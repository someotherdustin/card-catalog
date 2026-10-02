---
name: records-doctor
description: Walk through the problems `card-catalog validate` reports (stale or missing indexes, invalid card-catalog.json, duplicate record IDs, unknown statuses, broken links, orphaned indexes) and fix them one group at a time, with the person approving each fix. Use when validate or CI fails on card-catalog, the session-start message says an index is out of date or orphaned, or someone asks to check or clean up their records and indexes.
---

# Fix what validate reports

You run `validate`, explain the problems, propose fixes, and apply only the
ones the person approves. Without you, the same problems show up in
`validate` output in pre-commit or CI.

Never write an index file except through the CLI's `reindex`. Never delete a
file. Never make an edit the person hasn't approved.

## 1. Find the CLI and validate

Look in this conversation for the session-start line
`The card-catalog CLI is node "<cli>"`. Run:

```
node "${CLAUDE_PLUGIN_ROOT}/scripts/find-cli.ts" "<cli>"
```

leaving out `"<cli>"` if there's no such line. On exit 0, its stdout is the
command for the rest of this run; below, `$CC` stands for it. On exit 1,
show its stderr to the person and stop.

Run every CLI command from the repo root. Run `$CC validate --json`. With
no problems, say so and stop.

Each problem has `severity`, `code`, `path`, `message` and sometimes `fix`.
A `fix` that starts with `card-catalog ` is a CLI command: run it as `$CC`
followed by the rest.

## 2. Group the problems

Group them by `code`, in this order:

1. config errors (`config-unreadable`, `config-invalid`, then any other
   error whose path is `card-catalog.json`). `validate` runs no other
   checks until the config is valid, so fix these first and validate again
   before going on;
2. other errors;
3. warnings.

List notes in one line each, and fix them only if the person asks.

## 3. Propose fixes, one group at a time

For each group, say in a sentence what's wrong, then propose a fix for each
problem in it. The person approves the group, approves some of its problems,
or skips it. Don't move on until they've answered.

## 4. Apply approved fixes

- **CLI commands.** A stale or missing index (`stale-index`,
  `missing-index`) is fixed with `$CC reindex <dir>`. Run it through the
  CLI; never edit an `INDEX.md` or `index.json` yourself.
- **Edits.** An edit to a record, `card-catalog.json` or an ignore file is
  shown first, then made with the file-editing tools. Change records as
  little as possible and keep each record's own format: don't add
  frontmatter to a record that has none, and write a status the way that
  record already writes it.
- **Renames.** A rename, such as for `duplicate-id`, is proposed together
  with the edits to every link that names the old file or label. Once
  approved, make it with `git mv`, make the link edits, then run
  `$CC reindex`, because the write hook doesn't see shell commands.
- **Orphaned indexes** (`orphaned-index`). Never delete one. Show the
  command that would, `git rm <path>`, plus the `index.json` beside it when
  that's orphaned too, for the person to run themselves. Or offer to make
  its directory a collection again with the `add-collection` skill.
- **`newer-index`.** This card-catalog is older than the one that wrote the
  index. Say to update the card-catalog plugin, and change nothing.

What each code means and its usual fix are in the
[validate spec](https://github.com/someotherdustin/card-catalog/blob/main/docs/specs/validate.md).

## 5. Validate again

Run `$CC validate --json` again and report what's left, including problems
the person chose to skip.
