// Backfill / repair: rebuild index.json and INDEX.md for every ADR directory under a root.
//   node scripts/reindex.ts [root]   (default: current directory)

import { resolve } from "node:path";
import { findAdrDirs, refreshIndex } from "./index-store.ts";

const root = resolve(process.argv[2] ?? ".");
const dirs = findAdrDirs(root);
if (!dirs.length) console.log(`No docs/adr or doc/adr directories under ${root}`);

for (const dir of dirs) {
  const { changed, count, warnings } = refreshIndex(dir);
  for (const w of warnings) console.warn(`warning: ${w}`);
  console.log(`${changed ? "updated" : "unchanged"}: ${dir} (${String(count)} ADRs)`);
}
