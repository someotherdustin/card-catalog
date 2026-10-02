---
name: add-collection
description: Set up a card-catalog collection, so a directory of markdown records (RFCs, runbooks, postmortems, ADRs in an unusual layout) gets a grep-able INDEX.md, or change how an existing collection is read. Proposes a card-catalog.json entry, checks it against the real files with the card-catalog CLI's preview, and writes config only after the person approves the exact entry. Use when someone wants a directory indexed, asks why records are missing from an index or read wrongly, or wants a collection's labels, summaries or statuses changed.
---

# Add or change a collection

You propose a config entry for one collection, show what index it produces,
and write it to `card-catalog.json` only once the person approves that exact
entry. The card-catalog CLI does all the reading of records. Don't guess how
it will parse a file: run `preview` and look.

Never write records or index files. Never write config the person hasn't
seen and approved in the form you showed them.

## 1. Find the CLI

Look in this conversation for the session-start line
`The card-catalog CLI is node "<cli>"`. Run:

```
node "${CLAUDE_PLUGIN_ROOT}/scripts/find-cli.ts" "<cli>"
```

leaving out `"<cli>"` if there's no such line. On exit 0, its stdout is the
command for the rest of this run; below, `$CC` stands for it, so
`$CC list --json` means that command followed by `list --json`. On exit 1,
show its stderr to the person and stop.

Run every CLI command from the repo root.

## 2. Find the directory and type

Work out from the request which directory holds the records and what type
they are: a short lowercase name such as `rfc`, `runbook` or `postmortem`.
Ask if either is unclear.

Run `$CC list --json`.

- If the directory is in `collections`, you're changing that collection's
  entry. Run `$CC profile <dir> --json` to see what it resolves to now, and
  where each value comes from (`built-in`, `config entry <n>` or
  `generic default`).
- If it's in `notIndexed` with reason `ignored`, tell the person which
  ignore source hides it (`detail`) and stop. card-catalog never indexes an
  ignored directory, and changing that is their call, not yours.
- Otherwise it's a new collection. `list` only knows about directories
  that config or the defaults name, so a new directory can still be
  ignored: if `preview` later refuses it as ignored, tell the person the
  ignore source it names and stop, as above.

## 3. Read samples

Read 3–5 files that `preview` would read, spread across the collection: the
first and last in name order, one from the middle, and any whose name or
shape looks different from the rest. You need to know where each one keeps
its title, summary and status, and how its file name is formed.

## 4. Prefer a built-in type

Run `$CC types --json`. If a built-in type plausibly fits, try it first:

```
$CC preview <dir> --type <type> --json
```

If every sample is in `records` with a sensible `title` and `summary`, and
`skipped` is empty or holds only files that genuinely aren't records, the
proposed entry is just `{ "dir": "<dir>", "type": "<type>" }`. Go to step 6.

## 5. Otherwise propose an entry

Start from the generic defaults, shown by
`$CC profile <dir> --type <type> --json`, and set only the fields that need
to differ. Then check it:

```
$CC preview <dir> --entry '<entry json>' --json
```

An entry takes `dir` and `type`, then any of these:

| Field | What it sets |
|-------|--------------|
| `name`, `plural`, `description` | How the type is named: `Postmortem`, `postmortems`, `production incidents` |
| `match`, `exclude` | Which files are candidates: a glob such as `*.md` or `*/README.md`, and globs to leave out |
| `id` | An ID pattern over the file name, such as `{date}-{slug}`, `[{series}-]{number}`, `{slug}` or `{dir}`, or `frontmatter:<key>` |
| `title`, `summary`, `date`, `tags` | Sources, tried in order |
| `status` | `null`, or `{ "from": <sources>, "values": { "<raw word>": "<status>" } }` |
| `fields` | Extra values shown on the line: `{ "severity": "inline:Severity" }` |
| `links` | Link type → sources |
| `label` | A template over `{name}` and `{id}`, such as `RFC-{id}` |
| `guidance` | One sentence the session-start message adds for this type |
| `indexPath`, `announce` | Where the index goes (or `"none"`), and whether sessions are told about it |

A source is `frontmatter:<key>`, `inline:<Name>` (a `Name: value` line),
`section:<Name>` (the first paragraph under a `##` heading), `heading`,
`lead` (the first paragraph under the title) or `quote`. The full rules are
in the
[profiles spec](https://github.com/someotherdustin/card-catalog/blob/main/docs/specs/profiles.md).
When the docs and `preview` disagree, believe `preview`.

## 6. Show the result

Show the person:

1. the proposed entry, as the exact JSON you'd write;
2. the index lines `preview` produced (`records[].line`): all of them when
   there are 20 or fewer, otherwise the first 10;
3. every skipped file with its reason.

Point out anything that looks wrong, such as a summary that's really a
status line, or a record that was skipped. Then ask whether to write it. If
they ask for changes, go back to step 5 and show the result again. If they
stop, stop.

## 7. Write the config

Only after the person approves the exact entry you showed:

- If `card-catalog.json` exists at the repo root, add the entry to its
  `collections` array, or replace the existing entry for this directory.
  Leave the rest of the file as it is.
- If it doesn't exist, create it:

  ```json
  {
    "$schema": "https://unpkg.com/@someotherdustin/card-catalog/card-catalog.schema.json",
    "collections": [<the entry>]
  }
  ```

Use the file-editing tools, never the shell. The card-catalog write hook
sees the edit and reindexes every collection.

## 8. Validate

Run `$CC validate --json` and report any problems whose `path` is in this
collection's directory, or in `card-catalog.json`. If there are any, offer
to fix them with the `records-doctor` skill.
