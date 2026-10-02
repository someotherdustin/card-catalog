# card-catalog

A card catalog for the markdown records in your repo: one line per record,
pointing to where it's shelved.

ADRs written by coding agents (via `grill-with-docs` / `domain-modeling` from
[mattpocock/skills](https://github.com/mattpocock/skills)) pile up as flat
markdown files, and so do RFCs, runbooks and postmortems. card-catalog
doesn't replace whatever writes them. It runs *after* a record is written
and keeps an `INDEX.md` next to each collection of records: one line per
record with its label, status, title and a one-line summary. An agent
checks prior records by grepping the index, then opens only the ones whose
lines match.

With no configuration it indexes every `docs/adr` and `doc/adr` directory
as ADRs. An optional `card-catalog.json` adds other collections and says how
to read them.
[ADR-0001](docs/adr/0001-generalize-to-record-collections.md) records why,
and the [specs](docs/specs/README.md) define the config, profiles, index
format, hooks, CLI and checks exactly.

## Install

```
/plugin marketplace add someotherdustin/card-catalog
/plugin install card-catalog@card-catalog
```

Requires Node ≥ 22.18. The plugin's scripts are TypeScript run directly by
Node's built-in type stripping, so there's no build step and no runtime
dependencies.

For help in a conversation, also install the helpers, which bring the
matching `card-catalog` plugin with them:

```
/plugin install card-catalog-helpers@card-catalog
```

- **`add-collection`** (skill) proposes a `card-catalog.json` entry for a
  directory of records, checks it with `preview`, and writes it once you
  approve.
- **`records-doctor`** (skill) walks through what `validate` reports and
  fixes it with your approval. It never deletes files.
- **`precedent-finder`** (agent) finds the records a planned change touches
  or contradicts, and answers with a short list, so your conversation
  doesn't load the records.

They're a separate plugin so a session that only wants indexing doesn't
carry their descriptions. See [helpers.md](docs/specs/helpers.md).

Without Claude Code, or in CI, use the CLI from npm. The package is
`@someotherdustin/card-catalog`, and the command it installs is
`card-catalog`:

```
npx @someotherdustin/card-catalog list
```

**Upgrading from `adr-index`.** Before 0.3.0 the plugin was `adr-index` in
the `adr-manager` marketplace. Uninstall it, then install as above. Existing
`INDEX.md` and `index.json` files keep working and pick up the new name the
next time they're written.

**Upgrading to 0.4.0.** Each `index.json` is rewritten once as version 3,
and the `INDEX.md` header says `label` where it said `ID`. ADR index lines
are otherwise unchanged, except that frontmatter links such as
`relates-to:` now show as `key=value` pairs. Run `card-catalog reindex` once
and commit the result.

## What it does

Two hooks:

**At session start**, `scripts/session-start.ts` tells the agent where each
index is and how to use it. It doesn't load the records themselves, so its
cost is the same for 10 records or 500:

```
This repo records architecture decisions as ADRs. Each collection below has an index with one line per ADR:
label, status, date amended, title and a one-line summary.

- docs/adr/INDEX.md (67 ADRs)

Before changing an area, grep the index for its terms and open the ADRs whose lines match.
If your work would contradict an accepted ADR, say so explicitly rather than silently overriding it.
The card-catalog CLI is node "<plugin>/scripts/cli.ts" (list, preview, profile, validate; add --help).
```

It rebuilds each index in memory to check whether the one on disk is
current. If it isn't (for example, someone added an ADR by hand), the line
says `out of date` and the message includes the reindex command. It never
writes to the repo. A repo with no records gets no output.

**After each write**, `PostToolUse` on `Write|Edit|MultiEdit` runs
`scripts/on-write.ts`:

1. If the file is a record in a collection, it re-reads every record in that
   collection and writes `INDEX.md` and `index.json` atomically, each only
   if its content changed.
2. If the file is `card-catalog.json`, `.claude/settings.json`, any
   `.gitignore` or an agent ignore file, it reindexes every collection,
   since what's a collection may have changed.
3. Anything else is left alone. It always exits 0. A record that can't be
   parsed (no title, say) keeps its previous index line, and the problem is
   logged to stderr. It never interrupts the session that wrote the record.

`INDEX.md` is what agents read. One line per record means a grep hit returns
the whole record, where a multi-line format would return a fragment with no
record attached to it. Each label links to its file, which gives agents the
path and lets people click through on GitHub:

```
- [ADR-0003](0003-rest-over-graphql.md) [superseded by ADR-0009] 2026-04-01 | REST over GraphQL | We picked REST because ...
- [ADR-0009](0009-graphql-gateway.md) [accepted] 2026-04-01 relates-to=ADR-0003 | GraphQL gateway for mobile | ...
```

It's a flat list in ID order. A curated, human-facing overview (grouped by
topic, say) is left to the repo's own `docs/adr/README.md`; card-catalog
doesn't generate or check one.

`index.json` is card-catalog's own state: the same records plus a content
hash and amendment time each, one record per line so git diffs stay
readable. Agents aren't pointed at it.
[index-format.md](docs/specs/index-format.md) specifies both files.

`amendedAt` is when a record's content last changed. It's based on a content
hash, not the file's modification time, because git resets modification
times on checkout, which would make every record look freshly amended in
every clone. An unchanged hash keeps the date; a new one moves it to now; a
record the index has never hashed gets its last commit date. Commit
`INDEX.md` and `index.json` alongside the records so the dates carry across
clones.

### Ignored paths

Records under paths that git, an agent ignore file (`.aiignore`,
`.cursorignore` and the like) or a `Read(...)` deny rule in the committed
`.claude/settings.json` hides are never indexed or announced, even if config
lists them, since an index would leak their titles and summaries.
[ADR-0002](docs/adr/0002-never-index-ignored-paths.md) has the reasoning and
[ignored-paths.md](docs/specs/ignored-paths.md) the details.

## Other collections

Any directory of markdown records can be a collection. Name its record type
in `card-catalog.json` at the repo root, and say where to find whatever the
type's generic defaults don't:

```json
{
  "collections": [
    { "dir": "src/*/docs/adr", "type": "adr" },
    {
      "dir": "docs/postmortems",
      "type": "postmortem",
      "id": "{date}-{slug}",
      "summary": ["frontmatter:summary", "section:Impact", "lead"],
      "fields": { "severity": "inline:Severity" },
      "guidance": "Check for a postmortem before changing an area that has failed before."
    }
  ]
}
```

The defaults still apply alongside config, so adding postmortems doesn't
stop ADR indexing. Each record type has one **profile**: which files are
records, and where each one's ID, title, status, summary, links and extra
fields come from, as ordered lists of sources to try. The built-in `adr`
profile reads mattpocock/skills, Nygard, MADR and adr-tools ADRs.
[config.md](docs/specs/config.md) and [profiles.md](docs/specs/profiles.md)
cover every option, and `card-catalog.schema.json` lets editors check the
file as you type.

Try a profile before writing it into config:

```
card-catalog preview docs/postmortems --entry '{"type":"postmortem","id":"{date}-{slug}"}'
```

## CLI

```
card-catalog list                 collections, directories that aren't one and why, orphaned indexes
card-catalog reindex [<dir>…]     rebuild and write indexes
card-catalog preview <dir>        the index a directory would get, without writing
card-catalog profile <dir>        the resolved profile, and where each value comes from
card-catalog validate [--strict]  check config, records and indexes
```

Every command takes `--json` and `--root <dir>`. Inside the plugin it's
`node <plugin>/scripts/cli.ts`, and the session-start message gives the
full path. [cli.md](docs/specs/cli.md) has the output formats and exit
codes, and [validate.md](docs/specs/validate.md) every check.

To keep indexes honest in a repo, run `validate` from a pre-commit hook or
CI. It fails on a stale or missing index, an orphaned index and broken
config:

```
npx @someotherdustin/card-catalog validate
```

card-catalog doesn't install git hooks itself, since that would mean
choosing a hook manager for your repo.

## How it fits mattpocock/skills

- **ADR directory.** `setup-matt-pocock-skills` doesn't ask for an ADR
  path. It writes `docs/agents/domain.md`, which describes a fixed layout:
  `docs/adr/`, plus `src/<context>/docs/adr/` in multi-context repos.
  card-catalog finds that layout with no config.
- **Template format.** `domain-modeling/ADR-FORMAT.md` specifies
  `# {title}` followed by a 1–3 sentence paragraph ("context, what we
  decided, and why"). `status` frontmatter and the Considered Options and
  Consequences sections are optional.
- **Summary line.** That lead paragraph already works as a summary, so no
  upstream change or local override is needed. A `summary:` frontmatter key
  is honored if someone adds one.
- **Storage.** Two plain files per collection: `INDEX.md` for agents and
  `index.json` for card-catalog's bookkeeping. SQLite isn't worth the
  dependency at this scale.

## Development

Dev tooling lives at the repo root. The plugin itself has no dependencies.

```
npm install        # also installs the git pre-commit hook (husky)
npm run lint       # ESLint, typescript-eslint strict-type-checked + stylistic, zero warnings allowed
npm run typecheck  # tsc --noEmit, strict plus noUncheckedIndexedAccess, exactOptionalPropertyTypes, etc.
npm test           # node:test
npm run check      # all three
npm run reindex    # reindex this repo's own ADRs
npm run build:npm  # compile the core and CLI into npm/ for publishing
```

The core lives in `card-catalog-plugin/scripts/core/`, with no Claude Code
dependency. The hooks and `scripts/cli.ts` are thin front-ends over it. The
helpers live in `card-catalog-helpers/`: two skills, an agent, and
`scripts/find-cli.ts`, which finds a CLI at the pinned version.

The helpers' `claude plugin eval` suite costs API calls, so it isn't part of
`npm test`. Run it before a release that changes the helpers, by hand or
from the **Helper evals** workflow. The workflow authenticates to the Claude
API through workload identity federation, with no API key secret: a Claude
Console federation rule lets that workflow on `main` exchange its GitHub
OIDC token for a short-lived token. See
[its README](card-catalog-helpers/evals/README.md).

The pre-commit hook runs `lint` and `typecheck` on the whole project and
rejects the commit if either fails. `git commit --no-verify` skips it, so
CI (`.github/workflows/ci.yml`) runs lint, typecheck and tests on every PR and
push to `main`, on Node 22.18 (the minimum), latest 22 and 24, then builds
the npm package and validates this repo's own indexes. To block merges on
it, add a branch ruleset for `main` that requires the `check (node 22.18)`,
`check (node 22)` and `check (node 24)` status checks.

Pushing a `v*` tag runs `.github/workflows/release.yml`. It checks that the
tag, `npm/package.json`, both plugin manifests, the helpers' pin on
`card-catalog` and the CLI agree on the version, compiles, and publishes
`npm/` with npm provenance. Then it tags `card-catalog--v<version>` and
`card-catalog-helpers--v<version>`, which Claude Code resolves the helpers'
dependency against. It
authenticates through npm trusted publishing, so there's no token to keep:
the package's npm settings name this repo and `release.yml` as its trusted
publisher.
