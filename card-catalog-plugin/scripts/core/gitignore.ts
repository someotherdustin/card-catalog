// A gitignore(5) matcher, so agent ignore files, `ignoreFiles` and Claude
// Code deny rules are read exactly as git would read them, with no runtime
// dependency. Its tests compare it with `git check-ignore --no-index`.

import { globSource } from "./glob.ts";

export interface IgnoreRule {
  /** The pattern as written, for messages. */
  pattern: string;
  negate: boolean;
  dirOnly: boolean;
  regex: RegExp;
}

export interface IgnoreMatcher {
  /** Whether a repo-relative POSIX path is ignored, including by an excluded parent directory. */
  ignores(path: string, isDir: boolean): boolean;
}

export interface IgnoreOptions {
  /** Repo-relative directory the patterns are relative to. Default: the root. */
  base?: string;
}

export function parseIgnore(text: string, options: IgnoreOptions = {}): IgnoreMatcher {
  return ignoreMatcher(parseIgnoreLines(text.split(/\r?\n/)), options);
}

export function parseIgnoreLines(lines: string[]): IgnoreRule[] {
  const rules: IgnoreRule[] = [];
  for (const line of lines) {
    const rule = parseRule(line);
    if (rule) rules.push(rule);
  }
  return rules;
}

export function parseRule(line: string): IgnoreRule | undefined {
  // Trailing spaces are trimmed unless escaped with a backslash.
  let p = line.replace(/(?<!\\)[ \t]+$/, "");
  if (p === "" || p.startsWith("#")) return undefined;
  let negate = false;
  if (p.startsWith("!")) {
    negate = true;
    p = p.slice(1);
  } else if (p.startsWith("\\#") || p.startsWith("\\!")) {
    p = p.slice(1);
  }
  let dirOnly = false;
  if (p.endsWith("/")) {
    dirOnly = true;
    p = p.slice(0, -1);
  }
  if (p === "") return undefined;
  // A slash at the start or in the middle anchors the pattern to its base.
  const anchored = p.includes("/");
  if (p.startsWith("/")) p = p.slice(1);
  const source = globSource(p, { trailingMatchesSelf: false });
  const regex = new RegExp(`^${anchored ? "" : "(?:.*/)?"}${source}$`);
  return { pattern: line.trim(), negate, dirOnly, regex };
}

export function ignoreMatcher(rules: IgnoreRule[], { base = "" }: IgnoreOptions = {}): IgnoreMatcher {
  const prefix = base === "" ? "" : `${base}/`;
  const decide = (path: string, isDir: boolean): boolean | undefined => {
    for (let i = rules.length - 1; i >= 0; i--) {
      const rule = rules[i];
      if (!rule || (rule.dirOnly && !isDir)) continue;
      if (rule.regex.test(path)) return !rule.negate;
    }
    return undefined;
  };
  return {
    ignores(path, isDir) {
      if (prefix && !path.startsWith(prefix)) return false;
      const local = path.slice(prefix.length);
      const segments = local.split("/");
      // A file can't be re-included if a parent directory is excluded.
      for (let i = 1; i < segments.length; i++) {
        if (decide(segments.slice(0, i).join("/"), true) === true) return true;
      }
      return decide(local, isDir) === true;
    },
  };
}
