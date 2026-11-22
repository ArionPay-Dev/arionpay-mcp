// Copies the docs snapshot next to the compiled code (dist/docs-snapshot.json).
import { copyFileSync, existsSync } from "node:fs";
const from = new URL("../src/docs-snapshot.json", import.meta.url);
if (!existsSync(from)) {
  console.error("src/docs-snapshot.json is missing: run npm run docs-snapshot -- <website dist folder>");
  process.exit(1);
}
copyFileSync(from, new URL("../dist/docs-snapshot.json", import.meta.url));
