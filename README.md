# The Byte Herald

An automated technology newspaper. A pipeline reads what gained traction on Hacker
News, Lobsters and a set of independent tech feeds, fetches the articles those
discussions point at, and has Claude write a short report on the ones that
mattered. The output is a static site.

No human writes, edits or approves the copy.

**Live: [byteherald.pages.dev](https://byteherald.pages.dev)**

![The Byte Herald front page](docs/screenshot-front-page.png)

---

## How it works

```
  Hacker News ─┐
  Lobsters ────┤──▶ ingest ──▶ rank ──▶ write ──▶ export ──▶ build ──▶ deploy
  RSS feeds ───┘      │          │        │          │         │
                   fetch      score    Claude     posts.json  Astro
                   article    +dedupe   writes    (static)    static
                   text                 the post              output
```

Four stages, each runnable on its own:

| Stage | Script | What it does |
|---|---|---|
| **Ingest** | `scripts/ingest.ts` | Pulls candidates from every source into SQLite, then fetches and strips the linked article text. Failures are recorded per-URL so a known-bad link is never refetched. |
| **Rank** | `src/lib/rank.ts` | Scores `engagement × freshness × substance`, normalised per source, then dedupes by canonical URL and fuzzy headline match. Caps how many stories one source can contribute. |
| **Write** | `scripts/write.ts` | Sends the story plus its article text to Claude and validates the returned draft. Marks the story covered so it is never written about twice. |
| **Export + build** | `scripts/export.ts` | Dumps posts to `src/data/posts.json`; Astro builds a static site from that. |

The article-fetching step in stage one is what separates this from a headline
rewriter — the writer works from the actual text of the source, not the title.

---

## Quick start

Requires [Bun](https://bun.sh). Everything else installs from the lockfile.

```bash
bun install
bun run pipeline    # ingest → write → export
bun run build       # static site into dist/
bun run preview     # serve it at localhost:4321
```

`bun run publish` chains the whole thing and deploys.

### Writing backends

The writer picks a backend automatically; override with `WRITER=`.

| Backend | Requires | Cost / post | Use for |
|---|---|---|---|
| `api` | `ANTHROPIC_API_KEY` | ~$0.01–0.02 | production, scheduled runs |
| `claude-cli` | local Claude Code install | ~$0.08 | local dev with no API key |
| `placeholder` | nothing | free | layout work; output is labelled as a stub in the UI |

`claude-cli` shells out to `claude -p --output-format json`, which reuses whatever
auth the local Claude Code has. It costs more per post because every call re-pays
for Claude Code's own system prompt, and that floor does not shrink with trimming.

---

## Commands

| Command | Effect |
|---|---|
| `bun run ingest` | Fetch sources + article text |
| `bun run write` | Rank and write the next batch (`POSTS_PER_RUN=6`) |
| `bun run export` | Write `src/data/posts.json` from the database |
| `bun run pipeline` | ingest → write → export |
| `bun run build` | Static build into `dist/` |
| `bun run preview` | Serve `dist/` locally |
| `bun run deploy` | Push `dist/` to Cloudflare Pages |
| `bun run publish` | pipeline → build → deploy |

---

## Layout

```
scripts/          pipeline entry points (bun only)
  ingest.ts       stage 1 — sources + article extraction
  write.ts        stage 2 — rank + generate
  export.ts       stage 3 — database → JSON
  pipeline.ts     all three in order

src/lib/          logic
  db.ts           SQLite schema + queries
  rank.ts         story selection
  writer.ts       three writing backends + draft validation
  extract.ts      HTML → readable text
  posts.ts        site-side view of the exported posts
  sources/        hn.ts, lobsters.ts, rss.ts

src/pages/        the site
src/data/         posts.json (committed — the build reads this, not the database)
data/news.db      SQLite (gitignored — see below)
```

### Why the database is gitignored but `posts.json` is committed

`bun:sqlite` only loads under Bun, and `astro build` runs under Node — as does the
build step on every static host. So the database is a pipeline-side concern only,
and the site builds from plain JSON. Nothing under `src/pages` may import
`bun:sqlite`.

The database also holds the `covered` table, the record of which stories have
already been published. A cloud build starting from a fresh clone would have an
empty one and republish the same stories forever, so generation stays wherever the
database lives.

---

## Design

![An article page](docs/screenshot-article.png)

Typewriter/zine direction: `Special Elite` for display, `JetBrains Mono` for text
and furniture, both self-hosted as WOFF2 with no external requests. Khaki paper,
one red accent, yellow highlighter for emphasis, dashed rules.

Deliberately light-only. This is a newspaper; a dark broadsheet reads as a terminal.

The front page leads on the biggest story of the cycle — picked by
source-normalised engagement, not recency — with a numbered secondary rail and a
ruled grid below. Topic pages use a ruled index instead of the grid, because a
fixed-column grid leaves holes when a collection is small.

Responsiveness is verified programmatically rather than by eye: every page type is
rendered at 15 widths from 320px to 2560px and checked for horizontal overflow and
for balanced left/right margins on the reading column.

---

## SEO

Sitemap, `robots.txt`, canonical URLs, RSS, Open Graph and Twitter cards, a
generated 1200×630 social image, and JSON-LD (`WebSite`, `NewsArticle`,
`BreadcrumbList`).

The structured data names the **Organization** as author rather than inventing a
human byline. Passing a fabricated person to search engines would misrepresent who
wrote the text.

---

## Honest limitations

- **The copy is unreviewed.** Automated writing can misread a source, flatten an
  argument, or sound more certain than the evidence supports, and nothing here
  catches it before publication. Every post links its sources for that reason.
- **Volume is a real risk.** Google's spam policy targets "scaled content abuse" —
  mass-produced pages made primarily to rank. Fewer, better posts is the defence;
  the mitigations in place (sources on every post, no reproduction of source text,
  AI disclosure, rejecting untagged or unsourced drafts) help but do not replace it.
- **Ars Technica extraction returns nothing** — their pages are JS-rendered and the
  HTML extractor gets no text. RSS-tier stories rarely reach a published batch
  anyway.
- **No scheduling.** `bun run publish` is manual. Automating it in the cloud needs
  an API key and porting the database to D1.
- **No pagination.** The front page will get long past roughly 25 posts.

`trace.md` is the working log: every decision, every bug, and why. Including the
ones that were embarrassing.

---

## Sources

Hacker News (Firebase API), Lobsters (`hottest.json`), and RSS from TechCrunch,
The Verge, Ars Technica and Simon Willison. All free, no auth.

Reddit is not used — unauthenticated `.json` endpoints returned 403 from late May
2026.
