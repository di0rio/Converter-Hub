import { describe, it, expect } from 'vitest'
import {
  splitScript,
  MYSQL_DIALECT,
  POSTGRES_DIALECT,
  SQLITE_DIALECT,
  SQLSERVER_DIALECT,
  FIREBIRD_DIALECT,
} from '../src/parser/shared/dialect.js'

describe('splitScript', () => {
  describe('terminators', () => {
    it('splits on the terminator and keeps it with the statement', () => {
      expect(splitScript('SELECT 1; SELECT 2;', MYSQL_DIALECT)).toEqual([
        'SELECT 1;',
        'SELECT 2;',
      ])
    })

    it('does not split on a semicolon inside a string', () => {
      expect(splitScript("INSERT INTO t VALUES ('a;b');", MYSQL_DIALECT)).toEqual([
        "INSERT INTO t VALUES ('a;b');",
      ])
    })

    it('does not split on a semicolon inside a line comment', () => {
      const sql = '-- a; comment\nSELECT 1;'
      expect(splitScript(sql, MYSQL_DIALECT)).toEqual(['-- a; comment\nSELECT 1;'])
    })

    it('does not split inside a quoted identifier', () => {
      expect(splitScript('CREATE TABLE `a;b` (x int);', MYSQL_DIALECT)).toEqual([
        'CREATE TABLE `a;b` (x int);',
      ])
    })

    it('does not split inside a dollar-quoted body', () => {
      const sql = "CREATE FUNCTION f() RETURNS int AS $$ SELECT 1; $$ LANGUAGE sql;"
      expect(splitScript(sql, POSTGRES_DIALECT)).toHaveLength(1)
    })
  })

  describe('SQL Server batches', () => {
    it('treats GO as a batch separator rather than a statement', () => {
      const sql = ['SELECT 1', 'GO', 'SELECT 2', 'GO'].join('\n')
      expect(splitScript(sql, SQLSERVER_DIALECT)).toEqual(['SELECT 1', 'SELECT 2'])
    })

    it('does not end a batch on GO inside a string value', () => {
      const sql = ["INSERT t VALUES (N'line", 'GO', "still one value');"].join('\n')
      expect(splitScript(sql, SQLSERVER_DIALECT)).toHaveLength(1)
    })

    /**
     * SSMS scripts table data as bare INSERT lines with no semicolons at all,
     * stacked many per GO batch. Merging them yields one statement whose VALUES
     * scan walks into the next INSERT's column list, so the rows decode as
     * nonsense — this is data corruption, not just untidy splitting.
     */
    it('separates semicolon-less INSERT lines the way SSMS writes them', () => {
      const sql = [
        "INSERT [dbo].[items] ([id], [name]) VALUES (1, N'Alice Example')",
        "INSERT [dbo].[items] ([id], [name]) VALUES (2, N'Bob Example')",
        "INSERT [dbo].[items] ([id], [name]) VALUES (3, N'Cleo Example')",
      ].join('\n')

      expect(splitScript(sql, SQLSERVER_DIALECT)).toHaveLength(3)
    })

    it('starts a new statement at a keyword that cannot continue the last', () => {
      const sql = [
        'CREATE TABLE [a] ([id] int)',
        'CREATE TABLE [b] ([id] int)',
      ].join('\n')

      expect(splitScript(sql, SQLSERVER_DIALECT)).toHaveLength(2)
    })

    it('does not split a column list that spans lines', () => {
      const sql = [
        'CREATE TABLE [a](',
        '  [id] int NOT NULL,',
        '  [insert_count] int NULL',
        ')',
      ].join('\n')

      expect(splitScript(sql, SQLSERVER_DIALECT)).toHaveLength(1)
    })

    it('does not split INSERT ... SELECT across its own lines', () => {
      // SELECT is deliberately not a statement starter: it continues an INSERT.
      const sql = ['INSERT INTO [a] ([id])', 'SELECT [id] FROM [b]'].join('\n')
      expect(splitScript(sql, SQLSERVER_DIALECT)).toHaveLength(1)
    })
  })

  describe('SQLite trigger bodies', () => {
    /**
     * A trigger body holds its own statements. SQLite has no batch separator
     * and no terminator swap, so without knowing about BEGIN ... END the body
     * fragments and a SQL export emits the pieces out of order.
     */
    it('keeps a compound trigger body in one statement', () => {
      const sql = [
        'CREATE TRIGGER authors_ai AFTER INSERT ON authors',
        'BEGIN',
        "  INSERT INTO audit VALUES (NEW.id, 'created');",
        "  UPDATE audit SET msg = 'x' WHERE id = NEW.id;",
        'END;',
      ].join('\n')

      const statements = splitScript(sql, SQLITE_DIALECT)
      expect(statements).toHaveLength(1)
      expect(statements[0]).toContain('UPDATE audit')
      expect(statements[0]?.trimEnd().endsWith('END;')).toBe(true)
    })

    it('resumes normal splitting after the trigger closes', () => {
      const sql = [
        'CREATE TRIGGER t1 AFTER INSERT ON a',
        'BEGIN',
        '  UPDATE b SET x = 1;',
        'END;',
        "INSERT INTO a VALUES (1,'Alice Example');",
        'COMMIT;',
      ].join('\n')

      const statements = splitScript(sql, SQLITE_DIALECT)
      expect(statements).toHaveLength(3)
      expect(statements[1]).toContain('INSERT INTO a')
      expect(statements[2]).toBe('COMMIT;')
    })

    it('leaves an ordinary statement alone', () => {
      const sql = 'CREATE TABLE t (id int);\nINSERT INTO t VALUES (1);'
      expect(splitScript(sql, SQLITE_DIALECT)).toHaveLength(2)
    })
  })

  describe('Firebird SET TERM', () => {
    it('honours a swapped terminator and restores it afterwards', () => {
      const sql = [
        'SET TERM ^ ;',
        'CREATE TRIGGER t FOR authors',
        'AS BEGIN',
        '  IF (NEW.ID IS NULL) THEN NEW.ID = 1;',
        'END^',
        'SET TERM ; ^',
        "INSERT INTO authors VALUES (1, 'Alice Example');",
      ].join('\n')

      const statements = splitScript(sql, FIREBIRD_DIALECT)
      // The trigger survives whole, and the INSERT after the swap-back splits.
      expect(statements.some((s) => s.includes('IF (NEW.ID IS NULL)'))).toBe(true)
      expect(statements.some((s) => s.startsWith('INSERT INTO authors'))).toBe(true)
    })
  })
})
