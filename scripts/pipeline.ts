/**
 * The whole agent loop, in order. This is what a cron job runs.
 *
 *   bun run pipeline
 */
import { ingest } from "./ingest";
import { write } from "./write";
import { exportPosts } from "./export";

console.log("=== ingest ===");
await ingest();
console.log("\n=== write ===");
await write();
console.log("\n=== export ===");
exportPosts();
console.log("\nDone. Run `bun run build` to regenerate the site.");
