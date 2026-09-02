# SQL Database Extractor — Web Interface

A Next.js web interface for extracting databases and tables from MySQL, MariaDB and PostgreSQL dump files.

## Getting Started

```bash
# From the repository root
bun install
bun run dev:web
```

Open [http://localhost:3000](http://localhost:3000) and upload a `.sql` file.

## How It Works

1. Upload a `.sql` dump file (processed entirely in your browser — nothing is uploaded to a server)
2. Select a database
3. Select tables to extract
4. Download the extracted SQL

## Development

```bash
bun run dev          # Start Next.js dev server
bun run build        # Production build
bun run lint         # Lint
bun run typecheck    # Type check
bun run test         # Run tests
```

## Tech Stack

- Next.js 16 (App Router)
- React 19
- Tailwind CSS 4
- COSS UI (Base UI)
- TypeScript
