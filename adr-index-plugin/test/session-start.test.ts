import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { formatDigest } from "../scripts/digest.ts";
import type { IndexedAdr } from "../scripts/index-store.ts";

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

test("digest is empty when there are no ADRs", () => {
  assert.equal(formatDigest([]), "");
  assert.equal(formatDigest([{ dir: "docs/adr", adrs: [] }]), "");
});

test("digest lists status labels, supersession and summaries", () => {
  const text = formatDigest([
    {
      dir: "docs/adr",
      adrs: [adr(1, { status: "superseded", supersededBy: 2 }), adr(2), adr(3, { status: "unspecified" })],
    },
  ]);
  assert.match(text, /^docs\/adr\/$/m);
  assert.match(text, /- ADR-0001 \[superseded by ADR-0002\] Decision 1 \(0001-adr-1\.md, amended 2026-09-20\)/);
  assert.match(text, /- ADR-0002 \[accepted\] Decision 2/);
  assert.match(text, /- ADR-0003 Decision 3/);
  assert.match(text, /^ {2}Summary 2\.$/m);
});

test("over budget, inactive summaries are dropped before active ones", () => {
  const long = "x".repeat(200);
  const adrs = [adr(1, { status: "superseded", summary: long }), adr(2, { summary: long }), adr(3, { summary: long })];
  const full = formatDigest([{ dir: "docs/adr", adrs }]);
  // Room for everything except roughly one summary.
  const budget = full.length - 100;
  const text = formatDigest([{ dir: "docs/adr", adrs }], budget);
  assert.ok(text.length <= budget, `digest was ${String(text.length)} chars`);
  assert.equal(text.split(long).length - 1, 2, "both active summaries kept");
  assert.match(text, /1 summaries omitted/);
  assert.match(text, /ADR-0001 \[superseded/, "title line always kept");
});

test("SessionStart hook emits additionalContext and writes nothing", () => {
  const root = mkdtempSync(join(tmpdir(), "adr-ss-"));
  const dir = join(root, "docs", "adr");
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "0001-use-json.md"), "---\nstatus: accepted\n---\n# Use JSON index\n\nJSON is enough at ADR scale.\n");

  const out = JSON.parse(runHook(root)) as { hookSpecificOutput: { hookEventName: string; additionalContext: string } };
  assert.equal(out.hookSpecificOutput.hookEventName, "SessionStart");
  assert.match(out.hookSpecificOutput.additionalContext, /ADR-0001 \[accepted\] Use JSON index/);
  assert.match(out.hookSpecificOutput.additionalContext, /JSON is enough at ADR scale\./);
  assert.deepEqual(readdirSync(dir), ["0001-use-json.md"]);
});

test("SessionStart hook prints nothing in a repo without ADRs", () => {
  assert.equal(runHook(mkdtempSync(join(tmpdir(), "adr-ss-"))), "");
});
