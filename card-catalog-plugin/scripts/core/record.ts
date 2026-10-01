// Reads one record with its type's profile. A profile interpreter: every
// rule about where a value comes from is data in the profile, and this file
// only knows how to apply sources.

import { clean, heading, inline, lead, section, truncate } from "./markdown.ts";
import { type FrontmatterValue, splitFrontmatter } from "./frontmatter.ts";
import { compileIdPattern, type IdMatch, type IdPattern } from "./id-pattern.ts";
import type { Profile } from "./profile.ts";
import { escapeRegex } from "./glob.ts";

/** A link as written in a record, before it is looked up in the repo's collections. */
export interface RecordLink {
  type: string;
  /** The target label, or the text naming it. */
  target: string;
  /** For a markdown link to a `.md` file: the link's path, relative to the record file's directory. */
  path?: string;
}

export type RecordWarningCode = "unknown-status" | "no-summary" | "missing-status-link";

export interface ParsedRecord {
  id: string;
  label: string;
  series?: string;
  number?: number;
  slug?: string;
  title: string;
  /** Absent for a type whose status is `null`. */
  status?: string;
  summary: string;
  /** Path relative to the collection directory. */
  file: string;
  date?: string;
  tags?: string[];
  links: RecordLink[];
  fields: Record<string, string>;
  warnings: { code: RecordWarningCode; message: string }[];
}

export type SkipCode = "not-a-record" | "no-id" | "no-title";

export type ParseOutcome = { ok: true; record: ParsedRecord } | { ok: false; code: SkipCode; message: string };

interface Doc {
  fm: Record<string, FrontmatterValue>;
  body: string;
  name: string;
  inlineNames: string[];
}

/**
 * Parses the record at `file` (relative to the collection directory).
 * `collectionDirName` names the directory for `{dir}` when the file sits at
 * the top of the collection.
 */
export function parseRecord(profile: Profile, file: string, content: string, collectionDirName = ""): ParseOutcome {
  const stem = (file.split("/").pop() ?? file).replace(/\.md$/i, "");
  const parts = file.split("/");
  const dirName = parts.length > 1 ? (parts[parts.length - 2] ?? "") : collectionDirName;

  const text = content.replace(/^\uFEFF/, "").replace(/\r\n?/g, "\n");
  const { data: fm, body } = splitFrontmatter(text);
  const doc: Doc = { fm, body, name: profile.name, inlineNames: inlineNames(profile) };

  let idMatch: IdMatch | undefined;
  const pattern = idPatternFor(profile);
  if (pattern) {
    idMatch = pattern.fromFilename(stem, dirName);
    if (!idMatch) return { ok: false, code: "not-a-record", message: `name doesn't match id pattern ${profile.id}` };
  } else {
    const id = first(doc, [profile.id]);
    if (!id) return { ok: false, code: "no-id", message: `no ${profile.id.slice("frontmatter:".length)} in frontmatter` };
    idMatch = { id };
  }

  const title = first(doc, profile.title);
  if (!title) return { ok: false, code: "no-title", message: "no title" };

  const warnings: ParsedRecord["warnings"] = [];
  const summary = first(doc, profile.summary) ?? "";
  if (!summary) warnings.push({ code: "no-summary", message: "no summary" });

  const status = readStatus(profile, doc);
  if (status.unknown) warnings.push({ code: "unknown-status", message: `unrecognized status "${status.raw ?? ""}"` });

  const links = readLinks(profile, doc, status, idMatch.series);
  const showLink = status.value !== undefined ? profile.status?.showLink?.[status.value] : undefined;
  if (showLink && !links.some((l) => l.type === showLink)) {
    warnings.push({ code: "missing-status-link", message: `status is ${status.value ?? ""} but no ${showLink} link names the record that replaced it` });
  }

  const fields: Record<string, string> = {};
  for (const [name, sources] of Object.entries(profile.fields)) {
    const value = first(doc, sources);
    if (value) fields[name] = value;
  }
  const date = first(doc, profile.date);
  const tags = list(doc, profile.tags);

  const record: ParsedRecord = {
    id: idMatch.id,
    label: labelFor(profile, idMatch.id, idMatch.series),
    ...(idMatch.series !== undefined ? { series: idMatch.series } : {}),
    ...(idMatch.number !== undefined ? { number: idMatch.number } : {}),
    ...(idMatch.slug !== undefined ? { slug: idMatch.slug } : {}),
    title,
    ...(profile.status ? { status: status.value ?? "unspecified" } : {}),
    summary: truncate(summary),
    file,
    ...(date ? { date } : {}),
    ...(tags.length ? { tags } : {}),
    links,
    fields,
    warnings,
  };
  return { ok: true, record };
}

/** `{name} {id}` style label; a record in a series is labelled by its ID alone. */
export function labelFor(profile: Profile, id: string, series: string | undefined): string {
  if (series !== undefined) return id;
  return profile.label.replace(/\{name\}/g, profile.name).replace(/\{id\}/g, id);
}

const patternCache = new Map<string, IdPattern>();

export function idPatternFor(profile: Profile): IdPattern | undefined {
  if (profile.id.startsWith("frontmatter:")) return undefined;
  let p = patternCache.get(profile.id);
  if (!p) {
    p = compileIdPattern(profile.id);
    patternCache.set(profile.id, p);
  }
  return p;
}

function inlineNames(profile: Profile): string[] {
  const all = [
    profile.title, profile.summary, profile.date, profile.tags,
    profile.status?.from ?? [], ...Object.values(profile.links), ...Object.values(profile.fields),
  ].flat();
  return all.filter((s) => s.startsWith("inline:")).map((s) => s.slice("inline:".length));
}

// --- sources ---------------------------------------------------------------

/** Raw (uncleaned) values a source yields: one per list item, or one string. */
function yieldRaw(doc: Doc, source: string): string[] {
  const colon = source.indexOf(":");
  const kind = colon === -1 ? source : source.slice(0, colon);
  const arg = colon === -1 ? "" : source.slice(colon + 1);
  const one = (v: string | undefined) => (v === undefined ? [] : [v]);
  switch (kind) {
    case "frontmatter": {
      const v = doc.fm[arg.toLowerCase()];
      return v === undefined ? [] : Array.isArray(v) ? v : [v];
    }
    case "inline":
      return one(inline(doc.body, arg));
    case "section":
      return one(section(doc.body, arg));
    case "heading":
      return one(heading(doc.body, doc.name));
    case "lead":
      return one(lead(doc.body, doc.inlineNames, false));
    case "quote":
      return one(lead(doc.body, doc.inlineNames, true));
    default:
      return [];
  }
}

/** The first source that yields a non-empty value, cleaned. A list is joined with `, `. */
function first(doc: Doc, sources: string[]): string | undefined {
  for (const source of sources) {
    const value = clean(yieldRaw(doc, source).map(clean).filter(Boolean).join(", "));
    if (value) return value;
  }
  return undefined;
}

function firstRaw(doc: Doc, sources: string[]): string | undefined {
  for (const source of sources) {
    const values = yieldRaw(doc, source).filter((v) => clean(v));
    if (values.length) return values.join(", ");
  }
  return undefined;
}

/** A list: a list value's items, or a string split on commas. */
function list(doc: Doc, sources: string[]): string[] {
  for (const source of sources) {
    const values = yieldRaw(doc, source);
    const items = (values.length === 1 ? (values[0] ?? "").split(",") : values).map(clean).filter(Boolean);
    if (items.length) return items;
  }
  return [];
}

// --- status ----------------------------------------------------------------

interface StatusResult {
  value?: string;
  /** Raw status text, uncleaned. */
  raw?: string;
  /** The `values` key that matched, and the cleaned, lowercased text after it. */
  key?: string;
  rest?: string;
  unknown: boolean;
}

function readStatus(profile: Profile, doc: Doc): StatusResult {
  if (!profile.status) return { unknown: false };
  const raw = firstRaw(doc, profile.status.from);
  if (raw === undefined) return { unknown: false };
  const text = clean(raw).toLowerCase();
  let key: string | undefined;
  for (const k of Object.keys(profile.status.values)) {
    if (text.startsWith(k) && (key === undefined || k.length > key.length)) key = k;
  }
  if (key === undefined) return { raw: clean(raw), unknown: true };
  return { value: profile.status.values[key] ?? "unspecified", raw, key, rest: text.slice(key.length), unknown: false };
}

// --- links -----------------------------------------------------------------

const MD_LINK = /!?\[([^\]]*)\]\(<?([^)\s>]+)>?(?:\s+"[^"]*")?\)/g;

function readLinks(profile: Profile, doc: Doc, status: StatusResult, ownSeries: string | undefined): RecordLink[] {
  const links: RecordLink[] = [];
  const seen = new Set<string>();
  const add = (type: string, ref: Omit<RecordLink, "type">) => {
    const key = `${type}\0${ref.target}\0${ref.path ?? ""}`;
    if (seen.has(key)) return;
    seen.add(key);
    links.push({ type, ...ref });
  };
  for (const [type, sources] of Object.entries(profile.links)) {
    for (const source of sources) {
      if (source.startsWith("status:")) {
        if (status.value !== source.slice("status:".length) || status.raw === undefined) continue;
        const ref = fileRefs(status.raw)[0] ?? searchRef(profile, status.rest ?? "", ownSeries);
        if (ref) add(type, ref);
        continue;
      }
      for (const value of yieldRaw(doc, source)) {
        const files = fileRefs(value);
        if (files.length) {
          for (const ref of files) add(type, ref);
          continue;
        }
        for (const part of value.split(/[,;]/)) {
          const text = clean(part);
          if (text) add(type, { target: normalizeRef(profile, text, ownSeries) ?? text });
        }
      }
    }
  }
  return links;
}

function fileRefs(text: string): Omit<RecordLink, "type">[] {
  const refs: Omit<RecordLink, "type">[] = [];
  for (const m of text.matchAll(MD_LINK)) {
    const path = (m[2] ?? "").replace(/[#?].*$/, "");
    if (/\.md$/i.test(path) && !/^[a-z][a-z0-9+.-]*:/i.test(path)) refs.push({ target: clean(m[1] ?? ""), path: decodeURIComponentSafe(path) });
  }
  return refs;
}

function decodeURIComponentSafe(s: string): string {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}

interface RefMatchers {
  label: RegExp;
  id: RegExp | undefined;
  pattern: IdPattern | undefined;
}

const matcherCache = new WeakMap<Profile, RefMatchers>();

function refMatchers(profile: Profile): RefMatchers {
  let m = matcherCache.get(profile);
  if (m) return m;
  const pattern = idPatternFor(profile);
  const idSrc = pattern ? pattern.textSource() : "[A-Za-z0-9][A-Za-z0-9._-]*";
  const labelSrc = profile.label
    .split(/(\{name\}|\{id\})/)
    .map((part) => (part === "{name}" ? escapeRegex(profile.name) : part === "{id}" ? `(${idSrc})` : escapeRegex(part).replace(/[\s-]+/g, "[\\s-]?")))
    .join("");
  m = {
    label: new RegExp(`(?<![A-Za-z0-9])${labelSrc}(?![A-Za-z0-9])`, "i"),
    id: pattern ? new RegExp(`(?<![A-Za-z0-9])(${idSrc})(?![A-Za-z0-9])`, "i") : undefined,
    pattern,
  };
  matcherCache.set(profile, m);
  return m;
}

function labelFromMatch(profile: Profile, m: RegExpExecArray, offset: number, ownSeries: string | undefined): string {
  const { pattern } = refMatchers(profile);
  if (!pattern) return labelFor(profile, m[offset - 1] ?? "", undefined);
  const id = pattern.fromText(m, offset, ownSeries);
  return labelFor(profile, id.id, id.series);
}

/** Rules 2 and 3 on a whole reference: the label, or the ID alone, normalized. */
export function normalizeRef(profile: Profile, text: string, ownSeries: string | undefined): string | undefined {
  const { label, id } = refMatchers(profile);
  for (const re of [label, id]) {
    if (!re) continue;
    const m = new RegExp(`^(?:${re.source})$`, re.flags).exec(text);
    if (m) return labelFromMatch(profile, m, 2, ownSeries);
  }
  return undefined;
}

/** Rules 2 and 3 on status text: the first label or ID in it. */
function searchRef(profile: Profile, text: string, ownSeries: string | undefined): Omit<RecordLink, "type"> | undefined {
  const { label, id } = refMatchers(profile);
  const byLabel = label.exec(text);
  const byId = id?.exec(text) ?? null;
  const m = byLabel && (!byId || byLabel.index <= byId.index) ? byLabel : byId;
  return m ? { target: labelFromMatch(profile, m, 2, ownSeries) } : undefined;
}

/** Whether text looks like a label of this type, or a series ID, for `broken-link`. */
export function looksLikeLabel(profile: Profile, text: string): boolean {
  const { label, id, pattern } = refMatchers(profile);
  const full = (re: RegExp) => new RegExp(`^(?:${re.source})$`, re.flags).test(text);
  if (full(label)) return true;
  return pattern?.hasSeries === true && id !== undefined && full(id) && /^[a-z][a-z0-9]*-/i.test(text);
}
