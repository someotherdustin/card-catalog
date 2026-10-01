# card-catalog

card-catalog keeps a one-line-per-record index next to each collection of
markdown records in a repo, so agents and operators can find prior records
without reading them all.

## Language

### Records

**Record**:
One markdown file that card-catalog indexes as a single entry, such as one ADR.
_Avoid_: document, doc, entry

**Record type**:
A kind of record, such as ADR or postmortem, named in config. Built-in types
ship with card-catalog; any other name defines a user-defined type.
_Avoid_: format, kind, custom format

**Profile**:
The description of how to read records of one record type: which files are
records and where each one's ID, title, status and summary come from. Each
record type has exactly one profile.
_Avoid_: format profile, parser, schema

**Collection**:
A directory of records of one record type, with its own index. Its records
may sit in subdirectories. When collections nest, a record belongs to the
innermost one.
_Avoid_: folder, record set

**Collection setting**:
A choice made for one collection rather than for its record type, such as
where its index goes or whether it is announced.
_Avoid_: collection option

**Link**:
A typed reference from one record to another, such as superseded-by or
implements, naming its target by label. It may point into another collection.
_Avoid_: relation, reference

**Announced collection**:
A collection whose index the session-start message points agents at.

**Default collection**:
A collection card-catalog finds without any config, by matching known ADR
directory names.
_Avoid_: auto-discovered collection

### Index

**Index**:
The `INDEX.md` file for a collection: one line per record, which a grep hit
returns whole.
_Avoid_: digest, catalog, table of contents

**Index line**:
One record's line in an index: its label, status (if its record type has
one), date amended, extra fields, title and summary.
_Avoid_: entry, row

**ID**:
The part of a record's name that is unique within its collection, such as
`0003` or `2026-09-14-db-outage`.
_Avoid_: number, key

**Series**:
A numbered sequence of records within one collection, marked by a filename
prefix, such as records imported from another repo. Numbers are unique only
within a series.
_Avoid_: prefix, namespace

**Label**:
How index lines and links name a record, built from its ID, such as
`ADR-0003` or `Postmortem 2026-09-14-db-outage`. Unique within its
collection, not across the repo.

**Orphaned index**:
An index left behind in a directory that is no longer a collection.

**Ignored path**:
A path excluded by git or by an agent ignore file committed to the repo.
card-catalog never indexes or announces records under one, even when config
lists it.

**Agent ignore file**:
A file in the repo, such as `.aiignore` or `.cursorignore`, that tells a
coding tool which paths its agent must not see.

### Audiences

**Agent**:
A coding agent working in the repo, which reads indexes and writes records.

**Operator**:
A person working in the repo without an agent, through an editor, the CLI or CI.
_Avoid_: user, human
