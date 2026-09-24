import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { renderIndexMd } from "../scripts/index-md.ts";
import { type IndexedAdr, refreshIndex } from "../scripts/index-store.ts";

const script = join(dirname(fileURLToPath(import.meta.url)), "..", "scripts", "session-start.ts");

function adr(id: number, over: Partial<IndexedAdr> = {}): IndexedAdr {
  return { contentHash: "h", amendedAt: "2026-09-20T10:00:00.000Z", id, slug: `adr-${String(id)}`, title: `Decision ${String(id)}`, status: "accepted", summary: `Summary ${String(id)}.`, file: `${String(id).padStart(4, "0")}-adr-${String(id)}.md`, ...over };
}

function runHook(root: string): string {
  return execFileSync("node", [script], {
    input: JSON.stringify({ hook_event_name: "SessionStart", cwd: root }),
    env: { ...process.env, CLAUDE_PROJECT_DIR: root },
  }).toString();
}

function context(root: string): string {
  const out = JSON.parse(runHook(root)) as { hookSpecificOutput: { hookEventName: string; additionalContext: string } };
  assert.equal(out.hookSpecificOutput.hookEventName, "SessionStart");
  return out.hookSpecificOutput.additionalContext;
}

function repoWithAdr(): { root: string; dir: string } {
  const root = mkdtempSync(join(tmpdir(), "adr-ss-"));
  const dir = join(root, "docs", "adr");
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "0001-use-json.md"), "---\nstatus: accepted\n---\n# Use JSON index\n\nJSON is enough at ADR scale.\n");
  return { root, dir };
}

test("INDEX.md has one grep-able line per ADR, with status, supersession and series", () => {
  const text = renderIndexMd([
    adr(1, { status: "superseded", supersededBy: 2 }),
    adr(2),
    adr(31, { prefix: "hub", file: "hub-0031-x.md", status: "superseded", supersededBy: 42, supersededByPrefix: "hub" }),
    adr(29, { prefix: "hub", file: "hub-0029-x.md", status: "superseded", supersededBy: 4 }),
  ]);
  const lines = text.split("\n").filter((l) => l.startsWith("- "));
  assert.deepEqual(lines, [
    "- [ADR-0001](0001-adr-1.md) [superseded by ADR-0002] 2026-09-20 | Decision 1 | Summary 1.",
    "- [ADR-0002](0002-adr-2.md) [accepted] 2026-09-20 | Decision 2 | Summary 2.",
    "- [hub-0031](hub-0031-x.md) [superseded by hub-0042] 2026-09-20 | Decision 31 | Summary 31.",
    "- [hub-0029](hub-0029-x.md) [superseded by ADR-0004] 2026-09-20 | Decision 29 | Summary 29.",
  ]);
});

test("SessionStart hook points at INDEX.md without loading ADRs, and writes nothing", () => {
  const { root, dir } = repoWithAdr();
  refreshIndex(dir);
  const before = readdirSync(dir).sort();

  const text = context(root);
  assert.match(text, /^- docs\/adr\/INDEX\.md \(1 ADRs\)$/m);
  assert.match(text, /grep the index/);
  assert.doesNotMatch(text, /Use JSON index|JSON is enough/, "ADR content stays out of context");
  assert.doesNotMatch(text, /out of date|reindex/);
  assert.deepEqual(readdirSync(dir).sort(), before);
});

test("SessionStart hook flags a missing or stale INDEX.md", () => {
  const { root, dir } = repoWithAdr();
  assert.match(context(root), /INDEX\.md \(1 ADRs, out of date\)[\s\S]*reindex\.ts/);
  assert.deepEqual(readdirSync(dir), ["0001-use-json.md"]);

  refreshIndex(dir);
  writeFileSync(join(dir, "0002-second.md"), "# Second\n\nAdded outside the agent.\n");
  assert.match(context(root), /INDEX\.md \(2 ADRs, out of date\)/);
});

test("SessionStart hook prints nothing in a repo without ADRs", () => {
  assert.equal(runHook(mkdtempSync(join(tmpdir(), "adr-ss-"))), "");
});

test("refreshIndex writes both files, one ADR per line, and is idempotent", () => {
  const { dir } = repoWithAdr();
  writeFileSync(join(dir, "0002-second.md"), "# Second\n\nMore.\n");
  assert.equal(refreshIndex(dir).changed, true);
  const json = readFileSync(join(dir, "index.json"), "utf8");
  assert.equal(json.split("\n").filter((l) => l.startsWith('{"id"')).length, 2);
  assert.equal((JSON.parse(json) as { adrs: unknown[] }).adrs.length, 2);
  assert.match(readFileSync(join(dir, "INDEX.md"), "utf8"), /^- \[ADR-0002\]\(0002-second\.md\) \[unspecified\] \d{4}-\d{2}-\d{2} \| Second \| More\.$/m);
  assert.equal(refreshIndex(dir).changed, false);
});
