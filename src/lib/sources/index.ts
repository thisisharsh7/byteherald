import type { RawItem } from "../db";

// ASCII only. HTTP header values must be latin-1; a non-ASCII character here
// (an em dash, a smart quote) makes fetch throw before the request goes out.
export const USER_AGENT =
  "agent-news/0.1 (+https://github.com/local/agent-news; polite tech-news aggregator)";

export type Candidate = Omit<RawItem, "article_text" | "article_status" | "fetched_at">;

export async function getJson<T>(url: string, timeoutMs = 15_000): Promise<T> {
  const res = await fetch(url, {
    headers: { "user-agent": USER_AGENT, accept: "application/json" },
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText} for ${url}`);
  return (await res.json()) as T;
}

export async function getText(url: string, timeoutMs = 15_000): Promise<string> {
  const res = await fetch(url, {
    headers: { "user-agent": USER_AGENT, accept: "*/*" },
    signal: AbortSignal.timeout(timeoutMs),
    redirect: "follow",
  });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText} for ${url}`);
  return await res.text();
}

/** Run promise-returning tasks with a concurrency cap, keeping input order. */
export async function mapLimit<T, R>(
  items: T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const out = new Array<R>(items.length);
  let cursor = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (true) {
      const i = cursor++;
      if (i >= items.length) return;
      out[i] = await fn(items[i]!, i);
    }
  });
  await Promise.all(workers);
  return out;
}
