/**
 * Stage 3: dump published posts to a plain JSON file for the site to build from.
 *
 * Why this stage exists: `bun:sqlite` only loads under bun, but `astro build`
 * runs under node (and so does every static host's build step). Exporting JSON
 * keeps the database a pipeline-side concern and lets the site build anywhere.
 *
 *   bun run export
 */
import { writeFileSync, mkdirSync } from "node:fs";
import { openDb, allPosts } from "../src/lib/db";

export const EXPORT_PATH = "src/data/posts.json";

export type ExportedPost = {
  slug: string;
  title: string;
  dek: string;
  body: string;
  tags: string[];
  generator: string;
  sources: { label: string; url: string }[];
  created_at: number;
  /** Engagement carried over from the source story, so the front page can pick
   *  a real lead instead of just showing the newest thing. */
  source: string;
  score: number;
  comments: number;
};

export function exportPosts(path = EXPORT_PATH) {
  const db = openDb();

  // Join back to the originating item for its engagement numbers.
  const engagement = new Map<string, { source: string; score: number; comments: number }>();
  for (const row of db
    .query<{ post_slug: string; source: string; score: number; comments: number }, []>(
      `SELECT c.post_slug, r.source, r.score, r.comments
         FROM covered c JOIN raw_items r ON r.id = c.item_id`,
    )
    .all()) {
    engagement.set(row.post_slug, {
      source: row.source,
      score: row.score,
      comments: row.comments,
    });
  }

  const posts: ExportedPost[] = allPosts(db).map((p) => {
    const e = engagement.get(p.slug);
    return {
      slug: p.slug,
      title: p.title,
      dek: p.dek,
      body: p.body,
      tags: JSON.parse(p.tags),
      generator: p.generator,
      sources: JSON.parse(p.sources),
      created_at: p.created_at,
      source: e?.source ?? "unknown",
      score: e?.score ?? 0,
      comments: e?.comments ?? 0,
    };
  });
  db.close();

  mkdirSync("src/data", { recursive: true });
  writeFileSync(path, JSON.stringify(posts, null, 2) + "\n");
  console.log(`✓ exported ${posts.length} posts -> ${path}`);
}

if (import.meta.main) exportPosts();
