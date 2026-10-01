---
status: accepted
date: 2026-10-01
tags: [privacy, ignore-files, determinism]
---

# Never index ignored paths; indexes depend only on committed files

Records under paths that git or a committed agent ignore file hides are never indexed, even if config lists them, since an index would leak their titles and summaries to agents. Indexes depend only on committed files, so every writer builds the same one.

## Context

[ADR-0001](0001-generalize-to-record-collections.md) lets card-catalog index
any directory a config lists, and the default ADR match takes any `docs/adr`
or `doc/adr` directory at any depth. An `INDEX.md` gives every agent in the
repo the title and summary of each record, and the session-start message
points agents at it. If a repo owner has told their coding tool not to show
a directory to agents, indexing that directory undoes it.

Coding tools mark such paths in different ways. Most use a gitignore-syntax
file at the repo root: `.aiignore` (JetBrains), `.aiexclude` (Gemini Code
Assist), `.cursorignore`, `.devinignore` (and Windsurf's older
`.windsurfignore` and `.codeiumignore`), `.aiderignore`, `.geminiignore`,
`.continueignore`, `.clineignore` and `.rooignore`. Claude Code uses `Read`
deny rules in its settings files instead, and Codex and Copilot use
configuration outside the repo. There is no cross-tool standard, and every
vendor that states a guarantee calls theirs best-effort.

Several of these sources are personal: Claude Code's user, local and managed
settings, a global gitignore, `~/.codex/config.toml`. Indexes are committed
and have a single writer (ADR-0001, §5). If two teammates' hooks honored
different personal rules, each would rewrite the index the other just wrote,
and CI would agree with neither.

## Decision

**A record under an ignored path is never indexed or announced**, whether
its directory was found by default, listed in config, or just written to.
An ignored path is one excluded by any of:

- git's ignore rules;
- the agent ignore files listed above, read from the repo root;
- any further files named in `card-catalog.json` under `"ignoreFiles"`,
  which can add to the built-in list but not remove from it;
- `Read(...)` deny rules in the committed `.claude/settings.json` whose
  paths resolve inside the repo. Rules that don't resolve inside the repo
  are skipped, and `validate` notes each one.

Config can't override this. To index a directory an ignore file hides, edit
the ignore file: it is the single record of what agents may see. `validate`
reports any config entry that is ignored, so an operator can see why it
isn't indexed.

**An index depends only on files committed to the repo.** Personal settings
are never read. Git's own ignore rules are the exception, because a path
someone ignores personally is never committed, so neither is its index.

**An orphaned index outside an ignored path is a `validate` error.** If a
collection becomes ignored after it was indexed, its index stays where it is,
because card-catalog never deletes files. An index inside the ignored
directory is hidden by the same rule. But a profile's `indexPath` can put the
index somewhere else, and that index would keep exposing the hidden records'
titles and summaries. Making it an error means CI catches the leak, and an
operator removes the file.

This is best-effort, like the ignore files it honors. It keeps card-catalog
from becoming the way hidden content reaches an agent; it doesn't stop an
agent from reading files directly.

## Considered Options

- **Honor `.gitignore` only.** Simple, but every repo that hides paths from
  agents with an agent ignore file would have those paths indexed anyway.
- **Honor only `.aiignore`.** The closest thing to a standard, but most
  repos use their own tool's file, and those rules would be ignored.
- **Let config override ignore files** (a per-entry `respectIgnore: false`).
  It would split what agents may see across two places and make a privacy
  rule easy to switch off by mistake.
- **Honor personal settings as well.** It would protect more on one
  machine, but indexes would differ between teammates and CI, and writers
  would keep overwriting each other.
- **Delete indexes that become orphaned.** It would close the leak
  automatically, but a hook that deletes files is surprising and unsafe.
  `validate` failing is enough to make someone act.

## Consequences

- The core needs a gitignore-pattern matcher, which keeps it free of
  runtime dependencies, and must read Claude Code's permission-rule path
  anchors.
- Adding a newly published agent ignore file to the built-in list doesn't
  need an ADR. Codex joins when its repo-level config is confirmed.
- Someone whose configured collection doesn't appear has to check
  `validate` or `card-catalog list` to learn that an ignore rule is the
  reason.
