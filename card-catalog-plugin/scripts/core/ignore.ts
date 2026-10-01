// Which paths are ignored (ADR-0002): git's own rules, agent ignore files at
// the root, `ignoreFiles` from config, and `Read(...)` deny rules in the
// committed `.claude/settings.json`. Indexes depend only on committed files,
// so personal settings other than git's own are never read.

import { spawnSync } from "node:child_process";
import { lstatSync, readFileSync, realpathSync } from "node:fs";
import { join } from "node:path";
import { type IgnoreMatcher, type IgnoreRule, ignoreMatcher, parseIgnore, parseRule } from "./gitignore.ts";
import { isDirectory, joinRel, realpathOr, relDirname, repoRelative } from "./paths.ts";
import { type Problem, problem } from "./problems.ts";

export const AGENT_IGNORE_FILES = [
  ".aiignore", ".aiexclude", ".cursorignore", ".devinignore", ".windsurfignore",
  ".codeiumignore", ".aiderignore", ".geminiignore", ".continueignore",
  ".clineignore", ".rooignore",
];

export const CLAUDE_SETTINGS = ".claude/settings.json";

export interface PathQuery {
  path: string;
  isDir: boolean;
}

export interface PathStatus {
  /** The ignore source that excludes the path (or its symlink target), if any. */
  ignoredBy?: string;
  /** The path is a symlink whose target is outside the repo. */
  outside?: boolean;
}

export interface IgnoreSources {
  /** Status of each path, keyed by path. Follows symlinks. */
  check(paths: PathQuery[]): Map<string, PathStatus>;
  /** Repo-relative files whose edits change what's ignored, besides any `.gitignore`. */
  ruleFiles: string[];
  problems: Problem[];
}

interface Source {
  name: string;
  matcher: IgnoreMatcher;
}

export function loadIgnoreSources(root: string, ignoreFiles: string[]): IgnoreSources {
  const problems: Problem[] = [];
  const sources: Source[] = [];
  for (const name of AGENT_IGNORE_FILES) {
    const text = readText(join(root, name));
    if (text !== undefined) sources.push({ name, matcher: parseIgnore(text) });
  }
  for (const file of ignoreFiles) {
    const text = readText(join(root, file));
    if (text === undefined) {
      problems.push(problem("warning", "ignore-file-missing", file, "is listed in ignoreFiles but doesn't exist"));
      continue;
    }
    sources.push({ name: file, matcher: parseIgnore(text, { base: relDirname(file) }) });
  }
  const claude = claudeDenyRules(root, problems);
  if (claude.length) sources.push({ name: CLAUDE_SETTINGS, matcher: ignoreMatcher(claude) });

  const realRoot = realpathOr(root);
  return {
    ruleFiles: [...AGENT_IGNORE_FILES, ...ignoreFiles, CLAUDE_SETTINGS],
    problems,
    check(paths) {
      const result = new Map<string, PathStatus>();
      // Git refuses paths that run through a symlink, so it is asked about the
      // real path and the link itself instead. Our own matchers read both the
      // path as written and the real path.
      const plans: { q: PathQuery; git: PathQuery[]; own: PathQuery[] }[] = [];
      for (const q of paths) {
        if (q.path === "") {
          result.set(q.path, {});
          continue;
        }
        const target = symlinkTarget(root, realRoot, q.path);
        if (target === null) {
          result.set(q.path, { outside: true });
          continue;
        }
        if (target === undefined) {
          plans.push({ q, git: [q], own: [q] });
          continue;
        }
        const link = firstSymlink(root, q.path);
        const real = { path: target, isDir: q.isDir };
        plans.push({ q, git: [real, ...(link ? [link] : [])], own: [q, real] });
      }
      const git = gitIgnored(root, plans.flatMap((p) => p.git));
      for (const { q, git: asked, own } of plans) {
        const ignoredBy =
          asked.map((a) => git.get(a.path)).find((s) => s !== undefined) ??
          own.map((o) => sources.find((s) => s.matcher.ignores(o.path, o.isDir))?.name).find((s) => s !== undefined);
        result.set(q.path, ignoredBy !== undefined ? { ignoredBy } : {});
      }
      return result;
    },
  };
}

/** The first symlink on the way down to `path`, which git can be asked about. */
function firstSymlink(root: string, path: string): PathQuery | undefined {
  const segments = path.split("/");
  for (let i = 1; i <= segments.length; i++) {
    const prefix = segments.slice(0, i).join("/");
    try {
      if (lstatSync(join(root, prefix)).isSymbolicLink()) return { path: prefix, isDir: isDirectory(join(root, prefix)) };
    } catch {
      return undefined;
    }
  }
  return undefined;
}

/**
 * The repo-relative real path of `path` when a symlink makes it differ;
 * undefined when it doesn't; null when it resolves outside the repo.
 */
function symlinkTarget(root: string, realRoot: string, path: string): string | null | undefined {
  if (path === "") return undefined;
  let real: string;
  try {
    real = realpathSync(join(root, path));
  } catch {
    return undefined;
  }
  const rel = repoRelative(realRoot, real);
  if (rel === undefined) return null;
  return rel === path ? undefined : rel;
}

/** Git's verdict on each path, as the source that ignores it. Tracked files are never ignored. */
function gitIgnored(root: string, paths: PathQuery[]): Map<string, string> {
  const ignored = new Map<string, string>();
  const unique = [...new Set(paths.map((p) => p.path))];
  if (unique.length === 0) return ignored;
  const ask = (batch: string[]): boolean => {
    const r = spawnSync("git", ["check-ignore", "--stdin", "-z", "-v", "-n"], {
      cwd: root,
      input: batch.join("\0") + "\0",
      encoding: "utf8",
      maxBuffer: 64 * 1024 * 1024,
    });
    if (r.status !== 0 && r.status !== 1) return false;
    const fields = r.stdout.split("\0");
    for (let i = 0; i + 3 < fields.length; i += 4) {
      const [source = "", , pattern = "", path = ""] = fields.slice(i, i + 4);
      if (source !== "" && !pattern.startsWith("!")) ignored.set(path, source);
    }
    return true;
  };
  // Outside git the whole batch fails, and nothing is ignored by git. Inside
  // git, one path git refuses mustn't hide the verdicts on the others.
  if (!ask(unique) && isGitWorkTree(root)) for (const path of unique) ask([path]);
  return ignored;
}

function isGitWorkTree(root: string): boolean {
  return spawnSync("git", ["rev-parse", "--is-inside-work-tree"], { cwd: root, encoding: "utf8" }).stdout.trim() === "true";
}

/** `Read(...)` deny rules, read with Claude Code's anchors. `//` and `~/` rules are skipped and noted. */
function claudeDenyRules(root: string, problems: Problem[]): IgnoreRule[] {
  const text = readText(join(root, CLAUDE_SETTINGS));
  if (text === undefined) return [];
  let deny: unknown;
  try {
    deny = (JSON.parse(text) as { permissions?: { deny?: unknown } }).permissions?.deny;
  } catch {
    return [];
  }
  if (!Array.isArray(deny)) return [];
  const rules: IgnoreRule[] = [];
  for (const entry of deny) {
    if (typeof entry !== "string") continue;
    const m = /^Read\((.+)\)$/.exec(entry.trim());
    if (!m) continue;
    let pattern = (m[1] ?? "").trim();
    const negate = pattern.startsWith("!");
    if (negate) pattern = pattern.slice(1);
    if (pattern.startsWith("//") || pattern === "~" || pattern.startsWith("~/")) {
      problems.push(problem("note", "claude-rule-skipped", CLAUDE_SETTINGS, `${entry} uses a ${pattern.startsWith("//") ? "//" : "~/"} anchor, so it isn't honored`));
      continue;
    }
    if (pattern.startsWith("./")) pattern = pattern.slice(2);
    // Claude Code matches a single directory segment at any depth: `secrets/**` is `**/secrets/**`.
    if (/^[^/]+\/\*\*$/.test(pattern) && pattern !== "**/**") pattern = joinRel("**", pattern);
    const rule = parseRule((negate ? "!" : "") + pattern);
    if (rule) rules.push(rule);
  }
  return rules;
}

function readText(path: string): string | undefined {
  try {
    return readFileSync(path, "utf8");
  } catch {
    return undefined;
  }
}
