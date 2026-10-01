// card-catalog.json: optional, at the repo root, read on every run. Invalid
// config stops hooks writing anything, so validation here is strict and
// reports every problem at once.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { CONFIG_FILE } from "./paths.ts";
import { ENTRY_PROFILE_FIELDS, NAME_RULE, validateProfileFields } from "./profile.ts";
import { type Problem, problem } from "./problems.ts";

export interface CollectionSettingsInput {
  indexPath?: string;
  announce?: boolean;
  exclude?: string[];
}

export interface ConfigEntry extends CollectionSettingsInput {
  /** Normalized: no leading `./`, no trailing `/`, "" for the root. */
  dir: string;
  type: string;
  /** The entry's profile fields, as given. */
  profileFields: Record<string, unknown>;
  /** Position in `collections`, counting from 1. */
  position: number;
}

export interface Config {
  defaults: boolean;
  ignoreFiles: string[];
  entries: ConfigEntry[];
}

export type ConfigLoad =
  | { ok: true; config: Config; present: boolean }
  | { ok: false; problems: Problem[] };

const TOP_KEYS = ["$schema", "defaults", "ignoreFiles", "collections"];
const SETTING_KEYS = ["indexPath", "announce", "exclude"];

export const EMPTY_CONFIG: Config = { defaults: true, ignoreFiles: [], entries: [] };

export function loadConfig(root: string): ConfigLoad {
  let text: string;
  try {
    text = readFileSync(join(root, CONFIG_FILE), "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return { ok: true, config: EMPTY_CONFIG, present: false };
    return { ok: false, problems: [problem("error", "config-unreadable", CONFIG_FILE, `can't be read: ${(err as Error).message}`)] };
  }
  let json: unknown;
  try {
    json = JSON.parse(text.replace(/^\uFEFF/, ""));
  } catch (err) {
    return { ok: false, problems: [problem("error", "config-unreadable", CONFIG_FILE, `isn't valid JSON: ${(err as Error).message}`)] };
  }
  const result = parseConfig(json);
  if ("errors" in result) {
    return { ok: false, problems: result.errors.map((e) => problem("error", "config-invalid", CONFIG_FILE, e)) };
  }
  return { ok: true, config: result.config, present: true };
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((v) => typeof v === "string");
}

export function parseConfig(json: unknown): { config: Config } | { errors: string[] } {
  if (!isObject(json)) return { errors: ["the config must be a JSON object"] };
  const errors: string[] = [];
  for (const key of Object.keys(json)) if (!TOP_KEYS.includes(key)) errors.push(`unknown key "${key}"`);
  if ("$schema" in json && typeof json["$schema"] !== "string") errors.push("$schema must be a string");
  if ("defaults" in json && typeof json["defaults"] !== "boolean") errors.push("defaults must be true or false");
  const ignoreFiles = json["ignoreFiles"] ?? [];
  if (!isStringArray(ignoreFiles)) errors.push("ignoreFiles must be an array of paths");
  else for (const f of ignoreFiles) {
    const e = relPathError(f);
    if (e) errors.push(`ignoreFiles: "${f}" ${e}`);
  }
  const collections = json["collections"] ?? [];
  const entries: ConfigEntry[] = [];
  if (!Array.isArray(collections)) errors.push("collections must be an array");
  else collections.forEach((raw: unknown, i) => {
    const result = parseEntry(raw, i + 1, false);
    if ("errors" in result) errors.push(...result.errors.map((e) => `config entry ${String(i + 1)}: ${e}`));
    else entries.push(result.entry);
  });
  if (errors.length) return { errors };
  return {
    config: {
      defaults: json["defaults"] !== false,
      ignoreFiles: (ignoreFiles as string[]).map(normalizeDir),
      entries,
    },
  };
}

/** Validates one config entry. `preview --entry` may leave out `dir`. */
export function parseEntry(raw: unknown, position: number, dirOptional: boolean): { entry: ConfigEntry } | { errors: string[] } {
  if (!isObject(raw)) return { errors: ["must be an object"] };
  const errors: string[] = [];
  const allowed = new Set<string>(["dir", "type", ...SETTING_KEYS, ...ENTRY_PROFILE_FIELDS]);
  for (const key of Object.keys(raw)) if (!allowed.has(key)) errors.push(`unknown key "${key}"`);

  const dir = raw["dir"];
  if (dir === undefined) {
    if (!dirOptional) errors.push("needs dir");
  } else if (typeof dir !== "string") {
    errors.push("dir must be a string");
  } else {
    const e = relPathError(dir);
    if (e) errors.push(`dir "${dir}" ${e}`);
  }
  const type = raw["type"];
  if (typeof type !== "string" || !NAME_RULE.test(type)) errors.push(`type must be a name matching ${NAME_RULE.source}`);

  const indexPath = raw["indexPath"];
  if (indexPath !== undefined && (typeof indexPath !== "string" || (indexPath !== "none" && !indexPath.endsWith(".md")) || indexPath.startsWith("/"))) {
    errors.push('indexPath must be a relative path ending in .md, or "none"');
  }
  if ("announce" in raw && typeof raw["announce"] !== "boolean") errors.push("announce must be true or false");
  if ("exclude" in raw && !isStringArray(raw["exclude"])) errors.push("exclude must be an array of globs");
  errors.push(...validateProfileFields(raw));
  if (errors.length) return { errors };

  const profileFields = Object.fromEntries(Object.entries(raw).filter(([k]) => (ENTRY_PROFILE_FIELDS as readonly string[]).includes(k)));
  return {
    entry: {
      dir: normalizeDir(typeof dir === "string" ? dir : ""),
      type: type as string,
      ...(typeof indexPath === "string" ? { indexPath } : {}),
      ...(typeof raw["announce"] === "boolean" ? { announce: raw["announce"] } : {}),
      ...(isStringArray(raw["exclude"]) ? { exclude: raw["exclude"] } : {}),
      profileFields,
      position,
    },
  };
}

function relPathError(p: string): string | undefined {
  if (p.startsWith("/") || /^[A-Za-z]:[\\/]/.test(p)) return "must be relative to the repo root";
  if (p.split("/").includes("..")) return 'must not contain ".."';
  return undefined;
}

function normalizeDir(dir: string): string {
  return dir
    .split("/")
    .filter((s) => s !== "" && s !== ".")
    .join("/");
}
