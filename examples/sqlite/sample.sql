-- Synthetic fixture. Every name, address and value below is invented for
-- testing and refers to no real person, company or account.
--
-- Shaped like the output of `sqlite3 mydb.db .dump`.

PRAGMA foreign_keys=OFF;
BEGIN TRANSACTION;
CREATE TABLE authors (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, bio TEXT);
INSERT INTO authors VALUES(1,'Alice Example','Writes about SQL; semicolons and quotes '' included.');
INSERT INTO authors VALUES(2,'Bob Example',NULL);
INSERT INTO authors VALUES(3,'Zoë Example','Café-adjacent, Müller-approved.');
CREATE TABLE "order" ("id" INTEGER PRIMARY KEY, [note] TEXT, `status` TEXT);
INSERT INTO "order" VALUES(1,'first order','pending');
INSERT INTO "order" VALUES(2,'second order','shipped');
CREATE TABLE archived_authors (id INTEGER PRIMARY KEY, name TEXT);
CREATE TABLE blobs (id INTEGER PRIMARY KEY, payload BLOB);
INSERT INTO blobs VALUES(1,X'53514C697465');
CREATE INDEX idx_authors_name ON authors(name);
CREATE VIEW author_names AS SELECT name FROM authors;
CREATE TABLE sqlite_sequence(name,seq);
DELETE FROM sqlite_sequence;
INSERT INTO sqlite_sequence VALUES('authors',3);
INSERT INTO sqlite_sequence VALUES('order',2);
COMMIT;
