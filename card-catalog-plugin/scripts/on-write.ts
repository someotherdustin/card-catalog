// PostToolUse hook for Write|Edit|MultiEdit. If the written file is a record,
// rebuild its collection's index; if it changes config or what's ignored,
// rebuild every index. See docs/specs/hooks.md.
//
// Never blocks: every path exits 0. Problems go to stderr, which Claude Code
// only surfaces in verbose mode, so the session that wrote the record is
// never interrupted by us.

import { dirname, isAbsolute, resolve } from "node:path";
import { loadConfig } from "./core/config.ts";
import { type Collection, collectionContaining, isCandidate } from "./core/collections.ts";
import { AGENT_IGNORE_FILES, CLAUDE_SETTINGS } from "./core/ignore.ts";
import { buildIndex, writeIndex } from "./core/index-build.ts";
import { CONFIG_FILE, displayDir, findRepoRoot, relBasename, repoRelative } from "./core/paths.ts";
import { recordCount } from "./core/profile.ts";
import { openRepo, type Repo } from "./core/repo.ts";
import { CLI_PATH, readHookInput, runHook, warn } from "./hook-io.ts";

const QUIET_CODES = new Set(["stale-index", "missing-index", "empty-collection", "not-a-record"]);

function refresh(repo: Repo, c: Collection): void {
  const built = buildIndex(repo, c);
  for (const p of built.problems) if (p.severity !== "note" && !QUIET_CODES.has(p.code)) warn(`${p.path}: ${p.message}`);
  if (built.newer) {
    warn(`${displayDir(c.dir)}: index.json is from a newer card-catalog, so it wasn't rewritten`);
    return;
  }
  if (writeIndex(repo, built)) {
    console.error(`[card-catalog] indexed ${recordCount(c.profile, built.records.length)} in ${displayDir(c.dir)}`);
  }
}

/** Whether a default collection could contain `path`, so a repo without config can skip the full resolve. */
function underDefaultDir(path: string): boolean {
  const segments = path.split("/");
  return segments.some((s, i) => s === "adr" && i > 0 && ["docs", "doc"].includes(segments[i - 1] ?? ""));
}

async function main(): Promise<void> {
  const input = await readHookInput();
  const raw = input.tool_input?.file_path;
  if (!raw) return;
  const cwd = input.cwd ?? process.cwd();
  const abs = isAbsolute(raw) ? raw : resolve(cwd, raw);
  const root = findRepoRoot(dirname(abs), cwd);
  const path = repoRelative(root, abs);
  if (path === undefined || path === "") return;

  const loaded = loadConfig(root);
  if (!loaded.ok) {
    warn(`card-catalog.json is invalid, so no index was written. Run: node "${CLI_PATH}" validate`);
    return;
  }
  const ruleFile =
    path === CONFIG_FILE || path === CLAUDE_SETTINGS || relBasename(path) === ".gitignore" ||
    AGENT_IGNORE_FILES.includes(path) || loaded.config.ignoreFiles.includes(path);
  if (!ruleFile && !loaded.present && !underDefaultDir(path)) return;

  const opened = openRepo(root);
  if (!opened.ok) return;
  const { repo } = opened;
  if (ruleFile) {
    // What's ignored, or the config, changed: collections may have come or gone.
    for (const c of repo.collections) refresh(repo, c);
    return;
  }
  const c = collectionContaining(repo.collections, path);
  if (!c || !isCandidate(c, path)) return;
  const st = repo.ignore.check([{ path, isDir: false }]).get(path) ?? {};
  if (st.ignoredBy !== undefined || st.outside) return;
  refresh(repo, c);
}

runHook("on-write", main);
