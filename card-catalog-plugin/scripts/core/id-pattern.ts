// ID patterns: literal text with `{number}`, `{series}`, `{date}`, `{slug}`
// and `{dir}` placeholders, and `[...]` for optional parts. A pattern reads
// IDs from filenames, and normalizes IDs written in link text.

import { escapeRegex } from "./glob.ts";

type Placeholder = "number" | "series" | "date" | "slug" | "dir";
type Token = { lit: string } | { ph: Placeholder } | { opt: Token[] };

const PLACEHOLDER_SOURCE: Record<Placeholder, string> = {
  number: "\\d{1,5}",
  series: "[a-z][a-z0-9]*",
  date: "\\d{4}-\\d{2}-\\d{2}",
  slug: "[a-z0-9][a-z0-9._-]*",
  // `{dir}` matches nothing in a filename; in link text it reads like a slug.
  dir: "[a-z0-9][a-z0-9._-]*",
};

export interface IdMatch {
  id: string;
  series?: string;
  number?: number;
  slug?: string;
}

export interface IdPattern {
  pattern: string;
  hasNumber: boolean;
  hasSeries: boolean;
  /** Reads the ID from a filename without `.md`. Undefined when the name doesn't match. */
  fromFilename(stem: string, dirName: string): IdMatch | undefined;
  /** Regex source matching an ID in text, for link references. */
  textSource(): string;
  /** Normalizes an ID found by `textSource()`. A missing series becomes `ownSeries`. */
  fromText(match: RegExpExecArray, groupOffset: number, ownSeries: string | undefined): IdMatch;
}

export class IdPatternError extends Error {}

export function compileIdPattern(pattern: string): IdPattern {
  const tokens = tokenize(pattern);
  const flat = flatten(tokens);
  const placeholders = new Set(flat.filter((t): t is { ph: Placeholder } => "ph" in t).map((t) => t.ph));
  if (placeholders.size === 0) throw new IdPatternError(`ID pattern "${pattern}" has no placeholder`);
  const filenameOnlyDir = [...placeholders].every((p) => p === "dir") && flat.every((t) => !("lit" in t));

  // Capture groups follow token order; `render` walks the tokens in the same
  // order. In a filename, `{dir}` has no group.
  const source = (ts: Token[], forFilename: boolean): string =>
    ts
      .map((t) => {
        if ("lit" in t) return escapeRegex(t.lit);
        if ("ph" in t) return t.ph === "dir" && forFilename ? "" : `(${PLACEHOLDER_SOURCE[t.ph]})`;
        return `(${source(t.opt, forFilename)})?`;
      })
      .join("");
  const filenameRe = new RegExp(`^(?:${source(tokens, true)})(?=-|$)`, "i");
  const textSrc = source(tokens, false);

  const render = (m: RegExpExecArray, offset: number, dirName: string | undefined, ownSeries: string | undefined): IdMatch => {
    let gi = 0;
    const result: IdMatch = { id: "" };
    const walk = (ts: Token[], include: boolean): string =>
      ts
        .map((t) => {
          if ("lit" in t) return include ? t.lit : "";
          if ("ph" in t) {
            if (t.ph === "dir" && dirName !== undefined) return include ? dirName : "";
            const value = m[offset + gi++] ?? "";
            if (!include || value === "") return "";
            if (t.ph === "number") {
              result.number = Number(value);
              return value.padStart(4, "0");
            }
            if (t.ph === "series") {
              result.series = value.toLowerCase();
              return result.series;
            }
            if (t.ph === "slug") result.slug = value;
            return value;
          }
          const matched = include && m[offset + gi] !== undefined;
          gi++;
          // A reference without a series means the linking record's own series.
          if (include && !matched && ownSeries !== undefined && t.opt.some((x) => "ph" in x && x.ph === "series")) {
            result.series = ownSeries;
            const rendered = t.opt.map((x) => ("lit" in x ? x.lit : "ph" in x && x.ph === "series" ? ownSeries : "")).join("");
            skipGroups(t.opt);
            return rendered;
          }
          return walk(t.opt, matched);
        })
        .join("");
    const skipGroups = (ts: Token[]): void => {
      for (const t of ts) {
        if ("ph" in t) gi++;
        else if ("opt" in t) {
          gi++;
          skipGroups(t.opt);
        }
      }
    };
    result.id = walk(tokens, true);
    return result;
  };

  return {
    pattern,
    hasNumber: placeholders.has("number"),
    hasSeries: placeholders.has("series"),
    fromFilename(stem, dirName) {
      if (filenameOnlyDir) return { id: dirName };
      const m = filenameRe.exec(stem);
      if (!m) return undefined;
      const result = render(m, 1, dirName, undefined);
      if (!placeholders.has("slug")) {
        const rest = stem.slice(m[0].length + 1);
        if (rest) result.slug = rest;
      }
      return result;
    },
    textSource: () => textSrc,
    fromText: (m, offset, ownSeries) => render(m, offset, undefined, ownSeries),
  };
}

function tokenize(pattern: string): Token[] {
  const root: Token[] = [];
  let current = root;
  let parent: Token[] | undefined;
  let lit = "";
  const flushLit = () => {
    if (lit) current.push({ lit });
    lit = "";
  };
  for (let i = 0; i < pattern.length; i++) {
    const c = pattern.charAt(i);
    if (c === "{") {
      const close = pattern.indexOf("}", i);
      const name = close === -1 ? "" : pattern.slice(i + 1, close);
      if (!["number", "series", "date", "slug", "dir"].includes(name)) {
        throw new IdPatternError(`ID pattern "${pattern}" has an unknown placeholder at "${pattern.slice(i)}"`);
      }
      flushLit();
      current.push({ ph: name as Placeholder });
      i = close;
    } else if (c === "[") {
      if (parent) throw new IdPatternError(`ID pattern "${pattern}" nests optional parts`);
      flushLit();
      const opt: Token[] = [];
      current.push({ opt });
      parent = current;
      current = opt;
    } else if (c === "]") {
      if (!parent) throw new IdPatternError(`ID pattern "${pattern}" has an unmatched "]"`);
      flushLit();
      current = parent;
      parent = undefined;
    } else if (c === "}") {
      throw new IdPatternError(`ID pattern "${pattern}" has an unmatched "}"`);
    } else {
      lit += c;
    }
  }
  if (parent) throw new IdPatternError(`ID pattern "${pattern}" has an unclosed "["`);
  flushLit();
  return root;
}

function flatten(tokens: Token[]): Token[] {
  return tokens.flatMap((t) => ("opt" in t ? flatten(t.opt) : [t]));
}

