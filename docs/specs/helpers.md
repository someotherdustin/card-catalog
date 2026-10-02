# Helpers

Helpers are the skills and agents that use card-catalog in a conversation.
They ship in a second plugin, `card-catalog-helpers`, so someone who only
wants automatic indexing doesn't pay for their descriptions in every
session. See [ADR-0001](../adr/0001-generalize-to-record-collections.md)
§4 and §7.

Every helper is a thin layer over the [CLI](cli.md). None of them restates
how records are parsed, and anything a helper does can be done without one:
config can be written by hand against the
[JSON Schema](config.md#json-schema), and `validate` runs the doctor's
checks in pre-commit or CI. Helpers never write index files. They edit
records and config, and the [write hook](hooks.md#write-hook) or
`reindex` does the rest.

| Helper | Kind | Started by | Job |
|--------|------|------------|-----|
| [`add-collection`](#add-collection) | skill | a person or the model | Propose, check and write a config entry for a collection |
| [`records-doctor`](#records-doctor) | skill | a person or the model | Walk through `validate` problems and fix them with approval |
| [`precedent-finder`](#precedent-finder) | agent | the model | Find the records a planned change touches, and any it contradicts |

`supersede` and `collection-auditor`, which ADR-0001 also lists, aren't
built yet. They wait until real use shows what they need.

## The plugin

```
card-catalog-helpers/
  .claude-plugin/plugin.json
  package.json
  scripts/find-cli.ts
  skills/add-collection/SKILL.md
  skills/records-doctor/SKILL.md
  agents/precedent-finder.md
  evals/
  test/
```

`plugin.json` carries the same version as the core plugin and pins it
exactly:

```json
{
  "name": "card-catalog-helpers",
  "version": "0.5.0",
  "dependencies": [{ "name": "card-catalog", "version": "=0.5.0" }]
}
```

Installing the helpers installs the matching core plugin. The marketplace
lists `card-catalog-helpers` next to `card-catalog`, with
`./card-catalog-helpers` as its source.

Like the core plugin, the helpers plugin runs TypeScript with Node's type
stripping and has no build step.

## Finding the CLI

A plugin can't locate another plugin's files, so the skills find the CLI
with a script in their own plugin:

```
node "${CLAUDE_PLUGIN_ROOT}/scripts/find-cli.ts" [<cli>]
```

`<cli>` is the path from the session-start message's CLI line
(`The card-catalog CLI is node "<cli>"`), when the conversation has one.
The script reads the required version from the helpers plugin's own
`plugin.json`, then tries each source in order:

1. `node "<cli>"`, when `<cli>` was given and the file exists.
2. `npx -y @someotherdustin/card-catalog@<version>`.
3. `card-catalog` on `PATH`.

A source is used when its `--version` prints exactly the required version
within the time limit: 60 seconds for `npx`, which may download the
package, and 10 seconds for the others. The script prints the first usable
command on stdout, ready to have a CLI command appended, and exits 0:

```
npx -y @someotherdustin/card-catalog@0.5.0
```

When no source works, it prints nothing on stdout and exits 1. On stderr it
names each source tried and why it was rejected (`not given`, `not found`,
`timed out`, `exited with code 1`, `version 0.4.0, need 0.5.0`), then how to
get the CLI:
`npm install -g @someotherdustin/card-catalog@<version>`. A skill shows
that message and stops.

A skill calls the script once and uses the command for the rest of its run.

## `add-collection`

Sets up a new collection, or changes how an existing one is read, by
proposing a config entry and checking it with `preview` before anything is
written. It's how the model helps at setup without ever running inside a
hook (ADR-0001 §6).

1. **Find the CLI**, as above.
2. **Find the directory and type** from the request. `list --json` shows
   whether the directory is already a collection. If it is, the skill is
   changing that collection's entry, and `profile <dir> --json` shows what
   it resolves to now and where each value comes from. If the directory is
   ignored, the skill names the ignore source and stops
   ([ADR-0002](../adr/0002-never-index-ignored-paths.md)).
3. **Read samples.** 3–5 files that `preview` would read, spread across the
   collection: the first and last in name order, one from the middle, and
   any whose name or shape looks different from the rest.
4. **Prefer a built-in type.** If a built-in type fits (`types --json`
   lists them), the skill tries it first with `preview <dir> --type <type>
   --json`. When every sample is read as a record with a title and summary,
   the proposed entry is just `{ "dir", "type" }`.
5. **Otherwise propose an entry**, with only the fields that differ from
   the built-in type or the generic defaults, and run
   `preview <dir> --entry <json> --json`.
6. **Show the result**: the proposed entry, the index lines `preview`
   produced (all of them when there are 20 or fewer, otherwise the first
   10 and the skipped files), and every skipped file with its reason. The
   person approves, asks for changes, or stops. A change goes back to
   step 5.
7. **Write the config** once the person has approved that exact entry. It
   adds the entry to `card-catalog.json`, or replaces the existing one,
   creating the file with [`$schema`](config.md#json-schema) when there
   isn't one. The write uses
   the file-editing tools, never the shell, so the write hook reindexes
   every collection.
8. **Validate.** It runs `validate --json` and shows the problems in this
   collection's directory, if any, offering `records-doctor` for them.

`add-collection` never writes records, never writes index files, and never
writes config the person hasn't seen and approved in the form shown.

## `records-doctor`

Walks through the problems `validate` reports and fixes them, with the
person approving each fix. Without the skill, the same problems show up in
`validate` output in pre-commit or CI, with the fixes in
[validate.md](validate.md#fixes).

1. **Find the CLI** and run `validate --json`. With no problems, it says so
   and stops.
2. **Group the problems by code**, errors first, then warnings. Notes are
   listed in one line each and fixed only when the person asks. Config
   errors come first of all, since `validate` runs no other checks until
   the config is valid.
3. **For each group**, it says in a sentence what's wrong and proposes a
   fix for each problem. The person approves the group, approves some of
   its problems, or skips it.
4. **Apply approved fixes:**
   - A card-catalog command, such as `reindex <dir>` for a stale or missing
     index, is run through the CLI.
   - An edit to a record, `card-catalog.json` or an ignore file is shown
     first and made with the file-editing tools. Edits to records change
     as little as possible and keep the record's own format; the doctor
     doesn't add frontmatter to a record that has none.
   - A rename, such as for `duplicate-id`, is proposed with the link edits
     it needs, made with `git mv` once approved, and followed by `reindex`,
     because the write hook doesn't see shell commands.
   - An orphaned index is never deleted. The doctor shows the command that
     would delete it (`git rm <path>`, plus its `index.json` when that's
     orphaned too) for the person to run, or offers to make its directory a
     collection again with `add-collection`.
   - `newer-index` means this card-catalog is older than the one that wrote
     the index. The doctor says to update the plugin and changes nothing.
5. **Re-run `validate`** and report what's left.

The doctor never writes index files except through `reindex`, never deletes
a file, and never makes an edit the person hasn't approved.

## `precedent-finder`

A read-only agent. Given a planned change, it finds the records that bear on
it and any it would contradict, and returns conclusions rather than record
contents, so the conversation that started it doesn't load the records.

```yaml
name: precedent-finder
tools: Read, Grep, Glob
model: inherit
```

Its description tells whoever starts it to pass the planned change and the
index paths from the session-start message's collection lines. A subagent
doesn't see that message itself.

1. **Find the indexes.** It uses the paths it was given. Without them, it
   greps markdown files for the line every card-catalog index carries
   (`Generated by the card-catalog plugin from`, see
   [index-format.md](index-format.md#header)), and says in its answer that
   the indexes were found by search, so one may be orphaned.
2. **Shortlist.** It greps the indexes for the change's terms, including
   likely synonyms, and shortlists the matching lines.
3. **Confirm.** It reads only the shortlisted records to decide whether
   each one is relevant, and whether the change would contradict it. A
   record whose status shows it was superseded is followed to the record
   that replaced it, which is judged instead.
4. **Answer** in this form:

```
Searched: docs/adr/INDEX.md, docs/postmortems/INDEX.md

Conflicts:
- ADR-0009 [accepted] docs/adr/0009-graphql-gateway.md: the change adds a REST endpoint for mobile, which this routes through the gateway.

Relevant:
- Postmortem 2026-09-14-db-outage docs/postmortems/2026-09-14-db-outage.md: the same connection pool failed under load.
- ADR-0012 [accepted] docs/adr/0012-cache.md: replaces ADR-0004; sets the cache TTLs the change relies on.
```

Each record is listed with its label, status (for a type with one), path,
and a one-line reason. Conflicts and relevant records together are capped
at about 10, most important first. A replaced record isn't listed on its
own; its replacement notes what it replaces. When nothing is relevant, the
answer says `Nothing relevant in` and the indexes searched.

It never edits anything, and it has no shell, so it can't run the CLI.

## Releases

The npm package, both plugins and the helpers' dependency pin carry one
version. A release is still one pushed `v<version>` tag, and the release
workflow:

1. checks that the tag, `npm/package.json`, both `plugin.json` files, the
   helpers' pin on `card-catalog` and the CLI's `--version` all carry the
   same version;
2. runs the checks, builds and publishes to npm, as in
   [cli.md](cli.md);
3. then tags `card-catalog--v<version>` and
   `card-catalog-helpers--v<version>` and pushes them. Claude Code resolves
   plugin dependencies against tags named this way.

The plugin tags come after the npm publish, so the helpers never pin an npm
version that isn't published. If any step fails, no plugin tag is pushed.
Releases before 0.5.0 have only a `v<version>` tag.

## Testing

- `find-cli.ts` has `node:test` tests in `card-catalog-helpers/test/`, run
  by `npm test` with the rest of the repo.
- The skills and the agent have `claude plugin eval` suites in
  `card-catalog-helpers/evals/`, using fixture repos built by each case's
  scaffold script. They run model sessions, so they run by hand, locally,
  when a helper changes, never in CI and never as a release gate. They run with
  the repo root as the target, so each case can load both plugins and the
  core's hooks. A run can't ask the person anything, so a skill's approval
  step ends it: cases check the proposal and that nothing was written,
  unless the prompt approves a fix in advance. The cases cover at least:
  - `add-collection` choosing the built-in `adr` type for an ADR directory;
  - `add-collection` proposing a custom entry for a postmortems directory;
  - `add-collection` changing an existing collection's entry;
  - `add-collection` writing no config before approval;
  - `records-doctor` fixing a stale index with `reindex`;
  - `records-doctor` leaving an orphaned index in place;
  - `records-doctor` making no edit before approval;
  - `precedent-finder` reporting a conflict with an accepted record;
  - `precedent-finder` following a superseded record to its replacement;
  - `precedent-finder` answering `Nothing relevant`;
  - `precedent-finder` finding indexes without being given their paths.
