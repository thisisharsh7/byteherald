import { getJson, mapLimit, type Candidate } from "./index";

const BASE = "https://hacker-news.firebaseio.com/v0";

type HnItem = {
  id: number;
  by?: string;
  time?: number;
  title?: string;
  url?: string;
  score?: number;
  descendants?: number;
  type?: string;
  deleted?: boolean;
  dead?: boolean;
};

/**
 * Hacker News Firebase API. No auth, no documented rate limit.
 * We pull `beststories` rather than `topstories` — best is score-weighted over a
 * longer window, which surfaces stories that actually held attention instead of
 * whatever is spiking in the last few minutes.
 */
export async function fetchHackerNews(limit = 30): Promise<Candidate[]> {
  const ids = await getJson<number[]>(`${BASE}/beststories.json`);
  const wanted = ids.slice(0, limit);

  const items = await mapLimit(wanted, 8, (id) =>
    getJson<HnItem | null>(`${BASE}/item/${id}.json`).catch(() => null),
  );

  return items.filter(isUsableStory).map((it) => ({
    id: `hn:${it.id}`,
    source: "hackernews",
    native_id: String(it.id),
    title: it.title!,
    url: it.url ?? null,
    score: it.score ?? 0,
    comments: it.descendants ?? 0,
    comments_url: `https://news.ycombinator.com/item?id=${it.id}`,
    author: it.by ?? null,
    tags: null,
    published_at: (it.time ?? 0) * 1000,
  }));
}

function isUsableStory(it: HnItem | null): it is HnItem {
  return Boolean(it && !it.deleted && !it.dead && it.type === "story" && it.title);
}
