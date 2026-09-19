export type DatabaseFormat =
  | 'mysql'
  | 'mariadb'
  | 'tidb'
  | 'percona'
  | 'aurora-mysql'
  | 'singlestore'
  | 'starrocks'
  | 'postgresql'
  | 'cockroachdb'
  | 'yugabytedb'
  | 'greenplum'
  | 'redshift'
  | 'timescaledb'
  | 'citus'
  | 'enterprisedb'
  | 'sqlserver'
  | 'synapse'
  | 'sqlite'
  | 'duckdb'
  | 'firebird'
  | 'oracle'
  | 'db2'
  | 'cassandra'
  | 'mongodb'
  | 'elasticsearch'
  | 'neo4j'
  | 'snowflake'
  | 'bigquery'
  | 'databricks'
  | 'trino'
  | 'presto'
  | 'hive'
  | 'impala'

export type SupportStatus =
  | 'supported'
  | 'experimental'
  | 'planned'
  | 'not_applicable'

export type NamespaceKind = 'database' | 'schema'

export type DialectFamily =
  | 'mysql'
  | 'postgresql'
  | 'sqlserver'
  | 'sqlite'
  | 'firebird'
  | 'oracle'
  | 'db2'
  | 'cassandra'
  | 'mongodb'
  | 'elasticsearch'
  | 'neo4j'
  | 'none'

export interface FormatDescriptor {
  id: DatabaseFormat
  label: string
  status: SupportStatus
  family: DialectFamily
  namespace: NamespaceKind
  namespaceLabel: string
  markers: RegExp[]
  note?: string
  lossy?: boolean
}
