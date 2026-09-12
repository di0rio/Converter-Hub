---
name: sql-parser
description: "Use when implementing or modifying SQL dump parsing, MySQL/MariaDB syntax handling, SQL extraction logic, or SQL generation. Covers CREATE TABLE, INSERT, constraints, encoding, and dialect-specific behaviors."
---

# SQL Parser Skill

## Scope

This skill covers SQL dump parsing for MySQL and MariaDB only.

Do NOT extend support to PostgreSQL, SQLite, or generic SQL dialects.

## MySQL/MariaDB Dump Structure

A typical MySQL dump contains:

```sql
-- Header comment
/*!40101 SET @OLD_CHARACTER_SET_CLIENT=@@CHARACTER_SET_CLIENT */;
/*!40101 SET NAMES utf8 */;
-- ... more session settings ...

CREATE DATABASE IF NOT EXISTS `mydb` /*!40100 DEFAULT CHARACTER SET utf8mb4 */;
USE `mydb`;

DROP TABLE IF EXISTS `users`;
CREATE TABLE `users` (
  `id` int NOT NULL AUTO_INCREMENT,
  `name` varchar(255) NOT NULL,
  `email` varchar(255) NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `email` (`email`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

LOCK TABLES `users` WRITE;
INSERT INTO `users` VALUES (1,'John','john@example.com'),(2,'Jane','jane@example.com');
UNLOCK TABLES;

-- ... more tables ...

/*!40101 SET CHARACTER_SET_CLIENT=@OLD_CHARACTER_SET_CLIENT */;
```

## Key Parsing Challenges

1. **Conditional comments** - `/*!40101 ... */` syntax for version-specific SQL
2. **Multi-line INSERT** - VALUES spanning multiple lines
3. **Binary data** - INSERT with `_binary` prefix and hex literals
4. **Encoding declarations** - `CHARACTER SET`, `COLLATE` at multiple levels
5. **Foreign key constraints** - `CONSTRAINT`, `REFERENCES` in CREATE TABLE
6. **Stored procedures/triggers** - Delimiter-separated blocks
7. **Comments** - `--`, `#`, `/* */` at various positions

## Parser Architecture

Recommended approach:

1. **Tokenize** - Split SQL into meaningful tokens
2. **Identify statements** - Separate CREATE TABLE, INSERT, etc.
3. **Parse structure** - Extract database names, table definitions, data
4. **Validate** - Ensure output is valid, executable SQL

## Output Requirements

Extracted SQL must be:
- Valid and executable MySQL/MariaDB syntax
- Properly escaped (quotes, backslashes, special characters)
- Encoding-consistent with the source
- Complete with necessary SET statements for session variables

## Test Data

Use synthetic SQL fixtures only. Create minimal examples that exercise:
- Basic CREATE TABLE with various column types
- Multi-row INSERT statements
- Foreign key constraints
- Conditional comments
- Different character sets and collations
- Edge cases: empty tables, binary data, NULL values
