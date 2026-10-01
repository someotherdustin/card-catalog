# Profiles

A profile says how to read the records of one record type: which files are
records, and where each record's ID, title, status, summary, links and
extra fields come from. Profiles are plain data. Hooks apply them without a
model.

## Fields

| Field | Type | Meaning |
|-------|------|---------|
| `name` | string | Display name, used in labels and headings: `ADR`, `Postmortem`. |
| `plural` | string | Plural used in sentences: `ADRs`, `postmortems`. |
| `match` | glob | Which files in the collection directory are candidates. |
| `exclude` | glob[] | Candidates that are never records. |
| `id` | ID pattern or source | Where the ID comes from. See [IDs](#ids). |
| `title` | sources | Where the title comes from. |
| `summary` | sources | Where the one-line summary comes from. |
| `status` | object or `null` | Status sources and vocabulary, or `null` for types with no lifecycle. |
| `links` | map | Link type → sources. See [Links](#links). |
| `fields` | map | Extra field name → sources, shown on the index line. |
| `date` | sources | The record's own date, kept in `index.json`. |
| `tags` | sources | Tags, kept in `index.json`. |
| `label` | template | How an index line names a record. |
| `guidance` | string | A sentence the session-start message adds for this type. |

Wherever a field takes **sources**, it accepts one source string or an array
of them. Sources are tried in order, and the first one that yields a
non-empty value wins.

## Sources

| Source | Yields |
|--------|--------|
| `frontmatter:<key>` | The frontmatter value for `<key>`, compared case-insensitively. A list yields its items. |
| `inline:<Name>` | The value of the first `Name: value` line in the body. |
| `section:<Name>` | The first paragraph of the first `##` or `###` heading named `Name`. |
| `heading` | The text of the first `# ` heading, with a numbering prefix removed. |
| `lead` | The first prose paragraph under the `# ` heading. |
| `quote` | The first blockquote paragraph under the `# ` heading. |
| `status:<value>` | Links only: the raw status text after the word that mapped to `<value>`. |

Names in `inline:` and `section:` match case-insensitively. Any other source
string is a `config-invalid` error.

### Matching rules

- **`inline:`** accepts the forms people write: `Status: accepted`,
  `**Status:** accepted`, `__Status__: accepted`, `- Date: 2026-01-01`. A
  trailing `**` is stripped from the value.
- **`section:`** ends the section at the next heading of level 1–3. A
  trailing colon on the heading is allowed (`## Status:`).
- **`heading`** removes `1. ` (adr-tools numbering) and
  `<name>-0007: `, `<name> 7 - ` and similar, where `<name>` is the profile's
  `name` matched case-insensitively and the separator is one of `:`, `.`,
  `-`, `–`, `—`.
- **`lead`** reads up to the next heading of any level. It skips blank
  lines, HTML comments, blockquotes, and inline-field lines whose key is
  `status`, `date`, `deciders`, `tags`, `summary`, or any name an `inline:`
  source in the same profile uses.
- **`quote`** is the same as `lead` but accepts a blockquote. A quote right
  under the title is usually an editorial note added later
  (`> **Superseded by ADR-0005.** …`), which is why `lead` skips it and
  `quote` comes last in a chain.

Every value is cleaned before use: markdown links and images become their
text, `**`, `__` and backticks are removed, list and quote markers at line
starts are removed, and whitespace runs become one space. Summaries are then
cut to 280 characters, at the last sentence end in the second half of the
limit if there is one, otherwise at a word boundary with `…` added.

### Frontmatter

Frontmatter is a `---` block at the very start of the file (after an
optional BOM). card-catalog reads a flat YAML subset:

- `key: value`, with optional single or double quotes around the value;
- flow lists `key: [a, b]` and block lists (`key:` then `- item` lines);
- block scalars `key: >` and `key: |`, with optional `-` or `+` chomping
  indicators. Folded (`>`) values join their lines with spaces;
- `#` comments on their own line.

Nested maps and anything else are skipped without error. Where a field wants
one string and the value is a list, the items are joined with `, `.

## IDs

`id` is either a `frontmatter:<key>` source or an **ID pattern**. An ID
pattern is literal text with placeholders:

| Placeholder | Matches | Contributes |
|-------------|---------|-------------|
| `{number}` | 1–5 digits | The number zero-padded to at least 4 digits |
| `{series}` | `[a-z][a-z0-9]*`, case-insensitive | Itself, lowercased |
| `{date}` | `YYYY-MM-DD` | Itself |
| `{slug}` | `[a-z0-9][a-z0-9._-]*`, case-insensitive | Itself |
| `{dir}` | Nothing in the filename | The name of the record file's directory |

Square brackets mark an optional part: `[{series}-]{number}`.

The pattern is matched against the start of the record's filename without
`.md`. It must end at the end of the name or just before a `-`, and anything
after that `-` is the record's slug. The ID is the matched text, with
`{number}` padded. A candidate file whose name doesn't match the pattern is
not a record (`validate` notes it as `not-a-record`).

| Pattern | File | ID | Slug |
|---------|------|----|------|
| `[{series}-]{number}` | `0007-use-postgres.md` | `0007` | `use-postgres` |
| `[{series}-]{number}` | `hub-0023-tls.md` | `hub-0023` | `tls` |
| `[{series}-]{number}` | `7-use-postgres.md` | `0007` | `use-postgres` |
| `{date}-{slug}` | `2026-09-14-db-outage.md` | `2026-09-14-db-outage` | `db-outage` |
| `{slug}` | `restart-workers.md` | `restart-workers` | `restart-workers` |
| `{dir}` | `restart-workers/README.md` | `restart-workers` | none |

A record whose ID comes from frontmatter but has no value for that key is
not a record, and `validate` reports it as `no-id` (an error).

IDs must be unique within a collection. Duplicates are both indexed, and
`validate` reports `duplicate-id` (an error).

### Series

A pattern with `{series}` lets one collection hold several numbered
sequences, such as ADRs imported from another repo as `hub-0023-x.md` next
to the local `0023-x.md`. Numbers are unique only within a series.

## Labels

`label` is a template over `{name}` and `{id}`. The default is
`{name} {id}`, giving `Postmortem 2026-09-14-db-outage`. The `adr` profile
uses `ADR-{id}`, giving `ADR-0007`.

A record in a series is labelled by its ID alone (`hub-0023`), because the
series already names where it came from.

## Status

`status` is `null` for a type with no lifecycle. Records of that type have
no status, and their index lines show none. Otherwise it's an object:

```json
{
  "from": ["frontmatter:status", "section:Status", "inline:Status"],
  "values": { "draft": "proposed", "proposed": "proposed", "accepted": "accepted" }
}
```

`from` lists the sources of the raw status text. `values` maps raw words to
the type's vocabulary. The raw text is cleaned and lowercased, and the
longest key it starts with decides the status, so
`Accepted (2026-03-01)` is `accepted`. If no key matches, the status is
`unspecified` and `validate` warns `unknown-status`. If there's no raw text,
the status is `unspecified` without a warning.

## Links

`links` maps a link type to its sources:

```json
{
  "superseded-by": ["frontmatter:superseded-by", "status:superseded"],
  "relates-to": "frontmatter:relates-to"
}
```

Link type names follow the record type name rule (`^[a-z][a-z0-9-]*$`).
The well-known types are `supersedes`, `superseded-by`, `implements` and
`relates-to`, but any name works.

A source may yield several references: a frontmatter list, or text holding
more than one. Each reference is resolved to a **target**, written as a
label:

1. A markdown link to a `.md` file names the record in that file. If the
   file is in a known collection, the target is that record's label.
   Otherwise it's the link text. The link's path is kept too.
2. Text matching the profile's label, such as `ADR-42` or `ADR-0042`,
   names the record with that ID. In a series record, a reference without a
   series means the same series (`ADR-0042` inside `hub-0031` is
   `hub-0042`), because that's how the series referred to itself before it
   was imported.
3. Text matching the ID pattern directly, such as `hub-0042` or a bare
   `42`, names that ID, with the same series rule.
4. Anything else is kept verbatim as the target. That's how a link names a
   record in a collection of another type: `Postmortem 2026-09-14-db-outage`.

For `status:<value>` sources, rules 2 and 3 take the first match in the
text, so `Superseded by ADR-0009 (2026-04-01)` targets `ADR-0009`.

When a record's status is `superseded` and it has a `superseded-by` link,
the index line shows the link in the status
(`[superseded by ADR-0009]`). Every other link is shown as a `key=value`
pair. See [index-format.md](index-format.md#index-lines).

## Fields

`fields` maps an extra field name to its sources:
`{ "severity": "inline:Severity" }`. Field names follow the type name rule.
Values are cleaned strings. Fields are shown on the index line as
`key=value` pairs, in the order the profile lists them.

`date` and `tags` are kept in `index.json` but not shown on the line.

## Generic defaults

A user-defined type starts from these values:

| Field | Default |
|-------|---------|
| `name` | The type name with its first letter uppercased: `postmortem` → `Postmortem` |
| `plural` | `name` + `s` if `name` is all capitals (`RFCs`), else lowercased `name` + `s` (`postmortems`) |
| `match` | `*.md` |
| `exclude` | `["README.md", "INDEX.md"]` |
| `id` | `{slug}` |
| `title` | `["frontmatter:title", "heading"]` |
| `summary` | `["frontmatter:summary", "inline:Summary", "lead", "quote"]` |
| `status` | `null` |
| `links` | `frontmatter:<type>` for each of `supersedes`, `superseded-by`, `implements`, `relates-to` |
| `fields` | `{}` |
| `date` | `["frontmatter:date", "inline:Date"]` |
| `tags` | `["frontmatter:tags"]` |
| `label` | `{name} {id}` |
| `guidance` | none |

`match` is a glob relative to the collection directory, using the
[glob syntax](config.md#directory-globs) for files. `*.md` reads only the
directory itself; `**/*.md` and `*/README.md` reach into subdirectories.
The collection's own index file is never a record, whatever `match` and
`exclude` say.

A record with no title is skipped: hooks keep its previous index line if
there is one, and `validate` reports `no-title`.

## The built-in `adr` profile

The `adr` profile reads mattpocock/skills, Nygard, MADR and adr-tools ADRs
through its fallback chains. It's equivalent to:

```json
{
  "name": "ADR",
  "plural": "ADRs",
  "match": "*.md",
  "exclude": ["README.md", "INDEX.md"],
  "id": "[{series}-]{number}",
  "title": ["frontmatter:title", "heading"],
  "summary": [
    "frontmatter:summary", "inline:Summary", "lead",
    "section:Decision", "section:Context", "quote"
  ],
  "status": {
    "from": ["frontmatter:status", "section:Status", "inline:Status"],
    "values": {
      "draft": "proposed", "proposed": "proposed", "accepted": "accepted",
      "rejected": "rejected", "deprecated": "deprecated", "superseded": "superseded"
    }
  },
  "links": {
    "supersedes": "frontmatter:supersedes",
    "superseded-by": ["frontmatter:superseded-by", "status:superseded"],
    "implements": "frontmatter:implements",
    "relates-to": "frontmatter:relates-to"
  },
  "fields": {},
  "date": ["frontmatter:date", "inline:Date"],
  "tags": ["frontmatter:tags"],
  "label": "ADR-{id}",
  "guidance": "If your work would contradict an accepted ADR, say so explicitly rather than silently overriding it."
}
```

Its fixtures are the current parser tests. Every ADR that indexes today must
get the same index line from this profile, unless it has frontmatter links,
which now show as `key=value` pairs.

## Adding built-in profiles

A built-in profile is added when a real collection needs one, with fixtures
taken from that collection. It doesn't need an ADR.
