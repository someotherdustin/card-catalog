# adr-manager

Companion for ADR management in agentic workflows.

ADRs written by coding agents (via `grill-with-docs` / `domain-modeling` from
[mattpocock/skills](https://github.com/mattpocock/skills)) pile up as flat
markdown files. This repo doesn't replace that write path. It adds a
hook-only Claude Code plugin, **`adr-index`**, that runs *after* an ADR is
written and keeps a compact `index.json` next to it (id, title, status,
one-line summary). An agent can check prior decisions by reading the index,
then open only the ADRs whose summaries look relevant.

## Install

```
/plugin marketplace add someotherdustin/adr-manager
/plugin install adr-index@adr-manager
```

Requires Node ≥ 22.18. The scripts are TypeScript run directly by Node's
built-in type stripping, so there's no build step and no runtime dependencies.

## What it does

Two hooks:

**At session start**, `scripts/session-start.ts` puts a compact digest of
every ADR into the agent's context. That's how the index actually gets used:

```
docs/adr/
- ADR-0003 [superseded by ADR-0009] REST over GraphQL (0003-rest-over-graphql.md)
  We picked REST because ...
- ADR-0009 [accepted] GraphQL gateway for mobile (0009-graphql-gateway.md)
  ...
```

The digest comes with a short instruction: check it before changing the same
area, open full ADRs only when a summary looks relevant, and flag conflicts
with accepted ADRs. It's built in memory from the ADR files, so it's current
after a `git pull` and never writes to the repo. It's capped at about 6,000
characters. Past that, summaries are dropped (superseded, deprecated and
rejected ADRs first, then the oldest), but every ADR keeps its title line.
A repo with no ADRs gets no output.

**After each write**, `PostToolUse` on `Write|Edit|MultiEdit` runs
`scripts/on-write.ts`:

1. Ignores the event unless the file is `docs/adr/NNNN-slug.md` (also
   `src/<context>/docs/adr/` and adr-tools' `doc/adr/`).
2. Re-parses every ADR in that directory and writes `index.json` atomically,
   and only if something changed.
3. Always exits 0. If a file can't be parsed (for example, it has no title),
   the hook keeps its previous index entry, or skips it if there isn't one,
   and logs a warning to stderr. It never interrupts the session that wrote
   the ADR.

```json
{
  "version": 2,
  "generatedBy": "adr-index",
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
  plugin 0.1), `amendedAt` is the file's last commit date. For a file git
  doesn't track yet, it's the current time.

Commit `index.json` alongside the ADRs so these timestamps carry across clones.
The session-start digest shows the date on each ADR's line.

To index ADRs that existed before the plugin was installed, or to repair an index:
`node adr-index-plugin/scripts/reindex.ts [repo-root]`.

### Parsing rules (lenient)

| Field   | Tried in order |
|---------|----------------|
| title   | `title` frontmatter → first `# ` heading (strips `1. ` / `ADR-0001:` prefixes) |
| status  | `status` frontmatter → `## Status` section → `Status:` line → `unspecified` |
| summary | `summary` frontmatter → `Summary:` line → first paragraph under the H1 → `## Decision` → `## Context` (capped at 280 chars) |
| date, tags | frontmatter or `Date:` line |

## Findings from mattpocock/skills (the brief's open items)

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
- **Storage.** The index is JSON only. SQLite isn't worth the dependency at
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
