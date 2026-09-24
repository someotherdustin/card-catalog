// Builds and writes <adr-dir>/index.json. The whole directory is re-read on
// every run: ADR collections are tens to low hundreds of small files, so a
// full rebuild is cheap and can't drift the way incremental upserts can
// (renames, deletions, edits made outside the agent).

import { existsSync, readdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { basename, dirname, join, sep } from "node:path";
import { contentHash, lastCommitDates, resolveAmendedAt } from "./amendments.ts";
import { type AdrEntry, isAdrFilename, parseAdr } from "./parse-adr.ts";

export const INDEX_FILE = "index.json";
export const INDEX_VERSION = 2;

export interface IndexedAdr extends AdrEntry {
  /** Short hash of the file's content; `amendedAt` moves only when this does. */
  contentHash: string;
  /** When the ADR's content last changed (UTC ISO 8601). Equals creation time if never amended. */
  amendedAt: string;
}

export interface AdrIndex {
  version: number;
  generatedBy: string;
  adrs: IndexedAdr[];
}

/** Entries as read back from disk: version-1 indexes have no hash or timestamp. */
type StoredAdr = AdrEntry & Partial<Pick<IndexedAdr, "contentHash" | "amendedAt">>;

export interface BuildResult {
  index: AdrIndex;
  warnings: string[];
  changed: boolean;
}

/**
 * Directories we treat as ADR directories: `docs/adr` (grill-with-docs /
 * domain-modeling, including `src/<context>/docs/adr` in multi-context
 * repos) and `doc/adr` (adr-tools default).
 */
export function isAdrDir(dir: string): boolean {
  return basename(dir) === "adr" && ["docs", "doc"].includes(basename(dirname(dir)));
}

export function adrDirForFile(filePath: string): string | undefined {
  const dir = dirname(filePath);
  return isAdrDir(dir) && isAdrFilename(basename(filePath)) ? dir : undefined;
}

export function readIndex(adrDir: string): { adrs: StoredAdr[] } | undefined {
  try {
    const parsed: unknown = JSON.parse(readFileSync(join(adrDir, INDEX_FILE), "utf8"));
    return isStoredIndex(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
}

function isStoredIndex(value: unknown): value is { adrs: StoredAdr[] } {
  return typeof value === "object" && value !== null && Array.isArray((value as { adrs?: unknown }).adrs);
}

export function buildIndex(adrDir: string, now: Date = new Date()): BuildResult {
  const previous = readIndex(adrDir);
  const prevByFile = new Map(previous?.adrs.map((e) => [e.file, e]) ?? []);
  const warnings: string[] = [];
  const adrs: IndexedAdr[] = [];
  let commitDates: Map<string, string> | undefined;
  const commitDate = (file: string) => (commitDates ??= lastCommitDates(adrDir)).get(file);

  for (const file of readdirSync(adrDir).filter(isAdrFilename).sort()) {
    let content: string;
    try {
      content = readFileSync(join(adrDir, file), "utf8");
    } catch (err) {
      warnings.push(`${file}: unreadable (${err instanceof Error ? err.message : String(err)})`);
      continue;
    }
    const prev = prevByFile.get(file);
    const hash = contentHash(content);
    const stamp = () => ({
      contentHash: hash,
      amendedAt: resolveAmendedAt(hash, prev, () => commitDate(file), now),
    });
    const result = parseAdr(file, content);
    if (result.ok) {
      adrs.push({ ...result.entry, ...stamp() });
      warnings.push(...result.warnings);
    } else {
      // Fail soft: a stale entry beats a missing one. Keep what we had, but
      // still record that the file changed.
      if (prev) adrs.push({ ...prev, ...stamp() });
      warnings.push(`${result.reason}${prev ? " (kept previous index entry)" : " (skipped)"}`);
    }
  }

  adrs.sort((a, b) => a.id - b.id || a.file.localeCompare(b.file));
  const index: AdrIndex = { version: INDEX_VERSION, generatedBy: "adr-index", adrs };
  const changed = JSON.stringify(previous) !== JSON.stringify(index);
  return { index, warnings, changed };
}

export function writeIndex(adrDir: string, index: AdrIndex): void {
  const target = join(adrDir, INDEX_FILE);
  const tmp = `${target}.${String(process.pid)}.tmp`;
  writeFileSync(tmp, JSON.stringify(index, null, 2) + "\n");
  renameSync(tmp, target); // atomic on the same filesystem
}

/** Rebuild and write if anything changed. Returns warnings for logging. */
export function refreshIndex(adrDir: string): { changed: boolean; count: number; warnings: string[] } {
  const { index, warnings, changed } = buildIndex(adrDir);
  if (changed) writeIndex(adrDir, index);
  return { changed, count: index.adrs.length, warnings };
}

/** Find every ADR directory under root, skipping heavy/hidden directories. */
export function findAdrDirs(root: string): string[] {
  const found: string[] = [];
  const skip = new Set(["node_modules", "dist", "build", "target", "vendor"]);
  const walk = (dir: string, depth: number) => {
    if (depth > 8) return;
    if (isAdrDir(dir) && existsSync(dir)) found.push(dir);
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      if (e.isDirectory() && !e.name.startsWith(".") && !skip.has(e.name)) walk(dir + sep + e.name, depth + 1);
    }
  };
  walk(root, 0);
  return found;
}
