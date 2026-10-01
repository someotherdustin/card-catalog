---
status: accepted
date: 2026-09-27
tags: [scope, architecture, principles]
---

# Generalize from ADRs to record collections, for agents and operators alike

We'll generalize card-catalog from ADRs to any collection of markdown records, described by per-type profiles and an optional repo config, with one core shared by hooks, a CLI and helper skills and agents. Principle: the best way is whatever works for you, agent or operator.

## Context

card-catalog (then called adr-index) keeps a grep-able `INDEX.md` next to a
directory of ADRs, one line per record, so an agent can check prior
decisions without loading them all. The same problem exists for other
records that pile up in a repo: RFCs, specs, runbooks, postmortems,
glossaries. The design already generalizes. Records are indexed after
they're written, by whatever tool or person wrote them, and every index line
is a whole record.

What doesn't generalize is hard-coded in the parser and the index store:

- **ID scheme.** Filenames must be `NNNN-slug.md`. Postmortems are usually
  keyed by date and runbooks by slug.
- **Status vocabulary.** proposed / accepted / rejected / deprecated /
  superseded is specific to ADRs. RFCs use other states, and runbooks have no
  status at all.
- **Where records live and what to extract.** The ADR directories
  (`docs/adr`, `doc/adr`) and the section names used for summaries
  (`## Decision`, `## Context`) are fixed.
- **No configuration.** The README records the choice to follow the
  mattpocock/skills layout rather than read a config file. That was right
  for ADRs alone. It rules out formats the plugin doesn't already know.

Formats nobody has seen before are the hard case. A lenient parser can only
guess so far, so somebody has to be able to say "these files are records of
this type, and this is where the title, status and summary are".

The intended scope is broad: the plugin should support many different
agentic workflows, not one particular skill set.

## Principle

**The best way to do something is whatever works well for you, agent or
operator.** Every capability is tested against two questions: could an agent
use it, and could a person use it without an agent? Decisions below, and
later ADRs, should be checked against this.

It follows from the principle that card-catalog:

- describes the records people already write rather than prescribing a
  format, and never requires rewriting records to get them indexed;
- works whoever wrote a record, whenever: an agent skill, a person in an
  editor, another tool;
- produces outputs that serve both audiences, as `INDEX.md` does today
  (an agent greps it, a person clicks through on GitHub);
- is adopted in layers, each useful without the ones above it.

## Decision

### 1. A core with no Claude Code dependency

Parsing, profile resolution, index building, validation and previews live
in a plain Node library with a CLI, with no runtime dependencies (as now:
TypeScript run through Node's type stripping). Claude Code is one front-end.
Other agents, CI and people without an agent use the same core through the
CLI.

### 2. Collections of one record type, each read by one profile

A **collection** is a directory of records of one **record type**, such as
ADR or postmortem. Each record type has exactly one **profile**, which says
how to read its records:

- `match`: which files are records, as a glob relative to the collection
  directory. The default is `*.md`; `**/*.md` or `*/README.md` reach into
  subdirectories;
- `id`: where the ID comes from (a number in the filename, a date, the slug,
  the directory name, or a frontmatter field);
- `title`, `summary`: ordered sources to try, e.g.
  `["frontmatter:summary", "inline:Summary", "lead", "section:Decision"]`
  (the current fallback chains, written as data);
- `status`: a map from raw values to the type's vocabulary, or `null` for
  types with no lifecycle;
- `links`: relationship fields such as supersedes, superseded-by,
  implements, relates-to (generalizing today's superseded-by parsing);
- `fields`: extra values to index, e.g. a postmortem's severity;
- `label`: how an index line names a record, defaulting to `<Type> <id>`;
- `guidance`: an optional sentence the session-start message adds for this
  type;
- `indexPath`: where the index is written, or `none`;
- `announce`: whether SessionStart tells agents about the collection.

> **Amended 2026-10-01:** `indexPath` and `announce` are collection
> settings, not profile fields, and a collection can add to its profile's
> `exclude`. Collections of one type can then differ in where their index
> goes, whether they're announced and which local files they skip, while
> the type keeps exactly one profile.
> [docs/specs/config.md](../specs/config.md#collection-settings) has the details.

Styles of one type don't need profiles of their own: the `adr` profile reads
mattpocock, Nygard, MADR and adr-tools ADRs through its fallback chains.
When collections nest, a record belongs to the innermost one.

The `adr` profile ships built in, with the current tests as its fixtures.
Further built-in profiles are added when a real collection needs one, with
fixtures from it, and don't need an ADR.

### 3. Optional repo config that extends the defaults

An optional `card-catalog.json` at the repo root lists collections. It is
JSON, with a published JSON Schema for editor validation, and directories
may be globs. Each entry names a `type`: a built-in type name uses the
shipped profile, with any fields given alongside it overriding parts of it,
and any other name defines a new record type, which must give its own
fields.

```json
{
  "$schema": "https://…/card-catalog.schema.json",
  "collections": [
    { "dir": "src/*/docs/adr", "type": "adr" },
    {
      "dir": "docs/postmortems",
      "type": "postmortem",
      "id": "{date}-{slug}",
      "status": null,
      "summary": ["frontmatter:summary", "section:Impact", "lead"],
      "fields": { "severity": "inline:Severity" }
    }
  ]
}
```

Config **extends** the defaults rather than replacing them. Without a config
file, card-catalog behaves exactly as it does now: any `docs/adr` or
`doc/adr` directory is a default collection of ADRs. With one, the defaults
still apply. An entry for a directory the defaults cover overrides the
default for that directory, and `"defaults": false` turns the defaults off.
Adding a second collection never stops the first from being indexed.

This ADR amends the earlier "convention, not a setting" choice for
everything beyond that default. Frontmatter (`title`, `status`, `summary`)
stays the escape hatch that indexes any file, but it's never required.

The write hook finds the config by walking up from the written file to the
git root, and reads it on every run. It's one small file, so there is no
cache until a benchmark shows one is needed.

### 4. Three front-ends over the one core

- **Hooks** run automatically: reindex after a write, point agents at
  announced collections and report stale indexes at session start.
- **The CLI** is for operators and CI: `list`, `reindex`, `preview` (the
  index lines a directory would get, without writing), `profile` (the
  resolved profile for a directory) and `validate`. Every command takes
  `--json`. The README documents running `validate` from pre-commit and CI;
  card-catalog doesn't install git hooks itself, since that would mean
  choosing a hook manager for the repo.
- **Helpers** are skills and agents for conversational use.
  - **Skills** handle anything that needs a person's approval, because they
    run in the main conversation. The first candidates are `add-collection`
    (read sample files, propose a profile, show the `preview` lines, write
    the config once approved), `records-doctor` (walk through `validate`
    problems and offer fixes) and `supersede` (update both sides of a
    supersede link).
  - **Agents** handle work that reads many records, in their own context
    with read-only tools, and return conclusions. The first candidates are
    `precedent-finder` (given a planned change, find the relevant records
    and conflicts) and `collection-auditor` (contradictions, duplicates,
    broken supersede chains, records whose referenced code has changed).

Every helper is a thin layer over the CLI. None of them restates parsing
rules in prose, and anything a helper does has a non-conversational route:
the config schema is documented so it can be written by hand, and
`validate` runs the doctor's checks in pre-commit or CI.

The core is published to npm as `card-catalog`, at the same version as the
plugin, so operators and CI in any repo can run `npx card-catalog`. The
plugin bundles its own copy, so hooks never need the network. A Claude Code
plugin can't locate another plugin's files, so helpers call
`npx card-catalog`, falling back to the local CLI path that the session-start
message gives.

> **Amended 2026-10-01:** Node doesn't strip types from files under
> `node_modules`, so the npm package is the core and CLI compiled to
> JavaScript when a version tag is pushed. Compiled output is never
> committed, and the plugin and the repo still have no build step.

### 5. Indexes have a single writer

Only the core writes index files, through the hooks or `reindex`. Helpers
edit records and config, then the write hook reindexes. Any edit to
`card-catalog.json` reindexes every collection it describes. The whole
collection is re-read on every run, as now, so edits made outside any agent
are picked up.

card-catalog never deletes files. When a directory stops being a collection,
its index is left in place as an **orphaned index**, which `validate` and the
session-start message report so an operator can remove it.

### 6. The model helps at setup, never inside a hook

Hooks stay deterministic, fast, and never interrupt the session. To read an
unfamiliar format, an agent (the `add-collection` skill) proposes a
profile, which is then checked by a `preview` whose output a person approves.
Once written, the profile is plain data the hooks apply without a model.

### 7. Two plugins in the marketplace

- **`card-catalog`:** the core, CLI and hooks. On its own it gives complete
  automatic indexing.
- **`card-catalog-helpers`:** the skills and agents, declaring
  `card-catalog` in its `dependencies` so installing it installs the core.

Someone who only wants automatic indexing doesn't pay the context cost of
helper descriptions. Helpers that only a person would start set
`disable-model-invocation: true` so they stay out of the model's list.

### 8. Index records, never create them

card-catalog reads and indexes records that people and other tools write. It
doesn't create records or ship templates for any record type, since a
template prescribes a format. A scaffolding tool would need its own ADR.

### 9. Ignored paths are never indexed

Records under paths excluded by git or by an agent ignore file are never
indexed or announced, and an index depends only on files committed to the
repo. [ADR-0002](0002-never-index-ignored-paths.md) records this policy.

### 10. Guardrails

- Flexibility lives in profiles and config, never in code paths for
  particular workflows.
- The zero-config ADR experience must stay at least as good as it is today.
- Every new output meets the two-audience bar in the Principle.

## Considered Options

- **Stay ADR-only.** Simplest, but leaves the same problem unsolved for
  every other record type, and doesn't fit the intended scope.
- **Add more built-in formats, still without config.** Covers popular
  formats but never unfamiliar ones, which is the hard case.
- **Use a model inside the hook to parse unknown formats.** Handles
  anything in principle, but is nondeterministic, slow, costs tokens on
  every write, and can fail in ways that interrupt the session. Rejected in
  favor of using the model once, at setup, to produce a profile.
- **Require frontmatter on every record.** Deterministic and simple, but it
  prescribes a format and makes people rewrite existing records. Kept as an
  optional escape hatch.
- **A config file in each collection directory.** The hook would find it
  next to the written file, but nothing would give an overview of the
  collections, and a `src/*/docs/adr` layout would need one copy per
  directory.
- **Config that replaces the defaults.** More explicit, but adding a
  postmortems collection would silently stop ADR indexing.
- **Helpers bundling their own copy of the core.** Two copies drift apart,
  and it undercuts the single writer.
- **One plugin containing everything.** Simpler to install, but every
  session pays for helper descriptions whether or not anyone uses them.
- **An MCP server as a further front-end.** Deferred. It would serve agents
  that can't run commands, but it's a long-running process and more surface,
  while files and the CLI already serve any agent that can. Revisit when an
  agent that needs it shows up.
- **A database (e.g. SQLite) as the index.** Already rejected for ADRs:
  plain files are grep-able, diff-able and dependency-free at this scale.
  Nothing here changes that.

## Consequences

- The parser becomes a profile interpreter. The current ADR logic becomes
  the `adr` profile and its tests become that profile's fixtures.
- `index.json` moves to version 3: the record type once at the top,
  `records` with string IDs, and generic `links` and `fields`. Version 1 and
  2 indexes are still read, and are rewritten as version 3 on their next
  write, so every existing ADR `index.json` changes once.
- Index lines gain a per-type label, omit status for types without one, and
  carry extra fields and links as grep-able `key=value` pairs. ADR lines keep
  their current shape. The README specifies the format.
- The frontmatter reader needs YAML block scalars (`description: >`), which
  many formats use. Today such a value is read as the literal `>`.
- `on-write.ts` stops matching only ADR filenames. It resolves the
  collection for the written path from config and profiles, and reacts to
  config edits.
- The README's "hook-only plugin" and "convention, not a setting"
  statements change once this is implemented.
- Releases publish to npm as well as the marketplace, at one shared version.
- There's more surface to keep coherent. The Principle and Guardrails are
  the check on it.
