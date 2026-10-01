// Profiles: plain data saying how to read the records of one record type.
// The built-in `adr` profile is today's ADR parser written as data; a
// user-defined type starts from the generic defaults.

import { compileIdPattern, IdPatternError } from "./id-pattern.ts";

export interface StatusSpec {
  from: string[];
  values: Record<string, string>;
  showLink?: Record<string, string>;
}

export interface Profile {
  name: string;
  plural: string;
  description?: string;
  match: string;
  exclude: string[];
  id: string;
  title: string[];
  summary: string[];
  status: StatusSpec | null;
  links: Record<string, string[]>;
  fields: Record<string, string[]>;
  date: string[];
  tags: string[];
  label: string;
  guidance?: string;
}

export type ProfileField = keyof Profile;

/** Profile fields a config entry may give. `exclude` is a collection setting there. */
export const ENTRY_PROFILE_FIELDS = [
  "name", "plural", "description", "match", "id", "title", "summary", "status",
  "links", "fields", "date", "tags", "label", "guidance",
] as const satisfies readonly ProfileField[];

export const PROFILE_FIELDS = [
  "name", "plural", "description", "match", "exclude", "id", "title", "summary", "status",
  "links", "fields", "date", "tags", "label", "guidance",
] as const satisfies readonly ProfileField[];

export const NAME_RULE = /^[a-z][a-z0-9-]*$/;

export const ADR_PROFILE: Profile = {
  name: "ADR",
  plural: "ADRs",
  description: "architecture decisions",
  match: "*.md",
  exclude: ["README.md", "INDEX.md"],
  id: "[{series}-]{number}",
  title: ["frontmatter:title", "heading"],
  summary: ["frontmatter:summary", "inline:Summary", "lead", "section:Decision", "section:Context", "quote"],
  status: {
    from: ["frontmatter:status", "section:Status", "inline:Status"],
    values: {
      draft: "proposed", proposed: "proposed", accepted: "accepted",
      rejected: "rejected", deprecated: "deprecated", superseded: "superseded",
    },
    showLink: { superseded: "superseded-by" },
  },
  links: {
    supersedes: ["frontmatter:supersedes"],
    "superseded-by": ["frontmatter:superseded-by", "status:superseded"],
    implements: ["frontmatter:implements"],
    "relates-to": ["frontmatter:relates-to"],
  },
  fields: {},
  date: ["frontmatter:date", "inline:Date"],
  tags: ["frontmatter:tags"],
  label: "ADR-{id}",
  guidance: "If your work would contradict an accepted ADR, say so explicitly rather than silently overriding it.",
};

/** How sentences name one record: the name, lowercased unless it's all capitals (`ADR`, `postmortem`). */
export function recordNoun(profile: Profile): string {
  return profile.name === profile.name.toUpperCase() ? profile.name : profile.name.toLowerCase();
}

/** `1 ADR`, `12 postmortems`. */
export function recordCount(profile: Profile, n: number): string {
  return `${String(n)} ${n === 1 ? recordNoun(profile) : profile.plural}`;
}

export const BUILTIN_PROFILES: Readonly<Record<string, Profile>> = { adr: ADR_PROFILE };

export function genericDefaults(type: string, name = type.charAt(0).toUpperCase() + type.slice(1)): Profile {
  return {
    name,
    plural: name === name.toUpperCase() ? `${name}s` : `${name.toLowerCase()}s`,
    match: "*.md",
    exclude: ["README.md", "INDEX.md"],
    id: "{slug}",
    title: ["frontmatter:title", "heading"],
    summary: ["frontmatter:summary", "inline:Summary", "lead", "quote"],
    status: null,
    links: Object.fromEntries(["supersedes", "superseded-by", "implements", "relates-to"].map((t) => [t, [`frontmatter:${t}`]])),
    fields: {},
    date: ["frontmatter:date", "inline:Date"],
    tags: ["frontmatter:tags"],
    label: "{name} {id}",
  };
}

/** Where a profile field or collection setting came from. */
export type ValueSource = "built-in" | "generic default" | "default" | `config entry ${string}` | "--entry";

export interface ResolvedProfile {
  profile: Profile;
  sources: Record<ProfileField, ValueSource>;
}

/**
 * The profile for `type`: the built-in profile or the generic defaults, with
 * each field `given` replacing the starting field whole. `given` must have
 * passed `validateProfileFields`.
 */
export function resolveProfile(type: string, given: Record<string, unknown>, givenSource: ValueSource): ResolvedProfile {
  const builtin = BUILTIN_PROFILES[type];
  const start = builtin ?? genericDefaults(type, typeof given["name"] === "string" ? given["name"] : undefined);
  const startSource: ValueSource = builtin ? "built-in" : "generic default";
  const profile: Profile = { ...start };
  const sources = Object.fromEntries(PROFILE_FIELDS.map((f) => [f, startSource])) as Record<ProfileField, ValueSource>;
  const set = profile as unknown as Record<string, unknown>;
  for (const field of ENTRY_PROFILE_FIELDS) {
    if (!(field in given)) continue;
    set[field] = normalizeField(field, given[field]);
    sources[field] = givenSource;
  }
  return { profile, sources };
}

function normalizeField(field: ProfileField, value: unknown): unknown {
  switch (field) {
    case "title":
    case "summary":
    case "date":
    case "tags":
      return toList(value);
    case "links":
    case "fields":
      return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([k, v]) => [k, toList(v)]));
    case "status": {
      if (value === null) return null;
      const s = value as { from: unknown; values: Record<string, string>; showLink?: Record<string, string> };
      return {
        from: toList(s.from),
        values: Object.fromEntries(Object.entries(s.values).map(([k, v]) => [k.toLowerCase(), v])),
        ...(s.showLink ? { showLink: s.showLink } : {}),
      };
    }
    case "name":
    case "plural":
    case "description":
    case "match":
    case "exclude":
    case "id":
    case "label":
    case "guidance":
      return value;
  }
}

function toList(value: unknown): string[] {
  return Array.isArray(value) ? (value as string[]) : [value as string];
}

// --- validation ----------------------------------------------------------

const SOURCE_RE = /^(?:(frontmatter):([A-Za-z0-9_][A-Za-z0-9_.-]*)|(inline|section|status):(\S.*)|heading|lead|quote)$/;

export function sourceError(source: unknown, allowStatus: boolean): string | undefined {
  if (typeof source !== "string") return "a source must be a string";
  const m = SOURCE_RE.exec(source);
  if (!m) return `"${source}" is not a source`;
  if (m[3] === "status" && !allowStatus) return `"${source}": status: sources are for links only`;
  return undefined;
}

function sourcesError(value: unknown, allowStatus = false): string | undefined {
  const list = Array.isArray(value) ? (value as unknown[]) : [value];
  if (list.length === 0) return "needs at least one source";
  for (const s of list) {
    const e = sourceError(s, allowStatus);
    if (e) return e;
  }
  return undefined;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function nonEmptyString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() !== "" ? undefined : "must be a non-empty string";
}

/** Errors for the profile fields in a config entry, as `field: problem`. */
export function validateProfileFields(entry: Record<string, unknown>): string[] {
  const errors: string[] = [];
  const check = (field: string, error: string | undefined) => {
    if (error) errors.push(`${field}: ${error}`);
  };
  for (const field of ENTRY_PROFILE_FIELDS) {
    if (!(field in entry)) continue;
    const value = entry[field];
    switch (field) {
      case "name":
      case "plural":
      case "description":
      case "guidance":
      case "match":
        check(field, nonEmptyString(value));
        break;
      case "title":
      case "summary":
      case "date":
      case "tags":
        check(field, sourcesError(value));
        break;
      case "id":
        check(field, idError(value));
        break;
      case "label":
        check(field, labelError(value));
        break;
      case "links":
      case "fields":
        if (!isPlainObject(value)) {
          check(field, "must be an object");
          break;
        }
        for (const [name, sources] of Object.entries(value)) {
          if (!NAME_RULE.test(name)) check(`${field}.${name}`, `name must match ${NAME_RULE.source}`);
          check(`${field}.${name}`, sourcesError(sources, field === "links"));
        }
        break;
      case "status":
        check(field, statusError(value));
        break;
    }
  }
  return errors;
}

function idError(value: unknown): string | undefined {
  if (typeof value !== "string") return "must be a string";
  if (value.startsWith("frontmatter:")) return sourceError(value, false);
  try {
    compileIdPattern(value);
    return undefined;
  } catch (err) {
    if (err instanceof IdPatternError) return err.message;
    throw err;
  }
}

function labelError(value: unknown): string | undefined {
  if (typeof value !== "string") return "must be a string";
  if (!value.includes("{id}")) return `label template "${value}" must contain {id}`;
  const unknown = /\{(?!name\}|id\})[^}]*\}?/.exec(value);
  if (unknown) return `label template "${value}" has an unknown placeholder "${unknown[0]}"`;
  return undefined;
}

function statusError(value: unknown): string | undefined {
  if (value === null) return undefined;
  if (!isPlainObject(value)) return "must be null or an object";
  const extra = Object.keys(value).filter((k) => !["from", "values", "showLink"].includes(k));
  if (extra.length) return `unknown key "${extra[0] ?? ""}"`;
  if (!("from" in value)) return "needs from";
  const fromError = sourcesError(value["from"]);
  if (fromError) return `from: ${fromError}`;
  const values = value["values"];
  if (!isPlainObject(values) || Object.keys(values).length === 0) return "values must be a non-empty object";
  for (const [k, v] of Object.entries(values)) {
    if (typeof v !== "string" || v === "" || k === "") return `values: "${k}" must map to a non-empty string`;
  }
  const showLink = value["showLink"];
  if (showLink !== undefined) {
    if (!isPlainObject(showLink)) return "showLink must be an object";
    for (const [k, v] of Object.entries(showLink)) {
      if (typeof v !== "string" || !NAME_RULE.test(v)) return `showLink: "${k}" must map to a link type name`;
    }
  }
  return undefined;
}
