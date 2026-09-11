# Converter Hub

Local-first tools for turning one file into the files you actually want. Every
tool reads your file in the browser and writes the result back to it: nothing is
uploaded, and there is no server behind any of it.

No SQL from your files is ever executed. A dump is parsed as text and never
replayed. A SQLite database is opened read-only by a SQLite engine running in
your browser, which reads its tables and nothing else — no triggers fire, no
extensions load, and the file you selected is never written to.

## Tools

`apps/web/lib/tools.ts` is the single source of truth for this table. It feeds
the hub cards, the page titles, the breadcrumbs and the route metadata, so a
tool is described in one place and appears everywhere. Only tools that have a
route behind them are listed there — the hub never advertises something that
does not exist yet.

| Tool | Route | Reads | Writes | What it does |
|------|-------|-------|--------|--------------|
| Spreadsheets | `/spreadsheet` | XLSX, XLSM, XLS, XLSB, ODS, CSV, TSV | XLSX, CSV, JSON, Markdown, SQL | Splits a multi-sheet workbook into one file per sheet, packaged as a ZIP |
| SQL | `/sql` | SQL dumps from 24 engines, SQLite database files with their write-ahead log, Firebird 2.x database files | SQL, CSV, XLSX, JSON, JSON Lines, Markdown | Extracts the tables you pick out of a dump or a database file |
| Data | `/data` | CSV, TSV, JSON, JSON Lines, YAML, XML | CSV, TSV, JSON, JSON Lines, YAML, Markdown, SQL, XLSX | Converts one structured data file to another format, as a single file |
| Markdown | `/markdown` | Markdown, HTML | HTML, Markdown | Turns a Markdown document into an HTML file, or an HTML page into Markdown |
| JSON to TypeScript | `/json-to-typescript` | JSON | TypeScript | Writes types that describe a JSON sample |
| Images | `/image` | SVG, PNG, JPEG, WebP, AVIF | PNG, JPEG, WebP | Converts one image to another format, as a single file |

They are independent tools that share a design system, a virtualised data grid,
a ZIP writer, a CSV writer and a file dropzone. Adding another means an entry in
the registry and a route; the hub needs no changes.

The Data tool reads any of its inputs into a plain value and writes any output
from it. JSON, JSON Lines and YAML take any shape. The table outputs — CSV,
TSV, Markdown, SQL, XLSX — need a list of flat records (or an object holding
exactly one such list); a nested document is refused rather than flattened,
because flattening would pick one of several shapes on your behalf. A CSV's
delimiter is detected from its header line, and its values stay text. YAML is
read with the `yaml` library, whose default alias limit refuses a document that
expands into a huge graph from a few bytes, and it is loaded only when a YAML
file is read or written.

XML is read with the browser's own `DOMParser`, which runs nothing and never
fetches an external entity or DTD, into one fixed shape: the root element as
`{ "root": … }`, attributes as `"@name"`, a repeated element as a list in
document order, a text-only element as its text, and text beside attributes or
children under `"#text"`. A list wrapped in single-property layers —
`<people><person>…` — reaches the table outputs as that list. A malformed file
is refused without quoting the parser's message, which would quote the file.

The Markdown tool asks which way to convert, Markdown to HTML or HTML to
Markdown, and then takes only that kind of file. It renders nothing in the app:
the result is a file to download. Markdown becomes a complete HTML document through the `marked`
library, loaded only when a file is converted. Raw HTML in the Markdown is
written as text rather than passed through, and a link or image whose address
is not `http`, `https`, `mailto` or relative keeps its text and loses the
address, because the HTML file will be opened somewhere. HTML becomes Markdown
through the browser's `DOMParser`, which runs no script and loads no image, and
a small serializer for headings, paragraphs, links, images, lists, tables,
code, emphasis and strong text. Scripts, styles and the head are left out, and
any other element keeps its text. Arbitrary HTML does not convert perfectly.

A Firebird database file (`.fdb` or `.gdb`) is read by the SQL tool too, with
no Firebird engine: the core parses the file itself, following Firebird 2.5's
own source for the on-disk structure. Only Firebird 2.0, 2.1 and 2.5 files
(ODS 11) are read; any other version is refused with its version named. Only
committed rows are shown — a row changed by a transaction that never
committed is shown as it was before — and NUMERIC and DECIMAL values stay
exact. Text is decoded in each column's character set; a column in NONE is
read in the database's default, and in WIN1252 when that is NONE too. A table
with an ARRAY column, an external file, temporary rows or a character set the
browser cannot decode is listed as unreadable rather than guessed at. To check
a file from the command line without printing any of its rows, build the core
and run `node scripts/fdb-probe.mjs <file.fdb>`.

JSON to TypeScript takes a pasted JSON sample or a `.json` file, writes the
types as you type, and offers them to copy or download as a `.ts` file. It
merges the values it sees into one type per position, marks a field some
objects lack as optional, and writes `unknown` where the sample says nothing.

Four more text tools are built but parked off the hub: Encoding (Base64, hex,
URL encoding, HTML entities), Case (seven identifier styles), Timestamps (Unix
seconds, milliseconds and ISO 8601 in UTC) and Colors (HEX, rgb(), hsl()).
Their conversions are in `packages/core/src/utilities` and tested there; their
pages wait in `apps/web/app/_parked`, which the router ignores.

The Images tool uses no library: the browser decodes the file through an
`Image`, draws it onto a canvas and encodes it with `canvas.toBlob`. An SVG is
recognised by its content — `DOMParser` must find an `<svg>` root in the SVG
namespace — and is then loaded through `<img>` from a Blob URL, where the
browser runs none of its scripts and fetches none of its external resources;
it is never put into the page. JPEG output is painted onto white, since JPEG
has no transparency. AVIF is read where the browser can decode it but is not
offered as an output, because `canvas.toBlob` does not write it in general; a
browser that cannot write the chosen format is reported rather than handed a
PNG in disguise. An SVG with neither an absolute width nor height is drawn at
its viewBox size rather than the browser's default 300×150.

The SQL tool takes two kinds of input through one picker. A *dump* is a script —
the text `mysqldump` or `sqlite3 .dump` produces — and is parsed as text. A
*SQLite database* is the binary SQLite itself writes, and is opened by a SQLite
engine. The tool tells them apart by content, not by name: a file that starts
with the SQLite header, or comes with a `-wal` or `-shm`, is a database, and
anything else is read as a dump.

## SQLite

### What it reads

| File | Treated as |
|------|------------|
| `.db`, `.sqlite`, `.sqlite3`, `.db3`, or any other name | The database, if its header says `SQLite format 3` |
| `name-wal` | The write-ahead log for `name`. Read, so recent rows are not lost |
| `name-shm` | Accepted and ignored — it holds no data |

Detection reads the file header, never the extension. SQLite mandates no
extension, and a text file renamed to `.db` is still text.

### The write-ahead log

A database in WAL mode keeps recently committed rows in a `name-wal` file until
something folds them back in. Opening only the `.db` therefore shows a database
that is real but out of date, and says nothing about what is missing.

Select the `-wal` alongside the database and those rows are included. The tool
says so when it happens, so you know which of the two you are looking at. There
is no hand-written WAL parser here: a real SQLite build applies the log, exactly
as it would on your machine.

The `-shm` is optional. It is an index shared between processes rather than a
store of data, and SQLite rebuilds it in memory.

Selecting only a `-wal` or `-shm` is refused: neither is a database on its own,
and reconstructing one from them is forensic recovery, which this tool does not
do.

Companions are paired by name. `orders.db` never takes `sessions.db-wal` as its
log, because SQLite itself cannot tell whose log it is reading and would lay one
database's pages over another's. The browser pairs the file names you select;
the CLI pairs paths, so a log is only ever the one in its database's own folder.

A `-wal` whose header checksum does not match is refused with a neutral
message. SQLite on its own would treat such a log as empty and open the main
file alone, which exports the database minus its newest rows without a word.
An incomplete last frame is a different case: SQLite stops at the last commit,
which is exactly the state the database was in.

### How values are written

SQLite stores five classes and no dates. Nothing is guessed at on the way out:

| Stored | CSV, XLSX, JSON, Markdown | SQL |
|--------|---------------------------|-----|
| NULL | empty cell, distinct from `""` | `NULL` |
| INTEGER, REAL | the number as stored, 64-bit integers exact | unquoted |
| TEXT | unchanged — `007` stays `007` | quoted, quotes doubled |
| BLOB | base64 | `X'hex'`, which SQLite reads back |

An INTEGER that looks like a Unix timestamp and a TEXT that looks like a date are
left as they are. SQLite has no date type, and guessing rewrites your data.

The SQL export carries the `CREATE TABLE` SQLite already stored, so primary keys,
constraints, collations and declared types survive rather than being flattened.

CSV goes through the same writer the other tools use: the delimiter you pick
(comma, semicolon or tab), a byte order mark, and a leading `=`, `+`, `-` or
`@` neutralised. Table names become file names the same way sheet names do —
path separators and control characters removed — and two tables whose names
collide once cleaned, or differ only by case, get separate files.

### Limits and gaps

- **Size.** The browser holds the whole database in memory; past 256 MB it is
  refused rather than crashing the tab. The CLI has no such limit.
- **Rows.** At most 200,000 rows per table are read in the browser. The row count
  shown is always the true total, so a partial read is never passed off as whole.
- **Virtual tables.** FTS and other virtual tables are listed as unreadable and
  skipped, with their shadow tables. Their contents need the extension that wrote
  them.
- **Views** are not exported. Only tables are.
- **Generated columns** are left out. Their values are derived from the other
  columns, and leaving them out keeps the SQL export replayable — SQLite refuses
  an `INSERT` that names one.
- **SQLite's own tables** (`sqlite_*`, such as `sqlite_sequence`) are not
  listed. The SQL export therefore does not carry `AUTOINCREMENT` counters; a
  replayed table continues from its highest row id instead.
- **The CLI** writes CSV, XLSX and SQL. JSON, JSON Lines and Markdown are
  browser-only.
- **Encrypted databases** (SQLCipher and similar) cannot be opened, and are
  reported as unreadable. No attempt is made to bypass encryption.
- **Corrupt databases** are refused, not partially exported.

A **source format** (what a tool reads) and an **output format** (what it
writes) are kept apart throughout, because a future converter will pair them
differently again.

## Supported Formats

This section covers the SQL tool. The spreadsheet tool reads the
extensions listed in the table above and is described under
[Spreadsheets](#spreadsheets).



`packages/core/src/formats/catalog.ts` is the single source of truth for this
table. Every format there carries a status, and only `supported` is advertised
here, in the web UI and in the CLI. A format reaches `supported` only once it
has a parser, a synthetic fixture and passing tests, and a matrix test drives
every one of them through detection, parsing and all three exports on each run.

### Source formats

| Format | Reads | Grouping | Notes |
|--------|-------|----------|-------|
| MySQL | `INSERT` | database | |
| MariaDB | `INSERT` | database | |
| TiDB | `INSERT` | database | Dumpling output; `/*T![...] */` comments preserved |
| Percona Server | `INSERT` | database | mysqldump output; identified by its server version |
| Aurora MySQL | `INSERT` | database | mysqldump output; identified by `mysql_aurora` |
| SingleStore | `INSERT` | database | `SHARD KEY` / `SORT KEY` clauses preserved |
| StarRocks | `INSERT` | database | `ENGINE=OLAP`, key model and bucketing preserved |
| PostgreSQL | `COPY ... FROM stdin`, `INSERT` | schema | |
| YugabyteDB | `COPY`, `INSERT` | schema | `ysql_dump` output |
| Greenplum | `COPY`, `INSERT` | schema | `DISTRIBUTED BY` clauses preserved |
| Amazon Redshift | `INSERT` | schema | DDL plus INSERTs; see the note below |
| TimescaleDB | `COPY`, `INSERT` | schema | `create_hypertable()` preserved |
| Citus | `COPY`, `INSERT` | schema | distribution calls preserved |
| EnterpriseDB | `COPY`, `INSERT` | schema | EDB Postgres Advanced Server; `edb_` settings |
| Microsoft SQL Server | `INSERT` | schema | `GO` batches, `[bracketed]` identifiers |
| Azure Synapse Analytics | `INSERT` | schema | T-SQL plus `DISTRIBUTION` / columnstore clauses |
| SQLite | `INSERT` | database | `sqlite3 .dump` output |
| DuckDB | `INSERT` | database | `duckdb` shell `.dump` output |
| Firebird | `INSERT` | schema | `SET TERM` bodies handled |
| Oracle Database | `INSERT` | schema | `REM`/`PROMPT` lines, PL/SQL blocks closed by `/` |
| IBM Db2 | `INSERT` | schema | `SET SCHEMA`, identity columns |
| Cassandra | `INSERT` | keyspace | CQL scripts; collection types kept whole |
| MongoDB | `insertMany` | database | mongosh seed scripts; columns are the union of document keys |
| Elasticsearch | JSONL | index | `elasticdump` output; each line names its index |

**Experimental — readable, not advertised in the app:**

| Format | Gap |
|--------|-----|
| Neo4j | Only nodes are extracted. Nodes sharing a label become a table and their properties its columns, but **relationships are not represented** — a table has nowhere to put an edge. The export counts the relationships it skipped and says so in the SQL it writes. |
| CockroachDB | A column family written with an unquoted name (`FAMILY fam_0 (id)`) cannot be told apart from a column named `family`, so it stays in the column list and shows up as an extra empty column. The quoted form `cockroach dump` normally writes is handled. |

**Not applicable.** These have no local SQL dump this tool could read, so they
are recorded with the reason rather than left to look like an oversight:

| Product | Why |
|---------|-----|
| Snowflake | Unloads to CSV/Parquet in cloud storage via `COPY INTO`. No local SQL dump of table data. |
| Google BigQuery | Exports to Cloud Storage as CSV, JSON or Avro. DDL is retrievable; rows never take the form of a SQL script. |
| Databricks SQL | Backed by Delta Lake files. Table data exports as Parquet or CSV, not as `INSERT` statements. |
| Trino, Presto | Query engines over other stores. They own no data and have no dump format of their own. |
| Apache Hive | Metadata lives in the metastore, rows live as files on HDFS or S3. Neither is a SQL dump. |
| Apache Impala | A query engine over Hive-managed storage. Rows are files, not `INSERT` statements. |

A product is listed only when it is a distinct database engine *and* its dumps
carry a marker identifying it. Hosting a another engine does not qualify, so
Supabase, Neon, AlloyDB, Aurora PostgreSQL and Azure SQL Database are read as
PostgreSQL or SQL Server rather than listed separately — they parse fine, they
just are not different engines.

Cassandra, MongoDB, Elasticsearch and Neo4j are read because what they export is still tabular
enough for this model. A CQL keyspace holds tables with typed columns. A
mongosh seed script names its database and its collections, and a collection's
columns are the union of the keys its documents use — a document missing one
gets null for it, and a nested object or array is carried as its JSON text
rather than flattened into more columns.

What is *not* read, and why:

| Product | Why not |
|---------|---------|
| `mongoexport` output | Carries neither a database nor a collection name. It could only be given invented ones, and picking a database and tables — the whole point of this tool — would collapse to one anonymous table. |
| DynamoDB | Same: a `scan` export is `{"Items": [...]}` with no table name in the file. |
| Redis | Key/value, plus a binary RDB. There is no table to select. |

The rule across all of them is the same one used for hosted deployments: a
source is read when the file says what it holds, and refused when the only way
to name it would be to make the name up. Importing them would be a different
architecture, not another parser.

### Export formats

| Format | Output |
|--------|--------|
| SQL | One `.sql` file, in the dialect the dump came from |
| CSV | One `.csv` per table, UTF-8 with a byte order mark |
| XLSX | One workbook, one sheet per table |

Source format and export format are independent: any readable dump can be
exported to any of the three. CSV and XLSX are engine-neutral, because they are
written from the normalised rows rather than from SQL.

### Format detection

Detection resolves a *family* from markers the whole family shares, then the
*member* within it from markers only that product writes. That is what lets
Greenplum and PostgreSQL stay distinguishable without duplicating a parser, and
what stops a CockroachDB dump being relabelled PostgreSQL. A product's own
markers also count towards its family, since some — Redshift DDL, for one —
never write a family-wide banner at all.

Detection stays deliberately conservative:

- Markers from two families that are not clearly apart produce no answer rather
  than a guess.
- SQL carrying no engine markers at all — a hand-written `CREATE TABLE` plus
  `INSERT`s — is read as MySQL, and the app says it *assumed* rather than
  *detected* the format.
- A file with nothing recognisable in it is refused as *Unsupported database
  format*.

Detection can be overruled from the CLI with `--format`, and from the core with
`parseDump(sql, { format })`. The web app has no such control: it reports what
it read the file as and nothing more. A file whose markers contradict each other
is refused there rather than forced — use the CLI for that case.

### Databases and schemas

Engines disagree about what a grouping of tables is called, and the tool uses
each engine's own word rather than flattening them. MySQL, MariaDB and TiDB
group by database. The PostgreSQL family and SQL Server group by schema, and
when a dump names the owning database that name is kept alongside the schema.
SQLite has exactly one database and calls it `main` — that is SQLite's own name,
not one invented here, so it is offered as an ordinary selection.

### When the source does not fit

A format the catalog marks *lossy* cannot represent everything its source
holds. The app shows a warning naming what is lost **before** anything is
exported, and the warning text is the catalog's own note, so it cannot drift
from this document. Today that is Neo4j (relationships) and CockroachDB (an
extra empty column from an unquoted column family).

A format with a caveat worth reading but nothing actually lost — Cassandra's
CSV bulk path, MongoDB's `mongoexport` — does **not** warn. Warning about
those would teach people to dismiss the warning that matters.

### Known limitations

- **SQL export preserves the source dialect; it does not convert between
  dialects.** A PostgreSQL dump exports to PostgreSQL SQL. There is no
  translation layer, and none is claimed.
- **Foreign keys can outlive their targets.** Exporting a subset of tables keeps
  each table's own constraints, which may reference tables you did not select.
- **Stored routines, views, triggers and grants are not extracted.** They are
  preserved where the dump puts them, but are not offered as selectable objects.
- **SQL Server:** statements stacked in one `GO` batch are separated by keyword,
  which covers what SSMS writes. Procedure bodies are not parsed.
- **Redshift:** Redshift moves table data through `UNLOAD`/`COPY FROM s3://`,
  which is not a local SQL dump. What is supported is DDL plus `INSERT`
  statements — the closest thing to a portable local export.
- **Binary and custom-format dumps are not supported** for any engine. Only
  plain-text SQL is read.
- **MongoDB's SQL export is generated, not preserved.** Every other source
  exports the statements its own dump wrote, byte for byte. A document store
  has no source SQL to preserve, so the SQL export is plain ANSI `CREATE TABLE`
  and `INSERT` built from the documents, with every column declared `text`.
  This is the one source where the SQL output is written by this tool rather
  than carried through from the input.
- **Cassandra reads CQL scripts, not its bulk format.** Cassandra moves data
  with `COPY TO` / `COPY FROM` against CSV files, which is not a SQL script.
  Collection values (`map`, `list`, `set`) are kept as written rather than
  flattened into columns.
- **Oracle PL/SQL is preserved, not parsed.** Triggers, procedures, packages
  and types are carried as text and never offered as selectable tables.
- **Binary column values are kept as written** (`X'...'`, `0x...`) rather than
  decoded, so no byte is invented on the way to a spreadsheet.

## Spreadsheets

The spreadsheet tool reads `.xlsx`, `.xlsm`, `.xls`, `.xlsb`, `.ods`, `.csv`
and `.tsv` through
[SheetJS](https://sheetjs.com) and writes one file per sheet into a ZIP. A ZIP
rather than separate downloads, because a browser blocks the second and later
downloads of a burst — ten sheets would otherwise arrive silently as one file.

- **CSV and TSV are read as UTF-8 text, as one sheet named after the file.**
  The separator is detected, a byte order mark is ignored, and every value is
  kept as the text it is, so `007` keeps its leading zero and `1.10` is not
  turned into `1.1`. A file holding a NUL character (binary content renamed to
  `.csv`) or a quote that never closes is refused rather than shown as a
  sheet of noise. A file saved in another encoding, such as Windows-1252, is
  not converted: its accents come out wrong.
- **A file must be what its extension says.** `.xlsx`, `.xlsm`, `.xlsb` and
  `.ods` are ZIP archives, and one that does not start like a ZIP is refused
  with the same neutral message as any unreadable file. `.xls` is not checked
  this way, because Excel also saves HTML and XML under that extension.
- **Sheets holding no value are listed but never exported.** They would
  produce a file with nothing in it, so they appear in the list, marked
  `empty`, and cannot be selected.
- **Row counts are read from the cells, not from the used range.** Excel grows
  the used range to cover anything that was ever touched — a fill colour
  dragged down a column, a deleted block, a stray border — so a sheet with
  fifty rows of data routinely reports a range of ten thousand. A row is
  counted when it holds at least one cell with a value, which is the rule the
  export applies when it drops blank rows, so the number on screen and the
  number of rows in the file that comes out are the same number.
- **Row counts mean data rows.** The first row holding anything names the
  columns, so a sheet showing "5 rows" has five rows under a header — the same
  thing "5 rows" means on the SQL side.
- **File names are treated as untrusted.** A sheet name comes out of the user's
  file, and it names an entry in an archive: path separators are replaced,
  leading dots cannot produce a `..` entry or a hidden file, control characters
  are stripped, and the length is capped. Accents and non-Latin scripts are
  kept, because they are legal in file names and mangling them would only make
  the output harder to recognise. Sheets differing only by case are suffixed,
  since they would be one file on Windows and macOS.
- **XLSX output keeps values and formulas**, not visual formatting. A formula
  that only reads its own sheet stays a formula. One that reads another sheet,
  another workbook or a defined name would open as `#REF!` or `#NAME?` in a
  file holding a single sheet, so it is written as the value Excel cached for
  it instead. A formula saved without a cached value comes out empty.
- **CSV output goes through the same writer the SQL tool uses**, so both tools
  produce the same shape of file: UTF-8 with a byte order mark, RFC 4180
  quoting, and a leading `=`, `+`, `-` or `@` neutralised so a cell is not read
  back as a formula by whatever opens it next.
- **The CSV delimiter is a choice**: comma (the default), semicolon or tab.
  Excel in locales that use a decimal comma, Brazilian Portuguese among them,
  expects a semicolon and opens a comma-separated file as a single column. A
  value is quoted when it carries the chosen delimiter, so a semicolon inside a
  cell stays one cell. The SQL tool always writes commas.
- **JSON output is one array per sheet**, one object per row, keyed by the
  header row. Every object carries the same keys. Values are the same text the
  CSV holds, written exactly as they are: JSON is read by programs, not
  reopened by a spreadsheet, so the formula prefix would only corrupt them.
  UTF-8, no byte order mark.
- **Markdown output is one GitHub-flavoured table per sheet.** A pipe is
  escaped, a line break becomes `<br>`, `&`, `<` and `>` are escaped so a cell
  cannot inject markup into whatever renders it, and a leading `=`, `+`, `-`
  or `@` gets the same prefix the CSV applies.
- **SQL output is one script per sheet**: a `CREATE TABLE` followed by
  `INSERT`s batched 500 rows at a time. Every column is declared `TEXT`,
  because a spreadsheet has no schema — a column of digits may be a quantity,
  an order number or a phone number, and guessing wrong silently drops a
  leading zero or rounds an identifier. An empty cell becomes `NULL`.
  Identifiers are double-quoted and strings single-quoted, both escaped by
  doubling, which is the only escape standard SQL defines.

  The script opens with a MySQL-only mode line, wrapped in a versioned comment
  so every other engine ignores it:

  ```sql
  /*!40101 SET SESSION sql_mode = 'ANSI_QUOTES,NO_BACKSLASH_ESCAPES' */;
  ```

  MySQL and MariaDB depart from the standard in two ways that matter here.
  They read `"` as a string delimiter rather than as an identifier quote, and
  they treat a backslash as an escape inside a string — so a cell ending in a
  backslash would escape the closing quote and let the next value be read as
  SQL. Those two settings turn both off, which is what makes the same file mean
  the same thing everywhere.
- **Headers are made usable for JSON, Markdown and SQL**: an empty header is
  named after its position (`column_3`), and a repeated one — compared ignoring
  case — is suffixed (`name_2`). CSV and XLSX keep the header exactly as it is.

Note that SheetJS is installed from the vendor's own CDN
(`https://cdn.sheetjs.com/...`), which is the installation route
[their documentation prescribes](https://docs.sheetjs.com/docs/getting-started/installation/nodejs).
The copy on the public npm registry stops at 0.18.5 and carries known
prototype-pollution and ReDoS advisories that are fixed in the current release —
which matters here, because the file being parsed is untrusted by definition.

## Privacy Model

- **Web app:** Every tool parses and converts entirely in your browser, in client-side JavaScript (`file.text()` for dumps, `file.arrayBuffer()` for workbooks). Nothing is uploaded to a server. No network request is made for data processing, by either tool.
- **CLI:** Processes files locally on your machine. It covers the SQL tool only.
- **No analytics, telemetry, or external APIs.**
- **No persistent storage** of dump or spreadsheet contents.
- **No SQL from your files is ever executed,** and no database server is ever
  contacted. A SQLite database is read, read-only, by a SQLite engine running
  in the tab.

The web app ships a Content Security Policy and a set of security headers
(`apps/web/next.config.ts`) so that the claim above is enforced by the browser
rather than merely true of the code: `connect-src 'self'` and `form-action
'self'` leave no route for a dependency to ship a dump anywhere, `object-src`
and `base-uri` close the usual ways around that, and `frame-ancestors 'none'`
keeps the page out of other sites.

`script-src` allows inline scripts, deliberately. Next hydrates through an
inline bootstrap script, and the only way to allow it without the keyword is a
per-request nonce, which requires every page to render dynamically and gives up
the static prerender that lets this app be served as plain files. The exchange
is sound here because the injection it would defend against has nowhere to
enter: no user-supplied HTML is rendered, nothing is read from the URL, and
there is no server behind the page. The directives that carry the privacy model
are unaffected either way.

This project processes untrusted input (your dump and spreadsheet files). While every reasonable effort is made to handle input safely, no absolute security guarantees are made. See [SECURITY.md](./SECURITY.md) for details and vulnerability reporting.

## Limitations

- **Only the engines listed above.** See [Supported Formats](#supported-formats). Anything else is refused or named as unsupported, never half-parsed.
- **Pragmatic parsers.** Each parser handles the output its engine's dump tool writes; none is a universal SQL parser. Edge cases in highly unusual dump formats may not parse correctly.
- **Memory-bound, with a ceiling.** Reading is not streaming: a dump becomes one
  JavaScript string, and the parser holds the statement list and the parsed
  model alongside it, so peak memory is a multiple of the file. Files larger
  than **250 MB** are refused up front, by size, before a byte is read — in the
  CLI and in the web app both. That turns what used to be an out-of-memory
  crash partway through into a message saying what happened. The ceiling lives
  in `packages/core/src/limits/index.ts`.
- **Spreadsheets have their own, lower ceiling.** A workbook is a compressed
  archive that inflates well past its size on disk once every cell is an
  object, so the spreadsheet tool refuses files larger than **100 MB**, again
  by size and before reading. The ceiling lives in
  `apps/web/lib/spreadsheet.ts`.
- **The spreadsheet tool splits by sheet.** One file per sheet is the operation
  it performs; it does not split by column value or row group, and it is not a
  spreadsheet editor. Cell values and formulas survive an XLSX split; visual
  formatting (colours, borders, column widths) does not.

## Quick Start

### Prerequisites

- [Bun](https://bun.sh/) (for development)

### Install

```bash
git clone <repo-url> converter-hub
cd converter-hub
bun install
```

`bun install` does not run any project lifecycle script — installing this
repository never executes its code. See [CONTRIBUTING.md](./CONTRIBUTING.md)
for the setup model and for how to review contributor branches safely.

### Web Interface

```bash
bun run dev:web
```

Open [http://localhost:3000](http://localhost:3000), upload a `.sql` file, select a database and tables, then download the extracted SQL.

### CLI

Build first (`bun run build`), then run the CLI from its build output:

```bash
# Extract all tables from a specific database
node apps/cli/dist/index.js dump.sql -d store_db -a -o output.sql
```

```bash
# Extract specific tables
node apps/cli/dist/index.js dump.sql -d store_db -t customers,orders -o output.sql
```

```bash
# A PostgreSQL dump: pick a schema rather than a database
node apps/cli/dist/index.js dump.sql -d public -a -o output.sql
```

```bash
# Read the file as a named engine instead of detecting it
node apps/cli/dist/index.js dump.sql -f postgresql -d public -a -o output.sql
```

```bash
# Interactive mode (prompts for the database or schema, then the tables, then the output path)
node apps/cli/dist/index.js dump.sql
```

```bash
# Fully interactive: omit the file too, and browse the filesystem to pick one
node apps/cli/dist/index.js
```

### Build All Packages

```bash
bun run build
```

## Development

### Project Structure

```
converter-hub/
  packages/
    core/          SQL parsing, extraction logic, domain types, and the
                   writers both tools share
  apps/
    web/           Next.js web interface: the hub and both tools
    cli/           Command-line interface (the SQL tool only)
  examples/
    <format>/sample.sql     One synthetic sample dump per readable
                            source format, named by its catalog id
    spreadsheet/sample.xlsx A synthetic four-sheet workbook, one of whose
                            sheets is deliberately empty
```

Inside the core:

```
packages/core/src/
  formats/       The catalog: which engines exist, their support status,
                 what they call things, and how to detect them
  parser/
    shared/      The FormatParser interface, the dialect model, and the
                 dialect-driven script splitter and row readers
    mysql/       MySQL, MariaDB and TiDB (one reader, three identities)
    postgresql/  PostgreSQL and its derivatives
    sqlserver/
    sqlite/
    firebird/
    oracle/
    db2/
    cassandra/
    mongodb/
  types/         The normalised dump model every other layer works on
  limits/        How large a dump either app will accept, and the wording
                 shown when one is over it
  extractor/     Rebuilds SQL from the model
  tabular/       Turns the model into columns and rows
  generator/     CSV, XLSX, SQL inserts and ZIP
```

Dialect-specific SQL lives only under `parser/<format>/`. Everything above it
works on the normalised model, so adding an engine means writing one
`FormatParser` and registering it — no changes to the extractor, the generators
or the UI.

- `packages/core` — No I/O, no UI. Pure parsing and extraction logic.
- `apps/cli` — CLI interface. Imports from core. No UI code.
- `apps/web` — Next.js web interface. Imports from core. No CLI code.

### Commands

| Command | Description |
|---------|-------------|
| `bun install` | Install all dependencies |
| `bun run build` | Build all packages |
| `bun run typecheck` | Type-check all packages |
| `bun run test` | Run all tests |
| `bun run format` | Format the repository with Biome |
| `bun run format:check` | Report formatting differences without writing |
| `bun run lint` | Lint the web app |
| `bun run dev:web` | Start web dev server |
| `bun run dev:cli` | Start CLI in dev mode |

### Code style

Formatting is Biome's, configured in `biome.json`: two-space indentation, an
80-column width, single quotes in TypeScript and double quotes in JSX, no
semicolons, trailing commas. The settings describe the style the codebase
already had rather than replacing it, so `bun run format` is a no-op on code
written in the surrounding idiom.

Two exclusions are deliberate. Biome's **linter is off** — `bun run lint` is
still ESLint with `eslint-config-next`, which understands the framework's rules;
Biome is here to format, not to judge. And `globals.css` is excluded, because
Tailwind 4's at-rules (`@theme`, `@custom-variant`, `@apply`) are not CSS that
Biome's parser accepts.

### Testing

```bash
# Run all tests
bun run test

# Run tests for a single package
bun run --filter @sql-extractor/core test
bun run --filter sql-extractor test

# Watch mode
bun run --filter @sql-extractor/core test:watch
```

### Quality Gates

Before considering any change complete:

1. `bun run typecheck` — passes
2. `bun run lint` — passes
3. `bun run format:check` — reports nothing
4. `bun run test` — passes
5. `bun run build` — succeeds

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Language | TypeScript (strict mode) |
| Web | Next.js 16 (App Router), React 19 |
| UI | COSS UI (Base UI + Tailwind CSS 4) |
| Icons | Lucide React |
| Build | Bun |
| Tests | Vitest |
| Formatting | Biome |
| Linting | ESLint (`eslint-config-next`), web app only |
| Spreadsheets | SheetJS (from the vendor CDN, not the stale npm copy) |
| Archives | fflate |
| Source formats | See [Supported Formats](#supported-formats) |

**Explicitly out of scope:** dialect conversion, generic SQL abstractions, Redux, MUI, server-side database connections. Non-SQL engines are in scope when they export a script this tool can read — MongoDB, Cassandra, Elasticsearch and Neo4j all do — and out of it when they do not, which is recorded per product above.

## Sample Data

The `examples/` directory holds one synthetic dump per supported source format, plus `examples/spreadsheet/sample.xlsx` — a four-sheet workbook, one of whose sheets is deliberately empty so the spreadsheet tool's handling of that case can be seen. Every name, address and value in them is invented. They are safe to use in examples and tests — they contain no real personal or production data, and no credentials.

## Contributing

See [CONTRIBUTING.md](./CONTRIBUTING.md).

## License

[MIT](./LICENSE)
