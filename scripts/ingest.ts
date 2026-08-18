/**
 * Stage 1: pull candidate stories from every source into raw_items,
 * then fetch the linked article text for the ones that look promising.
 *
 *   bun run ingest
 */
import { openDb, upsertRawItem, setArticleText, type RawItem } from "../src/lib/db";
import { fetchHackerNews } from "../src/lib/sources/hn";
import { fetchLobsters } from "../src/lib/sources/lobsters";
import { fetchFeeds } from "../src/lib/sources/rss";
import { mapLimit } from "../src/lib/sources/index";
import { extractArticle } from "../src/lib/extract";

// Per source, not overall. Ordering the whole queue by raw score means HN's
// three-digit scores take every slot and Lobsters/RSS stories reach the writer
// with no article text — which produces honest but useless "details are
// limited" posts.
const EXTRACT_PER_SOURCE = 12;

export async function ingest() {
  const db = openDb();
  const now = Date.now();

  console.log("→ fetching sources");
  const settled = await Promise.allSettled([
    fetchHackerNews(30),
    fetchLobsters(25),
    fetchFeeds(8),
  ]);

  const names = ["hackernews", "lobsters", "rss"];
  const candidates = settled.flatMap((r, i) => {
    if (r.status === "fulfilled") {
      console.log(`  ${names[i]}: ${r.value.length} items`);
      return r.value;
    }
    console.warn(`  ! ${names[i]} failed: ${r.reason}`);
    return [];
  });

  let inserted = 0;
  let updated = 0;
  for (const c of candidates) {
    const item: RawItem = { ...c, fetched_at: now, article_text: null, article_status: null };
    if (upsertRawItem(db, item) === "inserted") inserted++;
    else updated++;
  }
  console.log(`→ stored ${inserted} new, refreshed ${updated} existing`);

  // Only extract for items we haven't tried yet, best-of-each-source first —
  // this is the slow, network-bound part and there's no point re-fetching
  // failures (article_status is set even on failure, so they're excluded).
  const pending = db
    .query<{ id: string; url: string }, [number]>(
      `SELECT id, url FROM (
         SELECT id, url,
                ROW_NUMBER() OVER (PARTITION BY source ORDER BY score DESC) AS rn
           FROM raw_items
          WHERE article_status IS NULL AND url IS NOT NULL AND url != ''
       )
        WHERE rn <= ?`,
    )
    .all(EXTRACT_PER_SOURCE);

  console.log(`→ extracting article text for ${pending.length} items`);
  let ok = 0;
  await mapLimit(pending, 5, async (row) => {
    const { text, status } = await extractArticle(row.url);
    setArticleText(db, row.id, text, status);
    if (status === "ok") ok++;
    else console.log(`  - ${row.id}: ${status}`);
  });
  console.log(`→ extracted ${ok}/${pending.length} successfully`);

  const total = db.query<{ n: number }, []>("SELECT COUNT(*) AS n FROM raw_items").get()!;
  console.log(`✓ ingest done — ${total.n} items in db`);
  db.close();
}

if (import.meta.main) await ingest();
