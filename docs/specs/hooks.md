# Hooks

The `card-catalog` plugin has two hooks. Both are deterministic, use no
model and no network, finish within their 10-second timeout, and always exit
0. A problem is logged as a warning on stderr, which Claude Code shows only
in verbose mode, so a hook never interrupts the session that ran it.

## Write hook

`PostToolUse` on `Write|Edit|MultiEdit` runs `scripts/on-write.ts`. It reads
`tool_input.file_path` from the hook input, resolving a relative path
against `cwd`, and finds the repo root for that path.

1. **Config or ignore rules changed.** If the file is one of:
   - `card-catalog.json` at the repo root,
   - an agent ignore file at the repo root, or a file listed in
     `ignoreFiles`,
   - `.claude/settings.json` at the repo root,
   - any `.gitignore`,

   it reindexes every collection, as `reindex` does. A change to what's
   ignored can add or remove collections, so it doesn't try to work out
   which ones are affected.
2. **Config invalid.** If `card-catalog.json` is invalid, it logs a warning
   naming the `validate` command and writes nothing.
3. **Record written.** Otherwise it finds the innermost collection whose
   directory contains the file. If there is one, and the file matches that
   profile's `match` and isn't excluded or ignored, it rebuilds that
   collection's index.
4. Anything else is left alone.

Each rebuild re-reads the whole collection, so edits, renames and deletions
made outside any agent are picked up the next time anything in the
collection is written. It never deletes files, and it writes each index
file only if its content changed.

Records changed by other tools, such as Bash, don't trigger the hook. The
session-start message reports the stale index, and `validate` fails on it.

## Session-start message

`SessionStart` runs `scripts/session-start.ts`. It never writes to the repo.
It resolves collections from the project directory (`CLAUDE_PROJECT_DIR`,
else `cwd`), rebuilds each announced collection's index in memory to see
whether the one on disk is current, and prints a message for the agent.

A collection is listed when its `announce` is `true`, it has an index
(`indexPath` isn't `"none"`), and it has at least one record. With nothing
to list, no orphaned indexes and a valid config, it prints nothing.

```
This repo keeps an index for each collection of records below, with one line per record:
label, status, date amended, title and a one-line summary. Types without a status leave it out.

- docs/adr/INDEX.md (67 ADRs)
- docs/postmortems/INDEX.md (12 postmortems, out of date)

Before changing an area, grep the indexes for its terms and open the records whose lines match.
If your work would contradict an accepted ADR, say so explicitly rather than silently overriding it.
Check for a postmortem before changing an area that has failed before.
To bring an out-of-date index up to date, run: node "<cli>" reindex
The card-catalog CLI is node "<cli>" (list, preview, profile, validate; add --help).
```

- **First line.** When every listed collection is of one type, the first two
  lines name it instead:
  `This repo records {description} as {plural}. Each collection below has an index with one line per {noun}:`
  then `label, status, date amended, title and a one-line summary.`, leaving
  out `status, ` for a type without one. Without a `description`, the first
  line starts `This repo records {plural}.` A message listing several types
  uses the generic first lines, whatever their descriptions. Their second
  line adds `Types without a status leave it out.` only when some listed
  types have a status and some don't.
- **Collection lines.** One per listed collection, in path order:
  the index path, the record count with the type's `plural` (or its
  `{noun}`, as in [index-format.md](index-format.md#header), when the count
  is 1), and `, out of date` when the index is stale or missing.
- **Grep line.** It says `the index` when one collection is listed, and
  names the type's `plural` instead of `records` when one type is.
- **Guidance.** Each listed type's `guidance` sentence, once, in the order
  the types first appear in the list.
- **Reindex line.** Only when some listed index is out of date.
- **CLI line.** Always, when anything is listed. Helper skills and agents
  use this path when `npx card-catalog` isn't available. `<cli>` is the
  absolute path of the plugin's `scripts/cli.ts`.
- **Orphaned indexes.** When any are found, a line
  `Orphaned indexes, which no collection maintains any more: <paths>`.
  Only files named `INDEX.md` or `index.json` are checked here.
- **Invalid config.** When `card-catalog.json` is invalid, the message is
  only:
  `card-catalog.json is invalid, so no index was checked. Run: node "<cli>" validate`.

Ignored collections are never listed, and the message never names an
ignored path.
