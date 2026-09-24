// Lenient ADR parser. We don't own the write path (grill-with-docs /
// domain-modeling does), so this never throws on odd input: it extracts what
// it can and reports failure only when there is no usable title.
//
// Upstream format (mattpocock/skills domain-modeling/ADR-FORMAT.md):
//
//   # {Short title of the decision}
//
//   {1-3 sentences: what's the context, what did we decide, and why.}
//
// with optional `status` frontmatter and optional "Considered Options" /
// "Consequences" sections. Nygard-style ADRs (## Status / ## Context /
// ## Decision) and adr-tools output are handled too.

export type AdrStatus =
  | "proposed"
  | "accepted"
  | "rejected"
  | "deprecated"
  | "superseded"
  | "unspecified";

export interface AdrEntry {
  /** Sequential number from the filename, e.g. 7 for 0007-foo.md. */
  id: number;
  slug: string;
  title: string;
  status: AdrStatus;
  /** ADR number that supersedes this one, when status is "superseded". */
  supersededBy?: number;
  /** One-line summary: the cheap-to-load part of the index. */
  summary: string;
  date?: string;
  tags?: string[];
  /** Filename relative to the ADR directory. */
  file: string;
}

export type ParseResult =
  | { ok: true; entry: AdrEntry; warnings: string[] }
  | { ok: false; reason: string };

const FILENAME_RE = /^(\d{1,5})-([a-z0-9][a-z0-9._-]*)\.md$/i;
const SUMMARY_MAX = 280;

export function isAdrFilename(file: string): boolean {
  return FILENAME_RE.test(file);
}

export function parseAdr(file: string, content: string): ParseResult {
  const nameMatch = FILENAME_RE.exec(file);
  if (!nameMatch) return { ok: false, reason: `not an ADR filename: ${file}` };

  const warnings: string[] = [];
  const text = content.replace(/^\uFEFF/, "").replace(/\r\n?/g, "\n");
  const { data: fm, body } = splitFrontmatter(text);

  const title = asString(fm["title"]) ?? extractTitle(body);
  if (!title) return { ok: false, reason: `no title found in ${file}` };

  const rawStatus = asString(fm["status"]) ?? extractSection(body, "status") ?? extractInlineField(body, "status");
  const { status, supersededBy } = normalizeStatus(rawStatus);
  if (rawStatus && status === "unspecified") warnings.push(`${file}: unrecognized status "${rawStatus}"`);

  let summary = asString(fm["summary"]) ?? extractInlineField(body, "summary") ?? extractLeadParagraph(body);
  if (!summary) {
    summary = extractSection(body, "decision") ?? extractSection(body, "context") ?? "";
    if (!summary) warnings.push(`${file}: no summary could be extracted`);
  }

  const date = asString(fm["date"]) ?? extractInlineField(body, "date");
  const tags = asList(fm["tags"]);

  const [, num = "", slug = ""] = nameMatch;
  const entry: AdrEntry = {
    id: Number(num),
    slug,
    title,
    status,
    summary: truncate(cleanInline(summary), SUMMARY_MAX),
    file,
  };
  if (supersededBy !== undefined) entry.supersededBy = supersededBy;
  if (date) entry.date = date;
  if (tags.length) entry.tags = tags;
  return { ok: true, entry, warnings };
}

// --- frontmatter -----------------------------------------------------------

type FmValue = string | string[];

/** Minimal flat-YAML reader: `key: value` and `key: [a, b]` / `- item` lists. */
export function splitFrontmatter(text: string): { data: Record<string, FmValue>; body: string } {
  const m = /^---\n([\s\S]*?)\n---[ \t]*(?:\n|$)/.exec(text);
  if (!m) return { data: {}, body: text };

  const data: Record<string, FmValue> = {};
  let list: string[] | null = null;
  for (const line of (m[1] ?? "").split("\n")) {
    const item = /^\s*-\s+(.*)$/.exec(line);
    if (item && list) {
      list.push(unquote(item[1] ?? ""));
      continue;
    }
    const kv = /^([A-Za-z0-9_-]+)\s*:\s*(.*)$/.exec(line);
    if (!kv) continue;
    const key = (kv[1] ?? "").toLowerCase();
    const value = (kv[2] ?? "").trim();
    if (value === "") {
      list = [];
      data[key] = list;
    } else if (value.startsWith("[") && value.endsWith("]")) {
      data[key] = value.slice(1, -1).split(",").map(unquote).filter(Boolean);
      list = null;
    } else {
      data[key] = unquote(value);
      list = null;
    }
  }
  return { data, body: text.slice(m[0].length) };
}

function unquote(s: string): string {
  const t = s.trim();
  if (t.length >= 2 && (t.startsWith('"') || t.startsWith("'")) && t.endsWith(t.charAt(0))) return t.slice(1, -1);
  return t;
}

function asString(v: FmValue | undefined): string | undefined {
  if (typeof v === "string") return v.trim() || undefined;
  if (Array.isArray(v) && v.length) return v.join(", ");
  return undefined;
}

function asList(v: FmValue | undefined): string[] {
  if (Array.isArray(v)) return v.filter(Boolean);
  if (typeof v === "string") return v.split(",").map((s) => s.trim()).filter(Boolean);
  return [];
}

// --- body extraction -------------------------------------------------------

function extractTitle(body: string): string | undefined {
  const m = /^#[ \t]+(.+?)[ \t#]*$/m.exec(body);
  if (!m) return undefined;
  // "1. Record architecture decisions" (adr-tools), "ADR-0007: Foo", "ADR 7 - Foo"
  const t = (m[1] ?? "")
    .replace(/^ADR[- ]?\d+\s*[:.\-–—]\s*/i, "")
    .replace(/^\d+\.\s+/, "")
    .trim();
  return t || undefined;
}

/** First paragraph of a `## Name` section. */
function extractSection(body: string, name: string): string | undefined {
  const re = new RegExp(`^#{2,3}[ \\t]+${name}[ \\t]*:?[ \\t]*$`, "im");
  const m = re.exec(body);
  if (!m) return undefined;
  const rest = body.slice(m.index + m[0].length);
  const end = rest.search(/^#{1,3}[ \t]/m);
  return firstParagraph(end === -1 ? rest : rest.slice(0, end));
}

/** `Status: accepted`, `**Status:** accepted`, `- Date: 2026-01-01`. */
function extractInlineField(body: string, name: string): string | undefined {
  const re = new RegExp(`^[ \\t]*(?:[-*][ \\t]+)?(?:\\*\\*|__)?${name}(?:\\*\\*|__)?[ \\t]*:(?:\\*\\*|__)?[ \\t]*(.+)$`, "im");
  const m = re.exec(body);
  return m?.[1] ? m[1].replace(/(\*\*|__)$/, "").trim() || undefined : undefined;
}

/** First prose paragraph after the H1, skipping inline metadata lines. */
function extractLeadParagraph(body: string): string | undefined {
  const h1 = /^#[ \t]+.+$/m.exec(body);
  let rest = h1 ? body.slice(h1.index + h1[0].length) : body;
  const nextHeading = rest.search(/^#{1,6}[ \t]/m);
  if (nextHeading !== -1) rest = rest.slice(0, nextHeading);
  const lines = rest
    .split("\n")
    .filter((l) => !/^[ \t]*(?:[-*][ \t]+)?(?:\*\*|__)?(status|date|deciders|tags|summary)(?:\*\*|__)?[ \t]*:/i.test(l));
  return firstParagraph(lines.join("\n"));
}

function firstParagraph(text: string): string | undefined {
  for (const block of text.split(/\n[ \t]*\n/)) {
    const t = block.trim();
    if (t && !t.startsWith("<!--")) return t;
  }
  return undefined;
}

// --- normalization ---------------------------------------------------------

export function normalizeStatus(raw: string | undefined): { status: AdrStatus; supersededBy?: number } {
  if (!raw) return { status: "unspecified" };
  const s = cleanInline(raw).toLowerCase();
  if (s.startsWith("superseded")) {
    const n = /(\d+)/.exec(s.replace(/^superseded/, ""));
    return n ? { status: "superseded", supersededBy: Number(n[1]) } : { status: "superseded" };
  }
  for (const k of ["proposed", "accepted", "rejected", "deprecated"] as const) {
    if (s.startsWith(k)) return { status: k };
  }
  if (s.startsWith("draft")) return { status: "proposed" };
  return { status: "unspecified" };
}

function cleanInline(s: string): string {
  return s
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1") // links/images → text
    .replace(/(\*\*|__|`)/g, "")
    .replace(/^[ \t]*[-*>][ \t]+/gm, "")
    .replace(/\s+/g, " ")
    .trim();
}

function truncate(s: string, max: number): string {
  if (s.length <= max) return s;
  const cut = s.slice(0, max);
  const sentence = cut.lastIndexOf(". ");
  if (sentence > max * 0.5) return cut.slice(0, sentence + 1);
  return cut.replace(/\s+\S*$/, "") + "…";
}
