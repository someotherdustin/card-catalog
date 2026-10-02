#!/usr/bin/env node
// Finds a card-catalog CLI at the version this plugin pins, for the helper
// skills. A plugin can't locate another plugin's files, so the skills pass the
// path from the session-start message when they have it.
//
//   node scripts/find-cli.ts [<cli>]
//
// Prints the first usable command on stdout, ready to have a CLI command
// appended, and exits 0. Otherwise prints nothing on stdout, says on stderr
// why each source was rejected and how to install the CLI, and exits 1.

import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, realpathSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export const PACKAGE = "@someotherdustin/card-catalog";

export interface Tried {
  /** The command as it would be printed, or how the source is described. */
  source: string;
  reason: string;
}

export interface FindOptions {
  /** The version the CLI must report. */
  version: string;
  /** The CLI path from the session-start message, if any. */
  cli?: string | undefined;
  env?: NodeJS.ProcessEnv;
  /** Milliseconds to wait for `--version`: npx may download the package. */
  timeouts?: { npx: number; other: number };
}

export interface Found {
  command?: string;
  tried: Tried[];
}

interface Source {
  label: string;
  command: string;
  file: string;
  args: string[];
  timeout: number;
  /** npx and card-catalog are .cmd shims on Windows, which only run through a shell. */
  shell: boolean;
}

export function findCli({ version, cli, env = process.env, timeouts = { npx: 60_000, other: 10_000 } }: FindOptions): Found {
  const tried: Tried[] = [];
  const windows = process.platform === "win32";
  const npx = `npx -y ${PACKAGE}@${version}`;

  const sources: (Source | Tried)[] = [
    cli === undefined
      ? { source: 'node "<cli>"', reason: "not given" }
      : !existsSync(cli)
        ? { source: `node "${cli}"`, reason: "not found" }
        : { label: `node "${cli}"`, command: `node "${cli}"`, file: process.execPath, args: [cli], timeout: timeouts.other, shell: false },
    { label: npx, command: npx, file: "npx", args: ["-y", `${PACKAGE}@${version}`], timeout: timeouts.npx, shell: windows },
    { label: "card-catalog on PATH", command: "card-catalog", file: "card-catalog", args: [], timeout: timeouts.other, shell: windows },
  ];

  for (const source of sources) {
    if ("reason" in source) {
      tried.push(source);
      continue;
    }
    const reason = check(source, version, env);
    if (reason === undefined) return { command: source.command, tried };
    tried.push({ source: source.label, reason });
  }
  return { tried };
}

/** Runs the source's `--version`: undefined when it matches, else why not. */
function check(source: Source, version: string, env: NodeJS.ProcessEnv): string | undefined {
  const r = spawnSync(source.file, [...source.args, "--version"], {
    encoding: "utf8",
    env,
    timeout: source.timeout,
    killSignal: "SIGKILL",
    shell: source.shell,
    stdio: ["ignore", "pipe", "pipe"],
  });
  const code = (r.error as NodeJS.ErrnoException | undefined)?.code;
  if (code === "ENOENT") return "not found";
  if (code === "ETIMEDOUT") return "timed out";
  if (r.error) return `failed: ${r.error.message}`;
  if (r.status !== 0) return r.status === null ? `killed by ${String(r.signal)}` : `exited with code ${String(r.status)}`;
  const reported = r.stdout.trim().split("\n")[0]?.trim() ?? "";
  if (reported === version) return undefined;
  return reported ? `version ${reported}, need ${version}` : "printed no version";
}

/** The version in this plugin's own plugin.json, which pins card-catalog at the same version. */
export function pluginVersion(): string {
  const manifest = join(dirname(fileURLToPath(import.meta.url)), "..", ".claude-plugin", "plugin.json");
  return (JSON.parse(readFileSync(manifest, "utf8")) as { version: string }).version;
}

function isMain(): boolean {
  const script = process.argv[1];
  if (script === undefined) return false;
  try {
    return realpathSync(script) === realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
}

if (isMain()) {
  const version = pluginVersion();
  const found = findCli({ version, cli: process.argv[2] });
  if (found.command !== undefined) {
    process.stdout.write(`${found.command}\n`);
  } else {
    process.stderr.write(
      [
        `card-catalog-helpers: found no card-catalog CLI at version ${version}.`,
        ...found.tried.map((t) => `  ${t.source}: ${t.reason}`),
        `Install it with: npm install -g ${PACKAGE}@${version}`,
        "",
      ].join("\n"),
    );
    process.exitCode = 1;
  }
}
