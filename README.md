# card-catalog

A card catalog for the markdown records in your repo: one line per record,
pointing to where it's shelved.

ADRs written by coding agents (via `grill-with-docs` / `domain-modeling` from
[mattpocock/skills](https://github.com/mattpocock/skills)) pile up as flat
markdown files. card-catalog doesn't replace that write path. It's a
hook-only Claude Code plugin that runs *after* an ADR is written and keeps an
`INDEX.md` next to it: one line per ADR with its ID, status, title and a
one-line summary. An agent checks prior decisions by grepping the index, then
opens only the ADRs whose lines match.

Today it indexes ADRs only.
[ADR-0001](docs/adr/0001-generalize-to-record-collections.md) proposes
extending it to other records that pile up the same way: RFCs, specs,
runbooks, postmortems.

## Install

```
/plugin marketplace add someotherdustin/card-catalog
/plugin install card-catalog@card-catalog
```

Requires Node ≥ 22.18. The scripts are TypeScript run directly by Node's
built-in type stripping, so there's no build step and no runtime dependencies.

**Upgrading from `adr-index`.** Before 0.3.0 the plugin was `adr-index` in
the `adr-manager` marketplace. Uninstall it, then install as above. Existing
`INDEX.md` and `index.json` files keep working and pick up the new name the
next time they're written.

## What it does

Two hooks:

**At session start**, `scripts/session-start.ts` tells the agent where the
index is and how to use it. It doesn't load the ADRs themselves, so its cost
is the same for 10 ADRs or 500:

```
This repo records architecture decisions as ADRs. Each ADR directory has an INDEX.md with one line per ADR:
ID, status, date amended, title and a one-line summary.

- docs/adr/INDEX.md (67 ADRs)

Before changing an area, grep the index for its terms and open the ADRs whose lines match.
If your work would contradict an accepted ADR, say so explicitly rather than silently overriding it.
```

It rebuilds the index in memory to check whether `INDEX.md` is current. If
it isn't (for example, someone added an ADR by hand), the line says
`out of date` and the message includes the reindex command. It never writes
to the repo. A repo with no ADRs gets no output.

**After each write**, `PostToolUse` on `Write|Edit|MultiEdit` runs
`scripts/on-write.ts`:

1. Ignores the event unless the file is `docs/adr/NNNN-slug.md` or
   `docs/adr/<prefix>-NNNN-slug.md` (also `src/<context>/docs/adr/` and
   adr-tools' `doc/adr/`).
2. Re-parses every ADR in that directory and writes `INDEX.md` and
   `index.json` atomically, each only if its content changed.
3. Always exits 0. If a file can't be parsed (for example, it has no title),
   the hook keeps its previous index entry, or skips it if there isn't one,
   and logs a warning to stderr. It never interrupts the session that wrote
   the ADR.

`INDEX.md` is what agents read. One line per ADR means a grep hit returns
the whole record, where a multi-line format would return a fragment with no
ADR attached to it. Each ID links to its file, which gives agents the path
and lets people click through on GitHub:

```
- [ADR-0003](0003-rest-over-graphql.md) [superseded by ADR-0009] 2026-04-01 | REST over GraphQL | We picked REST because ...
- [ADR-0009](0009-graphql-gateway.md) [accepted] 2026-04-01 | GraphQL gateway for mobile | ...
```

It's a flat list in number order. A curated, human-facing overview (grouped
by topic, say) is left to the repo's own `docs/adr/README.md`; the plugin
doesn't generate or check one.

`index.json` is the plugin's own state: the same fields plus a content hash
and amendment time per ADR. Agents aren't pointed at it. It's written one ADR
per line so git diffs stay readable; expanded, an entry looks like this:

```json
{
  "version": 2,
  "generatedBy": "card-catalog",
  "adrs": [
    {
      "id": 3,
      "slug": "rest-over-graphql",
      "title": "REST over GraphQL",
      "status": "superseded",
      "supersededBy": 9,
      "summary": "We picked REST because ...",
      "file": "0003-rest-over-graphql.md",
      "contentHash": "9f2c4e1ab07d3355",
      "amendedAt": "2026-04-01T12:00:00.000Z"
    }
  ]
}
```

`amendedAt` is when the ADR's content last changed. If the ADR was never
amended, it's the creation time. It's based on a content hash, not the file's
modification time, because git resets modification times on checkout, which
would make every ADR look freshly amended in every clone. So:

- If the content hash matches the previous index entry, `amendedAt` stays the
  same. Line-ending and trailing-whitespace changes don't count.
- If the hash differs, `amendedAt` becomes the current time.
- If the index has no hash for the file yet (a backfill, or an index from
  `adr-index` 0.1), `amendedAt` is the file's last commit date. For a file git
  doesn't track yet, it's the current time.

Commit `INDEX.md` and `index.json` alongside the ADRs so these timestamps
carry across clones. `INDEX.md` shows the date on each ADR's line.

To index ADRs that existed before the plugin was installed, or to repair an
index, run `reindex.ts [repo-root]` from the plugin's `scripts/` directory.
You don't need to find it yourself: when an index is out of date, the
session-start message includes the full command. In a clone of this repo,
`npm run reindex` does the same.

### Parsing rules (lenient)

A blockquote right under the title is treated as an editorial note added
later (`> **Annotation — 2026-09-23:** …`, `> **Confirmed …**`,
`> **Superseded by ADR-0005.** …`), so it's used as the summary only when
nothing else is available.

| Field   | Tried in order |
|---------|----------------|
| title   | `title` frontmatter → first `# ` heading (strips `1. ` / `ADR-0001:` prefixes) |
| status  | `status` frontmatter → `## Status` section → `Status:` line → `unspecified` |
| summary | `summary` frontmatter → `Summary:` line → first non-blockquote paragraph under the H1 → `## Decision` → `## Context` → a blockquote under the H1 (capped at 280 chars) |
| date, tags | frontmatter or `Date:` line |

### Prefixed series

A directory can hold more than one numbered series, such as ADRs imported
from another repo as `hub-0023-slug.md` next to the local `0023-slug.md`.
Numbers are unique only within a series, so a prefixed ADR's index entry
carries `"prefix": "hub"`, and `INDEX.md` shows it as `hub-0023` rather than
`ADR-0023`. The main sequence sorts first, then each series.

A superseded status names its replacement in `supersededBy` (the number) and
`supersededByPrefix` (the series, when there is one). A link to the
replacing ADR's file decides which series it is in:
`superseded by [ADR-0042](hub-0042-tls.md)` is hub-0042, and
`superseded by [Mesa ADR-0014](0014-mesa.md)` is ADR-0014. Without a link,
an explicit `hub-0042` in the text counts, and a bare `ADR-0042` means the
same series as the ADR being parsed, because that's how an imported series
referred to itself.

## How it fits mattpocock/skills

- **ADR directory is a convention, not a setting.** `setup-matt-pocock-skills`
  doesn't ask for an ADR path. It writes `docs/agents/domain.md`, which
  describes a fixed layout: `docs/adr/`, plus `src/<context>/docs/adr/` in
  multi-context repos. So the plugin matches that layout instead of reading
  a config file.
- **Template format.** `domain-modeling/ADR-FORMAT.md` specifies
  `# {title}` followed by a 1–3 sentence paragraph ("context, what we
  decided, and why"). `status` frontmatter and the Considered Options and
  Consequences sections are optional.
- **Summary line.** That lead paragraph already works as a summary, so the
  plugin doesn't need an upstream change or a local override. A `summary:`
  frontmatter key is honored if someone adds one.
- **Storage.** Two plain files: `INDEX.md` for agents and `index.json` for
  the plugin's bookkeeping. SQLite isn't worth the dependency at
  ADR-collection scale.

## Development

Dev tooling lives at the repo root. The plugin itself has no dependencies.

```
npm install        # also installs the git pre-commit hook (husky)
npm run lint       # ESLint, typescript-eslint strict-type-checked + stylistic, zero warnings allowed
npm run typecheck  # tsc --noEmit, strict plus noUncheckedIndexedAccess, exactOptionalPropertyTypes, etc.
npm test           # node:test
npm run check      # all three
```

The pre-commit hook runs `lint` and `typecheck` on the whole project and
rejects the commit if either fails. `git commit --no-verify` skips it, so
CI (`.github/workflows/ci.yml`) runs lint, typecheck and tests on every PR and
push to `main`, on Node 22.18 (the minimum), latest 22 and 24. To block
merges on it, add a branch ruleset for `main` that requires the
`check (node 22.18)`, `check (node 22)` and `check (node 24)` status checks.
