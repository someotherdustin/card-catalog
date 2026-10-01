# Validate checks

`card-catalog validate` checks config, records and indexes across the whole
repo. It's the non-conversational route to everything the `records-doctor`
skill does: run it from pre-commit or CI, and read its `--json` output from
a skill.

Each problem has a **severity**:

- **error**: something is wrong or about to be: a stale index, a record
  missing from its index, a leak. `validate` exits 1.
- **warning**: probably a mistake, but the indexes are still correct.
  `validate` exits 1 only with `--strict`.
- **note**: worth knowing, never fails.

Problems never name content under an ignored path, beyond the path of a
config entry or rule that refers to one.

## Config

| Code | Severity | When |
|------|----------|------|
| `config-unreadable` | error | `card-catalog.json` isn't valid JSON. No other checks run. |
| `config-invalid` | error | It fails the schema: an unknown key, a wrong type, a bad source string, ID pattern, label template or type name. No other checks run. |
| `config-no-match` | warning | A config entry's `dir` matches no directory. |
| `config-ignored` | warning | Every directory a config entry's `dir` matches is ignored. The message names the ignore source. |
| `config-duplicate` | error / warning | Two entries with the same literal `dir` (error), or two glob entries matching one directory (warning). The first wins. |
| `type-conflict` | error | Two entries give different profile fields for one type. The first entry's fields are used. |
| `index-conflict` | error | An `indexPath` leaves the repo, resolves to a record, or is shared by two collections. |

## Ignore sources

| Code | Severity | When |
|------|----------|------|
| `ignore-file-missing` | warning | A file listed in `ignoreFiles` doesn't exist. |
| `claude-rule-skipped` | note | A `Read(...)` deny rule in `.claude/settings.json` uses a `//` or `~/` anchor, so it isn't honored. |

## Records

| Code | Severity | When |
|------|----------|------|
| `unreadable` | error | A record file can't be read. |
| `no-title` | error | No title source yields a value. The record is missing from the index, or has a stale line. |
| `no-id` | error | The profile's `id` is a frontmatter source and the record doesn't have it. |
| `duplicate-id` | error | Two records in one collection have the same ID. |
| `no-summary` | warning | No summary source yields a value. |
| `unknown-status` | warning | The raw status matches no key in the profile's `values`. |
| `no-supersede-target` | warning | The status is `superseded` and there's no `superseded-by` link. |
| `broken-link` | warning | A link target looks like a label of a known type but no record has it, or a link's file doesn't exist. |
| `not-a-record` | note | A file matches `match` but not the `id` pattern, and isn't excluded. |
| `empty-collection` | note | A collection has no records. |

A link target that doesn't look like any known type's label is free text,
so `broken-link` doesn't apply to it.

## Indexes

| Code | Severity | When |
|------|----------|------|
| `stale-index` | error | A collection's `INDEX.md` or `index.json` differs from what a rebuild would write. See [index-format.md](index-format.md#current-and-stale-indexes). |
| `missing-index` | error | A collection with records and an `indexPath` has no index yet. |
| `newer-index` | error | An `index.json` has a version above the one this card-catalog writes. |
| `orphaned-index` | error | A card-catalog index outside an ignored path that no collection writes. |

`orphaned-index` is an error, not a warning, because of
[ADR-0002](../adr/0002-never-index-ignored-paths.md): when a collection
becomes ignored, an index that its `indexPath` put elsewhere keeps exposing
the hidden records' titles and summaries until someone deletes it. Failing
CI makes someone act. card-catalog never deletes it itself.

`validate` finds orphans by checking every markdown file and every
`index.json` outside ignored paths, as described in
[index-format.md](index-format.md#orphaned-indexes).

## Fixes

Where there's a fix, the problem carries it as `fix` in `--json` output and
in the message:

| Code | Fix |
|------|-----|
| `stale-index`, `missing-index` | `card-catalog reindex <dir>` |
| `orphaned-index` | Delete the file, or make its directory a collection again |
| `config-ignored` | Edit the named ignore file, or remove the entry |
| `type-conflict` | Keep the profile fields on one entry only |
| `no-supersede-target` | Add the replacing record's label to the status |
