// Glob patterns over POSIX paths, compiled to regular expressions. One
// translation serves gitignore patterns, config `dir` globs and profile
// `match` / `exclude` globs; they differ only in what a trailing `**` means.

export const GLOB_CHARS = /[*?[]/;

export function hasGlobChars(pattern: string): boolean {
  return GLOB_CHARS.test(pattern.replace(/\\./g, ""));
}

export interface GlobOptions {
  /**
   * Whether a trailing `/**` also matches the directory itself. True for
   * config and profile globs ("zero or more segments"); false for gitignore,
   * where `abc/**` matches everything inside `abc` but not `abc`.
   */
  trailingMatchesSelf?: boolean;
}

/** Regex source for a whole-path glob, without anchors. */
export function globSource(pattern: string, { trailingMatchesSelf = true }: GlobOptions = {}): string {
  const segments = pattern.split("/");
  let out = "";
  segments.forEach((segment, i) => {
    const last = i === segments.length - 1;
    if (segment === "**") {
      if (!last) out += "(?:[^/]+/)*";
      else if (i === 0) out += ".*";
      else out = trailingMatchesSelf ? `${out.slice(0, -1)}(?:/.*)?` : `${out}.+`;
      return;
    }
    out += segmentSource(segment) + (last ? "" : "/");
  });
  return out;
}

export function compileGlob(pattern: string, options?: GlobOptions): RegExp {
  return new RegExp(`^${globSource(pattern, options)}$`);
}

/** Regex source for one path segment: `*`, `?`, `[...]` and `\` escapes. */
export function segmentSource(segment: string): string {
  let out = "";
  for (let i = 0; i < segment.length; i++) {
    const c = segment.charAt(i);
    if (c === "\\" && i + 1 < segment.length) {
      out += escapeRegex(segment.charAt(++i));
    } else if (c === "*") {
      out += "[^/]*";
      while (segment.charAt(i + 1) === "*") i++;
    } else if (c === "?") {
      out += "[^/]";
    } else if (c === "[") {
      const close = classEnd(segment, i);
      if (close === -1) {
        out += "\\[";
        continue;
      }
      let body = segment.slice(i + 1, close);
      let negate = false;
      if (body.startsWith("!") || body.startsWith("^")) {
        negate = true;
        body = body.slice(1);
      }
      out += `[${negate ? "^" : ""}${body.replace(/\\(?!.)/g, "\\\\").replace(/[[\]]/g, "\\$&")}]`;
      i = close;
    } else {
      out += escapeRegex(c);
    }
  }
  return out;
}

/** Index of the `]` closing a class opened at `open`, or -1. A `]` right after `[`, `[!` or `[^` is literal. */
function classEnd(segment: string, open: number): number {
  let i = open + 1;
  if (segment.charAt(i) === "!" || segment.charAt(i) === "^") i++;
  if (segment.charAt(i) === "]") i++;
  for (; i < segment.length; i++) {
    const c = segment.charAt(i);
    if (c === "\\") i++;
    else if (c === "]") return i;
  }
  return -1;
}

export function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&");
}
