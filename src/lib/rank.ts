import type { Database } from "bun:sqlite";
import type { RawItem } from "./db";

export type Ranked = RawItem & { rank_score: number };

// Per-source score ceilings, used to normalise engagement onto a 0-1 scale.
// Without this HN (scores in the hundreds) drowns out Lobsters (tens) entirely.
const CEILING: Record<string, number> = {
  hackernews: 500,
  lobsters: 80,
};
const DEFAULT_CEILING = 40;

const HALF_LIFE_HOURS = 30;

// HN has both the highest raw scores and the best article-extraction rate, so
// without a cap it takes every slot and the feed reads like an HN mirror.
const MAX_PER_SOURCE = 3;

/**
 * Pick the stories worth writing about.
 *
 * Engagement alone favours whatever is loudest; recency alone favours whatever
 * is newest. The product of the two, with per-source normalisation, is what
 * gets a mixed feed that isn't dominated by one site.
 */
export function rankCandidates(db: Database, limit: number): Ranked[] {
  const rows = db
    .query<RawItem, []>(
      `SELECT * FROM raw_items
        WHERE id NOT IN (SELECT item_id FROM covered)
        ORDER BY score DESC
        LIMIT 200`,
    )
    .all();

  const now = Date.now();
  const scored = rows.map((r) => {
    const ceiling = CEILING[r.source] ?? DEFAULT_CEILING;
    const engagement = Math.min(1, (r.score + r.comments * 0.5) / ceiling);

    const ageHours = Math.max(0, (now - r.published_at) / 3_600_000);
    const freshness = Math.pow(0.5, ageHours / HALF_LIFE_HOURS);

    // Having the article body is a big deal — it's what lets the writer say
    // something instead of paraphrasing a headline.
    const substance = r.article_status === "ok" ? 1.25 : 0.7;

    return { ...r, rank_score: engagement * freshness * substance };
  });

  scored.sort((a, b) => b.rank_score - a.rank_score);
  return diversify(dedupe(scored), limit);
}

/**
 * Take the best items in score order, but stop taking from a source once it
 * has filled its quota — then fall back to filling any remaining slots purely
 * by score, so a thin news day still produces a full batch.
 */
function diversify(items: Ranked[], limit: number): Ranked[] {
  const perSource = new Map<string, number>();
  const picked: Ranked[] = [];
  const overflow: Ranked[] = [];

  for (const item of items) {
    const used = perSource.get(item.source) ?? 0;
    if (used < MAX_PER_SOURCE && picked.length < limit) {
      perSource.set(item.source, used + 1);
      picked.push(item);
    } else {
      overflow.push(item);
    }
  }

  return picked.concat(overflow).slice(0, limit);
}

/** Drop cross-posts: same destination URL, or near-identical headline. */
function dedupe(items: Ranked[]): Ranked[] {
  const seenUrls = new Set<string>();
  const seenTitles: string[] = [];
  const out: Ranked[] = [];

  for (const item of items) {
    const key = item.url ? canonicalUrl(item.url) : null;
    if (key && seenUrls.has(key)) continue;

    const norm = normaliseTitle(item.title);
    if (seenTitles.some((t) => similarity(t, norm) > 0.7)) continue;

    if (key) seenUrls.add(key);
    seenTitles.push(norm);
    out.push(item);
  }
  return out;
}

export function canonicalUrl(url: string): string {
  try {
    const u = new URL(url);
    u.hash = "";
    u.search = "";
    u.hostname = u.hostname.replace(/^www\./, "");
    u.pathname = u.pathname.replace(/\/$/, "");
    return `${u.hostname}${u.pathname}`.toLowerCase();
  } catch {
    return url.toLowerCase();
  }
}

function normaliseTitle(t: string): string {
  return t.toLowerCase().replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ").trim();
}

/** Jaccard overlap of word sets — cheap and good enough for headline dupes. */
function similarity(a: string, b: string): number {
  const A = new Set(a.split(" ").filter((w) => w.length > 3));
  const B = new Set(b.split(" ").filter((w) => w.length > 3));
  if (A.size === 0 || B.size === 0) return 0;
  let shared = 0;
  for (const w of A) if (B.has(w)) shared++;
  return shared / Math.min(A.size, B.size);
}
