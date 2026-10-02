#!/usr/bin/env node
// The card-catalog CLI: how operators and CI use card-catalog, and what
// helper skills and agents call. It runs the same core as the hooks.
//
//   node scripts/cli.ts <command> [options]      (card-catalog from the npm package)

import { realpathSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseEntry } from "./core/config.ts";
import {
  type Collection, makeCollection, profileForType, type SettingField, settingsFor,
} from "./core/collections.ts";
import { buildIndex, type BuiltIndex, writeIndex } from "./core/index-build.ts";
import { findOrphans } from "./core/orphans.ts";
import { displayDir, findRepoRoot, isDirectory, repoRelative } from "./core/paths.ts";
import type { Problem } from "./core/problems.ts";
import { BUILTIN_PROFILES, PROFILE_FIELDS, recordCount, resolveProfile } from "./core/profile.ts";
import { openRepo, type Repo } from "./core/repo.ts";
import { validate } from "./core/validate.ts";
import { VERSION } from "./core/version.ts";

export interface Io {
  out: (text: string) => void;
  err: (text: string) => void;
  cwd: string;
}

class UsageError extends Error {}
class Failure extends Error {}

interface Args {
  command: string | undefined;
  positionals: string[];
  root?: string;
  json: boolean;
  help: boolean;
  version: boolean;
  strict: boolean;
  type?: string;
  entry?: string;
}

const COMMANDS: Record<string, { usage: string; summary: string; options: string[]; args: [number, number] }> = {
  list: { usage: "list", summary: "List collections, directories that aren't one and why, and orphaned indexes.", options: [], args: [0, 0] },
  reindex: { usage: "reindex [<dir>…]", summary: "Rebuild and write the index of every collection, or of the ones named.", options: [], args: [0, Infinity] },
  preview: {
    usage: "preview <dir> [--type <type>] [--entry <json>]",
    summary: "Print the index <dir> would get, without writing anything.",
    options: ["--type", "--entry"],
    args: [1, 1],
  },
  profile: {
    usage: "profile <dir> [--type <type>] [--entry <json>]",
    summary: "Show the resolved profile and settings for <dir>, and where each value comes from.",
    options: ["--type", "--entry"],
    args: [1, 1],
  },
  types: { usage: "types", summary: "List the built-in record types a config entry can name.", options: [], args: [0, 0] },
  validate: { usage: "validate [--strict]", summary: "Check config, records and indexes across the repo.", options: ["--strict"], args: [0, 0] },
};

const HELP = `card-catalog ${VERSION}: grep-able indexes of the markdown records in a repo.

Usage: card-catalog <command> [options]

Commands:
${Object.values(COMMANDS).map((c) => `  ${c.usage.padEnd(48)} ${c.summary}`).join("\n")}

Options:
  --root <dir>   The repo root. Default: the repo root of the current directory.
  --json         Print one JSON object on stdout and nothing else there.
  --help, -h     Help for the CLI or a command.
  --version      The version.

Exit codes: 0 success, 1 the command ran and failed, 2 usage error.`;

function parseArgs(argv: string[]): Args {
  const args: Args = { command: undefined, positionals: [], json: false, help: false, version: false, strict: false };
  for (let i = 0; i < argv.length; i++) {
    const raw = argv[i] ?? "";
    const eq = raw.startsWith("--") ? raw.indexOf("=") : -1;
    const name = eq === -1 ? raw : raw.slice(0, eq);
    const value = (): string => {
      if (eq !== -1) return raw.slice(eq + 1);
      const v = argv[++i];
      if (v === undefined) throw new UsageError(`${name} needs a value`);
      return v;
    };
    switch (name) {
      case "--root": args.root = value(); break;
      case "--type": args.type = value(); break;
      case "--entry": args.entry = value(); break;
      case "--json": args.json = true; break;
      case "--strict": args.strict = true; break;
      case "--help": case "-h": args.help = true; break;
      case "--version": args.version = true; break;
      default:
        if (raw.startsWith("-") && raw !== "-") throw new UsageError(`unknown option ${name}`);
        if (args.command === undefined) args.command = raw;
        else args.positionals.push(raw);
    }
  }
  return args;
}

/** Runs the CLI and returns its exit code. */
export function runCli(argv: string[], io: Io): number {
  let args: Args;
  try {
    args = parseArgs(argv);
    if (args.version) {
      io.out(VERSION);
      return 0;
    }
    const spec = args.command !== undefined ? COMMANDS[args.command] : undefined;
    if (args.help) {
      io.out(spec ? `Usage: card-catalog ${spec.usage} [--root <dir>] [--json]\n\n${spec.summary}` : HELP);
      return 0;
    }
    if (args.command === undefined) throw new UsageError("no command given");
    if (!spec) throw new UsageError(`unknown command ${args.command}`);
    for (const [flag, set] of [["--type", args.type !== undefined], ["--entry", args.entry !== undefined], ["--strict", args.strict]] as const) {
      if (set && !spec.options.includes(flag)) throw new UsageError(`${args.command} doesn't take ${flag}`);
    }
    const [min, max] = spec.args;
    if (args.positionals.length < min) throw new UsageError(`${args.command} needs a directory`);
    if (args.positionals.length > max) throw new UsageError(`${args.command} takes at most ${String(max)} argument${max === 1 ? "" : "s"}`);
  } catch (err) {
    if (!(err instanceof UsageError)) throw err;
    io.err(`card-catalog: ${err.message}. Run card-catalog --help for usage.`);
    return 2;
  }

  const root = args.root !== undefined ? resolve(io.cwd, args.root) : findRepoRoot(io.cwd);
  const ctx = new Context(args, io, root);
  try {
    switch (args.command) {
      case "list": return ctx.list();
      case "reindex": return ctx.reindex();
      case "preview": return ctx.preview();
      case "profile": return ctx.profile();
      case "types": return ctx.types();
      case "validate": return ctx.validate();
      default: return 2;
    }
  } catch (err) {
    if (err instanceof UsageError) {
      io.err(`card-catalog: ${err.message}. Run card-catalog --help for usage.`);
      return 2;
    }
    if (!(err instanceof Failure)) throw err;
    if (args.json) io.out(JSON.stringify({ error: err.message, warnings: ctx.warnings }, null, 2));
    else io.err(`card-catalog: ${err.message}`);
    return 1;
  }
}

class Context {
  readonly warnings: string[] = [];
  private readonly args: Args;
  private readonly io: Io;
  private readonly root: string;

  constructor(args: Args, io: Io, root: string) {
    this.args = args;
    this.io = io;
    this.root = root;
  }

  private emit(text: string, json: object): void {
    if (this.args.json) this.io.out(JSON.stringify({ ...json, warnings: this.warnings }, null, 2));
    else if (text) this.io.out(text);
  }

  private warn(message: string): void {
    this.warnings.push(message);
    if (!this.args.json) this.io.err(`warning: ${message}`);
  }

  private warnProblems(problems: Problem[]): void {
    for (const p of problems) if (p.severity !== "note") this.warn(`${p.path}: ${p.message}`);
  }

  private open(): Repo {
    const opened = openRepo(this.root);
    if (!opened.ok) {
      throw new Failure(`card-catalog.json is invalid:\n${opened.problems.map((p) => `  ${p.message}`).join("\n")}\nRun: card-catalog validate`);
    }
    return opened.repo;
  }

  private dirArg(arg: string): string {
    const rel = repoRelative(this.root, resolve(this.io.cwd, arg));
    if (rel === undefined) throw new Failure(`${arg} is outside the repo at ${this.root}`);
    return rel;
  }

  list(): number {
    const repo = this.open();
    this.warnProblems(repo.problems);
    const rows = repo.collections.map((c) => {
      const built = buildIndex(repo, c);
      return { c, built, index: c.indexFile ?? (c.settings.indexPath === "none" ? "-" : (c.jsonFile ?? "-")) };
    });
    const orphans = findOrphans(repo, { allMarkdown: true });
    const where = (entry: number | null) => (entry === null ? "default" : `config entry ${String(entry)}`);

    const dirW = Math.max(0, ...rows.map((r) => displayDir(r.c.dir).length), ...repo.notIndexed.map((n) => n.dir.length));
    const typeW = Math.max(0, ...rows.map((r) => r.c.type.length), ...repo.notIndexed.map((n) => n.type.length));
    const countW = Math.max(0, ...rows.map((r) => String(r.built.records.length).length));
    const indexW = Math.max(0, ...rows.map((r) => r.index.length));
    const lines = [
      ...rows.map(({ c, built, index }) => {
        const n = built.records.length;
        const state = `${built.state}${c.settings.announce ? "" : ", not announced"}`;
        return `${displayDir(c.dir).padEnd(dirW)}  ${c.type.padEnd(typeW)}  ${String(n).padStart(countW)} record${n === 1 ? " " : "s"}  ${index.padEnd(indexW)}  ${state}`;
      }),
      ...repo.notIndexed.map((n) => {
        const why = n.reason === "ignored" ? `ignored by ${n.detail ?? "an ignore rule"}` : "matches no directory";
        return `${n.dir.padEnd(dirW)}  ${n.type.padEnd(typeW)}  not indexed: ${why} (${where(n.entry)})`;
      }),
      ...orphans.map((o) => `orphaned index: ${o}`),
    ];
    this.emit(lines.length ? lines.join("\n") : "No collections.", {
      root: repo.root,
      config: repo.configPresent ? "card-catalog.json" : null,
      collections: rows.map(({ c, built }) => ({
        dir: c.dir, type: c.type, source: c.source, entry: c.entry,
        records: built.records.length, index: c.indexFile ?? null, state: built.state, announce: c.settings.announce,
      })),
      notIndexed: repo.notIndexed.map((n) => ({ dir: n.dir, type: n.type, source: n.source, entry: n.entry, reason: n.reason, ...(n.detail !== undefined ? { detail: n.detail } : {}) })),
      orphans,
    });
    return 0;
  }

  reindex(): number {
    const repo = this.open();
    this.warnProblems(repo.problems);
    let targets = repo.collections;
    if (this.args.positionals.length) {
      targets = this.args.positionals.map((arg) => {
        const dir = this.dirArg(arg);
        const c = repo.collections.find((x) => x.dir === dir);
        if (!c) throw new Failure(`${displayDir(dir)} is not a collection${notIndexedReason(repo, dir)}`);
        return c;
      });
    }
    const results: { dir: string; type: string; records: number; changed: boolean }[] = [];
    const lines: string[] = [];
    let failed = false;
    for (const c of targets) {
      const built = buildIndex(repo, c);
      this.warnProblems(built.problems.filter((p) => !INDEX_STATE_CODES.has(p.code)));
      if (built.newer) {
        this.warn(`${displayDir(c.dir)}: skipped, its index.json is from a newer card-catalog`);
        results.push({ dir: c.dir, type: c.type, records: built.records.length, changed: false });
        continue;
      }
      let changed = false;
      try {
        changed = writeIndex(repo, built);
      } catch (err) {
        failed = true;
        this.io.err(`card-catalog: writing the index of ${displayDir(c.dir)} failed: ${(err as Error).message}`);
      }
      results.push({ dir: c.dir, type: c.type, records: built.records.length, changed });
      lines.push(`${changed ? "updated" : "unchanged"}: ${displayDir(c.dir)} (${recordCount(c.profile, built.records.length)})`);
    }
    this.emit(lines.join("\n"), { collections: results });
    return failed ? 1 : 0;
  }

  /** The collection to preview or describe: the one at <dir>, or one made from --type / --entry. */
  private target(repo: Repo, dir: string): Collection {
    if (this.args.entry !== undefined) {
      let json: unknown;
      try {
        json = JSON.parse(this.args.entry);
      } catch (err) {
        throw new UsageError(`--entry isn't valid JSON: ${(err as Error).message}`);
      }
      const parsed = parseEntry(json, 0, true);
      if ("errors" in parsed) throw new Failure(`--entry is invalid:\n${parsed.errors.map((e) => `  ${e}`).join("\n")}`);
      const resolved = resolveProfile(parsed.entry.type, parsed.entry.profileFields, "--entry");
      return makeCollection(dir, parsed.entry.type, resolved, settingsFor(parsed.entry, "--entry"), "config", null);
    }
    const existing = repo.collections.find((x) => x.dir === dir);
    if (this.args.type !== undefined) {
      const resolved = profileForType(repo.config, this.args.type);
      const settings = existing
        ? { settings: existing.settings, sources: existing.settingSources }
        : settingsFor(undefined, "default");
      return makeCollection(dir, this.args.type, resolved, settings, existing?.source ?? "config", existing?.entry ?? null);
    }
    if (!existing) throw new Failure(`${displayDir(dir)} is not a collection${notIndexedReason(repo, dir)}`);
    return existing;
  }

  preview(): number {
    const repo = this.open();
    const dir = this.dirArg(this.args.positionals[0] ?? ".");
    if (!isDirectory(resolve(this.root, dir))) throw new Failure(`${displayDir(dir)} is not a directory`);
    const st = repo.ignore.check([{ path: dir, isDir: true }]).get(dir) ?? {};
    if (st.ignoredBy !== undefined) throw new Failure(`${displayDir(dir)} is ignored by ${st.ignoredBy}, so nothing from it is shown`);
    if (st.outside) throw new Failure(`${displayDir(dir)} is a symlink to a directory outside the repo`);
    const c = this.target(repo, dir);
    const built: BuiltIndex = buildIndex(repo, c);
    if (!this.args.json) for (const s of built.skipped) this.io.err(`skipped: ${s.file} (${s.message})`);
    this.warnProblems(built.problems.filter((p) => !INDEX_STATE_CODES.has(p.code) && !SKIP_CODES.has(p.code)));
    if (this.args.json) {
      this.emit("", {
        dir: c.dir, type: c.type,
        records: built.records.map((r, i) => ({ ...r, line: built.lines[i] })),
        skipped: built.skipped.map((s) => ({ file: s.file, reason: s.reason })),
      });
    } else {
      this.io.out(built.preview.replace(/\n$/, ""));
    }
    return 0;
  }

  profile(): number {
    const repo = this.open();
    const dir = this.dirArg(this.args.positionals[0] ?? ".");
    const c = this.target(repo, dir);
    const profile = c.profile as unknown as Record<string, unknown>;
    const settings = c.settings as unknown as Record<string, unknown>;
    const header = `${displayDir(c.dir)}: ${c.type} (${this.args.entry !== undefined ? "--entry" : this.args.type !== undefined ? "--type" : c.entry === null ? "default" : `config entry ${String(c.entry)}`})`;
    const rows = PROFILE_FIELDS.map((f) => [f, show(profile[f]), c.profileSources[f]]);
    const settingRows = SETTING_FIELDS.map((f) => [f, show(settings[f]), c.settingSources[f]]);
    const valueW = Math.min(48, Math.max(...[...rows, ...settingRows].map((r) => (r[1] ?? "").length)));
    const row = ([f = "", v = "", s = ""]: string[]) => `  ${f.padEnd(11)} ${v.padEnd(valueW)}  ${s}`;
    this.emit([header, ...rows.map(row), "  settings:", ...settingRows.map(row)].join("\n"), {
      dir: c.dir, type: c.type, profile: c.profile, settings: c.settings, sources: c.profileSources, settingSources: c.settingSources,
    });
    return 0;
  }

  types(): number {
    const types = Object.entries(BUILTIN_PROFILES).map(([name, p]) => ({ name, plural: p.plural, description: p.description ?? null }));
    const nameW = Math.max(0, ...types.map((t) => t.name.length));
    const pluralW = Math.max(0, ...types.map((t) => t.plural.length));
    this.emit(types.map((t) => `${t.name.padEnd(nameW)}  ${t.plural.padEnd(pluralW)}  ${t.description ?? ""}`.trimEnd()).join("\n"), { types });
    return 0;
  }

  validate(): number {
    const { problems, counts } = validate(this.root);
    if (this.args.json) {
      this.io.out(JSON.stringify({ problems, counts }, null, 2));
    } else {
      const codeW = Math.max(0, ...problems.map((p) => p.code.length));
      const pathW = Math.max(0, ...problems.map((p) => p.path.length));
      for (const p of problems) {
        const fix = p.fix === undefined ? "" : p.fix.startsWith("card-catalog ") ? `; run: ${p.fix}` : `; ${p.fix.charAt(0).toLowerCase()}${p.fix.slice(1)}`;
        this.io.out(`${p.severity.padEnd(7)} ${p.code.padEnd(codeW)}  ${p.path.padEnd(pathW)}  ${p.message}${fix}`);
      }
      const total = problems.length;
      this.io.out(total === 0 ? "No problems." : `${String(total)} problem${total === 1 ? "" : "s"} (${plural(counts.error, "error")}, ${plural(counts.warning, "warning")}, ${plural(counts.note, "note")})`);
    }
    return counts.error > 0 || (this.args.strict && counts.warning > 0) ? 1 : 0;
  }
}

const INDEX_STATE_CODES = new Set(["stale-index", "missing-index", "newer-index", "empty-collection"]);
const SKIP_CODES = new Set(["not-a-record", "no-title", "no-id", "unreadable"]);
const SETTING_FIELDS: SettingField[] = ["indexPath", "announce", "exclude"];

function notIndexedReason(repo: Repo, dir: string): string {
  const n = repo.notIndexed.find((x) => x.dir === dir);
  if (!n) return "";
  return n.reason === "ignored" ? ` (ignored by ${n.detail ?? "an ignore rule"})` : " (matches no directory)";
}

function plural(n: number, word: string): string {
  return `${String(n)} ${word}${n === 1 ? "" : "s"}`;
}

function show(value: unknown): string {
  if (value === undefined) return "-";
  if (value === null) return "null";
  if (typeof value === "string") return value;
  if (Array.isArray(value)) return value.length ? value.map(String).join(", ") : "[]";
  if (typeof value === "object") {
    const entries = Object.entries(value);
    if (entries.length === 0) return "{}";
    if (entries.every(([, v]) => Array.isArray(v))) return entries.map(([k, v]) => `${k}: ${(v as string[]).join(", ")}`).join("; ");
    return JSON.stringify(value);
  }
  return JSON.stringify(value);
}

/** Run as a script, including through npm's bin symlink, rather than imported. */
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
  process.exitCode = runCli(process.argv.slice(2), {
    out: (t) => process.stdout.write(`${t}\n`),
    err: (t) => process.stderr.write(`${t}\n`),
    cwd: process.cwd(),
  });
}
