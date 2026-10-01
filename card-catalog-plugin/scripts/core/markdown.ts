// Body sources: `heading`, `lead`, `quote`, `section:<Name>` and
// `inline:<Name>`, plus the cleaning every value goes through. Lenient by
// design: we don't own the write path, so odd input yields nothing rather
// than an error.

import { escapeRegex } from "./glob.ts";

export const SUMMARY_MAX = 280;

/** Text of the first `# ` heading, with adr-tools (`1. `) and `<name>-0007: ` style numbering removed. */
export function heading(body: string, name: string): string | undefined {
  const m = /^#[ \t]+(.+?)[ \t#]*$/m.exec(body);
  if (!m) return undefined;
  const t = (m[1] ?? "")
    .replace(new RegExp(`^${escapeRegex(name)}[- ]?\\d+\\s*[:.\\-–—]\\s*`, "i"), "")
    .replace(/^\d+\.\s+/, "")
    .trim();
  return t || undefined;
}

/** First paragraph of the first `##` or `###` heading named `name`. */
export function section(body: string, name: string): string | undefined {
  const re = new RegExp(`^#{2,3}[ \\t]+${escapeRegex(name)}[ \\t]*:?[ \\t]*$`, "im");
  const m = re.exec(body);
  if (!m) return undefined;
  const rest = body.slice(m.index + m[0].length);
  const end = rest.search(/^#{1,3}[ \t]/m);
  return firstParagraph(end === -1 ? rest : rest.slice(0, end), true);
}

/** `Name: value`, `**Name:** value`, `__Name__: value`, `- Name: value`. */
export function inline(body: string, name: string): string | undefined {
  const re = new RegExp(
    `^[ \\t]*(?:[-*][ \\t]+)?(?:\\*\\*|__)?${escapeRegex(name)}(?:\\*\\*|__)?[ \\t]*:(?:\\*\\*|__)?[ \\t]*(.+)$`,
    "im",
  );
  const m = re.exec(body);
  return m?.[1] ? m[1].replace(/(\*\*|__)$/, "").trim() || undefined : undefined;
}

const LEAD_SKIP_KEYS = ["status", "date", "deciders", "tags", "summary"];

/**
 * First prose paragraph under the `# ` heading, up to the next heading,
 * skipping inline-field lines. A blockquote right under the title is usually
 * an editorial note added later, so only `quote` accepts one.
 */
export function lead(body: string, inlineNames: string[], allowQuotes: boolean): string | undefined {
  const h1 = /^#[ \t]+.+$/m.exec(body);
  let rest = h1 ? body.slice(h1.index + h1[0].length) : body;
  const next = rest.search(/^#{1,6}[ \t]/m);
  if (next !== -1) rest = rest.slice(0, next);
  const keys = [...LEAD_SKIP_KEYS, ...inlineNames].map(escapeRegex).join("|");
  const skip = new RegExp(`^[ \\t]*(?:[-*][ \\t]+)?(?:\\*\\*|__)?(?:${keys})(?:\\*\\*|__)?[ \\t]*:`, "i");
  return firstParagraph(
    rest
      .split("\n")
      .filter((l) => !skip.test(l))
      .join("\n"),
    allowQuotes,
  );
}

function firstParagraph(text: string, allowQuotes: boolean): string | undefined {
  for (const block of text.split(/\n[ \t]*\n/)) {
    const t = block.trim();
    if (!t || t.startsWith("<!--")) continue;
    if (!allowQuotes && t.startsWith(">")) continue;
    return t;
  }
  return undefined;
}

/** Links and images become their text; emphasis, backticks and line markers go; whitespace collapses. */
export function clean(s: string): string {
  return s
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/(\*\*|__|`)/g, "")
    .replace(/^[ \t]*[-*>][ \t]+/gm, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** Cut to `max` characters: at the last sentence end in the second half if there is one, else at a word, with `…`. */
export function truncate(s: string, max = SUMMARY_MAX): string {
  if (s.length <= max) return s;
  const cut = s.slice(0, max);
  const sentence = cut.lastIndexOf(". ");
  if (sentence > max * 0.5) return cut.slice(0, sentence + 1);
  return cut.replace(/\s+\S*$/, "") + "…";
}
