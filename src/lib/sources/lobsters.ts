import { getJson, type Candidate } from "./index";

type LobstersStory = {
  short_id: string;
  created_at: string;
  title: string;
  url: string;
  score: number;
  comment_count: number;
  submitter_user: string;
  tags: string[];
  comments_url: string;
};

/** Lobsters exposes its front page as JSON. Free, no auth. */
export async function fetchLobsters(limit = 25): Promise<Candidate[]> {
  const stories = await getJson<LobstersStory[]>("https://lobste.rs/hottest.json");

  return stories.slice(0, limit).map((s) => ({
    id: `lobsters:${s.short_id}`,
    source: "lobsters",
    native_id: s.short_id,
    // Self-posts have an empty `url`; fall back to the discussion page.
    title: s.title,
    url: s.url || s.comments_url,
    score: s.score ?? 0,
    comments: s.comment_count ?? 0,
    comments_url: s.comments_url,
    author: s.submitter_user ?? null,
    tags: JSON.stringify(s.tags ?? []),
    published_at: Date.parse(s.created_at),
  }));
}
