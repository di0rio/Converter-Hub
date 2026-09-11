# Security Policy

## Reporting Vulnerabilities

If you discover a security vulnerability in SQL Database Extractor, please report it responsibly.

**Do NOT open a public GitHub issue for security vulnerabilities.**

Instead, please email the maintainers directly (see the repository's contact information or GitHub profile). Include:

1. A description of the vulnerability
2. Steps to reproduce
3. The potential impact
4. Any suggested fixes (optional)

We will acknowledge receipt within 48 hours and aim to provide an initial assessment within one week.

## What Must NEVER Be Included in Reports

- **SQL dumps** — They may contain real personal data, credentials, or proprietary information.
- **Credentials** — Passwords, API keys, tokens, connection strings, or authentication data.
- **Personal data** — Names, emails, phone numbers, addresses, or any personally identifiable information.
- **Production data** — Any real data from your systems.

Use synthetic, fictional data in any examples or reproductions. The `examples/` directory contains a sample dump you can modify to demonstrate issues.

## Supported Versions

| Version | Supported |
|---------|-----------|
| 0.1.x   | Yes |

We provide security fixes for the latest release only.

## Security Model

SQL Database Extractor processes **untrusted input** (SQL dump files) and should be treated accordingly.

### What the Tools Do

- **SQL:** parses dump files with a per-engine parser and opens SQLite databases read-only with a SQLite engine compiled to WebAssembly. No SQL from your files is ever executed against anything.
- **Spreadsheets:** reads workbooks with SheetJS (the patched 0.20.3 build from the SheetJS CDN, locked by hash).
- **Data:** reads CSV, TSV, JSON, JSON Lines, YAML (alias expansion capped by the `yaml` library) and XML (with `DOMParser`, which resolves no external entity).
- **Markdown:** writes HTML with raw HTML escaped and only `http`, `https`, `mailto` and relative links kept. Nothing is rendered in the app.
- **Images:** an SVG is validated by content and loaded only through `<img>` from a Blob URL, so its scripts do not run and its external resources are not fetched. Images are capped at 16384 pixels a side and 64 million pixels in all.
- **JSON to TypeScript:** parses JSON and writes type declarations as text.
- Every output is built in memory and downloaded locally, as one file or a ZIP.

### Web App Processing Model

- Every tool runs entirely in the browser; files are read with `file.text()` or `file.arrayBuffer()` and nothing is uploaded
- No network requests are made for data processing, and links do not prefetch
- A Content Security Policy (`apps/web/next.config.ts`) limits `connect-src` and `form-action` to the app's own origin, so a compromised dependency has no route to send data out
- Error messages come only from the tools' own typed errors, never from a parser's message, which could quote the file
- No persistent storage of file contents
- Every file input has a size ceiling, checked before it is read

### What This Means

- **No absolute security guarantees.** The parser handles untrusted input. While every reasonable effort is made to handle input safely, bugs in parsing logic could theoretically cause unexpected behavior.
- **Memory considerations.** Files are loaded into memory. Extremely large files could exhaust available memory.
- **Client-side processing is not sandboxing.** The web app runs in the browser, but it processes untrusted input. Browser security boundaries apply, but they are not a substitute for careful input handling.
- **No server-side attack surface.** There is no server component processing your data. The attack surface is limited to the client-side parser and the CLI.

### Dependencies

This project depends on third-party packages. We rely on:

- Standard, well-maintained libraries (Commander, Next.js, React, Tailwind CSS)
- TypeScript's type system for compile-time safety
- Vitest for testing

For known vulnerabilities in dependencies, run `bun audit` or check the GitHub Security Advisories.

## Scope

The following are in scope for security reports:

- Parser crashes or unexpected behavior from crafted input to any tool
- Script execution or network access from a converted file (SVG, HTML, Markdown)
- Path traversal or file system access beyond intended scope
- Information disclosure through error messages
- Memory exhaustion through crafted input (beyond normal file size limits)

The following are out of scope:

- Bugs in the SQL dump file itself (the tool extracts, it doesn't validate dump integrity)
- Issues requiring physical access to the machine
- Social engineering attacks

## Disclosure Policy

We follow responsible disclosure. Please give us reasonable time to address vulnerabilities before public disclosure. We will credit reporters in the changelog unless they prefer to remain anonymous.
