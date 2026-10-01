// What both hooks share: reading the hook input, and logging to stderr,
// which Claude Code shows only in verbose mode. Hooks never fail the tool
// call that ran them, so every path exits 0.

import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export interface HookInput {
  cwd?: string;
  tool_input?: { file_path?: string };
}

/** Absolute path of the CLI, for commands the session-start message and warnings give. */
export const CLI_PATH = join(dirname(fileURLToPath(import.meta.url)), "cli.ts");

export async function readHookInput(): Promise<HookInput> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(chunk as Buffer);
  const raw = Buffer.concat(chunks).toString("utf8");
  return (raw.trim() ? JSON.parse(raw) : {}) as HookInput;
}

export function warn(message: string): void {
  console.error(`[card-catalog] warning: ${message}`);
}

export function runHook(name: string, main: () => Promise<void>): void {
  main()
    .catch((err: unknown) => {
      warn(`${name} skipped: ${err instanceof Error ? err.message : String(err)}`);
    })
    .finally(() => {
      process.exitCode = 0;
    });
}
