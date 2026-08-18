import { Database } from "bun:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";

export const DB_PATH = process.env.NEWS_DB ?? "data/news.db";

export type RawItem = {
  id: string;
  source: string;
  native_id: string;
  title: string;
  url: string | null;
  score: number;
  comments: number;
  comments_url: string | null;
  author: string | null;
  tags: string | null;
  published_at: number;
  fetched_at: number;
  article_text: string | null;
  article_status: string | null;
};

export type Post = {
  slug: string;
  title: string;
  dek: string;
  body: string;
  tags: string;
  generator: string;
  sources: string;
  created_at: number;
};

export function openDb(path = DB_PATH): Database {
  mkdirSync(dirname(path), { recursive: true });
  const db = new Database(path, { create: true });
  db.exec("PRAGMA journal_mode = WAL");
  db.exec("PRAGMA foreign_keys = ON");
  migrate(db);
  return db;
}

function migrate(db: Database) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS raw_items (
      id             TEXT PRIMARY KEY,
      source         TEXT NOT NULL,
      native_id      TEXT NOT NULL,
      title          TEXT NOT NULL,
      url            TEXT,
      score          INTEGER NOT NULL DEFAULT 0,
      comments       INTEGER NOT NULL DEFAULT 0,
      comments_url   TEXT,
      author         TEXT,
      tags           TEXT,
      published_at   INTEGER NOT NULL,
      fetched_at     INTEGER NOT NULL,
      article_text   TEXT,
      article_status TEXT
    );

    CREATE INDEX IF NOT EXISTS raw_items_published ON raw_items (published_at DESC);
    CREATE INDEX IF NOT EXISTS raw_items_score     ON raw_items (score DESC);

    CREATE TABLE IF NOT EXISTS posts (
      slug       TEXT PRIMARY KEY,
      title      TEXT NOT NULL,
      dek        TEXT NOT NULL,
      body       TEXT NOT NULL,
      tags       TEXT NOT NULL,
      generator  TEXT NOT NULL,
      sources    TEXT NOT NULL,
      created_at INTEGER NOT NULL
    );

    CREATE INDEX IF NOT EXISTS posts_created ON posts (created_at DESC);

    -- Which raw items have already been written about, so we never
    -- publish the same story twice.
    CREATE TABLE IF NOT EXISTS covered (
      item_id   TEXT PRIMARY KEY,
      post_slug TEXT NOT NULL REFERENCES posts (slug) ON DELETE CASCADE
    );
  `);
}

/** Insert, or update volatile fields (score/comments) if we've seen it before. */
export function upsertRawItem(db: Database, item: RawItem): "inserted" | "updated" {
  const existing = db
    .query<{ id: string }, [string]>("SELECT id FROM raw_items WHERE id = ?")
    .get(item.id);

  if (existing) {
    db.query(
      `UPDATE raw_items
          SET score = ?, comments = ?, title = ?, fetched_at = ?
        WHERE id = ?`,
    ).run(item.score, item.comments, item.title, item.fetched_at, item.id);
    return "updated";
  }

  db.query(
    `INSERT INTO raw_items
       (id, source, native_id, title, url, score, comments, comments_url,
        author, tags, published_at, fetched_at, article_text, article_status)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    item.id,
    item.source,
    item.native_id,
    item.title,
    item.url,
    item.score,
    item.comments,
    item.comments_url,
    item.author,
    item.tags,
    item.published_at,
    item.fetched_at,
    item.article_text,
    item.article_status,
  );
  return "inserted";
}

export function setArticleText(
  db: Database,
  id: string,
  text: string | null,
  status: string,
) {
  db.query("UPDATE raw_items SET article_text = ?, article_status = ? WHERE id = ?").run(
    text,
    status,
    id,
  );
}

export function allPosts(db: Database): Post[] {
  return db.query<Post, []>("SELECT * FROM posts ORDER BY created_at DESC").all();
}

export function postBySlug(db: Database, slug: string): Post | null {
  return db.query<Post, [string]>("SELECT * FROM posts WHERE slug = ?").get(slug);
}
