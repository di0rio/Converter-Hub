---
name: documentation
description: "Use when writing, reviewing, or maintaining project documentation. Covers README writing, API documentation, code comments, inline documentation, and documentation structure."
---

# Documentation Skill

## Documentation Types

### User Documentation
- README - Project overview and quick start
- USAGE - Detailed usage instructions
- EXAMPLES - Common use cases with examples

### Developer Documentation
- CONTRIBUTING - How to contribute
- ARCHITECTURE - System design and structure
- API - Library API reference

### Operational Documentation
- SECURITY - Security policy
- CHANGELOG - Version history
- LICENSE - Legal terms

## Writing Principles

- Be concise - developers don't read walls of text
- Use code examples - show, don't just tell
- Keep it current - outdated docs are worse than no docs
- Use clear headings - scannable structure
- Include prerequisites - don't assume knowledge

## Code Examples

```markdown
## Usage

Parse a SQL dump and extract specific tables:

\`\`\`typescript
import { parseSqlDump, extractTables } from '@sql-extractor/core'

const dump = await parseSqlDump('./dump.sql')
const extracted = extractTables(dump, ['users', 'posts'])
await writeExtractedSql(extracted, './output.sql')
\`\`\`
```

## API Documentation

For each public function/type:
- One-line description
- Parameter descriptions with types
- Return value description
- Usage example
- Edge cases or limitations

## README Structure

```markdown
# SQL Database Extractor

One-line description.

## Installation

\`\`\`bash
npm install @sql-extractor/cli
\`\`\`

## Quick Start

\`\`\`bash
sql-extractor extract --file dump.sql --tables users,posts
\`\`\`

## Features

- Feature 1
- Feature 2

## Contributing

See [CONTRIBUTING.md](./CONTRIBUTING.md)

## License

MIT
```

## Maintenance

- Update docs with code changes
- Review docs in PR reviews
- Test all code examples
- Check for broken links
- Keep dependencies list current
