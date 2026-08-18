import rss from "@astrojs/rss";
import type { APIContext } from "astro";
import { stories } from "../lib/posts";

export function GET(context: APIContext) {
  return rss({
    title: "The Byte Herald",
    description:
      "Trending technology stories from Hacker News, Lobsters and independent feeds, read and written up automatically.",
    site: context.site!,
    items: stories.map((s) => ({
      title: s.title,
      description: s.dek,
      pubDate: s.when,
      link: `/posts/${s.slug}/`,
      categories: s.tags,
    })),
    customData: "<language>en</language>",
  });
}
