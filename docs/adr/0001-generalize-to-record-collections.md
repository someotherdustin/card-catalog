---
status: proposed
date: 2026-09-27
tags: [scope, architecture, principles]
---

# Generalize from ADRs to record collections, for agents and operators alike

We'll generalize adr-index from ADRs to any collection of markdown records, described by format profiles and optional config, with one core shared by hooks, a CLI and helper skills and agents. Principle: the best way is whatever works for you, agent or operator.

## Context

adr-index keeps a grep-able `INDEX.md` next to a directory of ADRs, one line
per record, so an agent can check prior decisions without loading them all.
The same problem exists for other records that pile up in a repo: RFCs,
specs, runbooks, postmortems, glossaries. The design already generalizes.
Records are indexed after they're written, by whatever tool or person wrote
them, and every index line is a whole record.

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
this kind, and this is where the title, status and summary are".

The intended scope is broad: the plugin should support many different
agentic workflows, not one particular skill set.

## Principle

**The best way to do something is whatever works well for you, agent or
operator.** Every capability is tested against two questions: could an agent
use it, and could a person use it without an agent? Decisions below, and
later ADRs, should be checked against this.

It follows from the principle that the plugin:

- describes the records people already write rather than prescribing a
  format, and never requires rewriting records to get them indexed;
- works whoever wrote a record, whenever: an agent skill, a person in an
  editor, another tool;
- produces outputs that serve both audiences, as `INDEX.md` does today
  (an agent greps it, a person clicks through on GitHub);
- is adopted in layers, each useful without the ones above it.

## Decision

### 1. A core with no Claude Code dependency

Parsing, profile resolution, index building, validation and dry-runs live
in a plain Node library with a CLI, with no runtime dependencies (as now:
TypeScript run through Node's type stripping). Claude Code is one front-end.
Other agents, CI and people without an agent use the same core through the
CLI or a git hook.

### 2. Record collections described by format profiles

A **collection** is a directory of records of one type. A **format
profile** says how to read that type:

- `match`: which files are records;
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
- `indexPath`: where the index is written, or `none`;
- `announce`: whether SessionStart tells agents about the collection.

Profiles for known formats ship built in, with test fixtures. The first is
the current ADR behavior as a profile (mattpocock, Nygard, MADR and
adr-tools styles). Which profiles come next is a later decision.

### 3. Optional repo config; zero config keeps today's behavior

A config file maps directories to profiles and can override any part of a
profile, including a fully `custom` one:

```json
{
  "collections": [
    { "dir": "docs/adr", "format": "adr" },
    {
      "dir": "docs/postmortems",
      "format": "custom",
      "id": "{date}-{slug}",
      "status": null,
      "summary": ["frontmatter:summary", "section:Impact", "lead"],
      "fields": { "severity": "inline:Severity" }
    }
  ]
}
```

Without a config file, the plugin behaves exactly as it does now: ADRs in
`docs/adr`, `src/<context>/docs/adr` and `doc/adr`. This ADR amends the
earlier "convention, not a setting" choice for everything beyond that
default. Frontmatter (`title`, `status`, `summary`) stays the escape hatch
that indexes any file, but it's never required.

The config file's name and location are open (see Follow-ups). It shouldn't
live under `.claude/`, since the core isn't specific to Claude Code.

### 4. Three front-ends over the one core

- **Hooks** run automatically: reindex after a write, report stale indexes
  at session start.
- **The CLI** is for operators and CI: `reindex`, `dry-run`, `validate`,
  and a way to show the resolved profile for a directory.
- **Helpers** are skills and agents for conversational use.
  - **Skills** handle anything that needs a person's approval, because they
    run in the main conversation. The first candidates are `add-collection`
    (read sample files, propose a profile, show the dry-run lines, write
    the config once approved), `records-doctor` (walk through validation
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

### 5. Indexes have a single writer

Only the core writes index files, through the hooks or `reindex`. Helpers
edit records and config, then the write hook reindexes. An edit to the
config file reindexes the affected collections. The whole collection is
re-read on every run, as now, so edits made outside any agent are picked up.

### 6. The model helps at setup, never inside a hook

Hooks stay deterministic, fast, and never interrupt the session. To read an
unfamiliar format, an agent (the `add-collection` skill) proposes a
profile, which is then checked by a dry-run whose output a person approves.
Once written, the profile is plain data the hooks apply without a model.

### 7. Two plugins in the marketplace

- **Indexing:** the core, CLI and hooks. On its own it gives complete
  automatic indexing.
- **Helpers:** the skills and agents, depending on the indexing plugin.

Someone who only wants automatic indexing doesn't pay the context cost of
helper descriptions. Helpers that only a person would start set
`disable-model-invocation: true` so they stay out of the model's list.
Names are open (see Follow-ups).

### 8. Guardrails

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
- **One plugin containing everything.** Simpler to install, but every
  session pays for helper descriptions whether or not anyone uses them.
- **A database (e.g. SQLite) as the index.** Already rejected for ADRs:
  plain files are grep-able, diff-able and dependency-free at this scale.
  Nothing here changes that.

## Consequences

- The parser becomes a profile interpreter. The current ADR logic becomes
  the first profile and its tests become that profile's fixtures.
- `index.json` gets a new version carrying record type, the ID scheme and
  generic links. Version 2 indexes must still be read, as version 1 indexes
  are today.
- The frontmatter reader needs YAML block scalars (`description: >`), which
  many formats use. Today such a value is read as the literal `>`.
- `on-write.ts` stops matching only ADR filenames. It resolves the
  collection for the written path from config and profiles, and reacts to
  config edits.
- The README's "hook-only plugin" and "convention, not a setting"
  statements change once this is implemented.
- The names `adr-index` and `adr-manager` no longer fit. `adr-manager` also
  collides with the existing ADR Manager at adr.github.io.
- There's more surface to keep coherent. The Principle and Guardrails are
  the check on it.

## Follow-ups

- Config file name and location.
- Which built-in profiles ship after ADRs.
- Whether the plugin writes records for types that have no upstream skill
  producing them, or stays manage-only as it is for ADRs.
- ~~New names for the repo and the two plugins.~~ Decided 2026-10-01:
  `card-catalog` for the repo, the marketplace and the indexing plugin, and
  `card-catalog-helpers` for the helpers plugin. A library card catalog has
  one card per item and each card points to where the item is shelved,
  which is what an index line does.
- Whether to add an MCP server as a further front-end.
