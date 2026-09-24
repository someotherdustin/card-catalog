// SessionStart hook: tells the agent where the ADR index is and how to use
// it. It doesn't load the ADRs themselves: that cost grows with every ADR,
// and most sessions touch few of them. The agent greps INDEX.md for the area
// it's changing and opens only the ADRs that match.
//
// Read-only: it rebuilds the index in memory only to check whether INDEX.md
// on disk is current, and never writes. Like on-write, it always exits 0 and
// prints nothing when there are no ADRs.

import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { INDEX_MD_FILE } from "./index-md.ts";
import { buildIndex, findAdrDirs, indexIsCurrent } from "./index-store.ts";

interface HookInput {
  cwd?: string;
}

const reindexScript = join(dirname(fileURLToPath(import.meta.url)), "reindex.ts");

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks).toString("utf8");
}

function pointerText(dirs: { dir: string; count: number; current: boolean }[]): string {
  const listed = dirs.filter((d) => d.count > 0);
  if (listed.length === 0) return "";
  const lines = [
    "This repo records architecture decisions as ADRs. Each ADR directory has an INDEX.md with one line per ADR:",
    "ID, status, date amended, title and a one-line summary.",
    "",
    ...listed.map(
      (d) => `- ${join(d.dir, INDEX_MD_FILE)} (${String(d.count)} ADRs${d.current ? "" : ", out of date"})`,
    ),
    "",
    "Before changing an area, grep the index for its terms and open the ADRs whose lines match.",
    "If your work would contradict an accepted ADR, say so explicitly rather than silently overriding it.",
  ];
  if (listed.some((d) => !d.current)) {
    lines.push(`To bring an out-of-date index up to date, run: node "${reindexScript}"`);
  }
  return lines.join("\n");
}

async function main(): Promise<void> {
  const raw = await readStdin();
  const input = (raw.trim() ? JSON.parse(raw) : {}) as HookInput;
  const root = process.env["CLAUDE_PROJECT_DIR"] ?? input.cwd ?? process.cwd();

  const dirs = findAdrDirs(root).map((dir) => {
    const { index } = buildIndex(dir);
    return { dir: relative(root, dir) || ".", count: index.adrs.length, current: indexIsCurrent(dir, index) };
  });
  const text = pointerText(dirs);
  if (!text) return;

  process.stdout.write(
    JSON.stringify({
      hookSpecificOutput: { hookEventName: "SessionStart", additionalContext: text },
    }),
  );
}

main()
  .catch((err: unknown) => {
    console.error(`[adr-index] session-start skipped: ${err instanceof Error ? err.message : String(err)}`);
  })
  .finally(() => {
    process.exitCode = 0;
  });
