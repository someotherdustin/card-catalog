// Reads the flat YAML subset that record frontmatter uses: `key: value`,
// quoted values, flow and block lists, block scalars (`>` and `|`) and
// comment lines. Anything else, such as a nested map, is skipped without
// error: a record's frontmatter is never a reason to fail.

export type FrontmatterValue = string | string[];

export interface SplitDocument {
  /** Keys lowercased. */
  data: Record<string, FrontmatterValue>;
  body: string;
}

/** Splits `---` frontmatter from the body. `text` has no BOM and uses `\n` line endings. */
export function splitFrontmatter(text: string): SplitDocument {
  const m = /^---\n([\s\S]*?)\n?---[ \t]*(?:\n|$)/.exec(text);
  if (!m) return { data: {}, body: text };
  return { data: parseYamlSubset(m[1] ?? ""), body: text.slice(m[0].length) };
}

const KEY_LINE = /^([A-Za-z0-9_][A-Za-z0-9_.-]*)[ \t]*:(?:[ \t]+(.*))?[ \t]*$/;
const BLOCK_SCALAR = /^([|>])([+-]?)\d?([+-]?)(?:[ \t]+#.*)?$/;

export function parseYamlSubset(source: string): Record<string, FrontmatterValue> {
  const data: Record<string, FrontmatterValue> = {};
  const lines = source.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? "";
    if (/^\s*#/.test(line) || /^\s/.test(line) || line.trim() === "") continue;
    const kv = KEY_LINE.exec(line);
    if (!kv) continue;
    const key = (kv[1] ?? "").toLowerCase();
    const value = (kv[2] ?? "").trim();

    const block = BLOCK_SCALAR.exec(value);
    if (block) {
      const body: string[] = [];
      while (i + 1 < lines.length && (/^\s/.test(lines[i + 1] ?? "") || (lines[i + 1] ?? "") === "")) body.push(lines[++i] ?? "");
      data[key] = blockScalar(body, block[1] === ">", (block[2] ?? "") + (block[3] ?? ""));
      continue;
    }
    if (value === "") {
      // A block list, if `- item` lines follow; a nested map otherwise, which is skipped.
      const items: string[] = [];
      while (i + 1 < lines.length) {
        const next = lines[i + 1] ?? "";
        const item = /^\s*-(?:[ \t]+(.*))?$/.exec(next);
        if (item) items.push(unquote(item[1] ?? ""));
        else if (!/^\s/.test(next) && next.trim() !== "") break;
        i++;
      }
      if (items.length) data[key] = items.filter(Boolean);
      continue;
    }
    if (value.startsWith("[") && value.endsWith("]")) {
      data[key] = splitFlowList(value.slice(1, -1)).map(unquote).filter(Boolean);
      continue;
    }
    if (value.startsWith("{")) continue;
    data[key] = unquote(stripComment(value));
  }
  return data;
}

function blockScalar(lines: string[], folded: boolean, chomp: string): string {
  while (lines.length && (lines[lines.length - 1] ?? "").trim() === "" && chomp !== "+") lines.pop();
  const indent = Math.min(...lines.filter((l) => l.trim()).map((l) => /^\s*/.exec(l)?.[0].length ?? 0));
  const stripped = lines.map((l) => l.slice(Number.isFinite(indent) ? indent : 0));
  if (!folded) return stripped.join("\n");
  // Folded: lines join with spaces; a blank line is a line break.
  return stripped.reduce((acc, l) => (l === "" ? `${acc}\n` : acc === "" || acc.endsWith("\n") ? acc + l : `${acc} ${l}`), "");
}

function splitFlowList(s: string): string[] {
  const out: string[] = [];
  let current = "";
  let quote = "";
  for (const c of s) {
    if (quote) {
      if (c === quote) quote = "";
      current += c;
    } else if (c === '"' || c === "'") {
      quote = c;
      current += c;
    } else if (c === ",") {
      out.push(current);
      current = "";
    } else {
      current += c;
    }
  }
  out.push(current);
  return out;
}

function stripComment(value: string): string {
  if (value.startsWith('"') || value.startsWith("'")) return value;
  return value.replace(/[ \t]+#.*$/, "");
}

function unquote(s: string): string {
  const t = s.trim();
  if (t.length >= 2 && (t.startsWith('"') || t.startsWith("'")) && t.endsWith(t.charAt(0))) {
    const inner = t.slice(1, -1);
    return t.startsWith("'") ? inner.replace(/''/g, "'") : inner.replace(/\\"/g, '"').replace(/\\\\/g, "\\");
  }
  return t;
}
