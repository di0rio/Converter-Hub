import type {
  DatabaseFormat,
  DialectFamily,
  FormatDescriptor,
} from './types.js'

export const FAMILY_MARKERS: Record<DialectFamily, RegExp[]> = {
  mysql: [
    /\/\*!\d{5}/,
    /^--\s*MySQL dump/im,
    /\bLOCK TABLES\b/i,
    /\bUNLOCK TABLES\b/i,
    /\bENGINE\s*=\s*[A-Za-z]+/i,
    /\bAUTO_INCREMENT\b/i,
    /\bDEFAULT CHARSET\s*=/i,
    /^(?!\s*(?:--|#)).*`[^`\n]+`/m,
  ],
  postgresql: [
    /^--\s*PostgreSQL database dump/im,
    /^\\connect\b/im,
    /\bFROM stdin;/i,
    /^\\\.$/m,
    /\bSET search_path\b/i,
    /\bstandard_conforming_strings\b/i,
    /\bOWNER TO\b/i,
    /\bpg_catalog\./i,
  ],
  sqlserver: [
    /^\s*GO\s*$/im,
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
  elasticsearch: [/^\s*\{[^\n]*"_index"\s*:/m, /"_source"\s*:\s*\{/],
  neo4j: [
    /\b(CREATE|MERGE)\s*\(\s*[A-Za-z_]\w*\s*:\s*[A-Za-z_]\w*\s*\{/,
    /-\s*\[\s*:[A-Za-z_][^\]]*\]\s*->/,
    /^\s*MATCH\s*\(/im,
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
  elasticsearch: 'elasticsearch',
  neo4j: 'neo4j',
  none: null,
}

const DATABASE = { namespace: 'database', namespaceLabel: 'Database' } as const
const SCHEMA = { namespace: 'schema', namespaceLabel: 'Schema' } as const

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
  mysql: {
    id: 'mysql',
    label: 'MySQL',
    status: 'supported',
    family: 'mysql',
    ...DATABASE,
    markers: [],
  },

  mariadb: {
    id: 'mariadb',
    label: 'MariaDB',
    status: 'supported',
    family: 'mysql',
    ...DATABASE,
    markers: [/^--\s*MariaDB dump/im, /\/\*M!\d{5}/, /^--.*\bMariaDB\b/im],
  },

  tidb: {
    id: 'tidb',
    label: 'TiDB',
    status: 'supported',
    family: 'mysql',
    ...DATABASE,
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
    markers: [/\bPercona\b/i, /\bXtraDB\b/i],
  },

  'aurora-mysql': {
    id: 'aurora-mysql',
    label: 'Aurora MySQL',
    status: 'supported',
    family: 'mysql',
    ...DATABASE,
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
    markers: [
      /\bENGINE\s*=\s*OLAP\b/i,
      /\b(DUPLICATE|AGGREGATE|PRIMARY)\s+KEY\s*\([^)]*\)\s*(COMMENT|DISTRIBUTED|PARTITION)/i,
      /\bBUCKETS\s+\d+/i,
      /\bStarRocks\b/i,
    ],
  },

  postgresql: {
    id: 'postgresql',
    label: 'PostgreSQL',
    status: 'supported',
    family: 'postgresql',
    ...SCHEMA,
    markers: [],
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
    lossy: true,
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
    markers: [/\bedb_[a-z_]+\b/i, /\bEnterpriseDB\b/i, /\bedbspl\b/i],
  },

  sqlserver: {
    id: 'sqlserver',
    label: 'Microsoft SQL Server',
    status: 'supported',
    family: 'sqlserver',
    ...SCHEMA,
    markers: [],
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

  sqlite: {
    id: 'sqlite',
    label: 'SQLite',
    status: 'supported',
    family: 'sqlite',
    ...DATABASE,
    markers: [],
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

  elasticsearch: {
    id: 'elasticsearch',
    label: 'Elasticsearch',
    status: 'supported',
    family: 'elasticsearch',
    ...DATABASE,
    markers: [],
    note:
      'Reads elasticdump output: one JSON object per line, each naming the ' +
      'index it came from. Every index becomes a table and _source supplies ' +
      'the row. Columns are the union of the keys the documents use; nested ' +
      'objects and arrays are kept as their JSON text.',
  },

  neo4j: {
    id: 'neo4j',
    label: 'Neo4j',
    status: 'experimental',
    family: 'neo4j',
    ...DATABASE,
    markers: [],
    lossy: true,
    note:
      'Only nodes are extracted. Nodes sharing a label become a table and ' +
      'their properties become its columns, but relationships are not ' +
      'represented - a table has nowhere to put an edge. The export counts ' +
      'the relationships it skipped and says so in the SQL it writes.',
  },

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
