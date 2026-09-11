# Converter Hub — expansão v2: onde parou e o que falta

Continuação da task "Converter Hub — Implementação da expansão v2" (o prompt
longo com FASE 0 a FASE 7 e Grupos A a E). Tudo foi feito na `master`.

## Estado atual

Grupos A, B, C, D e E estão prontos e commitados. Falta só a entrega final da
FASE 7 e as pendências listadas no fim.

**Nada foi enviado para o GitHub.** Rode `git log origin/master..master` para
ver os commits locais e `git push` quando quiser publicar.

### Commits desta rodada

```
c630885 feat(web): add an Images tool for SVG and raster images
6e03d9d feat(web): export JSON Lines from the SQL tool
7a030d5 feat(web): add five text tools for encoding, case, timestamps, colors and JSON types
05e0204 fix(core): declare TextEncoder and TextDecoder for the core typecheck
```

### Números

- Gates: typecheck, lint, test e build passam.
- Testes: core 797, CLI 32, web 339.
- Nenhuma dependência nova nesta rodada. As únicas da expansão continuam sendo
  `yaml` e `marked`, as duas carregadas sob demanda.
- O tamanho do bundle por rota não foi medido de novo. O Next 16 não mostra
  esse número no build.

---

## O que já está pronto

### FASE 0 — Auditoria

- O SQLite já estava integrado ao `/sql` via `wa-sqlite`. O script em uso é
  `scripts/copy-sqlite-wasm.mjs`.
- `packages/core/src/formats/catalog.ts` continua específico de SQL.

### FASE 1 — Infraestrutura (`17a6671`, `e55367a`)

- `packages/core/src/csv`: `parseCsv` (RFC 4180) e `detectDelimiter`.
- `packages/core/src/records`: `parseJson`, `parseJsonl`, `toJsonl`,
  `recordsToTable` (o gate: desce por wrappers de uma propriedade, até 32
  camadas, e nunca achata), `tableToRecords` e `DataFormatError`.
- `apps/web/lib/download.ts`: `downloadFile`, que o `downloadZip` usa.

### Grupo A — Dados (`75f51b9`)

- `/data`: CSV, TSV, JSON, JSON Lines, YAML e XML de entrada. Saída em CSV, TSV,
  JSON, JSON Lines, YAML, Markdown, SQL e XLSX.
- `apps/web/lib/formats.ts` é o catálogo de formatos genéricos. Os cards do hub
  saem das listas `*_INPUTS` e `*_OUTPUTS` dele.

### Grupo B — Estrutura (`f803576`, `361e0c2`)

- XML no `/data`, via `DOMParser` (`apps/web/lib/xml.ts`).
- `/markdown`: Markdown → HTML com `marked`, e HTML → Markdown com
  `DOMParser`. Não tem preview.

### Grupo C — Utilidades de texto (`317b583`, `5879567`, `05e0204`, `7a030d5`)

- Core, em `packages/core/src/utilities`:
  - `encoding` (Base64 e hex via UTF-8, URL, entidades HTML);
  - `case` (7 estilos);
  - `timestamp` (abaixo de 1e11 é segundos, ISO sem offset vira UTC e o
    resultado avisa);
  - `color` (HEX, rgb(), hsl(); valor fora da faixa é recusado);
  - `json-to-typescript`.
- O typecheck do core falhava por falta de `TextEncoder`/`TextDecoder` no lib
  ES2022. Foi resolvido com uma declaração mínima em
  `packages/core/src/text-encoding.d.ts`, sem incluir o DOM.
- Web: um só componente, `apps/web/components/text-tool.tsx`, guiado por uma
  tabela `SPECS` com uma entrada por ferramenta:
  - modo por `RadioGroup` quando há mais de um;
  - saída somente leitura;
  - botões Copiar e Download (`.txt`, ou `.ts` no JSON to TypeScript);
  - conversão ao vivo;
  - erro num `Alert`, só com `DataFormatError` ou uma mensagem genérica.
- Rotas: `/encoding`, `/case`, `/timestamp`, `/color`, `/json-to-typescript`.
- Uma ferramenta de texto nova precisa de uma entrada em `SPECS`, uma no
  `tools.ts` e um `app/<rota>/page.tsx`.

### Grupo D — Imagens (`c630885`)

- `/image`: SVG, PNG, JPEG, WebP e AVIF de entrada. PNG, JPEG e WebP de saída,
  num arquivo só.
- `apps/web/lib/image.ts`: `Image` a partir de Blob URL, depois canvas, depois
  `toBlob`. Não usa biblioteca.
- **Segurança:**
  - o SVG é validado pelo conteúdo (`DOMParser`, raiz `<svg>` no namespace
    SVG);
  - ele só é carregado via `<img>`, nunca injetado no DOM;
  - verificado no Chromium de verdade: o `<script>` e o `<image>` externo do
    fixture não rodam e não são buscados.
- JPEG é pintado sobre fundo branco. O lado máximo é 16384 px. Se o navegador
  não gerar o formato pedido, isso é avisado.
- AVIF é só entrada.
- Fixture: `examples/image/sample.svg`.

### Grupo E — SQLite (`6e03d9d`)

- JSON Lines como saída do `/sql`, tanto para dumps (`textExport` em
  `hooks/use-sql-dump.ts`) quanto para SQLite (`buildSqliteExport`). Um
  `.jsonl` por tabela.
- Usa `toJsonl` e `tableToRecords` do core.

---

## O que falta

### FASE 7 — Entrega final

Escrever a entrega no formato da seção 32 do prompt: Implementado, Formatos,
Arquitetura, Dependências, Segurança, Quality gates e Adiado. A auditoria
desta rodada já conferiu:

- que toda ferramenta do registry tem página (há teste para isso);
- que os cards de Data, Markdown e Image saem das mesmas listas que o conversor
  usa;
- que não entrou nenhuma dependência nova.

### Pendências

1. **Bug no Windows:** `apps/web/scripts/ensure-react-symlinks.mjs`, rodado
   pelo `test` da web, apaga `apps/web/node_modules/react` e depois falha com
   `EPERM` no `symlinkSync` quando o Windows está sem Developer Mode.
   - Enquanto isso, rode `bun install` para restaurar e depois, dentro de
     `apps/web`, `bunx vitest run`.
   - Correção sugerida: usar junction no win32 e não apagar antes de conseguir
     criar o link.
2. **Rodapé do hub:** diz "no SQL is ever executed". Com SQLite, isso não é
   exato. Proposta: "no SQL from your files is ever executed". Fica a cargo do
   dono.
3. **Mensagem do `parseJson`:** diz "This file is not valid JSON." até no JSON
   to TypeScript, onde o JSON é colado, não é arquivo.
4. **SVG sem width/height absolutos:** é desenhado em 300×150 (o padrão do
   navegador). Ler o `viewBox` só se isso incomodar alguém.

---

## Convenções e armadilhas

- **TDD:** escreva o teste, veja falhar, e só então implemente. Fixtures só
  sintéticas, em `examples/`.
- **Commits separados por assunto.** `git add -p` não funciona no ambiente do
  Claude.
- **Gates:** `bun run typecheck`, `bun run lint`, `bun run test` e
  `bun run build`.
- **Depois de mexer no core**, rode `bun run --filter @sql-extractor/core build`
  antes do typecheck da web. A web lê o core pelo `dist`.
- **Máquina nova:** rode `bun install` antes de tudo. Sem isso falta o
  `wa-sqlite` e o typecheck do core quebra.
- **Formatação:** `bunx biome format --write <arquivos>`.
- **BOM e caracteres de controle:** use sempre escape (`'FEFF'`), nunca o
  caractere literal.
- Teste que tem JSX precisa ser `.tsx`.
- **UI:** componentes COSS e nenhuma classe de cor no `className`.
- **Mensagens de erro:** nunca mostrar mensagem de parser. Só
  `DataFormatError`, `SqliteReadError` ou uma mensagem genérica.

## Arquivos para testar à mão

- `examples/data/*` no `/data`.
- `examples/markdown/sample.{md,html}` no `/markdown`.
- `examples/image/sample.svg` no `/image`.
- Qualquer texto nas cinco ferramentas de texto.
- Dev server: `bun run dev:web` e depois `http://localhost:3000`.
