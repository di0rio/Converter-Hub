# Converter Hub — expansão v2: onde parou e o que falta

Continuação da task "Converter Hub — Implementação da expansão v2" (o prompt
longo com FASE 0 a FASE 7 e Grupos A a E). Tudo foi feito na `master`, na
máquina do trabalho.

## ATENÇÃO antes de sair desta máquina

1. **Nada foi enviado para o GitHub.** A `master` local tem 5 commits que o
   `origin/master` não tem:

   ```
   361e0c2 feat(web): add a Markdown tool for Markdown and HTML
   f803576 feat(web): read XML in the Data tool
   75f51b9 feat(web): add a Data tool for structured files
   e55367a feat(web): download a single file as well as a ZIP
   17a6671 feat(core): add a CSV parser and a gate from JSON to tables
   ```

2. **O Grupo C está em andamento e NÃO está commitado.** Arquivos soltos:

   ```
   M  packages/core/src/index.ts           (exports das utilidades)
   M  packages/core/src/sqlite/index.ts    (passou a usar bytesToBase64)
   ?? packages/core/src/utilities/         (encoding, case, timestamp, color, json-to-typescript)
   ?? packages/core/tests/{encoding,case,timestamp,color,json-to-typescript}.test.ts
   ```

Para continuar em casa: commitar esse trabalho em andamento (ou guardar com
`git stash`) e dar `git push` na `master` antes de sair, ou copiar o
repositório. Sem isso, a outra máquina não terá nada disto.

---

## O que já está pronto

### FASE 0 — Auditoria (feita)

- O SQLite já está integrado ao `/sql` usando só `wa-sqlite`. As referências a
  `sql.js` e `copy-sql-wasm.mjs` existem só num worktree velho em
  `.claude/worktrees/` e não no código ativo. O script em uso é
  `scripts/copy-sqlite-wasm.mjs`. O prompt assumia um estado anterior a esse.
- `packages/core/src/formats/catalog.ts` continua específico de SQL e não foi
  mexido.
- `packages/core/src/csv` existia como pasta vazia, ou seja, não havia parser
  de CSV. O CSV era lido só pelo SheetJS, na web.

### FASE 1 — Infraestrutura (commits `17a6671`, `e55367a`)

- `packages/core/src/csv/index.ts`: `parseCsv` (RFC 4180: aspas, delimitador
  e quebra de linha dentro de aspas, BOM, CRLF/LF/CR) e `detectDelimiter`
  (vírgula, ponto e vírgula ou tab, lido da linha de cabeçalho).
- `packages/core/src/records/index.ts`:
  - `parseJson` e `parseJsonl`; o erro diz só o número da linha, nunca o
    conteúdo.
  - `toJsonl`.
  - `recordsToTable`, o gate estrutural: aceita uma lista de registros planos.
    Desce por objetos com exatamente uma propriedade até achar a lista
    (`{items:[...]}`, `<people><person>`), com limite de 32 camadas, e recusa
    qualquer coisa aninhada. Nunca achata.
  - `tableToRecords`.
  - `DataFormatError`, cuja mensagem é segura para mostrar.
- `apps/web/lib/download.ts`: `downloadFile(content, filename, type)`. O
  `downloadZip` passou a chamar ele.
- `DownloadStep` aceita `result.type` e o botão mostra "Download CSV",
  "Download HTML" etc. O ZIP continua como "Download ZIP".

### Grupo A — Dados (commit `75f51b9`)

- Uma ferramenta só, `/data`, em vez de quatro: `components/data-converter.tsx`,
  `lib/data-convert.ts` e `app/data/page.tsx`.
- Entradas: CSV, TSV, JSON, JSON Lines, YAML (e XML, no Grupo B).
- Saídas: CSV (com delimitador), TSV, JSON, JSON Lines, YAML, Markdown, SQL
  e XLSX. É um arquivo único, sem ZIP.
- `apps/web/lib/formats.ts` é o catálogo pequeno de formatos genéricos
  (rótulo, extensões, MIME) e tem as listas `DATA_INPUTS`, `DATA_OUTPUTS`,
  `MARKDOWN_INPUTS` e `MARKDOWN_OUTPUTS`.
  - O card do hub é derivado dessas listas.
  - O `tools.ts` importa só `formats.ts`, para o hub não carregar os writers.
- Dependência nova: `yaml` (ISC, 103 KB, em chunk separado, só carrega sob
  demanda). Foi escolhida sobre o `js-yaml` porque protege contra "YAML
  bomb" por padrão (`maxAliasCount`).
- Fixtures em `examples/data/`: `people.{csv,tsv,json,jsonl,yaml,xml}` e
  `nested.json`, que de propósito não forma tabela.

### Grupo B — Estrutura (commits `f803576`, `361e0c2`)

- **XML** é entrada do `/data`, em `apps/web/lib/xml.ts`, usando `DOMParser`.
  O formato de saída é fixo:
  - `{root: …}`;
  - atributos como `@attr`;
  - elemento repetido vira lista;
  - texto misturado com filhos vai em `#text`.

  XML malformado é recusado sem mostrar a mensagem do parser.
- **`/markdown`**, em `components/markdown-converter.tsx`, `lib/markdown.ts`
  e `app/markdown/page.tsx`:
  - Markdown → HTML usa `marked`, com 42 KB e carregado sob demanda. O HTML
    cru é escapado, e só passam links `http`, `https`, `mailto` e relativos.
  - HTML → Markdown usa `DOMParser` mais um serializador próprio para
    headings, parágrafos, links, imagens, listas, tabelas, código, ênfase e
    negrito.
  - Nenhum preview, nenhum `dangerouslySetInnerHTML`.
- Fixtures em `examples/markdown/sample.{md,html}`.

### Números no último commit (`361e0c2`)

- Gates: typecheck, lint, test e build passam. Core 746, CLI 32, web 316
  testes.
- Bundle por rota: hub 576 KB (sem mudança), `/data` 696 KB, `/markdown`
  662 KB.
- Revisão de escalabilidade dos Grupos A e B: nenhum problema estrutural.

---

## Onde parou: Grupo C — Developer utilities

### Feito, mas não commitado

- `packages/core/src/utilities/encoding.ts`:
  - `encodeBase64` e `decodeBase64` via UTF-8, sem `btoa`/`Buffer`;
  - hex, URL e entidades HTML;
  - `bytesToBase64`, que o SQLite agora usa: o `toBase64` privado dele saiu.
- `case.ts`: `toCase` com `CASE_STYLES` (camel, pascal, snake, kebab,
  screaming, dot, title). Converte linha por linha.
- `timestamp.ts`: `convertTimestamp`.
  - Número inteiro abaixo de 1e11 é lido como segundos; acima, como
    milissegundos.
  - ISO sem offset é lido como UTC, e o resultado diz isso
    (`iso-assumed-utc`).
- `color.ts`: `convertColor` para HEX, rgb() e hsl(). Valor fora da faixa é
  recusado, nunca ajustado.
- `json-to-typescript.ts`: `jsonToTypeScript`.
  - Faz união de tipos, campos opcionais e usa `unknown` em vez de `any`.
  - Nomes são determinísticos (`PeopleItem`, `A2`), e chaves que não são
    identificador válido vão entre aspas.
- Testes: os 72 do core passam.

### Primeiro item a resolver

`bun run typecheck` falha no core:

```
src/utilities/encoding.ts: Cannot find name 'TextDecoder' / 'TextEncoder'
```

O `tsconfig` do core não inclui tipos que declarem `TextEncoder` e
`TextDecoder`. Veja `packages/core/tsconfig.json` e escolha a menor correção:

- adicionar `"DOM"` ao `lib` do core; fácil, mas deixa o core "ver" o DOM;
- ou declarar só os dois tipos, `TextEncoder` e `TextDecoder`, num `.d.ts`
  mínimo do core. Esta é a mais limpa.

Depois disso, confirme de novo que `bun run typecheck` passa.

### Falta no Grupo C

1. Componente compartilhado `apps/web/components/text-tool.tsx`, com cinco
   usuários, o que justifica ele existir:
   - textarea de entrada (COSS `Textarea`);
   - escolha de modo com COSS `RadioGroup`, quando houver modo;
   - saída somente leitura;
   - botão Copiar opcional (`navigator.clipboard.writeText`, com try/catch);
   - botão Download (`downloadFile`, `.txt` ou `.ts`);
   - conversão ao vivo, com erro mostrado num `Alert` usando a mensagem de
     `DataFormatError`;
   - sem classes de cor no `className`.
2. As cinco rotas, cada uma com `app/<rota>/page.tsx` e entrada no `tools.ts`:
   - `/encoding`: Base64, Hex, URL e entidades HTML, codificar e decodificar;
   - `/case`: os 7 estilos;
   - `/timestamp`: sem modo; mostra segundos, milissegundos e ISO UTC, e o
     que foi assumido;
   - `/color`: sem modo; mostra HEX, rgb e hsl;
   - `/json-to-typescript`: sem modo; saída `.ts`.
3. Testes de UI para cada ferramenta e `tools.test.ts` atualizado. A lista de
   ids é fixa ali, e existe o teste de que toda ferramenta tem página.
4. Docs: README (tabela e seções), AGENTS.md, `apps/web/README.md` e
   CHANGELOG.
5. Gates, revisão de escalabilidade do grupo e commits separados:
   - `feat(core): add text utilities for encoding, case, timestamps, colors and JSON types`;
   - um `feat(web): add … tool` por ferramenta, ou um só para a UI
     compartilhada mais as rotas.

---

## Depois do Grupo C

### Grupo D — Imagens / SVG

- SVG → PNG, WebP e JPEG sem biblioteca: `Image`, depois Blob URL, depois
  `canvas`, depois `canvas.toBlob()`.
- **Segurança:**
  - SVG carregado via `<img>` (Blob URL) não executa script nem busca
    recurso externo;
  - nunca injetar o SVG no DOM, nunca usar `dangerouslySetInnerHTML`;
  - validar pelo conteúdo (`DOMParser`, raiz `<svg>`), não pela extensão;
  - se não der para garantir segurança, adiar e documentar.
- **Imagens:** PNG, JPEG e WebP de entrada e de saída. AVIF só como entrada,
  onde o navegador decodifica. `canvas.toBlob` não gera AVIF em geral, então
  não anunciar AVIF como saída.
- Uma ferramenta só (`/image`) provavelmente basta para SVG e raster. Avaliar.

### Grupo E — SQLite

- O fluxo básico já funciona, integrado ao `/sql`. Falta só a saída JSONL:
  - em `apps/web/lib/sqlite-export.ts` (`buildSqliteExport`);
  - no `textExport` de `hooks/use-sql-dump.ts`;
  - no `output` da entrada `sql` do `tools.ts`;
  - nos testes.
- Usar `toJsonl` e `tableToRecords` do core. Não criar outro parser.

### FASE 7 — Documentação e auditoria final

- Revisar bundle, dependências, segurança, docs, registry, catálogo, rotas, e
  que nenhuma capacidade anunciada seja falsa.
- Entrega final no formato da seção 32 do prompt: Implementado, Formatos,
  Arquitetura, Dependências, Segurança, Quality gates, Adiado.

---

## Convenções e armadilhas (aprendidas nesta sessão)

- **TDD:** escreva o teste, veja falhar, e só então implemente. Fixtures só
  sintéticas, em `examples/`.
- **Commits separados por assunto.** Quando um arquivo mistura dois assuntos,
  a técnica usada foi: guardar uma cópia, reverter temporariamente a parte do
  outro assunto, commitar, e restaurar a cópia. `git add -p` não funciona no
  ambiente do Claude.
- **Gates:**

  ```bash
  bun run typecheck
  bun run lint
  bun run test
  bun run build
  ```

- **Depois de mexer no core**, rode `bun run --filter @sql-extractor/core build`
  antes do typecheck da web. A web lê o core pelo `dist`.
- **Formatação:** `bunx biome format --write <arquivos>` nos arquivos
  alterados.
- **BOM e caracteres de controle:** o editor tende a inserir U+FEFF literal.
  Use sempre `'﻿'` e `' '` como escape.
- Teste que tem JSX precisa ser `.tsx`.
- **UI:** componentes COSS e nenhuma classe de cor no `className`.
- **Mensagens de erro:** nunca mostrar mensagem de parser. Só `DataFormatError`
  ou `SqliteReadError`, ou uma mensagem genérica.
- **Pendência antiga:** o rodapé do hub diz "no SQL is ever executed". Com
  SQLite, isso não é exato. Proposta: "no SQL from your files is ever
  executed". Não foi alterado porque é uma afirmação factual do dono.

## Arquivos para testar à mão

- `examples/data/*` no `/data`.
- `examples/markdown/sample.md` e `sample.html` no `/markdown`.
- Dev server: `bun run dev:web` e depois `http://localhost:3000`.
