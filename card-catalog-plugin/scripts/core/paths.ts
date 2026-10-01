// Repo roots and POSIX paths. Everything the core passes around is a
// repo-relative POSIX path ("" for the root); only the edges touch the
// filesystem's own form.

import { spawnSync } from "node:child_process";
import { existsSync, realpathSync, statSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";

export const CONFIG_FILE = "card-catalog.json";

/**
 * The git top-level directory containing `start`; outside git, the nearest
 * ancestor holding a `card-catalog.json`, or else `fallback` (the directory
 * the command or hook started in).
 */
export function findRepoRoot(start: string, fallback = start): string {
  const dir = nearestExistingDir(resolve(start));
  const git = spawnSync("git", ["rev-parse", "--show-toplevel"], { cwd: dir, encoding: "utf8" });
  if (git.status === 0 && git.stdout.trim()) return resolve(git.stdout.trim());
  for (let d = dir; ; d = dirname(d)) {
    if (existsSync(join(d, CONFIG_FILE))) return d;
    if (dirname(d) === d) return resolve(fallback);
  }
}

function nearestExistingDir(path: string): string {
  for (let p = path; ; p = dirname(p)) {
    if (isDirectory(p)) return p;
    if (dirname(p) === p) return p;
  }
}

export function isDirectory(abs: string): boolean {
  try {
    return statSync(abs).isDirectory();
  } catch {
    return false;
  }
}

export function isFile(abs: string): boolean {
  try {
    return statSync(abs).isFile();
  } catch {
    return false;
  }
}

export function toPosix(p: string): string {
  return sep === "/" ? p : p.split(sep).join("/");
}

/** `abs` relative to `root`, POSIX style; undefined if it's outside. Resolves symlinked ancestors on both sides. */
export function repoRelative(root: string, abs: string): string | undefined {
  const rel = toPosix(relative(root, abs));
  if (!rel.startsWith("../") && rel !== ".." && !isAbsolute(rel)) return rel;
  // The root or the path may be spelled through a symlink (macOS /var → /private/var).
  const real = toPosix(relative(realpathOr(root), realpathOr(abs)));
  if (!real.startsWith("../") && real !== ".." && !isAbsolute(real)) return real;
  return undefined;
}

/** realpath of the nearest existing ancestor, with the rest appended. */
export function realpathOr(abs: string): string {
  const missing: string[] = [];
  for (let p = abs; ; p = dirname(p)) {
    try {
      return join(realpathSync(p), ...missing.reverse());
    } catch {
      if (dirname(p) === p) return abs;
      missing.push(p.slice(dirname(p).length + 1));
    }
  }
}

export function joinRel(...parts: string[]): string {
  return parts.filter((p) => p !== "" && p !== ".").join("/");
}

/** Normalizes `..` and `.` segments. Returns undefined if the path climbs above its start. */
export function normalizeRel(path: string): string | undefined {
  const out: string[] = [];
  for (const seg of path.split("/")) {
    if (seg === "" || seg === ".") continue;
    if (seg === "..") {
      if (out.length === 0) return undefined;
      out.pop();
    } else {
      out.push(seg);
    }
  }
  return out.join("/");
}

export function relDirname(path: string): string {
  const i = path.lastIndexOf("/");
  return i === -1 ? "" : path.slice(0, i);
}

export function relBasename(path: string): string {
  return path.slice(path.lastIndexOf("/") + 1);
}

/** Whether `path` is `dir` or inside it. */
export function within(dir: string, path: string): boolean {
  return dir === "" || path === dir || path.startsWith(`${dir}/`);
}

/** `to` relative to the directory `fromDir`, both repo-relative. */
export function relFrom(fromDir: string, to: string): string {
  const a = fromDir === "" ? [] : fromDir.split("/");
  const b = to === "" ? [] : to.split("/");
  let i = 0;
  while (i < a.length && i < b.length && a[i] === b[i]) i++;
  return [...a.slice(i).map(() => ".."), ...b.slice(i)].join("/");
}

/** How a repo-relative directory is shown: "." for the root. */
export function displayDir(dir: string): string {
  return dir === "" ? "." : dir;
}
