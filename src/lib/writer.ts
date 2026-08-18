import Anthropic from "@anthropic-ai/sdk";
import { tmpdir } from "node:os";
import type { Ranked } from "./rank";

export type Draft = {
  title: string;
  dek: string;
  body: string;
  tags: string[];
};

export type WriteResult = Draft & { generator: string };

const MODEL = "claude-opus-5";

/**
 * Three ways to write a post, in preference order:
 *
 *  1. `api`        — the Anthropic API. Cheapest per post (~$0.01-0.02) and the
 *                    right choice for a scheduled pipeline. Needs a key.
 *  2. `claude-cli` — headless Claude Code (`claude -p`), using whatever auth the
 *                    local Claude Code install already has. No key needed, so
 *                    it's the fastest way to get a real site running, but each
 *                    call re-pays for Claude Code's own ~23k-token system prompt
 *                    (~$0.08/post) and it depends on a local binary.
 *  3. `placeholder` — extractive stub, dev only, labelled in the UI.
 *
 * Override with WRITER=api|claude-cli|placeholder.
 */
export type Backend = "api" | "claude-cli" | "placeholder";

export function resolveBackend(): Backend {
  const forced = process.env.WRITER as Backend | undefined;
  if (forced) return forced;
  if (process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN) return "api";
  if (Bun.which("claude")) return "claude-cli";
  return "placeholder";
}

const SYSTEM = `You write for an independent tech news site. Every post you write is
generated automatically from a source story, and the site tells readers that.

Your job is to write a short, genuinely informative post about one story. You are
given the story's headline, where it was discussed, and (usually) the text of the
linked article.

What a good post does:
- Leads with what actually happened, in one sentence a busy reader can act on.
- Explains why it matters to someone who builds software, in concrete terms.
- Notes what is still unknown or contested, if anything is.
- Stays close to the source. Every factual claim must be supported by the article
  text you were given.

Hard rules:
- Never invent facts, numbers, quotes, dates, or names. If the article text is
  missing or thin, write a shorter post about only what the headline supports and
  say plainly that details are limited.
- Do not reproduce the article. Quote at most one short sentence, and only when the
  exact wording matters.
- No hype, no "game-changer", no rhetorical questions as openers, no padding.
- Do not invent a byline, an interview, or first-hand reporting. You did not talk
  to anyone.

Length: 150-300 words of body. Markdown, plain paragraphs. No headings, no
title inside the body, no source list (the site renders those itself).`;

const SCHEMA = {
  type: "object",
  properties: {
    title: {
      type: "string",
      description:
        "The post headline. Original wording, not a copy of the source headline. Under 80 characters.",
    },
    dek: {
      type: "string",
      description: "One sentence standfirst summarising the story. Under 160 characters.",
    },
    body: {
      type: "string",
      description: "The post body in markdown. 150-300 words, plain paragraphs.",
    },
    tags: {
      type: "array",
      items: { type: "string" },
      description: "2-4 lowercase topic tags, e.g. 'ai', 'security', 'databases'.",
    },
  },
  required: ["title", "dek", "body", "tags"],
  additionalProperties: false,
} as const;

export async function writePost(item: Ranked, backend: Backend): Promise<WriteResult> {
  switch (backend) {
    case "api":
      return writeViaApi(item);
    case "claude-cli":
      return writeViaClaudeCli(item);
    case "placeholder":
      return extractiveDraft(item);
  }
}

// ---------------------------------------------------------------- api backend

async function writeViaApi(item: Ranked): Promise<WriteResult> {
  const client = new Anthropic();
  const response = await client.messages.create({
    model: MODEL,
    max_tokens: 4096,
    system: [{ type: "text", text: SYSTEM, cache_control: { type: "ephemeral" } }],
    // Routine summarisation. Lower effort is materially cheaper here and the
    // claude-api guidance is that low/medium punch well above their weight on
    // this model — worth re-sweeping against your own output.
    output_config: {
      effort: "medium",
      format: { type: "json_schema", schema: SCHEMA },
    },
    messages: [{ role: "user", content: buildPrompt(item) }],
  });

  if (response.stop_reason === "refusal") {
    throw new Error(
      `refused (${response.stop_details?.category ?? "unknown"}) for ${item.id}`,
    );
  }

  const text = response.content.find((b) => b.type === "text");
  if (!text || text.type !== "text") throw new Error(`no text block for ${item.id}`);

  return { ...validateDraft(JSON.parse(text.text)), generator: MODEL };
}

// --------------------------------------------------- headless claude-code backend

type CliEnvelope = {
  result?: string;
  is_error?: boolean;
  subtype?: string;
  total_cost_usd?: number;
};

async function writeViaClaudeCli(item: Ranked): Promise<WriteResult> {
  // The CLI has no structured-output flag, so the schema goes in the prompt and
  // we validate what comes back.
  const prompt = [
    SYSTEM,
    "",
    "Respond with a single JSON object and nothing else. No prose before or",
    "after it, no markdown code fence. It must match this schema exactly:",
    JSON.stringify(SCHEMA, null, 2),
    "",
    "The story:",
    "",
    buildPrompt(item),
  ].join("\n");

  const proc = Bun.spawn(
    [
      "claude",
      "-p",
      "--output-format",
      "json",
      "--model",
      MODEL,
      // The writer needs no tools; denying them keeps it from wandering off
      // and trims the request.
      "--allowed-tools",
      "",
    ],
    {
      // Run outside the project so the CLI does not load this repo's CLAUDE.md
      // and mistake our engineering instructions for writing instructions.
      cwd: tmpdir(),
      stdin: new TextEncoder().encode(prompt),
      stdout: "pipe",
      stderr: "pipe",
    },
  );

  const [stdout, stderr, code] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);

  if (code !== 0) {
    throw new Error(`claude cli exited ${code}: ${stderr.trim().slice(0, 300)}`);
  }

  let envelope: CliEnvelope;
  try {
    envelope = JSON.parse(stdout) as CliEnvelope;
  } catch {
    throw new Error(`claude cli returned non-JSON: ${stdout.slice(0, 200)}`);
  }

  if (envelope.is_error || !envelope.result) {
    throw new Error(`claude cli error (${envelope.subtype ?? "unknown"})`);
  }

  const draft = validateDraft(parseLooseJson(envelope.result));
  return { ...draft, generator: `${MODEL} (claude-code)` };
}

/** The CLI sometimes wraps JSON in a fence or adds a stray sentence. */
function parseLooseJson(raw: string): unknown {
  const text = raw.trim();

  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const candidate = fenced ? fenced[1]!.trim() : text;

  try {
    return JSON.parse(candidate);
  } catch {
    // Fall back to the outermost {...} span.
    const start = candidate.indexOf("{");
    const end = candidate.lastIndexOf("}");
    if (start === -1 || end <= start) {
      throw new Error(`no JSON object in model output: ${text.slice(0, 200)}`);
    }
    return JSON.parse(candidate.slice(start, end + 1));
  }
}

function validateDraft(value: unknown): Draft {
  if (typeof value !== "object" || value === null) throw new Error("draft is not an object");
  const d = value as Record<string, unknown>;

  const str = (key: string): string => {
    const v = d[key];
    if (typeof v !== "string" || v.trim().length === 0) {
      throw new Error(`draft.${key} missing or empty`);
    }
    return v.trim();
  };

  const tags = Array.isArray(d.tags)
    ? d.tags.filter((t): t is string => typeof t === "string" && t.trim().length > 0)
    : [];

  const body = str("body");
  if (body.split(/\s+/).length < 40) throw new Error("draft.body suspiciously short");

  // Tags drive the section kicker and the topic pages, so an untagged post
  // renders as a sectionless orphan. Fail here instead: the story stays
  // uncovered and gets retried on the next run.
  if (tags.length === 0) throw new Error("draft.tags empty");

  return {
    title: str("title"),
    dek: str("dek"),
    body,
    tags: tags.slice(0, 4).map((t) => t.toLowerCase().trim()),
  };
}

// -------------------------------------------------------------- shared prompt

function buildPrompt(item: Ranked): string {
  const parts = [
    `Headline: ${item.title}`,
    `Discussed on: ${item.source}`,
    item.url ? `Source URL: ${item.url}` : null,
    item.tags ? `Source tags: ${(JSON.parse(item.tags) as string[]).join(", ")}` : null,
    `Engagement: ${item.score} points, ${item.comments} comments`,
  ].filter(Boolean);

  if (item.article_status === "ok" && item.article_text) {
    parts.push("", "--- ARTICLE TEXT ---", item.article_text, "--- END ARTICLE TEXT ---");
  } else {
    parts.push(
      "",
      `The linked article could not be retrieved (${item.article_status ?? "not attempted"}).`,
      "Write only what the headline supports, and say that details are limited.",
    );
  }

  parts.push("", "Write the post.");
  return parts.join("\n");
}

// ---------------------------------------------------------- placeholder backend

/**
 * Dev-only stub for when neither an API key nor the Claude Code CLI is
 * available. Extractive, not written — labelled as such in the UI.
 */
function extractiveDraft(item: Ranked): WriteResult {
  const source = item.article_text
    ? firstSentences(item.article_text, 5)
    : "The linked article could not be retrieved, so only the headline is available.";

  return {
    title: item.title,
    dek: `From ${item.source} — ${item.score} points, ${item.comments} comments.`,
    body: [
      "_This is an unwritten placeholder. It shows the real ingested story with an" +
        " extract of the source article, so the layout can be reviewed before a" +
        " writing backend is available._",
      "",
      source,
    ].join("\n"),
    tags: item.tags ? (JSON.parse(item.tags) as string[]).slice(0, 3) : [item.source],
    generator: "placeholder-extractive",
  };
}

function firstSentences(text: string, count: number): string {
  const body = text.split("\n").find((line) => line.length > 200) ?? text;
  const sentences = body.match(/[^.!?]+[.!?]+/g) ?? [body.slice(0, 500)];
  return sentences.slice(0, count).join(" ").trim();
}
