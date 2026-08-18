import { USER_AGENT } from "./sources/index";

export type Extraction = { text: string | null; status: string };

const MAX_BYTES = 2_000_000;
const MAX_CHARS = 12_000;

/**
 * Fetch a linked article and reduce it to plain text.
 *
 * This is the step that separates a real post from rewritten headlines: the
 * writer needs the actual substance of the story. Deliberately conservative —
 * a failed extraction is fine (the writer falls back to title + discussion
 * context), a wrong extraction poisons the post.
 */
export async function extractArticle(url: string): Promise<Extraction> {
  let res: Response;
  try {
    res = await fetch(url, {
      headers: { "user-agent": USER_AGENT, accept: "text/html,*/*" },
      signal: AbortSignal.timeout(20_000),
      redirect: "follow",
    });
  } catch (err) {
    return { text: null, status: `fetch_error: ${(err as Error).message}` };
  }

  if (!res.ok) return { text: null, status: `http_${res.status}` };

  const type = res.headers.get("content-type") ?? "";
  if (!type.includes("html") && !type.includes("text/plain")) {
    return { text: null, status: `unsupported_type: ${type.split(";")[0]}` };
  }

  const buf = await res.arrayBuffer();
  if (buf.byteLength > MAX_BYTES) return { text: null, status: "too_large" };

  const html = new TextDecoder("utf-8", { fatal: false }).decode(buf);
  const text = htmlToText(html);

  if (text.length < 400) return { text: null, status: `too_short_${text.length}` };
  return { text: text.slice(0, MAX_CHARS), status: "ok" };
}

function htmlToText(html: string): string {
  let s = html;

  // Drop everything that never contains prose.
  s = s.replace(/<script\b[\s\S]*?<\/script>/gi, " ");
  s = s.replace(/<style\b[\s\S]*?<\/style>/gi, " ");
  s = s.replace(/<noscript\b[\s\S]*?<\/noscript>/gi, " ");
  s = s.replace(/<svg\b[\s\S]*?<\/svg>/gi, " ");
  s = s.replace(/<nav\b[\s\S]*?<\/nav>/gi, " ");
  s = s.replace(/<header\b[\s\S]*?<\/header>/gi, " ");
  s = s.replace(/<footer\b[\s\S]*?<\/footer>/gi, " ");
  s = s.replace(/<aside\b[\s\S]*?<\/aside>/gi, " ");
  s = s.replace(/<form\b[\s\S]*?<\/form>/gi, " ");
  s = s.replace(/<!--[\s\S]*?-->/g, " ");

  // Prefer the main content region when the page marks one.
  const main =
    s.match(/<article\b[\s\S]*?<\/article>/i)?.[0] ??
    s.match(/<main\b[\s\S]*?<\/main>/i)?.[0] ??
    s;

  // Keep paragraph boundaries so the writer sees structure, not a wall.
  let out = main.replace(/<\/(p|div|h[1-6]|li|br|tr|blockquote)>/gi, "\n");
  out = out.replace(/<br\s*\/?>/gi, "\n");
  out = out.replace(/<[^>]+>/g, " ");
  out = decodeEntities(out);
  out = out.replace(/[ \t ]+/g, " ");
  out = out
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .join("\n");

  return out.trim();
}

function decodeEntities(s: string): string {
  return s
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;|&apos;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/&mdash;|&#8212;/g, "—")
    .replace(/&ndash;|&#8211;/g, "–")
    .replace(/&#8217;|&rsquo;/g, "’")
    .replace(/&#8216;|&lsquo;/g, "‘")
    .replace(/&#8220;|&ldquo;/g, "“")
    .replace(/&#8221;|&rdquo;/g, "”")
    .replace(/&hellip;|&#8230;/g, "…")
    .replace(/&#(\d+);/g, (_, d) => String.fromCharCode(Number(d)))
    .replace(/&amp;/g, "&");
}
