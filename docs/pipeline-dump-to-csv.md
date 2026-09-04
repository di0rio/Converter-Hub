# Pipeline: do dump SQL até CSV/XLSX

Este documento descreve o caminho que um arquivo de dump percorre até virar uma
tabela (CSV, XLSX ou SQL filtrado). Todo o trabalho acontece em
`packages/core` — os apps (`apps/cli`, `apps/web`) só orquestram entrada e saída.

O SQL nunca é executado. Ele é lido apenas como texto.

## Visão geral

```
texto do dump
   │
   ├─ 1. detectFormat()      formats/index.ts       → qual engine escreveu isso?
   │
   ├─ 2. parseDump()         parser/index.ts        → despacha para o parser do dialeto
   │      └─ splitStatements() + classifyStatement()
   │             → SqlDump { databases[] → tables[] → statements[] }
   │
   ├─ 3. toTabular()         tabular/index.ts       → Table → { columns, rows }
   │      ├─ readColumns()     (do CREATE TABLE)
   │      └─ readDataBlock()   (dos INSERT / COPY)
   │
   └─ 4. generateExport()    generator/index.ts     → toCsv / toXlsx / extractDatabase
          └─ createZip()                            → bytes do .zip
```

As camadas 3 e 4 são **agnósticas de dialeto**. Só a camada 2 sabe a diferença
entre MySQL e PostgreSQL.

---

## 1. Detecção de formato — `packages/core/src/formats/index.ts`

`detectFormat(sql)` procura marcadores que **só** uma ferramenta de dump emite:

- MySQL/MariaDB: comentários versionados `/*!40101`, `LOCK TABLES`,
  `AUTO_INCREMENT`, `ENGINE=`, identificadores com crase.
- MariaDB (além dos de MySQL): `/*M!100101`, cabeçalho `-- MariaDB dump`.
- PostgreSQL: `\connect`, `FROM stdin;`, terminador `\.`, `SET search_path`,
  `OWNER TO`, `pg_catalog.`.

Regras de decisão:

- Marcadores dos dois lados ao mesmo tempo: só decide se um lado estiver à
  frente por 2 ou mais acertos; senão retorna `{ format: null }`.
- SQL genérico (só `CREATE TABLE` / `INSERT INTO`, sem marcador de engine):
  retorna `mysql` com `confidence: 'assumed'` — o leitor MySQL é um superconjunto
  do SQL portátil.
- Nada reconhecível: `{ format: null }`, e `parseDump` lança
  `UnsupportedFormatError`.

A distinção `detected` vs `assumed` existe para a UI não afirmar que reconheceu
um engine quando na verdade apenas chutou.

## 2. Parsing — `packages/core/src/parser/`

### Despacho

`parser/index.ts` mantém um registro:

```ts
const PARSERS: Record<DatabaseFormat, FormatParser> = {
  mysql: createMysqlParser('mysql'),
  mariadb: createMysqlParser('mariadb'),
  postgresql: postgresParser,
}
```

Esse é o **único** ponto do projeto que despacha por formato. Adicionar um engine
= uma entrada aqui + um módulo de parser.

### O contrato `FormatParser` — `parser/shared/format-parser.ts`

```ts
interface FormatParser {
  format: DatabaseFormat
  parse(sql): SqlDump               // caminhada estrutural
  readColumns(createStmt): string[] // nomes de coluna, em ordem de declaração
  readDataBlock(stmt): DataBlock    // decodifica valores das linhas
  countDataRows(stmt): number       // conta linhas sem decodificar valores
}
```

`countDataRows` existe separado de propósito: contar linhas de todas as tabelas
de um dump grande é barato porque não decodifica nenhum valor.

### 2a. Tokenização

Antes de classificar qualquer coisa, o texto é quebrado em statements. Isso não é
um `split(';')` — é uma máquina de estados que respeita aspas e comentários.

**MySQL** (`parser/mysql/index.ts`, `splitStatements`): aspas simples, aspas
duplas, crases, escapes com barra invertida, comentários `--`, `#` e `/* */`.
Só quebra no `;` quando está no estado neutro.

**PostgreSQL** (`parser/postgresql/lexer.ts`): tudo o acima, menos os escapes com
barra (strings padrão), mais três coisas que não são SQL:

- meta-comandos do psql (`\connect`)
- corpos com dollar-quote (`$$ ... $$`, `$tag$ ... $tag$`)
- blocos `COPY ... FROM stdin;` cujas linhas de dados são texto cru e **podem
  conter ponto e vírgula** — o lexer lê até a linha terminadora `\.`.

Regras léxicas compartilhadas ficam em `parser/shared/syntax.ts`:
`readBalanced` (lê parênteses balanceados respeitando aspas), `splitTopLevel`
(quebra em vírgulas de profundidade zero), `stripLeadingComments`,
`unquoteIdentifier`. Elas recebem um `SqlSyntax` (`MYSQL_SYNTAX` ou
`POSTGRES_SYNTAX`) que diz quais aspas delimitam identificador e se a barra
invertida escapa.

### 2b. Classificação e montagem do modelo

Cada statement é classificado pelas palavras-chave iniciais e vai para um slot
do modelo normalizado (`types/index.ts`):

```ts
SqlDump   { format, preamble, databases[], postamble }
Database  { name, catalog?, createStatement, useStatement, tables[] }
Table     { name, database, format,
            createStatement,
            preDataStatements[],   // antes das linhas (LOCK TABLES, etc.)
            dataStatements[],      // as linhas: INSERT ou bloco COPY
            postDataStatements[] } // depois (UNLOCK, índices, constraints)
```

O texto de cada statement é guardado **verbatim**. Por isso a exportação SQL
reproduz o dialeto de origem — o projeto não converte dialeto: um dump
PostgreSQL sai como SQL PostgreSQL.

Casos de borda tratados no MySQL:

- `mysqldump <db>` não escreve `CREATE DATABASE` nem `USE`. O nome é recuperado do
  cabeçalho `-- Host: ... Database: shop` (`databaseNameFromHeader`); sem isso as
  tabelas não teriam onde se ligar e o dump pareceria vazio.
- `INSERT` sem `CREATE TABLE` anterior cria uma tabela *placeholder* com
  `createStatement: ''`.
- Comentários versionados (`/*!40101 SET ... */`) são statements reais em
  servidores compatíveis, então são classificados pelo conteúdo interno, não
  como comentário.

No PostgreSQL, além disso: `search_path` / `set_config`, `\connect`, sequências
(`CREATE/ALTER SEQUENCE`, `setval`), `ALTER TABLE` para constraints diferidas.
Tabelas sem qualificação de schema caem em `public` (`DEFAULT_SCHEMA`).

O modelo também abstrai a diferença de nomenclatura: MySQL/MariaDB agrupam por
*database*, PostgreSQL por *schema*. `describeFormat()` devolve o rótulo certo
(`namespaceLabel`) para a UI não chamar schema de database.

## 3. Achatamento tabular — `packages/core/src/tabular/index.ts`

**Este é o passo que transforma statements SQL em linhas e colunas.**

`toTabular(table): TabularTable` faz:

1. `parser.readColumns(table.createStatement)` — extrai os nomes de coluna do
   `CREATE TABLE`, na ordem de declaração, pulando cláusulas de constraint
   (`PRIMARY`, `KEY`, `FOREIGN`, `CHECK`, ...).
2. Para cada statement em `dataStatements`, chama `parser.readDataBlock(stmt)`,
   que devolve `{ columns, rows }`:
   - **MySQL** (`parser/mysql/rows.ts`): lê as tuplas depois de `VALUES`
     (`readTuples`) e decodifica cada literal (`decodeLiteral`): `NULL` vira
     `null`, remove aspas, resolve `\n \t \r \0` e aspas duplicadas.
   - **PostgreSQL** (`parser/postgresql/rows.ts`): dois caminhos que convergem na
     mesma forma —
     - bloco `COPY`: campos separados por tab, `\N` é null, escapes
       `\n \t \r \b \f \v \\`;
     - `INSERT` (`pg_dump --inserts`): strings padrão (só aspas duplicadas
       escapam), `E'...'` reativa barras invertidas, e o cast final
       (`'{}'::jsonb`) é removido por ser informação de tipo, não valor.
3. **Alinhamento**: se o statement nomeia suas colunas (`INSERT INTO t (a, b)`),
   os valores são remapeados para a ordem do `CREATE TABLE`; coluna ausente vira
   `null`. Se não nomeia, os valores entram na ordem em que vieram.
4. **Fallback sem DDL**: dump com linhas mas sem `CREATE TABLE` ainda produz
   saída útil — usa a lista de colunas declarada no primeiro statement de dados
   se o tamanho bater, senão gera `column_1`, `column_2`, ...

Resultado: `{ name, columns: string[], rows: (string | null)[][] }` — a forma que
CSV e XLSX consomem. Nada aqui é específico de dialeto: qual engine escreveu o
dump muda *como um statement é decodificado*, nunca *como as linhas se alinham
às colunas*.

`countRows(table)` percorre os mesmos `dataStatements` chamando `countDataRows`,
sem decodificar valores — é o número mostrado na UI por tabela. Um `INSERT`
multi-linha conta como suas linhas, não como um statement.

## 4. Geração de saída — `packages/core/src/generator/index.ts`

`generateExport(dump, options, format)` é o orquestrador:

1. Encontra o database selecionado; erro se não existir.
2. Filtra as tabelas (`'all'` ou lista de nomes); erro se a seleção for vazia.
3. Ramifica por formato de saída.
4. Empacota tudo num ZIP com `fflate` (`createZip`) e devolve
   `{ filename, bytes, files[], tableCount }`.

Tudo é transformação pura de bytes: sem filesystem, sem rede, sem executar SQL.

### `sql`

Delega para `extractDatabase()` (`extractor/index.ts`), que remonta um arquivo
SQL na ordem de restauração: cabeçalho comentado, preamble, `CREATE DATABASE` +
`USE`, e por tabela `createStatement`, `preDataStatements`, `dataStatements`,
`postDataStatements`, e por fim o postamble. Cada statement sai exatamente como
estava no dump.

### `csv` — `toCsv(TabularTable)`

Um arquivo por tabela dentro do ZIP, com nomes deduplicados
(`tabela.csv`, `tabela_2.csv`).

- RFC 4180: só coloca aspas quando o valor contém vírgula, aspas ou quebra de
  linha; aspas internas viram `""`.
- **Neutralização de fórmula**: valor começando com `=`, `+`, `-`, `@`, tab ou CR
  recebe prefixo `'`. Conteúdo de dump é não confiável e o Excel/Sheets
  interpretaria como fórmula ao abrir (CSV injection).
- Terminações `\r\n` e BOM UTF-8 no início — sem o BOM o Excel lê UTF-8 errado.

### `xlsx` — `toXlsx(TabularTable[])`

Escreve um `.xlsx` do zero (nenhuma dependência de spreadsheet; só `fflate` para
zipar). Uma aba por tabela.

- Monta as partes OOXML mínimas: `[Content_Types].xml`, `_rels/.rels`,
  `xl/workbook.xml`, `xl/_rels/workbook.xml.rels`, `xl/worksheets/sheetN.xml`.
- Nomes de aba: máximo 31 caracteres, sem `: \ / ? * [ ]`, não vazio, único no
  workbook (`sheetName`).
- Escape XML, incluindo remoção dos caracteres de controle que XML 1.0 proíbe.
- Tipagem de célula: só vira número se casar com `NUMERIC` **e** não tiver zero à
  esquerda — códigos postais e IDs com zero à frente permanecem texto. O resto
  vai como `inlineStr` com `xml:space="preserve"`.

Nomes de arquivo passam por `safeFileName`: só `A-Za-z0-9._-`, sem ponto inicial,
máximo 100 caracteres, fallback `unnamed`.

---

## Como os apps usam isso

### CLI — `apps/cli/src/commands/extract.ts`

`resolveFormat(--format)`, `readSqlFile`, `parseDump`, prompts para escolher
database e tabelas, `extractDatabase`, `writeOutputFile`. O CLI hoje exporta
SQL; CSV/XLSX são o caminho do app web.

### Web — `apps/web/hooks/use-sql-dump.ts`

Roda inteiramente no navegador (nenhum upload ao servidor). `loadFile` chama
`detectFormat` uma vez e passa a resposta para `parseDump`, guardando a
`confidence` para a UI dizer se o engine foi reconhecido ou só assumido.
`convert` chama `generateExport` dentro de um `setTimeout(0)` para o estado
"convertendo" pintar antes de um dump grande bloquear a main thread. O `step`
é derivado do estado (`file`, `database`, `tables`, `export`), não guardado.

---

## Onde mexer

| Objetivo | Arquivo |
|---|---|
| Suportar um novo engine | `parser/index.ts` (registro) + novo módulo em `parser/<engine>/` implementando `FormatParser` |
| Corrigir detecção de formato | `formats/index.ts` (listas de marcadores) |
| Corrigir decodificação de valor / escape | `parser/<engine>/rows.ts` (`decodeLiteral`, `decodeCopyField`) |
| Corrigir extração de nomes de coluna | `parser/<engine>/rows.ts` (`readColumns`) |
| Corrigir alinhamento entre coluna e valor | `tabular/index.ts` (`toTabular`) |
| Mudar quoting/encoding do CSV | `generator/index.ts` (`csvCell`, `toCsv`) |
| Mudar tipagem de célula do XLSX | `generator/index.ts` (`sheetXml`, `NUMERIC`) |
| Mudar ordem do SQL exportado | `extractor/index.ts` |
