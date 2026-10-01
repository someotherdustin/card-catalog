import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { parseAdr } from "../scripts/parse-adr.ts";
import { type AdrIndex, buildIndex } from "../scripts/index-store.ts";

const here = dirname(fileURLToPath(import.meta.url));

function parse(file: string, content: string) {
  const r = parseAdr(file, content);
  assert.ok(r.ok, !r.ok ? r.reason : "");
  return r.entry;
}

test("grill-with-docs minimal format: title + lead paragraph", () => {
  const e = parse(
    "0001-event-sourced-orders.md",
    "# Event-sourced orders\n\nOrders are event-sourced because audit requirements demand full history. We accepted the extra projection complexity.\n",
  );
  assert.equal(e.id, 1);
  assert.equal(e.slug, "event-sourced-orders");
  assert.equal(e.title, "Event-sourced orders");
  assert.equal(e.status, "unspecified");
  assert.match(e.summary, /^Orders are event-sourced/);
});

test("status frontmatter with superseded-by", () => {
  const e = parse(
    "0003-rest.md",
    "---\nstatus: superseded by ADR-0009\n---\n# REST over GraphQL\n\nWe picked REST.\n\n## Considered Options\n\n- GraphQL\n",
  );
  assert.equal(e.status, "superseded");
  assert.equal(e.supersededBy, 9);
  assert.equal(e.summary, "We picked REST.");
});

test("Nygard / adr-tools format", () => {
  const e = parse(
    "0002-use-postgres.md",
    "# 2. Use Postgres\n\nDate: 2026-03-01\n\n## Status\n\nAccepted\n\n## Context\n\nWe need a relational store.\n\n## Decision\n\nUse **Postgres** for the write model.\n",
  );
  assert.equal(e.title, "Use Postgres");
  assert.equal(e.status, "accepted");
  assert.equal(e.date, "2026-03-01");
  assert.equal(e.summary, "Use Postgres for the write model.");
});

test("explicit summary wins; tags list", () => {
  const e = parse(
    "0004-x.md",
    "---\nsummary: Short one-liner.\ntags:\n  - storage\n  - infra\n---\n# X\n\nLong body.\n",
  );
  assert.equal(e.summary, "Short one-liner.");
  assert.deepEqual(e.tags, ["storage", "infra"]);
});

test("fails soft on non-ADR filename and missing title", () => {
  assert.equal(parseAdr("README.md", "# Hi").ok, false);
  assert.equal(parseAdr("0005-x.md", "no heading here").ok, false);
});

test("long summaries are truncated", () => {
  const e = parse("0006-y.md", `# Y\n\n${"word ".repeat(200)}\n`);
  assert.ok(e.summary.length <= 281);
  assert.ok(e.summary.endsWith("…"));
});

test("editorial blockquotes under the title are not the summary", () => {
  const e = parse(
    "0015-entry-point.md",
    "---\nstatus: accepted\n---\n\n# Entry point\n\n> **Annotation — 2026-09-23:** the loader now reads\n> `mesaRuntime` instead.\n\n> **Confirmed 2026-09-20 by #32.** Still holds.\n\nA Game's entry point is `index.ts` exporting `game`.\n",
  );
  assert.equal(e.summary, "A Game's entry point is index.ts exporting game.");
});

test("a lone blockquote is used only when nothing else gives a summary", () => {
  const withDecision = parse("0002-x.md", "# X\n\n> **Superseded by ADR-0005.** Kept for history.\n\n## Decision\n\nUse Y.\n");
  assert.equal(withDecision.summary, "Use Y.");
  const quoteOnly = parse("0003-x.md", "# X\n\n> **Superseded by ADR-0005.** Kept for history.\n");
  assert.equal(quoteOnly.summary, "Superseded by ADR-0005. Kept for history.");
});

test("prefixed filenames form their own series", () => {
  const e = parse("hub-0023-harness.md", "# Harness\n\nA protocol client.\n\n**Status:** accepted\n");
  assert.equal(e.id, 23);
  assert.equal(e.prefix, "hub");
  assert.equal(e.slug, "harness");
  assert.equal(e.status, "accepted");
  assert.equal(parse("0023-harness.md", "# Harness\n").prefix, undefined);
});

test("supersession resolves the series from a link, else from the text", () => {
  const status = (file: string, s: string) => parse(file, `# X\n\nBody.\n\n**Status:** ${s}\n`);
  const crossSeries = status("hub-0001-x.md", "superseded by [Mesa ADR-0001](0001-typescript.md) and [Mesa ADR-0014](0014-mesa.md)");
  assert.equal(crossSeries.supersededBy, 1);
  assert.equal(crossSeries.supersededByPrefix, undefined);
  const sameSeries = status("hub-0031-x.md", "superseded by [ADR-0042](hub-0042-tls.md)");
  assert.equal(sameSeries.supersededBy, 42);
  assert.equal(sameSeries.supersededByPrefix, "hub");
  const bare = status("hub-0031-x.md", "superseded by ADR-0042");
  assert.equal(bare.supersededByPrefix, "hub");
  const explicit = status("0005-x.md", "superseded by hub-0042");
  assert.equal(explicit.supersededByPrefix, "hub");
  assert.equal(status("0005-x.md", "superseded by ADR-0009").supersededByPrefix, undefined);
});

test("buildIndex sorts the main sequence before prefixed series", () => {
  const dir = join(mkdtempSync(join(tmpdir(), "adr-")), "docs", "adr");
  mkdirSync(dir, { recursive: true });
  for (const f of ["hub-0001-a.md", "0002-b.md", "hub-0002-c.md", "0001-d.md"]) writeFileSync(join(dir, f), `# ${f}\n`);
  const { index } = buildIndex(dir);
  assert.deepEqual(index.adrs.map((a) => a.file), ["0001-d.md", "0002-b.md", "hub-0001-a.md", "hub-0002-c.md"]);
});

test("buildIndex keeps stale entry when a file becomes unparseable", () => {
  const dir = join(mkdtempSync(join(tmpdir(), "adr-")), "docs", "adr");
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "0001-a.md"), "# A\n\nFirst.\n");
  writeFileSync(join(dir, "index.json"), JSON.stringify(buildIndex(dir).index));
  writeFileSync(join(dir, "0001-a.md"), "garbage without heading");
  const { index, warnings } = buildIndex(dir);
  assert.equal(index.adrs[0]?.title, "A");
  assert.match(warnings[0] ?? "", /kept previous/);
});

test("on-write hook indexes an ADR end-to-end and ignores other files", () => {
  const root = mkdtempSync(join(tmpdir(), "adr-"));
  const dir = join(root, "docs", "adr");
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "0001-a.md"), "# A\n\nFirst decision.\n");
  const run = (file_path: string) =>
    execFileSync("node", [join(here, "..", "scripts", "on-write.ts")], {
      input: JSON.stringify({ cwd: root, tool_name: "Write", tool_input: { file_path } }),
    });

  run(join(root, "src", "app.ts"));
  assert.throws(() => readFileSync(join(dir, "index.json")));

  run("docs/adr/0001-a.md");
  const index = JSON.parse(readFileSync(join(dir, "index.json"), "utf8")) as AdrIndex;
  assert.deepEqual(index.adrs.map((a) => a.title), ["A"]);
});

test("on-write hook exits 0 on malformed stdin", () => {
  execFileSync("node", [join(here, "..", "scripts", "on-write.ts")], { input: "not json", stdio: "pipe" });
});
