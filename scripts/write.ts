/**
 * Stage 2: rank the ingested items, write a post for each of the top N,
 * and record which items are now covered so they're never used twice.
 *
 *   bun run write                        # auto-pick a backend
 *   POSTS_PER_RUN=3 bun run write
 *   WRITER=claude-cli bun run write      # force headless Claude Code
 */
import { openDb } from "../src/lib/db";
import { rankCandidates } from "../src/lib/rank";
import { writePost, resolveBackend } from "../src/lib/writer";

const POSTS_PER_RUN = Number(process.env.POSTS_PER_RUN ?? 6);

export async function write() {
  const db = openDb();
  const backend = resolveBackend();

  console.log(`→ writer backend: ${backend}`);
  if (backend === "placeholder") {
    console.warn(
      "! No writing backend available — emitting extractive placeholders.\n" +
        "  Set ANTHROPIC_API_KEY, or install the Claude Code CLI, then re-run.",
    );
  }
  if (backend === "claude-cli") {
    console.log("  (uses local Claude Code auth; ~$0.08/post, slower than the API)");
  }

  const candidates = rankCandidates(db, POSTS_PER_RUN);
  console.log(`→ ${candidates.length} stories selected`);

  const insertPost = db.query(
    `INSERT OR REPLACE INTO posts
       (slug, title, dek, body, tags, generator, sources, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  const markCovered = db.query(
    "INSERT OR REPLACE INTO covered (item_id, post_slug) VALUES (?, ?)",
  );

  let written = 0;
  for (const item of candidates) {
    const label = `${item.id} (${item.rank_score.toFixed(3)})`;
    const started = Date.now();
    try {
      const draft = await writePost(item, backend);
      const slug = slugify(draft.title, item.native_id);

      const sources = [
        item.url ? { label: hostOf(item.url), url: item.url } : null,
        item.comments_url
          ? { label: `${item.source} discussion`, url: item.comments_url }
          : null,
      ].filter(Boolean);

      db.transaction(() => {
        insertPost.run(
          slug,
          draft.title,
          draft.dek,
          draft.body,
          JSON.stringify(draft.tags),
          draft.generator,
          JSON.stringify(sources),
          Date.now(),
        );
        markCovered.run(item.id, slug);
      })();

      written++;
      const secs = ((Date.now() - started) / 1000).toFixed(1);
      console.log(`  ✓ ${label} ${secs}s -> /posts/${slug}`);
    } catch (err) {
      console.error(`  ✗ ${label}: ${(err as Error).message}`);
    }
  }

  const total = db.query<{ n: number }, []>("SELECT COUNT(*) AS n FROM posts").get()!;
  console.log(`✓ wrote ${written}/${candidates.length} posts — ${total.n} total in db`);
  db.close();
}

function slugify(title: string, suffix: string): string {
  const base = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 60)
    .replace(/-$/, "");
  return `${base || "post"}-${suffix}`;
}

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "source";
  }
}

if (import.meta.main) await write();
