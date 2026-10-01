import assert from "node:assert/strict";
import { test } from "node:test";
import { ADR_PROFILE, genericDefaults, type Profile, resolveProfile } from "../scripts/core/profile.ts";
import { type ParsedRecord, parseRecord } from "../scripts/core/record.ts";

function parse(file: string, content: string, profile: Profile = ADR_PROFILE): ParsedRecord {
  const r = parseRecord(profile, file, content);
  assert.ok(r.ok, !r.ok ? r.message : "");
  return r.record;
}

const postmortem = (fields: Record<string, unknown> = {}): Profile =>
  resolveProfile("postmortem", { id: "{date}-{slug}", ...fields }, "config entry 1").profile;

// --- the adr profile: fixtures carried over from the ADR-only parser -------

test("adr: grill-with-docs minimal format, title and lead paragraph", () => {
  const e = parse(
    "0001-event-sourced-orders.md",
    "# Event-sourced orders\n\nOrders are event-sourced because audit requirements demand full history. We accepted the extra projection complexity.\n",
  );
  assert.equal(e.id, "0001");
  assert.equal(e.label, "ADR-0001");
  assert.equal(e.slug, "event-sourced-orders");
  assert.equal(e.title, "Event-sourced orders");
  assert.equal(e.status, "unspecified");
  assert.match(e.summary, /^Orders are event-sourced/);
  assert.deepEqual(e.warnings, []);
});

test("adr: a superseded status links to its replacement", () => {
  const e = parse(
    "0003-rest.md",
    "---\nstatus: superseded by ADR-0009\n---\n# REST over GraphQL\n\nWe picked REST.\n\n## Considered Options\n\n- GraphQL\n",
  );
  assert.equal(e.status, "superseded");
  assert.deepEqual(e.links, [{ type: "superseded-by", target: "ADR-0009" }]);
  assert.equal(e.summary, "We picked REST.");
});

test("adr: Nygard and adr-tools format", () => {
  const e = parse(
    "0002-use-postgres.md",
    "# 2. Use Postgres\n\nDate: 2026-03-01\n\n## Status\n\nAccepted\n\n## Context\n\nWe need a relational store.\n\n## Decision\n\nUse **Postgres** for the write model.\n",
  );
  assert.equal(e.title, "Use Postgres");
  assert.equal(e.status, "accepted");
  assert.equal(e.date, "2026-03-01");
  assert.equal(e.summary, "Use Postgres for the write model.");
});

test("adr: an explicit summary wins, and tags come from a block list", () => {
  const e = parse("0004-x.md", "---\nsummary: Short one-liner.\ntags:\n  - storage\n  - infra\n---\n# X\n\nLong body.\n");
  assert.equal(e.summary, "Short one-liner.");
  assert.deepEqual(e.tags, ["storage", "infra"]);
});

test("adr: a name that doesn't match the ID pattern, or a missing title, isn't a record", () => {
  const notRecord = parseRecord(ADR_PROFILE, "README.md", "# Hi");
  assert.deepEqual(notRecord, { ok: false, code: "not-a-record", message: "name doesn't match id pattern [{series}-]{number}" });
  const noTitle = parseRecord(ADR_PROFILE, "0005-x.md", "no heading here");
  assert.equal(noTitle.ok ? "" : noTitle.code, "no-title");
});

test("adr: long summaries are cut at a word with an ellipsis", () => {
  const e = parse("0006-y.md", `# Y\n\n${"word ".repeat(200)}\n`);
  assert.ok(e.summary.length <= 281);
  assert.ok(e.summary.endsWith("…"));
});

test("adr: editorial blockquotes under the title are not the summary", () => {
  const e = parse(
    "0015-entry-point.md",
    "---\nstatus: accepted\n---\n\n# Entry point\n\n> **Annotation — 2026-09-23:** the loader now reads\n> `mesaRuntime` instead.\n\n> **Confirmed 2026-09-20 by #32.** Still holds.\n\nA Game's entry point is `index.ts` exporting `game`.\n",
  );
  assert.equal(e.summary, "A Game's entry point is index.ts exporting game.");
});

test("adr: a lone blockquote is the summary only when nothing else is", () => {
  assert.equal(parse("0002-x.md", "# X\n\n> **Superseded by ADR-0005.** Kept for history.\n\n## Decision\n\nUse Y.\n").summary, "Use Y.");
  assert.equal(parse("0003-x.md", "# X\n\n> **Superseded by ADR-0005.** Kept for history.\n").summary, "Superseded by ADR-0005. Kept for history.");
});

test("adr: a series record is labelled by its ID", () => {
  const e = parse("hub-0023-harness.md", "# Harness\n\nA protocol client.\n\n**Status:** accepted\n");
  assert.equal(e.id, "hub-0023");
  assert.equal(e.label, "hub-0023");
  assert.equal(e.series, "hub");
  assert.equal(e.number, 23);
  assert.equal(e.slug, "harness");
  assert.equal(e.status, "accepted");
  assert.equal(parse("0023-harness.md", "# Harness\n").series, undefined);
  assert.equal(parse("7-use-postgres.md", "# P\n").id, "0007");
});

test("adr: a reference without a series means the linking record's own series", () => {
  const supersededBy = (file: string, s: string) => parse(file, `# X\n\nBody.\n\n**Status:** ${s}\n`).links;
  assert.deepEqual(supersededBy("hub-0031-x.md", "superseded by ADR-0042"), [{ type: "superseded-by", target: "hub-0042" }]);
  assert.deepEqual(supersededBy("0005-x.md", "superseded by hub-0042"), [{ type: "superseded-by", target: "hub-0042" }]);
  assert.deepEqual(supersededBy("0005-x.md", "Superseded by ADR-9 (2026-04-01)"), [{ type: "superseded-by", target: "ADR-0009" }]);
  assert.deepEqual(supersededBy("hub-0031-x.md", "superseded by [ADR-0042](hub-0042-tls.md)"), [
    { type: "superseded-by", target: "ADR-0042", path: "hub-0042-tls.md" },
  ]);
});

test("adr: a superseded record with no replacement named is flagged", () => {
  const e = parse("0004-x.md", "---\nstatus: superseded\n---\n# X\n\nY.\n");
  assert.deepEqual(e.links, []);
  assert.deepEqual(e.warnings.map((w) => w.code), ["missing-status-link"]);
});

test("adr: the longest status key wins, and unknown words are flagged", () => {
  const p = resolveProfile("adr", { status: { from: "frontmatter:status", values: { super: "a", superseded: "superseded" } } }, "config entry 1").profile;
  assert.equal(parse("0001-x.md", "---\nstatus: Superseded\n---\n# X\n", p).status, "superseded");
  const parked = parse("0001-x.md", "---\nstatus: parked\n---\n# X\n\nY.\n");
  assert.equal(parked.status, "unspecified");
  assert.deepEqual(parked.warnings, [{ code: "unknown-status", message: 'unrecognized status "parked"' }]);
});

test("adr: frontmatter links show every reference, normalized to labels", () => {
  const e = parse("0010-x.md", "---\nsupersedes: [ADR-3, 0004]\nrelates-to: Postmortem 2026-09-14-db-outage\n---\n# X\n\nY.\n");
  assert.deepEqual(e.links, [
    { type: "supersedes", target: "ADR-0003" },
    { type: "supersedes", target: "ADR-0004" },
    { type: "relates-to", target: "Postmortem 2026-09-14-db-outage" },
  ]);
});

// --- generic profiles ------------------------------------------------------

test("a user-defined type takes the generic defaults", () => {
  const p = genericDefaults("postmortem");
  assert.equal(p.name, "Postmortem");
  assert.equal(p.plural, "postmortems");
  assert.equal(genericDefaults("rfc", "RFC").plural, "RFCs");
  const e = parse("restart-workers.md", "# Restart workers\n\nWhen the queue backs up.\n", p);
  assert.equal(e.id, "restart-workers");
  assert.equal(e.label, "Postmortem restart-workers");
  assert.equal(e.status, undefined);
});

test("ID patterns: date and slug, and the directory name", () => {
  const e = parse("2026-09-14-db-outage.md", "# DB outage\n\nThe primary failed over.\n", postmortem());
  assert.equal(e.id, "2026-09-14-db-outage");
  assert.equal(e.slug, "db-outage");
  assert.equal(e.label, "Postmortem 2026-09-14-db-outage");
  const notes = parseRecord(postmortem(), "notes.md", "# Notes\n");
  assert.deepEqual(notes, { ok: false, code: "not-a-record", message: "name doesn't match id pattern {date}-{slug}" });

  const runbook = resolveProfile("runbook", { id: "{dir}", match: "*/README.md" }, "config entry 1").profile;
  const r = parse("restart-workers/README.md", "# Restart workers\n", runbook);
  assert.equal(r.id, "restart-workers");
  assert.equal(r.slug, undefined);
});

test("an ID from frontmatter, and a record without one", () => {
  const p = resolveProfile("rfc", { name: "RFC", id: "frontmatter:rfc" }, "config entry 1").profile;
  assert.equal(parse("anything.md", "---\nrfc: 42\n---\n# Cache\n", p).label, "RFC 42");
  const missing = parseRecord(p, "anything.md", "# Cache\n");
  assert.deepEqual(missing, { ok: false, code: "no-id", message: "no rfc in frontmatter" });
});

test("fields, sections and inline names are read case-insensitively", () => {
  const p = postmortem({ summary: ["section:Impact", "lead"], fields: { severity: "inline:Severity" } });
  const e = parse("2026-09-14-db.md", "# DB\n\nSEVERITY: **high**\n\nLead text.\n\n## impact:\n\nCheckout was down for 20 minutes.\n", p);
  assert.deepEqual(e.fields, { severity: "high" });
  assert.equal(e.summary, "Checkout was down for 20 minutes.");
  const lead = parse("2026-09-14-db.md", "# DB\n\nSeverity: high\n\nLead text.\n", postmortem({ fields: { severity: "inline:Severity" } }));
  assert.equal(lead.summary, "Lead text.", "lead skips lines an inline: source reads");
});

test("headings lose the type's own numbering prefix", () => {
  const p = resolveProfile("rfc", { name: "RFC" }, "config entry 1").profile;
  assert.equal(parse("cache.md", "# RFC 7 - Cache layer\n", p).title, "Cache layer");
  assert.equal(parse("cache.md", "# rfc-0007: Cache layer\n", p).title, "Cache layer");
  assert.equal(parse("0001-x.md", "# ADR-0001 — Use JSON\n").title, "Use JSON");
});

test("frontmatter block scalars, quotes and comments", () => {
  const e = parse(
    "0001-x.md",
    '---\n# a comment\ntitle: "Quoted: title"\nsummary: >-\n  Folded across\n  two lines.\ndescription: |\n  kept\n---\n# Ignored heading\n',
  );
  assert.equal(e.title, "Quoted: title");
  assert.equal(e.summary, "Folded across two lines.");
});

test("values are cleaned of markdown", () => {
  const e = parse("0001-x.md", "# Use `JSON` for [the index](x.md)\n\n- **Bold** lead with a ![pic](p.png).\n");
  assert.equal(e.title, "Use JSON for the index");
  assert.equal(e.summary, "Bold lead with a pic.");
});
