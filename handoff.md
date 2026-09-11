# Converter Hub — expansão v2: concluída

Continuação da task "Converter Hub — Implementação da expansão v2" (FASE 0 a
FASE 7, Grupos A a E). Tudo foi feito na `master`.

## Estado

Todas as fases e grupos estão prontos e commitados, e as pendências da rodada
anterior foram resolvidas. A entrega final da FASE 7 está logo abaixo.

**Nada foi enviado para o GitHub.** Rode `git log origin/master..master` para
ver os commits locais e `git push` para publicar.

---

## Entrega final (FASE 7)

### Implementado

| Grupo | Rota | Commits |
|-------|------|---------|
| Infraestrutura | — | `17a6671`, `e55367a` |
| A — Dados | `/data` | `75f51b9` |
| B — Estrutura | XML no `/data`, `/markdown` | `f803576`, `361e0c2` |
| C — Utilidades de texto | `/encoding`, `/case`, `/timestamp`, `/color`, `/json-to-typescript` | `317b583`, `5879567`, `05e0204`, `7a030d5` |
| D — Imagens | `/image` | `c630885`, `4aadf4d` |
| E — SQLite | JSON Lines no `/sql` | `6e03d9d` |

Correções desta rodada:

- `f0b189a`: o script de symlink do React agora funciona no Windows sem
  Developer Mode.
- `640036c`: a mensagem de JSON inválido não fala mais em "arquivo".
- `4aadf4d`: um SVG só com `viewBox` é desenhado no tamanho do `viewBox`.
- `d849872`: o rodapé do hub e os READMEs dizem "no SQL from your files is ever
  executed".

### Formatos

| Ferramenta | Lê | Escreve |
|------------|----|---------|
| Spreadsheets | XLSX, XLSM, XLS, XLSB, ODS, CSV, TSV | XLSX, CSV, JSON, Markdown, SQL |
| SQL | dumps SQL, bancos SQLite | SQL, CSV, XLSX, JSON, JSON Lines, Markdown |
| Data | CSV, TSV, JSON, JSON Lines, YAML, XML | CSV, TSV, JSON, JSON Lines, YAML, Markdown, SQL, XLSX |
| Markdown | Markdown, HTML | HTML, Markdown |
| Encoding | texto, Base64, hex, URL, entidades HTML | os mesmos |
| Case | texto | 7 estilos de identificador |
| Timestamps | Unix s/ms, ISO 8601 | Unix s/ms, ISO 8601 UTC |
| Colors | HEX, RGB, HSL | HEX, RGB, HSL |
| JSON to TypeScript | JSON | TypeScript |
| Images | SVG, PNG, JPEG, WebP, AVIF | PNG, JPEG, WebP |

### Arquitetura

- `apps/web/lib/tools.ts` é o registry. Cada ferramenta tem uma entrada ali e
  uma rota, e há teste garantindo que toda entrada tem página.
- `apps/web/lib/formats.ts` é o catálogo dos formatos genéricos. Os cards de
  Data, Markdown e Images saem das mesmas listas que o conversor usa.
- Parsers e utilidades puras ficam no core (`csv`, `records`, `utilities`). O
  que depende do navegador (`DOMParser`, canvas, `yaml`, `marked`) fica em
  `apps/web/lib`.
- As cinco ferramentas de texto são um único componente, `text-tool.tsx`,
  guiado pela tabela `SPECS`.

### Dependências

- Na expansão entraram só `yaml` e `marked`, os dois carregados sob demanda.
- As imagens não usam biblioteca: `Image`, canvas e `toBlob`.
- JS por rota, somando os chunks do HTML pré-renderizado, sem compressão:

  | Rota | JS |
  |------|----|
  | hub | 562 KB |
  | `/spreadsheet` | 722 KB |
  | `/sql` | 800 KB |
  | `/data` | 689 KB |
  | `/markdown` | 652 KB |
  | cada ferramenta de texto | 666 KB |
  | `/image` | 684 KB |

### Segurança

- **Mensagens de erro:** só `DataFormatError`, `SqliteReadError` ou uma
  mensagem genérica. Nunca a mensagem de um parser, que pode citar a entrada.
- **XML e HTML:** lidos com `DOMParser`, que não executa nada. Entidades
  externas nunca são resolvidas.
- **Markdown:** o HTML cru é escapado. Nos links e imagens só passam `http`,
  `https`, `mailto` e endereços relativos.
- **SVG:** validado pelo conteúdo e carregado só via `<img>` a partir de Blob
  URL. Verificado no Chromium: o `<script>` e o `<image>` externo do fixture
  não rodam e não são buscados. O SVG nunca é injetado no DOM.
- **CSP:** a de `next.config.ts` permite `img-src blob:` e mantém
  `connect-src 'self'`.

### Quality gates

- `bun run typecheck`, `bun run lint`, `bun run test` e `bun run build`
  passam.
- Testes: core 797, CLI 32, web 341.

### Adiado

- AVIF como saída: `canvas.toBlob` não gera AVIF em geral.
- Nenhum preview renderizado de HTML ou SVG. É intencional.

---

## Convenções e armadilhas

- **TDD:** escreva o teste, veja falhar, e só então implemente. Fixtures só
  sintéticas, em `examples/`.
- **Commits separados por assunto.** Para commitar só parte de um arquivo, gere
  a versão parcial a partir de `git show HEAD:<arquivo>`, grave com
  `git hash-object -w` e coloque no índice com `git update-index --cacheinfo`.
- **Depois de mexer no core**, rode `bun run --filter @sql-extractor/core build`
  antes do typecheck da web.
- **Máquina nova:** rode `bun install` antes de tudo.
- **Formatação:** `bunx biome format --write <arquivos>`.
- **BOM e caracteres de controle:** use sempre o escape, nunca o caractere
  literal. O editor tende a inserir U+FEFF literal.
- **UI:** componentes COSS e nenhuma classe de cor no `className`.
