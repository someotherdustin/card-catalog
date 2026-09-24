// PostToolUse hook for Write|Edit|MultiEdit. If the touched file is an ADR,
// rebuild that directory's index.json and INDEX.md.
//
// Never blocks: every path exits 0. Problems go to stderr, which Claude Code
// only surfaces in verbose mode, so the grilling session that wrote the ADR
// is never interrupted by us.

import { isAbsolute, resolve } from "node:path";
import { adrDirForFile, refreshIndex } from "./index-store.ts";

interface HookInput {
  cwd?: string;
  tool_input?: { file_path?: string };
}

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks).toString("utf8");
}

async function main(): Promise<void> {
  const input = JSON.parse(await readStdin()) as HookInput;
  const raw = input.tool_input?.file_path;
  if (!raw) return;

  const filePath = isAbsolute(raw) ? raw : resolve(input.cwd ?? process.cwd(), raw);
  const adrDir = adrDirForFile(filePath);
  if (!adrDir) return;

  const { changed, count, warnings } = refreshIndex(adrDir);
  for (const w of warnings) console.error(`[adr-index] warning: ${w}`);
  if (changed) console.error(`[adr-index] indexed ${String(count)} ADR(s) in ${adrDir}`);
}

main()
  .catch((err: unknown) => {
    console.error(`[adr-index] skipped: ${err instanceof Error ? err.message : String(err)}`);
  })
  .finally(() => {
    process.exitCode = 0;
  });
