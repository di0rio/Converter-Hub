---
name: security
description: "Use when reviewing code for security vulnerabilities, SQL injection risks, malicious input handling, path traversal, unsafe file operations, or dependency security. Covers OWASP guidelines and secure coding practices."
---

# Security Skill

## Threat Model

This tool processes untrusted SQL dump files that may contain:
- Malicious SQL designed to exploit the parser
- Path traversal attempts in file operations
- Sensitive data (passwords, API keys, personal information)
- Binary data disguised as SQL
- Extremely large files designed to cause DoS

## SQL Injection Prevention

- Never execute SQL from untrusted input - parse only
- Sanitize all output generated from parsed input
- Use parameterized queries if database interaction is needed
- Validate SQL structure before processing

## Path Traversal Prevention

- Validate all file paths before operations
- Use `path.resolve()` and verify the result is within expected directories
- Reject paths containing `..` segments
- Use `path.basename()` when extracting file names

## File Handling

- Validate file types before processing
- Set maximum file size limits
- Use streaming for large files
- Close file handles properly (use try/finally)
- Don't follow symlinks without validation

## Sensitive Data

- Never log SQL contents, INSERT values, or table data
- Never log passwords, tokens, API keys, or credentials
- Never store uploaded files permanently
- Process and discard - no persistent storage
- Strip sensitive data from error messages

## Logging Safety

```typescript
// BAD - logs sensitive data
console.log(`Processing SQL: ${sqlContent}`)
console.log(`Found password: ${row.password}`)

// GOOD - logs only safe metadata
console.log(`Processing file: ${fileName} (${fileSize} bytes)`)
console.log(`Found ${rowCount} rows in table: ${tableName}`)
```

## Dependency Security

- Audit dependencies before adding
- Use `npm audit` or equivalent
- Prefer well-maintained, popular packages
- Pin dependency versions
- Review changelogs for security fixes

## Error Handling

- Don't expose internal error details to users
- Don't include file contents in error messages
- Log errors with context for debugging
- Use generic error messages for user-facing output
