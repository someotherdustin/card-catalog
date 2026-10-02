# CLI

The CLI is how operators and CI use card-catalog, and what helper skills and
agents call. It runs the same core as the hooks.

```
npx @someotherdustin/card-catalog <command> [options]
node <plugin>/scripts/cli.ts <command> [options]
```

The npm package `@someotherdustin/card-catalog`, whose command is
`card-catalog`, and the plugin carry the same version. The plugin runs its
TypeScript directly, with no build step. Node doesn't strip
types under `node_modules`, so the npm package holds the same core and CLI
compiled to JavaScript at publish time; compiled output is never committed.
Pushing a `v*` tag runs a workflow that checks the tag, `package.json`,
both plugin manifests and the helpers' pin carry the same version, compiles,
publishes with npm provenance, and then tags each plugin
([helpers.md](helpers.md#releases)). The
plugin's `scripts/reindex.ts [root]` stays as a shortcut for
`reindex --root <root>`, because earlier READMEs and session-start messages
gave it.

## Common options

| Option | Meaning |
|--------|---------|
| `--root <dir>` | The repo root. Default: the [repo root](README.md#conventions) of the current directory. |
| `--json` | Print one JSON object on stdout and nothing else there. |
| `--help`, `-h` | Help for the CLI or a command. |
| `--version` | The version. |

Without `--json`, results go to stdout and warnings to stderr. With
`--json`, warnings go into the object as `warnings: string[]`. Directory
arguments are relative to the current directory and shown relative to the
root.

## Exit codes

| Code | Meaning |
|------|---------|
| 0 | Success. For `validate`, no errors (and no warnings with `--strict`). |
| 1 | The command ran and failed: `validate` found problems, a write failed, the config is invalid, or a directory is ignored. |
| 2 | Usage error: unknown command or option, missing argument. |

## `list`

Lists collections and anything that stops a directory from being one.

```
$ card-catalog list
docs/adr               adr         67 records  docs/adr/INDEX.md          current
docs/postmortems       postmortem  12 records  docs/postmortems/INDEX.md  stale
docs/adr/archive       adr          9 records  docs/adr/archive/INDEX.md  current, not announced
src/*/docs/adr         adr         not indexed: matches no directory (config entry 1)
legacy/docs/adr        adr         not indexed: ignored by .aiignore (default)
orphaned index: old/INDEX.md
```

`--json`:

```json
{
  "root": "/abs/path",
  "config": "card-catalog.json",
  "collections": [
    {
      "dir": "docs/adr", "type": "adr", "source": "default", "entry": null,
      "records": 67, "index": "docs/adr/INDEX.md", "state": "current", "announce": true
    }
  ],
  "notIndexed": [
    { "dir": "legacy/docs/adr", "type": "adr", "source": "default", "entry": null,
      "reason": "ignored", "detail": ".aiignore" }
  ],
  "orphans": ["old/INDEX.md"],
  "warnings": []
}
```

- `config` is `null` without a config file.
- `source` is `"default"` or `"config"`; `entry` is the entry's position in
  `collections`, counting from 1 as human output does, or `null`.
- `state` is `"current"`, `"stale"`, `"missing"` (records but no index
  yet), `"empty"` (no records and no index) or `"none"`
  (`indexPath: "none"`).
- `reason` is `"ignored"` (with the source in `detail`) or `"no-match"`.

Ignored directories that no config entry names and no default would have
found aren't listed.

## `reindex [<dir>…]`

Rebuilds and writes the index of every collection, or of the collections
named. Prints one line per collection:

```
updated: docs/adr (67 ADRs)
unchanged: docs/postmortems (12 postmortems)
```

Exits 1 if the config is invalid, a named directory isn't a collection, or
a write fails. Named directories are checked before anything is written. Parse warnings don't change the exit code. A collection whose
`index.json` is newer than this version supports is skipped with a warning.

`--json`: `{ "collections": [{ "dir", "type", "records", "changed" }], "warnings": [] }`.

## `preview <dir>`

Prints what the index for `<dir>` would be, without writing anything. It's
how a proposed profile is checked before it goes into config.

| Option | Meaning |
|--------|---------|
| `--type <type>` | Read `<dir>` as this type. Default: the type of the collection at `<dir>`. |
| `--entry <json>` | A config entry, as JSON, to use for `<dir>` in place of config. `dir` may be left out. |

Without either option, `<dir>` must be a collection. With them, it may be
any directory, so a skill can try a profile before writing config. Amendment
times come from an existing `index.json` in `<dir>` if there is one,
otherwise from commit dates.

Output is the `INDEX.md` content, followed on stderr by the files that
matched but aren't records, and why:

```
skipped: notes.md (name doesn't match id pattern {date}-{slug})
skipped: 2026-01-03-dns.md (no title)
```

`--json`:

```json
{
  "dir": "docs/postmortems",
  "type": "postmortem",
  "records": [ { "…": "index.json record keys", "line": "- [Postmortem …](…) …" } ],
  "skipped": [ { "file": "notes.md", "reason": "not-a-record" } ],
  "warnings": []
}
```

An ignored `<dir>` is refused with exit 1, and nothing from it is printed.

## `profile <dir>`

Shows the resolved profile and settings for the collection at `<dir>`, and
where each value came from: `built-in`, `config entry <n>` or
`generic default`. Accepts `--type` and `--entry` as `preview` does.

```
docs/postmortems: postmortem (config entry 3)
  id        {date}-{slug}                                  config entry 3
  title     frontmatter:title, heading                     generic default
  summary   frontmatter:summary, section:Impact, lead      config entry 3
  ...
```

`--json`:
`{ "dir", "type", "profile": { <field>: value }, "settings": { "indexPath", "announce", "exclude" }, "sources": { <field>: "built-in" | "config entry <n>" | "generic default" | "--entry" }, "settingSources": { <setting>: "config entry <n>" | "default" | "--entry" } }`.
Settings have their own sources because `exclude` is both a profile field
and a collection setting.

A `<dir>` that isn't a collection, without `--type` or `--entry`, exits 1
with the reason (`not a collection`, or why not, as in `list`).

## `types`

Lists the built-in record types, so a skill or a person can see which ones
a config entry can name without giving its own profile.

```
$ card-catalog types
adr  ADRs  architecture decisions
```

`--json`: `{ "types": [{ "name", "plural", "description" }] }`, where
`description` is `null` for a type without one.

## `validate`

Runs every check in [validate.md](validate.md) over the whole repo.

| Option | Meaning |
|--------|---------|
| `--strict` | Treat warnings as errors for the exit code. |

```
error   stale-index      docs/postmortems/INDEX.md  out of date; run: card-catalog reindex docs/postmortems
warning unknown-status   docs/adr/0012-cache.md     unrecognized status "parked"
note    not-a-record     docs/postmortems/notes.md  name doesn't match id pattern {date}-{slug}
3 problems (1 error, 1 warning, 1 note)
```

`--json`:

```json
{
  "problems": [
    { "severity": "error", "code": "stale-index", "path": "docs/postmortems/INDEX.md",
      "message": "out of date", "fix": "card-catalog reindex docs/postmortems" }
  ],
  "counts": { "error": 1, "warning": 1, "note": 1 }
}
```

`fix` is present when there's a command or edit that resolves the problem.

To run it from pre-commit or CI, call `npx @someotherdustin/card-catalog validate`.
card-catalog doesn't install git hooks itself.
