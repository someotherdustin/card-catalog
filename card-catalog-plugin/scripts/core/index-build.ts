// Builds a collection's INDEX.md and index.json (version 3). The whole
// collection is re-read on every run: collections are tens to low hundreds
// of small files, so a full rebuild is cheap and can't drift the way
// incremental updates can (renames, deletions, edits made outside an agent).

import { mkdirSync, readdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { contentHash, lastCommitDates, resolveAmendedAt } from "./amendments.ts";
import { type Collection, collectionContaining, isCandidate } from "./collections.ts";
import { displayDir, isDirectory, isFile, joinRel, normalizeRel, realpathOr, relBasename, relDirname, relFrom, within } from "./paths.ts";
import { type Problem, problem } from "./problems.ts";
import { idPatternFor, looksLikeLabel, type ParsedRecord, parseRecord, type SkipCode } from "./record.ts";
import { recordNoun } from "./profile.ts";
import type { Repo } from "./repo.ts";

export const INDEX_VERSION = 3;
export const GENERATED_BY = "card-catalog";
const SKIP_DIRS = new Set(["node_modules", "dist", "build", "target", "vendor"]);

export interface IndexLink {
  type: string;
  target: string;
  /** Relative to the collection directory, when the target was found as a file. */
  file?: string;
}

/** One record as index.json stores it. Keys are in index.json order. */
export interface IndexRecord {
  id: string;
  label: string;
  series?: string;
  slug?: string;
  title: string;
  status?: string;
  summary: string;
  file: string;
  date?: string;
  tags?: string[];
  links?: IndexLink[];
  fields?: Record<string, string>;
  contentHash: string;
  amendedAt: string;
}

export type IndexState = "current" | "stale" | "missing" | "empty" | "none";

export interface Skipped {
  /** Relative to the collection directory. */
  file: string;
  reason: SkipCode | "unreadable";
  message: string;
}

export interface BuiltIndex {
  collection: Collection;
  records: IndexRecord[];
  /** The index line of each record, in the same order. */
  lines: string[];
  /** Rendered INDEX.md, when the collection has one to write. */
  indexMd?: string;
  /** Rendered index.json, when the collection has one to write. */
  indexJson?: string;
  /** The rendered INDEX.md even when nothing would be written, for `preview`. */
  preview: string;
  skipped: Skipped[];
  problems: Problem[];
  state: IndexState;
  /** index.json was written by a newer card-catalog: it is never overwritten. */
  newer: boolean;
}

export interface BuildOptions {
  now?: Date;
}

// --- reading records ---------------------------------------------------------

interface Parsed {
  records: ParsedRecord[];
  skipped: Skipped[];
  /** Raw content hash per file, and files that couldn't be read. */
  hashes: Map<string, string>;
  problems: Problem[];
}

const parsedCache = new WeakMap<Repo, Map<Collection, Parsed>>();

/** Parses every record in a collection, once per repo snapshot. */
export function parseCollection(repo: Repo, c: Collection): Parsed {
  let cache = parsedCache.get(repo);
  if (!cache) {
    cache = new Map();
    parsedCache.set(repo, cache);
  }
  const hit = cache.get(c);
  if (hit) return hit;

  const problems: Problem[] = [];
  const records: ParsedRecord[] = [];
  const skipped: Skipped[] = [];
  const hashes = new Map<string, string>();
  const files = listCandidates(repo, c);
  const status = repo.ignore.check(files.map((path) => ({ path, isDir: false })));
  const dirName = relBasename(c.dir) || relBasename(repo.root);
  for (const path of files) {
    const st = status.get(path) ?? {};
    if (st.outside) {
      problems.push(problem("note", "symlink-outside-repo", path, "is a symlink to a file outside the repo, so it isn't indexed"));
      continue;
    }
    if (st.ignoredBy !== undefined) continue;
    const file = c.dir === "" ? path : path.slice(c.dir.length + 1);
    let content: string;
    try {
      content = readFileSync(join(repo.root, path), "utf8");
    } catch (err) {
      const message = `can't be read: ${(err as Error).message}`;
      skipped.push({ file, reason: "unreadable", message });
      problems.push(problem("error", "unreadable", path, message));
      continue;
    }
    hashes.set(file, contentHash(content));
    const outcome = parseRecord(c.profile, file, content, dirName);
    if (!outcome.ok) {
      skipped.push({ file, reason: outcome.code, message: outcome.message });
      if (outcome.code === "not-a-record") problems.push(problem("note", "not-a-record", path, outcome.message));
      else problems.push(problem("error", outcome.code, path, outcome.message));
      continue;
    }
    records.push(outcome.record);
    for (const w of outcome.record.warnings) problems.push(problem("warning", w.code, path, w.message));
  }
  const seen = new Map<string, ParsedRecord>();
  for (const r of records) {
    const first = seen.get(r.id);
    if (first) problems.push(problem("error", "duplicate-id", joinRel(c.dir, r.file), `has the same ID as ${first.file} (${r.id})`));
    else seen.set(r.id, r);
  }
  const parsed = { records, skipped, hashes, problems };
  cache.set(c, parsed);
  return parsed;
}

/** Repo-relative files matching the collection's `match`, not excluded, not in a nested collection or repo. */
function listCandidates(repo: Repo, c: Collection): string[] {
  const nested = repo.collections.filter((o) => o !== c && within(c.dir, o.dir) && o.dir !== c.dir).map((o) => o.dir);
  const maxDepth = c.profile.match.includes("**") ? Infinity : c.profile.match.split("/").length - 1;
  const out: string[] = [];
  const walk = (dir: string, depth: number, seen: Set<string>) => {
    let entries;
    try {
      entries = readdirSync(join(repo.root, dir), { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      const path = joinRel(dir, e.name);
      const abs = join(repo.root, path);
      if (e.isDirectory() || (e.isSymbolicLink() && isDirectory(abs))) {
        if (depth >= maxDepth || SKIP_DIRS.has(e.name) || e.name.startsWith(".") || nested.includes(path)) continue;
        if (isFile(join(abs, ".git")) || isDirectory(join(abs, ".git"))) continue;
        const real = realpathOr(abs);
        if (seen.has(real)) continue;
        walk(path, depth + 1, new Set([...seen, real]));
      } else if ((e.isFile() || (e.isSymbolicLink() && isFile(abs))) && isCandidate(c, path)) {
        out.push(path);
      }
    }
  };
  walk(c.dir, 0, new Set([realpathOr(join(repo.root, c.dir))]));
  return out.sort();
}

// --- building ------------------------------------------------------------------

interface PreviousIndex {
  version: number;
  byFile: Map<string, Partial<IndexRecord>>;
}

function readPrevious(repo: Repo, c: Collection): PreviousIndex | undefined {
  const at = c.jsonFile ?? joinRel(c.dir, "index.json");
  let json: unknown;
  try {
    json = JSON.parse(readFileSync(join(repo.root, at), "utf8"));
  } catch {
    return undefined;
  }
  if (typeof json !== "object" || json === null) return undefined;
  const obj = json as { version?: unknown; records?: unknown; adrs?: unknown };
  const version = typeof obj.version === "number" ? obj.version : 1;
  const list = Array.isArray(obj.records) ? obj.records : Array.isArray(obj.adrs) ? obj.adrs : [];
  const byFile = new Map<string, Partial<IndexRecord>>();
  for (const r of list as unknown[]) {
    if (typeof r === "object" && r !== null && typeof (r as { file?: unknown }).file === "string") {
      const rec = r as Partial<IndexRecord> & { file: string };
      byFile.set(rec.file, version >= INDEX_VERSION ? rec : pick(rec));
    }
  }
  return { version, byFile };
}

/** From an older index only the file, hash and amendment time are read. */
function pick(r: Partial<IndexRecord>): Partial<IndexRecord> {
  return {
    ...(typeof r.file === "string" ? { file: r.file } : {}),
    ...(typeof r.contentHash === "string" ? { contentHash: r.contentHash } : {}),
    ...(typeof r.amendedAt === "string" ? { amendedAt: r.amendedAt } : {}),
  };
}

export function buildIndex(repo: Repo, c: Collection, { now = new Date() }: BuildOptions = {}): BuiltIndex {
  const parsed = parseCollection(repo, c);
  const problems = [...parsed.problems];
  const previous = readPrevious(repo, c);
  const newer = previous !== undefined && previous.version > INDEX_VERSION;
  let commitDates: Map<string, string> | undefined;
  const commitDate = (file: string) => (commitDates ??= lastCommitDates(join(repo.root, c.dir))).get(file);

  const entries: { record: IndexRecord; parsed?: ParsedRecord }[] = [];
  for (const r of parsed.records) {
    const hash = parsed.hashes.get(r.file) ?? "";
    const prev = previous?.byFile.get(r.file);
    entries.push({ record: toIndexRecord(repo, c, r, hash, resolveAmendedAt(hash, prev, () => commitDate(r.file), now), problems), parsed: r });
  }
  // A record that fails to parse keeps its previous line, so a broken edit doesn't lose it.
  for (const s of parsed.skipped) {
    if (s.reason !== "no-title" && s.reason !== "unreadable") continue;
    const prev = previous?.byFile.get(s.file);
    if (!prev || typeof prev.id !== "string" || typeof prev.label !== "string" || typeof prev.title !== "string") continue;
    const hash = parsed.hashes.get(s.file);
    const stamp = hash === undefined ? {} : { contentHash: hash, amendedAt: resolveAmendedAt(hash, prev, () => commitDate(s.file), now) };
    entries.push({ record: { ...(prev as IndexRecord), ...stamp } });
  }
  const pattern = idPatternFor(c.profile);
  entries.sort((a, b) => compareRecords(a.record, b.record, a.parsed?.number, b.parsed?.number, pattern?.hasNumber ?? false));
  const records = entries.map((e) => e.record);

  const lines = records.map((r) => indexLine(c, r));
  const header = indexHeader(c, records.some((r) => pairs(c, r).length > 0));
  const preview = [...header, ...lines].join("\n") + "\n";
  const json = renderJson(c, records);

  const result: BuiltIndex = { collection: c, records, lines, preview, skipped: parsed.skipped, problems, state: "none", newer };
  if (c.settings.indexPath === "none") return result;

  const diskMd = c.indexFile !== undefined ? readText(join(repo.root, c.indexFile)) : undefined;
  const diskJson = c.jsonFile !== undefined ? readText(join(repo.root, c.jsonFile)) : undefined;
  const reindex = `card-catalog reindex ${displayDir(c.dir)}`;
  if (newer) {
    problems.push(problem("error", "newer-index", c.jsonFile ?? c.dir, `was written by a newer card-catalog (version ${String(previous.version)}); it isn't overwritten`));
  }
  if (records.length === 0 && diskMd === undefined && diskJson === undefined) {
    problems.push(problem("note", "empty-collection", displayDir(c.dir), "has no records"));
    result.state = "empty";
    return result;
  }
  if (records.length === 0) problems.push(problem("note", "empty-collection", displayDir(c.dir), "has no records"));
  if (c.indexFile !== undefined) result.indexMd = preview;
  result.indexJson = json;

  const mdCurrent = c.indexFile === undefined || diskMd === preview;
  const olderOrNewer = previous !== undefined && previous.version !== INDEX_VERSION;
  const jsonCurrent = diskJson === json || (olderOrNewer && diskJson !== undefined);
  if (diskMd === undefined && diskJson === undefined) {
    result.state = "missing";
    problems.push(problem("error", "missing-index", c.indexFile ?? c.jsonFile ?? c.dir, "doesn't exist yet", reindex));
  } else if (mdCurrent && jsonCurrent) {
    result.state = "current";
  } else {
    result.state = "stale";
    problems.push(problem("error", "stale-index", c.indexFile ?? c.jsonFile ?? c.dir, "out of date", reindex));
  }
  return result;
}

function compareRecords(a: IndexRecord, b: IndexRecord, an: number | undefined, bn: number | undefined, byNumber: boolean): number {
  const sa = a.series ?? "";
  const sb = b.series ?? "";
  if (sa !== sb) return sa === "" ? -1 : sb === "" ? 1 : sa < sb ? -1 : 1;
  if (byNumber && an !== undefined && bn !== undefined && an !== bn) return an - bn;
  if (a.id !== b.id) return a.id < b.id ? -1 : 1;
  return a.file < b.file ? -1 : a.file > b.file ? 1 : 0;
}

function toIndexRecord(repo: Repo, c: Collection, r: ParsedRecord, hash: string, amendedAt: string, problems: Problem[]): IndexRecord {
  const links = r.links.map((l) => resolveLink(repo, c, r, l, problems));
  return {
    id: r.id,
    label: r.label,
    ...(r.series !== undefined ? { series: r.series } : {}),
    ...(r.slug !== undefined ? { slug: r.slug } : {}),
    title: r.title,
    ...(r.status !== undefined ? { status: r.status } : {}),
    summary: r.summary,
    file: r.file,
    ...(r.date !== undefined ? { date: r.date } : {}),
    ...(r.tags !== undefined ? { tags: r.tags } : {}),
    ...(links.length ? { links } : {}),
    ...(Object.keys(r.fields).length ? { fields: r.fields } : {}),
    contentHash: hash,
    amendedAt,
  };
}

// --- links ---------------------------------------------------------------------

function resolveLink(repo: Repo, c: Collection, r: ParsedRecord, link: ParsedRecord["links"][number], problems: Problem[]): IndexLink {
  const from = joinRel(c.dir, r.file);
  if (link.path !== undefined) {
    const target = normalizeRel(joinRel(c.dir, relDirname(r.file), link.path));
    if (target === undefined) return { type: link.type, target: link.target || link.path };
    const file = relFrom(c.dir, target);
    const owner = collectionContaining(repo.collections, target);
    const found = owner ? parseCollection(repo, owner).records.find((x) => joinRel(owner.dir, x.file) === target) : undefined;
    if (found) return { type: link.type, target: found.label, file };
    if (!isFile(join(repo.root, target))) {
      problems.push(problem("warning", "broken-link", from, `${link.type} links to ${link.path}, which doesn't exist`));
    }
    return { type: link.type, target: link.target || link.path, file };
  }
  const own = parseCollection(repo, c).records.find((x) => x.label === link.target);
  if (own) return { type: link.type, target: link.target, file: own.file };
  const matches = repo.collections
    .filter((o) => o !== c)
    .flatMap((o) => parseCollection(repo, o).records.filter((x) => x.label === link.target).map((x) => joinRel(o.dir, x.file)));
  if (matches.length === 1 && matches[0] !== undefined) return { type: link.type, target: link.target, file: relFrom(c.dir, matches[0]) };
  if (matches.length > 1) {
    problems.push(problem("warning", "ambiguous-link", from, `${link.type} ${link.target} matches records in more than one collection: ${matches.join(", ")}`, "Link to the record's file instead of naming its label"));
  } else if ([c, ...repo.collections].some((o) => looksLikeLabel(o.profile, link.target))) {
    problems.push(problem("warning", "broken-link", from, `${link.type} ${link.target} names no record`));
  }
  return { type: link.type, target: link.target };
}

// --- rendering -----------------------------------------------------------------

function indexHeader(c: Collection, withPairs: boolean): string[] {
  const { name, plural } = c.profile;
  const indexDir = relDirname(c.indexFile ?? joinRel(c.dir, "INDEX.md"));
  const rel = relFrom(indexDir, c.dir);
  const where = rel === "" ? "this directory" : `\`${rel}\``;
  const shape = `label ${c.profile.status ? "[status] " : ""}amended ${withPairs ? "key=value … " : ""}| title | summary`;
  return [
    `# ${name} index`,
    "",
    `Generated by the card-catalog plugin from the ${plural} in ${where}. Edits here are overwritten.`,
    `One line per ${recordNoun(c.profile)}: \`${shape}\`. Search it with grep, then open the ${plural} that match.`,
    "",
  ];
}

function shownLinkType(c: Collection, r: IndexRecord): string | undefined {
  const type = r.status !== undefined ? c.profile.status?.showLink?.[r.status] : undefined;
  return type !== undefined && r.links?.some((l) => l.type === type) ? type : undefined;
}

function pairs(c: Collection, r: IndexRecord): string[] {
  const out: string[] = [];
  for (const name of Object.keys(c.profile.fields)) {
    const value = r.fields?.[name];
    if (value) out.push(`${name}=${pairValue(value)}`);
  }
  const shown = shownLinkType(c, r);
  for (const type of Object.keys(c.profile.links)) {
    if (type === shown) continue;
    const targets = (r.links ?? []).filter((l) => l.type === type).map((l) => pairValue(l.target));
    if (targets.length) out.push(`${type}=${targets.join(",")}`);
  }
  return out;
}

function pairValue(v: string): string {
  return /[\s"|\\]/.test(v) ? `"${v.replace(/["\\]/g, "\\$&")}"` : v;
}

function cell(s: string): string {
  return s.replace(/\|/g, "\\|");
}

function indexLine(c: Collection, r: IndexRecord): string {
  const indexDir = relDirname(c.indexFile ?? joinRel(c.dir, "INDEX.md"));
  const path = relFrom(indexDir, joinRel(c.dir, r.file)).split("/").map(encodeURIComponent).join("/");
  const parts = [`- [${r.label}](${path})`];
  if (c.profile.status) {
    const shown = shownLinkType(c, r);
    const status = r.status ?? "unspecified";
    parts.push(shown ? `[${status} by ${(r.links ?? []).filter((l) => l.type === shown).map((l) => l.target).join(", ")}]` : `[${status}]`);
  }
  parts.push(r.amendedAt.slice(0, 10), ...pairs(c, r));
  return `${parts.join(" ")} | ${cell(r.title)} | ${cell(r.summary)}`;
}

function renderJson(c: Collection, records: IndexRecord[]): string {
  return [
    `{"version":${String(INDEX_VERSION)},"generatedBy":"${GENERATED_BY}","type":${JSON.stringify(c.type)},"records":[`,
    records.map((r) => JSON.stringify(r)).join(",\n"),
    "]}",
    "",
  ].join("\n");
}

// --- writing -------------------------------------------------------------------

/** Writes each index file whose content changed, atomically. Returns whether any did. Never writes over a newer index. */
export function writeIndex(repo: Repo, built: BuiltIndex): boolean {
  if (built.newer) return false;
  let changed = false;
  const c = built.collection;
  for (const [path, text] of [[c.indexFile, built.indexMd], [c.jsonFile, built.indexJson]] as const) {
    if (path === undefined || text === undefined) continue;
    const target = join(repo.root, path);
    if (readText(target) === text) continue;
    mkdirSync(join(target, ".."), { recursive: true });
    const tmp = `${target}.${String(process.pid)}.tmp`;
    writeFileSync(tmp, text);
    renameSync(tmp, target); // atomic on the same filesystem
    changed = true;
  }
  return changed;
}

function readText(path: string): string | undefined {
  try {
    return readFileSync(path, "utf8");
  } catch {
    return undefined;
  }
}
