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

`PostToolUse` on `Write|Edit|MultiEdit` → `scripts/on-write.ts`:

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
  "version": 1,
  "generatedBy": "adr-index",
  "adrs": [
    {
      "id": 3,
      "slug": "rest-over-graphql",
      "title": "REST over GraphQL",
      "status": "superseded",
      "supersededBy": 9,
      "summary": "We picked REST because ...",
      "file": "0003-rest-over-graphql.md"
    }
  ]
}
```

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

```
cd adr-index-plugin
npm install        # typescript + @types/node for typecheck only
npm test           # node:test
npm run typecheck
```
