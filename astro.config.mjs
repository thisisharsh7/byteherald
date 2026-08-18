import { defineConfig } from "astro/config";
import sitemap from "@astrojs/sitemap";

// `site` is required for canonical URLs, the sitemap and the RSS feed to emit
// absolute URLs. Change this if the site moves to a custom domain.
export default defineConfig({
  site: "https://wirehead.pages.dev",
  output: "static",
  trailingSlash: "always",
  devToolbar: { enabled: false },
  integrations: [sitemap()],
});
