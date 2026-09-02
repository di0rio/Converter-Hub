# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- Core SQL parser for MySQL/MariaDB dump files
- Database detection and enumeration
- Table detection and enumeration within databases
- Extraction of all tables from a database
- Extraction of selected tables from a database
- SQL generation for extracted content (CREATE DATABASE, CREATE TABLE, INSERT statements, LOCK/UNLOCK tables)
- CLI with interactive mode (prompts for database and table selection)
- CLI with non-interactive mode (flags for database, tables, output)
- Web interface with file upload, database selection, table selection, and download
- Synthetic sample SQL dump (`examples/sample-mysql-dump.sql`)
- Monorepo structure with `packages/core`, `apps/cli`, `apps/web`
- TypeScript strict mode across all packages
- Vitest test suite for core and CLI packages
