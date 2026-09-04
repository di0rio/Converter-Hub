import type {
  DatabaseFormat,
  DialectFamily,
  FormatDescriptor,
} from './types.js'

/**
 * The single source of truth for which database formats exist and how far each
 * one got. The UI list, the CLI's `--format` choices, the README table and the
 * compatibility matrix are all derived from here — nothing repeats these names
 * by hand.
 *
 * Detection works in two steps, which is what lets near-identical products stay
 * distinguishable without duplicating a parser:
 *
 *   1. FAMILY_MARKERS picks the family from signals the whole family shares.
 *   2. A member's own `markers` separate it from the family default.
 *
 * A member with no markers of its own is the family default: the format you get
 * when the family is recognised but nothing narrows it further.
 */

// --------------------------------------------------------------- families

/**
 * Signals that identify a family. These are the markers a dump tool writes
 * regardless of which product in the family produced it.
 */
export const FAMILY_MARKERS: Record<DialectFamily, RegExp[]> = {
  mysql: [
    /\/\*!\d{5}/, // /*!40101 SET ... */ version-gated comments
    /^--\s*MySQL dump/im,
    /\bLOCK TABLES\b/i,
    /\bUNLOCK TABLES\b/i,
    /\bENGINE\s*=\s*[A-Za-z]+/i,
    /\bAUTO_INCREMENT\b/i,
    /\bDEFAULT CHARSET\s*=/i,
    // A backtick-quoted identifier, but not one inside a comment: dump headers
    // quite reasonably mention shell commands in backticks, and a PostgreSQL
    // dump whose banner reads `cockroach dump ...` is not MySQL evidence.
    /^(?!\s*(?:--|#)).*`[^`\n]+`/m,
  ],
  postgresql: [
    /^--\s*PostgreSQL database dump/im,
    /^\\connect\b/im,
    /\bFROM stdin;/i,
    /^\\\.$/m, // COPY data terminator
    /\bSET search_path\b/i,
    /\bstandard_conforming_strings\b/i,
    /\bOWNER TO\b/i,
    /\bpg_catalog\./i,
  ],
  sqlserver: [
    /^\s*GO\s*$/im, // batch separator on its own line
    /\[dbo\]\s*\./i,
    /\bSET\s+IDENTITY_INSERT\b/i,
    /\bSET\s+ANSI_NULLS\b/i,
    /\bSET\s+QUOTED_IDENTIFIER\b/i,
    /\bNVARCHAR\s*\(/i,
    /\bUNIQUEIDENTIFIER\b/i,
    /\bIDENTITY\s*\(\s*\d+\s*,\s*\d+\s*\)/i,
  ],
  sqlite: [
    /^PRAGMA\s+foreign_keys\s*=/im,
    /\bsqlite_sequence\b/i,
    /\bsqlite_master\b/i,
    /^BEGIN TRANSACTION;\s*$/im,
    /\bAUTOINCREMENT\b/i,
  ],
  firebird: [
    /\bSET\s+TERM\b/i,
    /\bCREATE\s+GENERATOR\b/i,
    /\bGEN_ID\s*\(/i,
    /^\/\*\s*Firebird/im,
    /\bRDB\$/i,
  ],
  oracle: [
    /^REM\s/im,
    /\bVARCHAR2\s*\(/i,
    /\bNUMBER\s*\(\s*\d+/i,
    /\bINSERT\s+ALL\b/i,
    /\bFROM\s+dual\b/i,
    /\bNOCACHE\b/i,
  ],
  mongodb: [
    /\bdb\s*\.\s*[A-Za-z_][\w$]*\s*\.\s*(insertMany|insertOne)\s*\(/,
    /\bdb\s*\.\s*getCollection\s*\(/,
    /\bObjectId\s*\(/,
  ],
  cassandra: [
    /\bCREATE\s+KEYSPACE\b/i,
    /\breplication_factor\b/i,
    /\b(SimpleStrategy|NetworkTopologyStrategy)\b/i,
    /\bCOLUMNFAMILY\b/i,
    /\bfrozen\s*</i,
  ],
  db2: [
    /\bSYSIBM\b/i,
    /\bGENERATED\s+ALWAYS\s+AS\s+IDENTITY\b/i,
    /\bVALUES\s+NEXTVAL\s+FOR\b/i,
    /\bORGANIZE\s+BY\b/i,
    /^--\s*DB2\b/im,
  ],
  none: [],
}

/**
 * The format a family resolves to when no member's own markers match.
 *
 * This is what keeps a plain `pg_dump` file reading as PostgreSQL rather than
 * as one of its derivatives.
 */
export const FAMILY_DEFAULT: Record<DialectFamily, DatabaseFormat | null> = {
  mysql: 'mysql',
  postgresql: 'postgresql',
  sqlserver: 'sqlserver',
  sqlite: 'sqlite',
  firebird: 'firebird',
  oracle: 'oracle',
  db2: 'db2',
  cassandra: 'cassandra',
  mongodb: 'mongodb',
  none: null,
}

// ---------------------------------------------------------------- catalog

const DATABASE = { namespace: 'database', namespaceLabel: 'Database' } as const
const SCHEMA = { namespace: 'schema', namespaceLabel: 'Schema' } as const

/** A product with no local SQL dump this tool could read. */
function notApplicable(
  id: DatabaseFormat,
  label: string,
  note: string,
): FormatDescriptor {
  return {
    id,
    label,
    status: 'not_applicable',
    family: 'none',
    ...SCHEMA,
    markers: [],
    note,
  }
}

export const CATALOG: Record<DatabaseFormat, FormatDescriptor> = {
  // ------------------------------------------------------- MySQL family

  mysql: {
    id: 'mysql',
    label: 'MySQL',
    status: 'supported',
    family: 'mysql',
    ...DATABASE,
    markers: [], // family default
  },

  mariadb: {
    id: 'mariadb',
    label: 'MariaDB',
    status: 'supported',
    family: 'mysql',
    ...DATABASE,
    // A MariaDB dump is a MySQL dump plus these; only they separate the two.
    markers: [/^--\s*MariaDB dump/im, /\/\*M!\d{5}/, /^--.*\bMariaDB\b/im],
  },

  tidb: {
    id: 'tidb',
    label: 'TiDB',
    status: 'supported',
    family: 'mysql',
    ...DATABASE,
    // Dumpling writes no banner of its own, so the giveaway is the TiDB-only
    // version-gated comment SHOW CREATE TABLE emits: /*T![clustered_index] */.
    markers: [
      /\/\*T!\[/,
      /^--\s*Dumpling\b/im,
      /\btidb_version\b/i,
      /\btidb_rowid\b/i,
      /\bAUTO_RANDOM\b/i,
    ],
  },

  percona: {
    id: 'percona',
    label: 'Percona Server',
    status: 'supported',
    family: 'mysql',
    ...DATABASE,
    // mysqldump writes the server version it read from, and Percona's carries
    // its own name and build suffix.
    markers: [/\bPercona\b/i, /\bXtraDB\b/i],
  },

  'aurora-mysql': {
    id: 'aurora-mysql',
    label: 'Aurora MySQL',
    status: 'supported',
    family: 'mysql',
    ...DATABASE,
    // Aurora reports itself as e.g. 8.0.mysql_aurora.3.04.0.
    markers: [/\bmysql_aurora\b/i, /\baurora_[a-z_]+\b/i],
  },

  singlestore: {
    id: 'singlestore',
    label: 'SingleStore',
    status: 'supported',
    family: 'mysql',
    ...DATABASE,
    markers: [/\bSHARD\s+KEY\b/i, /\bSingleStore\b/i, /\bMemSQL\b/i],
  },

  starrocks: {
    id: 'starrocks',
    label: 'StarRocks',
    status: 'supported',
    family: 'mysql',
    ...DATABASE,
    // StarRocks writes its own table shape after the column list.
    markers: [
      /\bENGINE\s*=\s*OLAP\b/i,
      /\b(DUPLICATE|AGGREGATE|PRIMARY)\s+KEY\s*\([^)]*\)\s*(COMMENT|DISTRIBUTED|PARTITION)/i,
      /\bBUCKETS\s+\d+/i,
      /\bStarRocks\b/i,
    ],
  },

  // -------------------------------------------------- PostgreSQL family

  postgresql: {
    id: 'postgresql',
    label: 'PostgreSQL',
    status: 'supported',
    family: 'postgresql',
    ...SCHEMA,
    markers: [], // family default
  },

  cockroachdb: {
    id: 'cockroachdb',
    label: 'CockroachDB',
    status: 'experimental',
    family: 'postgresql',
    ...SCHEMA,
    markers: [
      /\bcrdb_internal\b/i,
      /\bunique_rowid\s*\(/i,
      /^--\s*CockroachDB\b/im,
      /\bFAMILY\s+"?primary"?\s*\(/i,
    ],
    note:
      'Reads cockroach dump output. A column family written with an unquoted ' +
      'name (FAMILY fam_0 (id)) is indistinguishable from a column named ' +
      'family, so it is left in the column list and shows up as an extra ' +
      'empty column. The quoted form cockroach dump normally writes is handled.',
  },

  yugabytedb: {
    id: 'yugabytedb',
    label: 'YugabyteDB',
    status: 'supported',
    family: 'postgresql',
    ...SCHEMA,
    markers: [/^--\s*YugabyteDB\b/im, /\byb_[a-z_]+\b/i, /\bSPLIT\s+INTO\b/i],
  },

  greenplum: {
    id: 'greenplum',
    label: 'Greenplum',
    status: 'supported',
    family: 'postgresql',
    ...SCHEMA,
    markers: [/\bDISTRIBUTED\s+(BY|RANDOMLY|REPLICATED)\b/i, /\bgp_[a-z_]+\b/i],
  },

  redshift: {
    id: 'redshift',
    label: 'Amazon Redshift',
    status: 'supported',
    family: 'postgresql',
    ...SCHEMA,
    markers: [
      /\bDISTKEY\s*\(/i,
      /\bSORTKEY\s*\(/i,
      /\bDISTSTYLE\b/i,
      /\bENCODE\s+[a-z]/i,
    ],
  },

  timescaledb: {
    id: 'timescaledb',
    label: 'TimescaleDB',
    status: 'supported',
    family: 'postgresql',
    ...SCHEMA,
    markers: [
      /\bcreate_hypertable\s*\(/i,
      /\btimescaledb\b/i,
      /\b_timescaledb_/i,
    ],
  },

  citus: {
    id: 'citus',
    label: 'Citus',
    status: 'supported',
    family: 'postgresql',
    ...SCHEMA,
    markers: [
      /\bcreate_distributed_table\s*\(/i,
      /\bcreate_reference_table\s*\(/i,
      /\bcitus\b/i,
    ],
  },

  enterprisedb: {
    id: 'enterprisedb',
    label: 'EnterpriseDB',
    status: 'supported',
    family: 'postgresql',
    ...SCHEMA,
    // EDB Postgres Advanced Server writes its own session settings.
    markers: [/\bedb_[a-z_]+\b/i, /\bEnterpriseDB\b/i, /\bedbspl\b/i],
  },

  // -------------------------------------------------- SQL Server family

  sqlserver: {
    id: 'sqlserver',
    label: 'Microsoft SQL Server',
    status: 'supported',
    family: 'sqlserver',
    ...SCHEMA,
    markers: [], // family default
  },

  synapse: {
    id: 'synapse',
    label: 'Azure Synapse Analytics',
    status: 'supported',
    family: 'sqlserver',
    ...SCHEMA,
    markers: [
      /\bDISTRIBUTION\s*=\s*(HASH|ROUND_ROBIN|REPLICATE)/i,
      /\bCLUSTERED\s+COLUMNSTORE\s+INDEX\b/i,
    ],
  },

  // ------------------------------------------------------------ embedded

  sqlite: {
    id: 'sqlite',
    label: 'SQLite',
    status: 'supported',
    family: 'sqlite',
    // SQLite has exactly one database and calls it `main`. That is SQLite's own
    // word, so selecting it is honest rather than an invented grouping.
    ...DATABASE,
    markers: [], // family default
  },

  duckdb: {
    id: 'duckdb',
    label: 'DuckDB',
    status: 'supported',
    family: 'sqlite',
    ...DATABASE,
    markers: [
      /^--\s*DuckDB\b/im,
      /\bduckdb_[a-z_]+\b/i,
      /\bCREATE\s+SEQUENCE\b[\s\S]*\bSTART\s+\d+/i,
    ],
  },

  // ------------------------------------------------- standalone dialects

  firebird: {
    id: 'firebird',
    label: 'Firebird',
    status: 'supported',
    family: 'firebird',
    ...SCHEMA,
    markers: [],
  },

  oracle: {
    id: 'oracle',
    label: 'Oracle Database',
    status: 'supported',
    family: 'oracle',
    ...SCHEMA,
    markers: [],
  },

  db2: {
    id: 'db2',
    label: 'IBM Db2',
    status: 'supported',
    family: 'db2',
    ...SCHEMA,
    markers: [],
  },

  cassandra: {
    id: 'cassandra',
    label: 'Cassandra',
    status: 'supported',
    family: 'cassandra',
    // A keyspace holds tables the way a database does, and cqlsh calls it that.
    ...DATABASE,
    markers: [],
    note:
      'Reads CQL scripts (cqlsh DESCRIBE plus INSERT statements). Cassandra ' +
      'bulk-loads through COPY TO / COPY FROM against CSV files, which is not ' +
      'a SQL script and is not read here. Collection values (map, list, set) ' +
      'are kept as written rather than flattened into columns.',
  },

  mongodb: {
    id: 'mongodb',
    label: 'MongoDB',
    status: 'supported',
    family: 'mongodb',
    ...DATABASE,
    markers: [],
    note:
      'Reads mongosh seed scripts (use <db> plus db.<collection>.insertMany). ' +
      'mongoexport output is not read: it carries neither a database nor a ' +
      'collection name, so it could only be given invented ones. Columns are ' +
      'the union of the keys the documents use; nested objects and arrays are ' +
      'kept as their JSON text rather than flattened into more columns.',
  },

  // ------------------------------------------------------ not applicable

  snowflake: notApplicable(
    'snowflake',
    'Snowflake',
    'Unloads to CSV/Parquet in cloud storage via COPY INTO. There is no local SQL dump of table data to read.',
  ),
  bigquery: notApplicable(
    'bigquery',
    'Google BigQuery',
    'Exports to Cloud Storage as CSV, JSON or Avro. DDL is retrievable, but rows never take the form of a SQL script.',
  ),
  databricks: notApplicable(
    'databricks',
    'Databricks SQL',
    'Backed by Delta Lake files rather than SQL dumps. Table data is exported as Parquet or CSV, not as INSERT statements.',
  ),
  trino: notApplicable(
    'trino',
    'Trino',
    'A query engine over other stores, not a database. It owns no data and has no dump format of its own.',
  ),
  presto: notApplicable(
    'presto',
    'Presto',
    'A query engine over other stores, not a database. It owns no data and has no dump format of its own.',
  ),
  hive: notApplicable(
    'hive',
    'Apache Hive',
    'Metadata lives in the metastore and rows live as files on HDFS or S3. Neither is a SQL dump.',
  ),
  impala: notApplicable(
    'impala',
    'Apache Impala',
    'A query engine over Hive-managed storage. Rows are files, not INSERT statements.',
  ),
}
