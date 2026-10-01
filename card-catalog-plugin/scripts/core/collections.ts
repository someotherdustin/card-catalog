// Resolves which directories are collections, of which type, read by which
// profile. For each directory the first rule that applies decides: ignored
// (never a collection), a literal config entry, a glob config entry, a
// default `docs/adr` or `doc/adr` directory.

import { existsSync, readdirSync, realpathSync } from "node:fs";
import { join } from "node:path";
import type { Config, ConfigEntry } from "./config.ts";
import { CONFIG_FILE, isDirectory, joinRel, normalizeRel, relBasename, relDirname, within } from "./paths.ts";
import { compileGlob, hasGlobChars, segmentSource } from "./glob.ts";
import type { IgnoreSources } from "./ignore.ts";
import { type Profile, type ProfileField, resolveProfile, type ValueSource } from "./profile.ts";
import { type Problem, problem } from "./problems.ts";

export const INDEX_JSON = "index.json";
export const DEFAULT_INDEX_PATH = "INDEX.md";
const DEFAULT_DEPTH = 8;
const SKIP_DIRS = new Set(["node_modules", "dist", "build", "target", "vendor"]);

export interface CollectionSettings {
  indexPath: string;
  announce: boolean;
  exclude: string[];
}

export type SettingField = keyof CollectionSettings;

export interface Collection {
  /** Repo-relative directory, "" for the root. */
  dir: string;
  type: string;
  profile: Profile;
  profileSources: Record<ProfileField, ValueSource>;
  settings: CollectionSettings;
  settingSources: Record<SettingField, ValueSource>;
  source: "default" | "config";
  /** Config entry position, counting from 1, or null for a default collection. */
  entry: number | null;
  /** Repo-relative path of INDEX.md, unless `indexPath` is "none" or conflicts. */
  indexFile?: string;
  /** Repo-relative path of index.json, unless `indexPath` is "none". */
  jsonFile?: string;
}

export interface NotIndexed {
  dir: string;
  type: string;
  source: "default" | "config";
  entry: number | null;
  reason: "ignored" | "no-match";
  detail?: string;
}

export interface Resolution {
  collections: Collection[];
  notIndexed: NotIndexed[];
  problems: Problem[];
}

/** Profiles per record type: the first entry giving profile fields defines it. */
export function typeProfiles(config: Config): { profiles: Map<string, { fields: Record<string, unknown>; source: ValueSource }>; problems: Problem[] } {
  const profiles = new Map<string, { fields: Record<string, unknown>; source: ValueSource; entry: number }>();
  const problems: Problem[] = [];
  for (const e of config.entries) {
    if (Object.keys(e.profileFields).length === 0) continue;
    const existing = profiles.get(e.type);
    if (!existing) {
      profiles.set(e.type, { fields: e.profileFields, source: `config entry ${String(e.position)}`, entry: e.position });
    } else if (!sameJson(existing.fields, e.profileFields)) {
      problems.push(problem(
        "error", "type-conflict", CONFIG_FILE,
        `config entries ${String(existing.entry)} and ${String(e.position)} give different profile fields for type "${e.type}"; entry ${String(existing.entry)}'s are used`,
        "Keep the profile fields on one entry only",
      ));
    }
  }
  return { profiles, problems };
}

export function profileForType(config: Config, type: string): { profile: Profile; sources: Record<ProfileField, ValueSource> } {
  const defined = typeProfiles(config).profiles.get(type);
  const resolved = resolveProfile(type, defined?.fields ?? {}, defined?.source ?? "built-in");
  return resolved;
}

export function settingsFor(entry: ConfigEntry | undefined, source: ValueSource): { settings: CollectionSettings; sources: Record<SettingField, ValueSource> } {
  return {
    settings: {
      indexPath: entry?.indexPath ?? DEFAULT_INDEX_PATH,
      announce: entry?.announce ?? true,
      exclude: entry?.exclude ?? [],
    },
    sources: {
      indexPath: entry?.indexPath !== undefined ? source : "default",
      announce: entry?.announce !== undefined ? source : "default",
      exclude: entry?.exclude !== undefined ? source : "default",
    },
  };
}

export function makeCollection(
  dir: string,
  type: string,
  resolved: { profile: Profile; sources: Record<ProfileField, ValueSource> },
  settings: { settings: CollectionSettings; sources: Record<SettingField, ValueSource> },
  source: "default" | "config",
  entry: number | null,
): Collection {
  const c: Collection = {
    dir, type,
    profile: resolved.profile, profileSources: resolved.sources,
    settings: settings.settings, settingSources: settings.sources,
    source, entry,
  };
  if (settings.settings.indexPath !== "none") {
    c.jsonFile = joinRel(dir, INDEX_JSON);
    const indexFile = normalizeRel(joinRel(dir, settings.settings.indexPath));
    if (indexFile !== undefined) c.indexFile = indexFile;
  }
  return c;
}

interface Claim {
  kind: "literal" | "glob" | "default";
  entry?: ConfigEntry;
}

export function resolveCollections(root: string, config: Config, ignore: IgnoreSources): Resolution {
  const problems: Problem[] = [];
  const { problems: typeProblems } = typeProfiles(config);
  problems.push(...typeProblems);

  // Every directory each rule matches.
  const claims = new Map<string, Claim[]>();
  const claim = (dir: string, c: Claim) => {
    const list = claims.get(dir) ?? [];
    list.push(c);
    claims.set(dir, list);
  };
  const matchedBy = new Map<ConfigEntry, string[]>();
  const literalSeen = new Map<string, ConfigEntry>();
  for (const e of config.entries) {
    const glob = hasGlobChars(e.dir);
    if (!glob) {
      const first = literalSeen.get(e.dir);
      if (first) {
        problems.push(problem("error", "config-duplicate", CONFIG_FILE, `config entries ${String(first.position)} and ${String(e.position)} both name "${e.dir}"; entry ${String(first.position)} wins`));
        continue;
      }
      literalSeen.set(e.dir, e);
    }
    const dirs = glob ? expandDirGlob(root, e.dir) : literalDir(root, e.dir);
    matchedBy.set(e, dirs);
    for (const d of dirs) claim(d, { kind: glob ? "glob" : "literal", entry: e });
  }
  if (config.defaults) for (const d of findDefaultDirs(root)) claim(d, { kind: "default" });

  // Ignore status of every matched directory, in one batch.
  const status = ignore.check([...claims.keys()].map((path) => ({ path, isDir: true })));

  const collections: Collection[] = [];
  const notIndexed: NotIndexed[] = [];
  for (const [dir, list] of [...claims].sort(([a], [b]) => compareDirs(a, b))) {
    const winner =
      list.find((c) => c.kind === "literal") ?? list.find((c) => c.kind === "glob") ?? list.find((c) => c.kind === "default");
    if (!winner) continue;
    const globs = list.filter((c) => c.kind === "glob");
    if (winner.kind === "glob" && globs.length > 1) {
      const [a, b] = globs;
      problems.push(problem("warning", "config-duplicate", CONFIG_FILE, `config entries ${String(a?.entry?.position)} and ${String(b?.entry?.position)} both match "${dir}"; entry ${String(a?.entry?.position)} wins`));
    }
    const type = winner.entry?.type ?? "adr";
    const source = winner.entry ? "config" : "default";
    const entry = winner.entry?.position ?? null;
    const st = status.get(dir) ?? {};
    if (st.outside) {
      problems.push(problem("note", "symlink-outside-repo", dir, "is a symlink to a directory outside the repo, so it isn't indexed"));
      continue;
    }
    if (st.ignoredBy !== undefined) {
      notIndexed.push({ dir, type, source, entry, reason: "ignored", detail: st.ignoredBy });
      continue;
    }
    collections.push(makeCollection(
      dir, type, profileForType(config, type),
      settingsFor(winner.entry, winner.entry ? `config entry ${String(winner.entry.position)}` : "default"),
      source, entry,
    ));
  }

  for (const [e, dirs] of matchedBy) {
    const where = `config entry ${String(e.position)}`;
    if (dirs.length === 0) {
      problems.push(problem("warning", "config-no-match", CONFIG_FILE, `${where}: dir "${e.dir}" matches no directory`));
      notIndexed.push({ dir: e.dir, type: e.type, source: "config", entry: e.position, reason: "no-match" });
      continue;
    }
    const ignoredBy = dirs.map((d) => status.get(d)?.ignoredBy);
    if (ignoredBy.every((s) => s !== undefined)) {
      problems.push(problem(
        "warning", "config-ignored", CONFIG_FILE,
        `${where}: every directory "${e.dir}" matches is ignored (by ${[...new Set(ignoredBy)].join(", ")})`,
        "Edit the named ignore file, or remove the entry",
      ));
    }
  }

  problems.push(...indexConflicts(collections));
  notIndexed.sort((a, b) => compareDirs(a.dir, b.dir));
  return { collections, notIndexed, problems };
}

/** The innermost collection whose directory contains `path`. */
export function collectionContaining(collections: Collection[], path: string): Collection | undefined {
  let best: Collection | undefined;
  for (const c of collections) {
    if (within(c.dir, path) && path !== c.dir && (!best || c.dir.length > best.dir.length)) best = c;
  }
  return best;
}

/** Index paths that leave the repo, resolve to a record, or are shared. The conflicting index isn't written. */
function indexConflicts(collections: Collection[]): Problem[] {
  const problems: Problem[] = [];
  const owners = new Map<string, Collection>();
  for (const c of collections) {
    if (c.settings.indexPath === "none") continue;
    const at = c.dir === "" ? CONFIG_FILE : c.dir;
    if (c.indexFile === undefined) {
      problems.push(problem("error", "index-conflict", at, `indexPath "${c.settings.indexPath}" leaves the repo`));
      continue;
    }
    const owner = owners.get(c.indexFile);
    if (owner) {
      problems.push(problem("error", "index-conflict", c.indexFile, `is the index of both ${owner.dir || "."} and ${c.dir || "."}; only ${owner.dir || "."} writes it`));
      delete c.indexFile;
      continue;
    }
    const container = collectionContaining(collections, c.indexFile);
    if (container && container !== c && isCandidate(container, c.indexFile)) {
      problems.push(problem("error", "index-conflict", c.indexFile, `is the index of ${c.dir || "."} but also a record of ${container.dir || "."}`));
      delete c.indexFile;
      continue;
    }
    owners.set(c.indexFile, c);
  }
  return problems;
}

/** Whether a repo-relative file matches the collection's `match` and isn't excluded. */
export function isCandidate(c: Collection, path: string): boolean {
  if (!within(c.dir, path) || path === c.dir) return false;
  const rel = c.dir === "" ? path : path.slice(c.dir.length + 1);
  if (path === c.indexFile || path === c.jsonFile) return false;
  if (!compileGlob(c.profile.match).test(rel)) return false;
  return ![...c.profile.exclude, ...c.settings.exclude].some((x) => compileGlob(x).test(rel));
}

export function compareDirs(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

// --- finding directories -----------------------------------------------------

function isNestedRepo(root: string, dir: string): boolean {
  return dir !== "" && existsSync(join(root, dir, ".git"));
}

function skipped(name: string): boolean {
  return SKIP_DIRS.has(name) || name.startsWith(".");
}

interface ChildDir {
  name: string;
  /** Real path, which differs from the parent's real path plus the name only through a symlink. */
  real: string;
}

/** Subdirectories of `dir` (following symlinks), and whether `dir` holds a `.git`, from one directory read. */
function readDir(root: string, dir: string, dirReal: string): { children: ChildDir[]; hasGit: boolean } {
  let entries;
  try {
    entries = readdirSync(join(root, dir), { withFileTypes: true });
  } catch {
    return { children: [], hasGit: false };
  }
  const children: ChildDir[] = [];
  for (const e of entries) {
    if (e.isDirectory()) children.push({ name: e.name, real: join(dirReal, e.name) });
    else if (e.isSymbolicLink() && isDirectory(join(root, dir, e.name))) children.push({ name: e.name, real: realOf(root, joinRel(dir, e.name)) });
  }
  children.sort((a, b) => compareDirs(a.name, b.name));
  return { children, hasGit: entries.some((e) => e.name === ".git") };
}

/** A literal entry's directory, if it exists and isn't inside a nested repo. */
function literalDir(root: string, dir: string): string[] {
  if (!isDirectory(join(root, dir))) return [];
  const segments = dir === "" ? [] : dir.split("/");
  for (let i = 1; i <= segments.length; i++) if (isNestedRepo(root, segments.slice(0, i).join("/"))) return [];
  return [dir];
}

/** Directories a `dir` glob matches. Never enters skipped names (unless named literally), nested repos or cycles. */
export function expandDirGlob(root: string, pattern: string): string[] {
  const segments = pattern === "" ? [] : pattern.split("/");
  const found = new Set<string>();
  // `seen` holds the real paths on the way down, so a symlink cycle can't loop.
  const visit = (dir: string, real: string, i: number, seen: Set<string>) => {
    const { children, hasGit } = readDir(root, dir, real);
    if (dir !== "" && hasGit) return;
    if (i === segments.length) {
      found.add(dir);
      return;
    }
    const seg = segments[i] ?? "";
    if (seg === "**") {
      visit(dir, real, i + 1, seen);
      for (const child of children) {
        if (skipped(child.name) || seen.has(child.real)) continue;
        visit(joinRel(dir, child.name), child.real, i, new Set([...seen, child.real]));
      }
    } else if (hasGlobChars(seg)) {
      const re = new RegExp(`^${segmentSource(seg)}$`);
      for (const child of children) if (!skipped(child.name) && re.test(child.name)) visit(joinRel(dir, child.name), child.real, i + 1, seen);
    } else {
      const name = seg.replace(/\\(.)/g, "$1");
      const child = children.find((c) => c.name === name);
      if (child) visit(joinRel(dir, name), child.real, i + 1, seen);
    }
  };
  const rootReal = realOf(root, "");
  visit("", rootReal, 0, new Set([rootReal]));
  return [...found].sort(compareDirs);
}

function realOf(root: string, dir: string): string {
  try {
    return realpathSync(join(root, dir));
  } catch {
    return join(root, dir);
  }
}

/** Every `adr` directory whose parent is `docs` or `doc`, at most 8 levels down. */
export function findDefaultDirs(root: string): string[] {
  const found: string[] = [];
  const walk = (dir: string, real: string, depth: number, seen: Set<string>) => {
    if (depth > DEFAULT_DEPTH) return;
    const { children, hasGit } = readDir(root, dir, real);
    if (dir !== "" && hasGit) return;
    if (relBasename(dir) === "adr" && ["docs", "doc"].includes(relBasename(relDirname(dir)))) found.push(dir);
    for (const child of children) {
      if (skipped(child.name) || seen.has(child.real)) continue;
      walk(joinRel(dir, child.name), child.real, depth + 1, new Set([...seen, child.real]));
    }
  };
  const rootReal = realOf(root, "");
  walk("", rootReal, 0, new Set([rootReal]));
  return found;
}

function sameJson(a: unknown, b: unknown): boolean {
  return JSON.stringify(sortKeys(a)) === JSON.stringify(sortKeys(b));
}

function sortKeys(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(sortKeys);
  if (v && typeof v === "object") return Object.fromEntries(Object.keys(v).sort().map((k) => [k, sortKeys((v as Record<string, unknown>)[k])]));
  return v;
}
