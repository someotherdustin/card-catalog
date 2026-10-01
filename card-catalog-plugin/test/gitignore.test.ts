import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { parseIgnore } from "../scripts/core/gitignore.ts";

// Every case is checked against git itself: the matcher must give the same
// answer as `git check-ignore --no-index` for the same patterns and paths.
const PATTERNS = `
# comments and blank lines are skipped

*.log
!keep.log
\\#hash.md
\\!bang.md
trailing-space.md
build/
/rooted.md
docs/private/
docs/**/draft-*.md
**/generated
a/**
!a/reopened.md
notes/*.tmp
[Tt]emp/
q?.md
vendor
!vendor/allowed.md
`;

const FILES = [
  "app.log", "keep.log", "sub/x.log", "sub/keep.log",
  "#hash.md", "!bang.md", "trailing-space.md",
  "build/out.md", "src/build/out.md", "build.md",
  "rooted.md", "sub/rooted.md",
  "docs/private/a.md", "docs/private/deep/b.md", "x/docs/private/c.md",
  "docs/draft-1.md", "docs/adr/draft-2.md", "docs/adr/final.md",
  "generated/a.md", "src/generated/b.md",
  "a/x.md", "a/reopened.md", "a/b/c.md",
  "notes/one.tmp", "notes/deep/two.tmp",
  "Temp/x.md", "temp/y.md", "tEmp/z.md",
  "q1.md", "q12.md",
  "vendor/lib.md", "vendor/allowed.md",
  "plain.md", "docs/adr/0001-x.md",
];

function gitIgnored(root: string, paths: string[]): Set<string> {
  const r = spawnSync("git", ["check-ignore", "--no-index", "--stdin"], { cwd: root, input: paths.join("\n") + "\n", encoding: "utf8" });
  assert.notEqual(r.status, 128, r.stderr);
  return new Set(r.stdout.split("\n").filter(Boolean));
}

test("the gitignore matcher agrees with git check-ignore", () => {
  const root = mkdtempSync(join(tmpdir(), "cc-ignore-"));
  spawnSync("git", ["init", "-q"], { cwd: root });
  writeFileSync(join(root, ".gitignore"), PATTERNS);
  const dirs = new Set<string>();
  for (const file of FILES) {
    mkdirSync(dirname(join(root, file)), { recursive: true });
    writeFileSync(join(root, file), "");
    for (let d = dirname(file); d !== "."; d = dirname(d)) dirs.add(d);
  }
  const paths = [...FILES, ...dirs];
  const expected = gitIgnored(root, paths);
  const matcher = parseIgnore(PATTERNS);
  for (const path of paths) {
    assert.equal(matcher.ignores(path, dirs.has(path)), expected.has(path), `${path}: git says ${expected.has(path) ? "ignored" : "not ignored"}`);
  }
});

test("patterns in a file below the root apply relative to its directory", () => {
  const matcher = parseIgnore("*.md\n/top.txt\n", { base: "sub" });
  assert.equal(matcher.ignores("sub/a.md", false), true);
  assert.equal(matcher.ignores("sub/deep/a.md", false), true);
  assert.equal(matcher.ignores("a.md", false), false);
  assert.equal(matcher.ignores("sub/top.txt", false), true);
  assert.equal(matcher.ignores("sub/x/top.txt", false), false);
});
