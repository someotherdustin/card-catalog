import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { adr, makeRepo, writeFiles } from "./fixtures.ts";

const scripts = join(dirname(fileURLToPath(import.meta.url)), "..", "scripts");
const cliPath = join(scripts, "cli.ts");

function onWrite(root: string, file_path: string, input?: string) {
  const r = spawnSync("node", [join(scripts, "on-write.ts")], {
    input: input ?? JSON.stringify({ cwd: root, tool_name: "Write", tool_input: { file_path } }),
    encoding: "utf8",
  });
  assert.equal(r.status, 0, r.stderr);
  return r.stderr;
}

function sessionStart(root: string): string {
  const r = spawnSync("node", [join(scripts, "session-start.ts")], {
    input: JSON.stringify({ hook_event_name: "SessionStart", cwd: root }),
    env: { ...process.env, CLAUDE_PROJECT_DIR: root },
    encoding: "utf8",
  });
  assert.equal(r.status, 0, r.stderr);
  if (r.stdout === "") return "";
  const out = JSON.parse(r.stdout) as { hookSpecificOutput: { hookEventName: string; additionalContext: string } };
  assert.equal(out.hookSpecificOutput.hookEventName, "SessionStart");
  return out.hookSpecificOutput.additionalContext;
}

const exists = (root: string, path: string) => existsSync(join(root, path));

test("the write hook indexes a record's collection and ignores other files", () => {
  const root = makeRepo({ "docs/adr/0001-a.md": adr("A", "First decision."), "src/app.ts": "" });
  onWrite(root, join(root, "src", "app.ts"));
  assert.ok(!exists(root, "docs/adr/index.json"));
  assert.match(onWrite(root, "docs/adr/0001-a.md"), /indexed 1 ADR in docs\/adr/);
  const index = JSON.parse(readFileSync(join(root, "docs/adr/index.json"), "utf8")) as { version: number; records: { title: string }[] };
  assert.equal(index.version, 3);
  assert.deepEqual(index.records.map((r) => r.title), ["A"]);
});

test("the write hook leaves ignored records and non-records alone", () => {
  const root = makeRepo({ ".aiignore": "docs/adr/0002-*\n", "docs/adr/0002-secret.md": adr("Secret"), "docs/adr/README.md": "# About\n" });
  onWrite(root, "docs/adr/0002-secret.md");
  onWrite(root, "docs/adr/README.md");
  assert.ok(!exists(root, "docs/adr/INDEX.md"));
});

test("editing config or an ignore file reindexes every collection", () => {
  const root = makeRepo({ "docs/adr/0001-a.md": adr("A"), "docs/postmortems/2026-01-01-x.md": adr("X") });
  writeFiles(root, { "card-catalog.json": { collections: [{ dir: "docs/postmortems", type: "postmortem", id: "{date}-{slug}" }] } });
  onWrite(root, "card-catalog.json");
  assert.ok(exists(root, "docs/adr/INDEX.md"));
  assert.ok(exists(root, "docs/postmortems/INDEX.md"));

  writeFiles(root, { ".aiignore": "docs/adr/0001-a.md\n" });
  onWrite(root, ".aiignore");
  assert.doesNotMatch(readFileSync(join(root, "docs/adr/INDEX.md"), "utf8"), /ADR-0001/);
});

test("with invalid config the write hook warns and writes nothing", () => {
  const root = makeRepo({ "docs/adr/0001-a.md": adr("A"), "card-catalog.json": { collections: "nope" } });
  const err = onWrite(root, "docs/adr/0001-a.md");
  assert.match(err, /^\[card-catalog\] warning: card-catalog\.json is invalid, so no index was written\. Run: node ".*cli\.ts" validate$/m);
  assert.ok(!exists(root, "docs/adr/INDEX.md"));
});

test("the write hook exits 0 on malformed input", () => {
  onWrite(makeRepo(), "", "not json");
});

test("the session-start message points at each index without loading records, and writes nothing", () => {
  const root = makeRepo({ "docs/adr/0001-use-json.md": adr("Use JSON index", "JSON is enough at ADR scale.", "status: accepted") });
  onWrite(root, "docs/adr/0001-use-json.md");
  const before = readdirSync(join(root, "docs/adr")).sort();
  assert.equal(
    sessionStart(root),
    [
      "This repo records architecture decisions as ADRs. Each collection below has an index with one line per ADR:",
      "label, status, date amended, title and a one-line summary.",
      "",
      "- docs/adr/INDEX.md (1 ADR)",
      "",
      "Before changing an area, grep the index for its terms and open the ADRs whose lines match.",
      "If your work would contradict an accepted ADR, say so explicitly rather than silently overriding it.",
      `The card-catalog CLI is node "${cliPath}" (list, preview, profile, validate; add --help).`,
    ].join("\n"),
  );
  assert.deepEqual(readdirSync(join(root, "docs/adr")).sort(), before);
});

test("the session-start message flags missing and stale indexes", () => {
  const root = makeRepo({ "docs/adr/0001-a.md": adr("A") });
  assert.match(sessionStart(root), /^- docs\/adr\/INDEX\.md \(1 ADR, out of date\)$/m);
  assert.match(sessionStart(root), new RegExp(`^To bring an out-of-date index up to date, run: node "${cliPath.replace(/[.\\]/g, "\\$&")}" reindex$`, "m"));
  assert.deepEqual(readdirSync(join(root, "docs/adr")), ["0001-a.md"]);
  onWrite(root, "docs/adr/0001-a.md");
  writeFileSync(join(root, "docs/adr/0002-b.md"), adr("B"));
  assert.match(sessionStart(root), /\(2 ADRs, out of date\)/);
});

test("several types get the generic intro, each type's guidance, and no unannounced collections", () => {
  const root = makeRepo({
    "card-catalog.json": {
      collections: [
        { dir: "docs/postmortems", type: "postmortem", id: "{date}-{slug}", guidance: "Check for a postmortem before changing an area that has failed before." },
        { dir: "docs/adr/archive", type: "adr", announce: false },
      ],
    },
    "docs/adr/0001-a.md": adr("A"),
    "docs/adr/archive/0001-old.md": adr("Old"),
    "docs/postmortems/2026-09-14-db.md": adr("DB"),
  });
  spawnSync("node", [cliPath, "reindex"], { cwd: root });
  const text = sessionStart(root);
  assert.equal(
    text.split("\n").slice(0, 8).join("\n"),
    [
      "This repo keeps an index for each collection of records below, with one line per record:",
      "label, status, date amended, title and a one-line summary. Types without a status leave it out.",
      "",
      "- docs/adr/INDEX.md (1 ADR)",
      "- docs/postmortems/INDEX.md (1 postmortem)",
      "",
      "Before changing an area, grep the indexes for its terms and open the records whose lines match.",
      "If your work would contradict an accepted ADR, say so explicitly rather than silently overriding it.",
    ].join("\n"),
  );
  assert.match(text, /^Check for a postmortem before changing an area that has failed before\.$/m);
  assert.doesNotMatch(text, /archive/);
});

test("the session-start message reports orphans and invalid config, and is silent with nothing to say", () => {
  assert.equal(sessionStart(makeRepo()), "");
  const orphan = makeRepo({ "old/INDEX.md": "# ADR index\n\nGenerated by the card-catalog plugin from the ADRs in this directory.\n" });
  assert.equal(sessionStart(orphan), "Orphaned indexes, which no collection maintains any more: old/INDEX.md");
  const invalid = makeRepo({ "card-catalog.json": "{", "docs/adr/0001-a.md": adr("A") });
  assert.equal(sessionStart(invalid), `card-catalog.json is invalid, so no index was checked. Run: node "${cliPath}" validate`);
});
