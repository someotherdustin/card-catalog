# Ignored paths

[ADR-0002](../adr/0002-never-index-ignored-paths.md) decides that records
under ignored paths are never indexed or announced, and that an index
depends only on files committed to the repo. This spec defines which paths
are ignored and how each source is read.

## What "ignored" means

A path is **ignored** if any source below excludes it or any directory
containing it, up to the repo root. Ignored paths are left out everywhere:

- a directory that is ignored is never a collection, whether it was found by
  default, listed in config, or just written to;
- a file that is ignored is never a record, even inside a collection that
  isn't;
- ignored directories aren't searched for default collections, glob
  matches or orphaned indexes;
- `preview` refuses an ignored directory, so the CLI can't show what an
  index would have exposed.

Config can't override this. To index something an ignore file hides, edit
the ignore file.

## Sources

### Git

Git's own rules decide, as `git check-ignore` reports them: every
`.gitignore`, `.git/info/exclude` and `core.excludesFile`. A file git tracks
is never ignored by git's rules, matching git itself. Outside a git repo,
this source excludes nothing.

These are the only personal rules card-catalog honors. A path someone
ignores personally is never committed, so neither is an index of it, and
indexes still agree between teammates.

### Agent ignore files

These files are read from the repo root only:

```
.aiignore  .aiexclude  .cursorignore  .devinignore  .windsurfignore
.codeiumignore  .aiderignore  .geminiignore  .continueignore
.clineignore  .rooignore
```

Each uses gitignore syntax, with patterns relative to the repo root.
Whether git tracks a file makes no difference to them.

Adding a file to this list doesn't need an ADR. Codex joins when its
repo-level config is confirmed.

### `ignoreFiles` in config

Each path in `card-catalog.json`'s `ignoreFiles` names another file in
gitignore syntax, with patterns relative to that file's directory. These add
to the built-in list and can't remove from it. A listed file that doesn't
exist is reported by `validate` as `ignore-file-missing` (a warning) and
excludes nothing.

### Claude Code settings

card-catalog reads `permissions.deny` in `<repo root>/.claude/settings.json`
only. `settings.local.json`, user settings and managed settings are personal
and never read.

Only rules of the form `Read(<pattern>)` count. Other tools' rules, and a
bare `Read` with no pattern, are skipped. Patterns use gitignore syntax with
Claude Code's anchors:

| Pattern | Anchored at | card-catalog |
|---------|-------------|--------------|
| `/path` | The project directory | Read relative to the repo root |
| `path`, `./path` | The session's working directory | Read relative to the repo root |
| `//path` | The filesystem root | Skipped, noted by `validate` |
| `~/path` | The home directory | Skipped, noted by `validate` |

Reading both relative forms at the repo root is exact for this file. Claude
Code loads `.claude/settings.json` from the session's working directory and
doesn't look in parents, so a session that applies the root settings file
started at the root.

`//` and `~/` rules can point inside the repo on one machine and outside it
on another, so honoring them would make indexes differ between teammates.
`validate` reports each one as `claude-rule-skipped` (a note).

Claude Code's deny-rule matching differs from gitignore in two ways, and
card-catalog follows Claude Code:

- A relative pattern with a single directory segment, such as `secrets/**`,
  matches that directory at any depth, as if written `**/secrets/**`.
- A pattern starting with `!` carves its matches out of the relative rules
  listed before it in the same list. It never reopens a path inside a
  directory that a rule blocks as a whole.

## Gitignore matching

The core matches gitignore patterns itself, with no runtime dependency.
It follows gitignore(5): blank lines and `#` comments, `\#` and `\!`
escapes, trailing-space trimming, `!` negation, a trailing `/` for
directories only, a leading or middle `/` to anchor, `*`, `?`, `[...]`, and
`**`. A file can't be re-included if a parent directory is excluded.

The matcher's tests compare its answers with
`git check-ignore --no-index` on the same patterns.

## Best effort

This keeps card-catalog from being the way hidden content reaches an agent.
It doesn't stop an agent from reading files directly, and no ignore file it
honors claims to.
