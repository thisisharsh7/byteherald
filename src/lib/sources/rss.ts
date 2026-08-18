import { getText, mapLimit, type Candidate } from "./index";

export const FEEDS = [
  { name: "techcrunch", url: "https://techcrunch.com/feed/" },
  { name: "theverge", url: "https://www.theverge.com/rss/index.xml" },
  { name: "arstechnica", url: "https://arstechnica.com/feed/" },
  { name: "simonwillison", url: "https://simonwillison.net/atom/everything/" },
];

/**
 * Feeds have no score, so they can't compete with HN/Lobsters on engagement.
 * They earn their place by covering stories the aggregators miss; the ranker
 * gives them a flat baseline score (see rank.ts).
 */
const FEED_BASELINE_SCORE = 12;

export async function fetchFeeds(perFeed = 8): Promise<Candidate[]> {
  const results = await mapLimit(FEEDS, 4, async (feed) => {
    try {
      const xml = await getText(feed.url);
      return parseFeed(xml, feed.name).slice(0, perFeed);
    } catch (err) {
      console.warn(`  ! feed ${feed.name} failed: ${(err as Error).message}`);
      return [];
    }
  });
  return results.flat();
}

function parseFeed(xml: string, sourceName: string): Candidate[] {
  // Handles both RSS <item> and Atom <entry> with the same shape-agnostic pass.
  const blocks = [
    ...xml.matchAll(/<item\b[\s\S]*?<\/item>/gi),
    ...xml.matchAll(/<entry\b[\s\S]*?<\/entry>/gi),
  ].map((m) => m[0]);

  const out: Candidate[] = [];

  for (const block of blocks) {
    const title = decodeXml(tag(block, "title"));
    const link = extractLink(block);
    if (!title || !link) continue;

    const dateRaw =
      tag(block, "pubDate") ||
      tag(block, "published") ||
      tag(block, "updated") ||
      tag(block, "dc:date");
    const published = dateRaw ? Date.parse(dateRaw) : NaN;

    const guid = tag(block, "guid") || tag(block, "id") || link;

    out.push({
      id: `${sourceName}:${hash(guid)}`,
      source: sourceName,
      native_id: hash(guid),
      title,
      url: link,
      score: FEED_BASELINE_SCORE,
      comments: 0,
      comments_url: null,
      author: decodeXml(tag(block, "dc:creator") || tag(block, "name")) || null,
      tags: null,
      published_at: Number.isNaN(published) ? Date.now() : published,
    });
  }

  return out;
}

function tag(block: string, name: string): string {
  const re = new RegExp(`<${name}\\b[^>]*>([\\s\\S]*?)</${name}>`, "i");
  const raw = block.match(re)?.[1] ?? "";
  return stripCdata(raw).trim();
}

function extractLink(block: string): string | null {
  // RSS: <link>https://…</link>. Atom: <link rel="alternate" href="https://…"/>
  const plain = tag(block, "link");
  if (plain.startsWith("http")) return plain;

  const hrefs = [...block.matchAll(/<link\b([^>]*)\/?>/gi)].map((m) => m[1] ?? "");
  const alternate =
    hrefs.find((attrs) => /rel=["']?alternate/i.test(attrs)) ?? hrefs[0] ?? "";
  return alternate.match(/href=["']([^"']+)["']/i)?.[1] ?? null;
}

function stripCdata(s: string): string {
  return s.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1");
}

function decodeXml(s: string): string {
  return s
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;|&apos;/g, "'")
    .replace(/&#8217;/g, "’")
    .replace(/&#8216;/g, "‘")
    .replace(/&#8220;/g, "“")
    .replace(/&#8221;/g, "”")
    .replace(/&#8212;/g, "—")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .trim();
}

function hash(s: string): string {
  // Stable short id so the same feed entry maps to the same row across runs.
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(36);
}
