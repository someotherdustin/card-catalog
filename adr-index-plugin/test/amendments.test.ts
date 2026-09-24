import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { contentHash, lastCommitDates, resolveAmendedAt } from "../scripts/amendments.ts";
import { buildIndex, writeIndex } from "../scripts/index-store.ts";

const T1 = new Date("2026-09-01T00:00:00.000Z");
const T2 = new Date("2026-09-10T00:00:00.000Z");
const noGit = () => undefined;

function adrDir(): string {
  const dir = join(mkdtempSync(join(tmpdir(), "adr-am-")), "docs", "adr");
  mkdirSync(dir, { recursive: true });
  return dir;
}

test("contentHash ignores line endings and trailing whitespace only", () => {
  assert.equal(contentHash("# A\n\nBody.\n"), contentHash("# A  \r\n\r\nBody.\r\n\n"));
  assert.notEqual(contentHash("# A\n\nBody.\n"), contentHash("# A\n\nBody!\n"));
});

test("resolveAmendedAt: unchanged keeps, changed bumps, unknown falls back to git then now", () => {
  const prev = { contentHash: "abc", amendedAt: T1.toISOString() };
  assert.equal(resolveAmendedAt("abc", prev, noGit, T2), T1.toISOString());
  assert.equal(resolveAmendedAt("xyz", prev, noGit, T2), T2.toISOString());
  assert.equal(resolveAmendedAt("abc", undefined, () => "2026-01-01T00:00:00.000Z", T2), "2026-01-01T00:00:00.000Z");
  assert.equal(resolveAmendedAt("abc", undefined, noGit, T2), T2.toISOString());
});

test("buildIndex: amendedAt survives rebuilds and moves only on content change", () => {
  const dir = adrDir();
  writeFileSync(join(dir, "0001-a.md"), "# A\n\nFirst.\n");
  writeIndex(dir, buildIndex(dir, T1).index);

  const unchanged = buildIndex(dir, T2);
  assert.equal(unchanged.index.adrs[0]?.amendedAt, T1.toISOString());
  assert.equal(unchanged.changed, false);

  writeFileSync(join(dir, "0001-a.md"), "# A\n\nFirst, amended.\n");
  const amended = buildIndex(dir, T2);
  assert.equal(amended.index.adrs[0]?.amendedAt, T2.toISOString());
  assert.equal(amended.changed, true);
});

test("an unparseable edit keeps the stale entry but still records the amendment", () => {
  const dir = adrDir();
  writeFileSync(join(dir, "0001-a.md"), "# A\n\nFirst.\n");
  writeIndex(dir, buildIndex(dir, T1).index);
  writeFileSync(join(dir, "0001-a.md"), "no heading any more");
  const entry = buildIndex(dir, T2).index.adrs[0];
  assert.equal(entry?.title, "A");
  assert.equal(entry.amendedAt, T2.toISOString());
});

test("backfill uses each ADR's last commit date", () => {
  const dir = adrDir();
  const repo = join(dir, "..", "..");
  const git = (args: string[], date?: string) =>
    execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", ...args], {
      cwd: repo,
      stdio: "ignore",
      env: { ...process.env, ...(date ? { GIT_COMMITTER_DATE: date, GIT_AUTHOR_DATE: date } : {}) },
    });
  git(["init", "-q"]);
  writeFileSync(join(dir, "0001-a.md"), "# A\n\nFirst.\n");
  writeFileSync(join(dir, "0002-b.md"), "# B\n\nSecond.\n");
  git(["add", "."]);
  git(["commit", "-qm", "both"], "2026-03-01T12:00:00+02:00");
  writeFileSync(join(dir, "0002-b.md"), "# B\n\nSecond, revised.\n");
  git(["commit", "-qam", "revise b"], "2026-04-01T12:00:00Z");

  assert.deepEqual(Object.fromEntries(lastCommitDates(dir)), {
    "0001-a.md": "2026-03-01T10:00:00.000Z",
    "0002-b.md": "2026-04-01T12:00:00.000Z",
  });

  writeFileSync(join(dir, "0003-c.md"), "# C\n\nNot committed yet.\n");
  const adrs = buildIndex(dir, T2).index.adrs;
  assert.deepEqual(
    adrs.map((a) => a.amendedAt),
    ["2026-03-01T10:00:00.000Z", "2026-04-01T12:00:00.000Z", T2.toISOString()],
  );
});

test("lastCommitDates is empty outside a git repo", () => {
  assert.equal(lastCommitDates(mkdtempSync(join(tmpdir(), "adr-nogit-"))).size, 0);
});
