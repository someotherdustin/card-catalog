import assert from "node:assert/strict";
import { mkdirSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { type RepoOpen, openRepo } from "../scripts/core/repo.ts";
import { adr, makeRepo } from "./fixtures.ts";


function open(root: string) {
  const r: RepoOpen = openRepo(root);
  assert.ok(r.ok, !r.ok ? JSON.stringify(r.problems) : "");
  return r.repo;
}

const dirs = (root: string) => open(root).collections.map((c) => `${c.dir}:${c.type}:${c.source}`);
const codes = (root: string) => open(root).problems.map((p) => `${p.severity} ${p.code}`);

test("without config, every docs/adr and doc/adr directory is an ADR collection", () => {
  const root = makeRepo({
    "docs/adr/0001-a.md": adr("A"),
    "doc/adr/0001-b.md": adr("B"),
    "src/ordering/docs/adr/0001-c.md": adr("C"),
    "node_modules/pkg/docs/adr/0001-d.md": adr("D"),
    ".hidden/docs/adr/0001-e.md": adr("E"),
    "a/b/c/d/e/f/docs/adr/0001-deep.md": adr("Deep"),
    "a/b/c/d/e/f/g/docs/adr/0001-too-deep.md": adr("Too deep"),
    "adr/0001-f.md": adr("F"),
  });
  assert.deepEqual(dirs(root), [
    "a/b/c/d/e/f/docs/adr:adr:default",
    "doc/adr:adr:default",
    "docs/adr:adr:default",
    "src/ordering/docs/adr:adr:default",
  ]);
  const c = open(root).collections.find((x) => x.dir === "docs/adr");
  assert.ok(c);
  assert.equal(c.indexFile, "docs/adr/INDEX.md");
  assert.equal(c.jsonFile, "docs/adr/index.json");
  assert.equal(c.profile.label, "ADR-{id}");
});

test("config adds collections and keeps the defaults unless turned off", () => {
  const files = {
    "docs/adr/0001-a.md": adr("A"),
    "services/api/records/x.md": adr("X"),
    "services/web/records/y.md": adr("Y"),
    "docs/postmortems/2026-01-01-x.md": adr("X"),
  };
  const config = {
    collections: [
      { dir: "services/*/records", type: "adr" },
      { dir: "docs/postmortems/", type: "postmortem", id: "{date}-{slug}" },
    ],
  };
  const root = makeRepo({ ...files, "card-catalog.json": config });
  assert.deepEqual(dirs(root), [
    "docs/adr:adr:default",
    "docs/postmortems:postmortem:config",
    "services/api/records:adr:config",
    "services/web/records:adr:config",
  ]);
  const pm = open(root).collections.find((c) => c.type === "postmortem");
  assert.ok(pm);
  assert.equal(pm.profile.id, "{date}-{slug}");
  assert.equal(pm.profile.plural, "postmortems");
  assert.equal(pm.profileSources.id, "config entry 2");
  assert.equal(pm.profileSources.title, "generic default");

  const noDefaults = makeRepo({ ...files, "card-catalog.json": { ...config, defaults: false } });
  assert.deepEqual(dirs(noDefaults).filter((d) => d.startsWith("docs/adr")), []);
});

test("a literal entry beats a glob, a glob beats a default, and overlaps are reported", () => {
  const root = makeRepo({
    "docs/adr/0001-a.md": adr("A"),
    "docs/other/x.md": adr("X"),
    "card-catalog.json": {
      collections: [
        { dir: "docs/*", type: "decision" },
        { dir: "*/*", type: "other" },
        { dir: "docs/adr", type: "adr", announce: false },
        { dir: "docs/adr", type: "adr" },
      ],
    },
  });
  const repo = open(root);
  const c = repo.collections.find((x) => x.dir === "docs/adr");
  assert.ok(c);
  assert.equal(c.entry, 3);
  assert.equal(c.settings.announce, false);
  assert.equal(c.settingSources.announce, "config entry 3");
  assert.equal(repo.collections.find((x) => x.dir === "docs/other")?.type, "decision");
  assert.deepEqual(codes(root).sort(), ["error config-duplicate", "warning config-duplicate"]);
});

test("profile fields belong to the type: one definition, shared, conflicts reported", () => {
  const root = makeRepo({
    "docs/adr/0001-a.md": adr("A"),
    "more/adr/0001-b.md": adr("B"),
    "third/adr/0001-c.md": adr("C"),
    "card-catalog.json": {
      collections: [
        { dir: "more/adr", type: "adr", guidance: "Read them." },
        { dir: "third/adr", type: "adr", guidance: "Something else." },
      ],
    },
  });
  const repo = open(root);
  assert.deepEqual(repo.collections.map((c) => c.profile.guidance), ["Read them.", "Read them.", "Read them."]);
  assert.deepEqual(codes(root), ["error type-conflict"]);
});

test("ignored directories are never collections, whichever rule found them", () => {
  const root = makeRepo({
    ".aiignore": "legacy/\n",
    "legacy/docs/adr/0001-a.md": adr("A"),
    "docs/adr/0001-b.md": adr("B"),
    "private/notes/x.md": adr("X"),
    "card-catalog.json": { collections: [{ dir: "private/notes", type: "note" }, { dir: "nowhere/*", type: "note" }] },
    ".claude/settings.json": { permissions: { deny: ["Read(private/**)", "Read(//etc/secrets/**)", "Bash(rm:*)"] } },
  });
  const repo = open(root);
  assert.deepEqual(repo.collections.map((c) => c.dir), ["docs/adr"]);
  assert.deepEqual(repo.notIndexed, [
    { dir: "legacy/docs/adr", type: "adr", source: "default", entry: null, reason: "ignored", detail: ".aiignore" },
    { dir: "nowhere/*", type: "note", source: "config", entry: 2, reason: "no-match" },
    { dir: "private/notes", type: "note", source: "config", entry: 1, reason: "ignored", detail: ".claude/settings.json" },
  ]);
  assert.deepEqual(codes(root).sort(), ["note claude-rule-skipped", "warning config-ignored", "warning config-no-match"]);
});

test("git's own ignore rules count, including directories they exclude", () => {
  const root = makeRepo({ ".gitignore": "generated/\n", "generated/docs/adr/0001-a.md": adr("A"), "docs/adr/0001-b.md": adr("B") }, { git: true });
  const repo = open(root);
  assert.deepEqual(repo.collections.map((c) => c.dir), ["docs/adr"]);
  assert.deepEqual(repo.notIndexed.map((n) => `${n.dir} ${n.detail ?? ""}`), ["generated/docs/adr .gitignore"]);
});

test("a missing ignoreFiles file is a warning", () => {
  const root = makeRepo({ "card-catalog.json": { ignoreFiles: [".internal-ignore", "sub/.more"] }, "sub/.more": "x/\n", "sub/x/docs/adr/0001-a.md": adr("A") });
  const repo = open(root);
  assert.deepEqual(repo.collections, []);
  assert.deepEqual(repo.problems.map((p) => `${p.code} ${p.path}`), ["ignore-file-missing .internal-ignore"]);
});

test("nested repos are never entered", () => {
  const root = makeRepo({ "vendored/.git": "gitdir: ../.git/modules/vendored\n", "vendored/docs/adr/0001-a.md": adr("A"), "card-catalog.json": { collections: [{ dir: "vendored/docs/adr", type: "adr" }] } });
  assert.deepEqual(dirs(root), []);
  assert.deepEqual(codes(root), ["warning config-no-match"]);
});

test("symlinked directories are followed, unless they leave the repo or their target is ignored", () => {
  const outside = makeRepo({ "docs/adr/0001-x.md": adr("X") });
  const root = makeRepo({ "shared/adr/0001-a.md": adr("A"), ".aiignore": "hidden/\n", "hidden/adr/0001-h.md": adr("H") });
  mkdirSync(join(root, "svc/docs"), { recursive: true });
  symlinkSync(join(root, "shared/adr"), join(root, "svc/docs/adr"));
  mkdirSync(join(root, "ext/docs"), { recursive: true });
  symlinkSync(join(outside, "docs/adr"), join(root, "ext/docs/adr"));
  mkdirSync(join(root, "leak/docs"), { recursive: true });
  symlinkSync(join(root, "hidden/adr"), join(root, "leak/docs/adr"));
  const repo = open(root);
  assert.deepEqual(repo.collections.map((c) => c.dir), ["svc/docs/adr"]);
  assert.deepEqual(repo.notIndexed.map((n) => `${n.dir} ${n.detail ?? ""}`), ["leak/docs/adr .aiignore"]);
  assert.deepEqual(repo.problems.map((p) => `${p.code} ${p.path}`), ["symlink-outside-repo ext/docs/adr"]);
});

test("index paths that leave the repo, are shared or land on a record are conflicts", () => {
  const root = makeRepo({
    "notes/a/x.md": adr("X"),
    "notes/b/y.md": adr("Y"),
    "docs/runbooks/r.md": adr("R"),
    "card-catalog.json": {
      collections: [
        { dir: "notes/a", type: "note", indexPath: "../shared.md" },
        { dir: "notes/b", type: "note", indexPath: "../shared.md" },
        { dir: "docs/runbooks", type: "runbook", indexPath: "../../../out.md" },
        { dir: "docs", type: "doc", indexPath: "runbooks/r.md" },
      ],
    },
  });
  const repo = open(root);
  assert.deepEqual(repo.collections.map((c) => `${c.dir} ${c.indexFile ?? "-"}`), ["docs -", "docs/runbooks -", "notes/a notes/shared.md", "notes/b -"]);
  assert.deepEqual(repo.problems.map((p) => p.code), ["index-conflict", "index-conflict", "index-conflict"]);
});

test("invalid config is reported in full and resolves nothing", () => {
  const root = makeRepo({
    "card-catalog.json": {
      extra: 1,
      collections: [{ dir: "/abs", type: "Bad" }, { dir: "x", type: "x", summary: "nonsense", id: "{nope}", label: "{name}", status: { from: "status:x", values: {} } }],
    },
  });
  const r = openRepo(root);
  assert.ok(!r.ok);
  assert.deepEqual(r.problems.map((p) => p.message), [
    'unknown key "extra"',
    'config entry 1: dir "/abs" must be relative to the repo root',
    "config entry 1: type must be a name matching ^[a-z][a-z0-9-]*$",
    'config entry 2: id: ID pattern "{nope}" has an unknown placeholder at "{nope}"',
    'config entry 2: summary: "nonsense" is not a source',
    'config entry 2: status: from: "status:x": status: sources are for links only',
    'config entry 2: label: label template "{name}" must contain {id}',
  ]);
  writeFileSync(join(root, "card-catalog.json"), "{ not json");
  const unreadable = openRepo(root);
  assert.equal(!unreadable.ok && unreadable.problems[0]?.code, "config-unreadable");
});

test("git's ignore rules still apply when another path in the repo is under a symlinked directory", () => {
  const root = makeRepo({ ".gitignore": "legacy/\n", "legacy/docs/adr/0001-a.md": adr("A"), "shared/docs/adr/0001-b.md": adr("B") }, { git: true });
  mkdirSync(join(root, "svc"), { recursive: true });
  symlinkSync(join(root, "shared/docs"), join(root, "svc/docs"));
  const repo = open(root);
  assert.deepEqual(repo.collections.map((c) => c.dir), ["shared/docs/adr", "svc/docs/adr"]);
  assert.deepEqual(repo.notIndexed.map((n) => `${n.dir} ${n.detail ?? ""}`), ["legacy/docs/adr .gitignore"]);
});
