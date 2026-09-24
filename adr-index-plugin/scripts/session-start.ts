// SessionStart hook: puts a compact digest of every ADR (number, status,
// title, one-line summary) into the agent's context, so prior decisions are
// visible without opening any ADR bodies.
//
// Read-only: the digest is built in memory from the ADR files, so it is
// current even after a `git pull` and never dirties the working tree. Like
// on-write, it always exits 0 and prints nothing when there are no ADRs.

import { relative } from "node:path";
import { formatDigest } from "./digest.ts";
import { buildIndex, findAdrDirs } from "./index-store.ts";

interface HookInput {
  cwd?: string;
}

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks).toString("utf8");
}

async function main(): Promise<void> {
  const raw = await readStdin();
  const input = (raw.trim() ? JSON.parse(raw) : {}) as HookInput;
  const root = process.env["CLAUDE_PROJECT_DIR"] ?? input.cwd ?? process.cwd();

  const dirs = findAdrDirs(root).map((dir) => ({
    dir: relative(root, dir) || ".",
    adrs: buildIndex(dir).index.adrs,
  }));
  const digest = formatDigest(dirs);
  if (!digest) return;

  process.stdout.write(
    JSON.stringify({
      hookSpecificOutput: { hookEventName: "SessionStart", additionalContext: digest },
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
