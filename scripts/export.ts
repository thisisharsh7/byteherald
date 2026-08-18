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
};

export function exportPosts(path = EXPORT_PATH) {
  const db = openDb();
  const posts: ExportedPost[] = allPosts(db).map((p) => ({
    slug: p.slug,
    title: p.title,
    dek: p.dek,
    body: p.body,
    tags: JSON.parse(p.tags),
    generator: p.generator,
    sources: JSON.parse(p.sources),
    created_at: p.created_at,
  }));
  db.close();

  mkdirSync("src/data", { recursive: true });
  writeFileSync(path, JSON.stringify(posts, null, 2) + "\n");
  console.log(`✓ exported ${posts.length} posts -> ${path}`);
}

if (import.meta.main) exportPosts();
