# Config: `card-catalog.json`

The config file is optional. Without it, card-catalog indexes every
[default collection](#default-collections) as ADRs, exactly as before
ADR-0001. With it, the defaults still apply unless turned off, and config
adds collections or overrides defaults directory by directory.

## Location

The config is `card-catalog.json` at the repo root. Files with that name
anywhere else are not read. Hooks and the CLI read it on every run, with no
cache.

## Shape

```json
{
  "$schema": "https://unpkg.com/@someotherdustin/card-catalog/card-catalog.schema.json",
  "defaults": true,
  "ignoreFiles": [".internal-ignore"],
  "collections": [
    { "dir": "src/*/docs/adr", "type": "adr" },
    { "dir": "docs/adr/archive", "type": "adr", "announce": false },
    {
      "dir": "docs/postmortems",
      "type": "postmortem",
      "id": "{date}-{slug}",
      "summary": ["frontmatter:summary", "section:Impact", "lead"],
      "fields": { "severity": "inline:Severity" },
      "guidance": "Check for a postmortem before changing an area that has failed before."
    }
  ]
}
```

| Key | Type | Default | Meaning |
|-----|------|---------|---------|
| `$schema` | string | none | The JSON Schema URL, for editors. card-catalog ignores it. |
| `defaults` | boolean | `true` | Whether [default collections](#default-collections) are found. |
| `ignoreFiles` | string[] | `[]` | Extra ignore files, as repo-relative paths. See [ignored-paths.md](ignored-paths.md). |
| `collections` | object[] | `[]` | Config entries, described below. |

Any other top-level key is a `config-invalid` error.

## Config entries

Each item in `collections` is a **config entry**. It names one or more
directories and the record type of the collections there.

| Key | Required | Meaning |
|-----|----------|---------|
| `dir` | yes | A repo-relative directory path or [glob](#directory-globs). |
| `type` | yes | A record type name: `^[a-z][a-z0-9-]*$`. |
| `indexPath`, `announce`, `exclude` | no | [Collection settings](#collection-settings). |
| any profile field | no | Defines or overrides the type's profile. See [profiles.md](profiles.md). |

An entry with any other key is a `config-invalid` error.

### Record types and profiles

If `type` names a built-in type (today only `adr`), the type starts from the
shipped profile. Each profile field given in config replaces that field of
the built-in profile whole. Fields aren't merged deeply. For example, a
`links` value replaces the built-in `links` map; it doesn't add to it.

If `type` names any other type, the entry defines a user-defined type.
Profile fields it doesn't give take the
[generic defaults](profiles.md#generic-defaults), never the `adr` profile's.

A record type has exactly one profile. Several entries may name the same
type, but at most one distinct set of profile fields may be given for it.
An entry that names the type without profile fields uses the profile defined
elsewhere. If two entries give different profile fields for one type,
`validate` reports `type-conflict` (an error), and hooks use the first
entry's fields.

### Collection settings

Collection settings belong to a collection, not to its type, so they may
differ between entries of the same type. That lets one ADR directory stay
out of the session-start message, or skip a template file, without changing
how ADRs are read everywhere.

| Setting | Default | Meaning |
|---------|---------|---------|
| `indexPath` | `"INDEX.md"` | Path of the index file, relative to the collection directory, ending in `.md`. `"none"` writes no index and no `index.json`. |
| `announce` | `true` | Whether the session-start message points agents at this collection's index. |
| `exclude` | `[]` | Globs for files that are never records in this collection. They add to the profile's `exclude`, never replace it. |

`indexPath` may point outside the collection directory (`"../postmortems.md"`)
but must stay inside the repo. It must not resolve to a record, or to the
index of another collection. Either is an `index-conflict` error.

ADR-0001 §2 first listed `indexPath` and `announce` as profile fields. Its
amendment note records the move.

## Directory globs

`dir` may contain glob characters:

- `*` matches any characters in one path segment;
- `**` as a whole segment matches zero or more segments;
- `?` matches one character in a segment;
- `[abc]` and `[a-z]` match one character from a set.

A glob matches directories only, and only ones that exist. `dir` must not be
absolute or contain `..`. A trailing `/` is ignored.

While expanding `*` or `**`, card-catalog doesn't descend into
`node_modules`, `dist`, `build`, `target`, `vendor` or any directory whose
name starts with `.`, unless the glob names that directory literally. It
doesn't descend into ignored directories (see
[ignored-paths.md](ignored-paths.md)) or [nested repos](#nested-repos).

## Default collections

Unless `"defaults": false`, every directory named `adr` whose parent is named
`docs` or `doc` is a default collection of type `adr`, with the built-in
profile and default settings. The search starts at the repo root, goes at
most 8 levels deep, and skips the same directories as glob expansion.

## Resolving collections

For each directory, the first rule that applies decides its collection:

1. A directory that is ignored, or inside an ignored directory, is never a
   collection. `validate` reports a config entry that matches only ignored
   directories (`config-ignored`).
2. A config entry whose `dir` has no glob characters and names the directory.
3. A config entry whose `dir` glob matches the directory. If several do, the
   first one in `collections` wins, and `validate` reports
   `config-duplicate` (a warning).
4. A default collection.

Two entries with the same literal `dir` are a `config-duplicate` error; the
first wins.

### Nested repos

A directory containing `.git` (a directory or a file, as in a submodule or
worktree) below the repo root is a separate repo. Discovery, glob expansion
and orphan scans never enter it, and a config entry can't name a directory
inside it. It's indexed when someone works in it as its own repo, under its
own config.

### Nesting

Collections may nest: `docs` can be a collection of runbooks while
`docs/adr` is a collection of ADRs. A file belongs to the innermost
collection whose directory contains it, so `docs/adr/0001-x.md` is an ADR
and is not read as a runbook, even if the runbook profile's `match` would
reach it.

## Invalid config

If `card-catalog.json` isn't valid JSON or fails the schema, hooks write
nothing. The write hook logs a warning, the session-start message says the
config is invalid and gives the `validate` command, and `reindex` exits 1.
Falling back to the defaults could rewrite indexes that the config was
deliberately shaping, so card-catalog doesn't.

## JSON Schema

The schema ships as `card-catalog.schema.json` at the root of the npm
package and of the plugin. It describes everything in this spec, including
source strings and ID patterns as string patterns, so editors flag most
mistakes as they're typed. `validate` checks the same rules and more
(globs that match nothing, conflicts between entries).

The `$schema` URL is
`https://unpkg.com/@someotherdustin/card-catalog/card-catalog.schema.json`.
It always serves the latest published version, so editors check against
the newest schema rather than the one that wrote the file.
