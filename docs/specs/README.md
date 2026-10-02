# card-catalog specs

These specs define card-catalog's external contracts: the files it reads, the
files it writes, and the commands and hooks people and agents use. They turn
[ADR-0001](../adr/0001-generalize-to-record-collections.md) and
[ADR-0002](../adr/0002-never-index-ignored-paths.md) into details precise
enough to build and test against.

A spec says *what* card-catalog does, not how the code does it. When the code
and a spec disagree, one of them is a bug: fix the code, or change the spec
in the same PR. A change that affects ADR-level choices (scope, the
Principle, the Guardrails) needs an ADR, not just a spec edit.

| Spec | Covers |
|------|--------|
| [config.md](config.md) | `card-catalog.json`: how collections are found and configured |
| [profiles.md](profiles.md) | Profile fields, source syntax, ID patterns, links, and the built-in `adr` profile |
| [index-format.md](index-format.md) | `INDEX.md` and `index.json` (version 3), amendment times, migration |
| [ignored-paths.md](ignored-paths.md) | Which paths count as ignored, and how each ignore source is read |
| [hooks.md](hooks.md) | The write hook and the session-start message |
| [cli.md](cli.md) | `card-catalog` commands, options, `--json` output and exit codes |
| [validate.md](validate.md) | Every check `validate` runs, with its code and severity |
| [helpers.md](helpers.md) | The `card-catalog-helpers` plugin: its skills and agent, finding the CLI, releases |

## Conventions

- **Repo root** is the git top-level directory containing the path in
  question. Outside a git repo, it's the nearest ancestor directory that
  holds a `card-catalog.json`, or else the directory the command or hook
  started in.
- Paths in config and in output are POSIX-style (`/` separators) and
  relative to the repo root, unless a spec says otherwise. Paths inside an
  index are relative to that index's file.
- Every text file card-catalog writes is UTF-8 with `\n` line endings and a
  trailing newline.
- "Warning" in a hook means a line on stderr starting with
  `[card-catalog] warning:`. Hooks never fail the tool call that ran them.
- Terms such as *record*, *collection*, *profile*, *label* and *orphaned
  index* are used as defined in [CONTEXT.md](../../CONTEXT.md).
