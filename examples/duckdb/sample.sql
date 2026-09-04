-- DuckDB dump, produced by the duckdb shell's .dump command
--
-- Synthetic fixture. Every name, address and value below is invented for
-- testing and refers to no real person, company or account.
--
-- The shell is forked from SQLite's, so the script shape matches: PRAGMA,
-- a transaction, CREATE TABLE and INSERT. The types are DuckDB's own, and
-- identifiers are quoted the standard way rather than with backticks.
--
-- Metadata below would come from duckdb_tables() in a real session.

PRAGMA foreign_keys=false;
BEGIN TRANSACTION;

CREATE TABLE readings(
    id BIGINT NOT NULL,
    station VARCHAR NOT NULL,
    celsius DOUBLE,
    taken_at TIMESTAMP
);

INSERT INTO readings VALUES
(1,'Station Alpha',21.5,'2024-01-15 10:30:00'),
(2,'Station Beta',NULL,'2024-02-20 14:45:00'),
(3,'Station Zoë',18.25,'2024-03-01 09:00:00');

CREATE TABLE observers(
    id INTEGER NOT NULL,
    name VARCHAR NOT NULL,
    email VARCHAR,
    "order" INTEGER
);

INSERT INTO observers VALUES
(1,'Alice Example','alice@example.test',1),
(2,'Bob Example',NULL,2);

CREATE INDEX idx_readings_station ON readings(station);

COMMIT;
