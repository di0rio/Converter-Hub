import type { DatabaseFormat } from '../formats/index.js'

/**
 * A dump normalised into the shape every layer above the parser works with.
 *
 * Nothing above this model is dialect-specific. The raw statement text inside
 * each field is preserved verbatim, so a SQL export stays valid for the engine
 * the dump came from.
 */
export interface SqlDump {
  /** The engine that produced the dump. */
  format: DatabaseFormat
  databases: Database[]
  preamble: string      // session statements before the first database
  postamble: string     // trailing statements after the last database
}

/**
 * One selectable grouping of tables: a database in MySQL and MariaDB, a schema
 * in PostgreSQL. `SqlDump.format` says which, so callers can use the right word
 * instead of assuming every engine calls this a database.
 */
export interface Database {
  name: string
  /** Owning database, for formats that nest schemas inside one (PostgreSQL). */
  catalog?: string
  createStatement: string   // CREATE DATABASE / CREATE SCHEMA (full SQL text)
  useStatement: string      // statement that switches to it (USE, \connect)
  tables: Table[]
}

/**
 * One table and the statements that build it, in restore order.
 *
 * The three statement lists are what every engine needs and no more: setup that
 * has to run before the rows, the rows themselves, and the constraints and
 * indexes that are cheaper to add afterwards. Each engine fills them with its
 * own SQL — LOCK/UNLOCK TABLES for MySQL, sequences and deferred constraints
 * for PostgreSQL — without the model naming any of it.
 */
export interface Table {
  name: string
  database: string
  /** The engine this table's statements are written in. */
  format: DatabaseFormat
  createStatement: string        // Full CREATE TABLE DDL
  preDataStatements: string[]    // Runs after CREATE TABLE, before the rows
  dataStatements: string[]       // Row-carrying statements: INSERT, or COPY blocks
  postDataStatements: string[]   // Runs after the rows: constraints, indexes
}

export interface ExtractionOptions {
  database: string
  tables: string[] | 'all'
}

export interface ExtractionResult {
  sql: string
  database: string
  tableCount: number
}
