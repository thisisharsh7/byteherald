import postsData from "../data/posts.json";

export type Post = {
  slug: string;
  title: string;
  dek: string;
  body: string;
  tags: string[];
  generator: string;
  sources: { label: string; url: string }[];
  created_at: number;
  source: string;
  score: number;
  comments: number;
};

export type Story = Post & {
  /** Uppercased first tag — the newspaper "section" this story sits under. */
  section: string;
  when: Date;
  /** First sentence or two of the body, for the lead story's excerpt. */
  excerpt: string;
};

const RAW = postsData as Post[];

export const stories: Story[] = RAW.map((p) => ({
  ...p,
  section: (p.tags[0] ?? "dispatch").replace(/-/g, " ").toUpperCase(),
  when: new Date(p.created_at),
  excerpt: excerptOf(p.body),
})).sort((a, b) => b.created_at - a.created_at);

function excerptOf(body: string, sentences = 3): string {
  const firstPara = body
    .split("\n")
    .map((l) => l.trim())
    .find((l) => l.length > 80 && !l.startsWith("_") && !l.startsWith("#"));
  if (!firstPara) return "";
  // Include any closing quote in the same chunk, otherwise a sentence ending
  // `..."` leaves the stray quote leading the *next* chunk.
  const parts = firstPara.match(/[^.!?]+[.!?]+["'\u201d\u2019]?/g);
  const text = parts ? parts.slice(0, sentences).join(" ") : firstPara;
  // Never open on dangling punctuation.
  return text.replace(/^[\s"'\u201c\u201d\u2018\u2019,;:)\]]+/, "").trim();
}

/**
 * The front page needs a real lead, not the newest item. Newspapers lead on the
 * biggest story of the cycle, so: take the recent window and pick the story with
 * the strongest engagement, normalised per source (HN scores run an order of
 * magnitude above Lobsters).
 */
const SOURCE_CEILING: Record<string, number> = { hackernews: 900, lobsters: 90 };

function weight(s: Story): number {
  const ceiling = SOURCE_CEILING[s.source] ?? 40;
  // Deliberately NOT clamped to 1. Clamping made every big story tie at the
  // ceiling, so the lead silently fell back to whichever was newest — which is
  // the exact bug this function exists to prevent.
  return (s.score + s.comments * 0.5) / ceiling;
}

/** [lead, ...rest] with rest still in reverse-chronological order. */
export function frontPage(recentWindow = 8): { lead?: Story; rest: Story[] } {
  if (stories.length === 0) return { rest: [] };
  const window = stories.slice(0, recentWindow);
  const lead = window.reduce((best, s) => (weight(s) > weight(best) ? s : best), window[0]!);
  return { lead, rest: stories.filter((s) => s.slug !== lead.slug) };
}

/** Every tag with its post count, most-used first. */
export function topics(): { tag: string; count: number }[] {
  const counts = new Map<string, number>();
  for (const s of stories) {
    for (const t of s.tags) counts.set(t, (counts.get(t) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([tag, count]) => ({ tag, count }))
    .sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag));
}

/** Tags used often enough to earn a slot in the masthead nav. */
export function navTopics(limit = 6): { tag: string; count: number }[] {
  return topics()
    .filter((t) => t.count > 1)
    .slice(0, limit);
}

export function byTopic(tag: string): Story[] {
  return stories.filter((s) => s.tags.includes(tag));
}

export function findStory(slug: string): Story | undefined {
  return stories.find((s) => s.slug === slug);
}

/** Issue number — one per distinct publishing day, oldest day = No. 1. */
export function issueNumber(): number {
  const days = new Set(stories.map((s) => s.when.toISOString().slice(0, 10)));
  return days.size;
}

export const dateLine = (d: Date) =>
  new Intl.DateTimeFormat("en-GB", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(d);

export const timeLine = (d: Date) =>
  new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "UTC",
  }).format(d) + " UTC";
