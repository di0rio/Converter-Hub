---
name: secure-coding
description: "Use when implementing secure coding practices, input validation, output encoding, error handling, authentication patterns, or cryptographic operations. Covers OWASP secure coding guidelines."
---

# Secure Coding Skill

## Input Validation

- Validate all inputs at system boundaries
- Use allowlists over denylists
- Validate file types, sizes, and content
- Reject unexpected input early
- Normalize input before validation

```typescript
// Validate file extension
const allowedExtensions = ['.sql']
const ext = path.extname(filename).toLowerCase()
if (!allowedExtensions.includes(ext)) {
  throw new Error(`Invalid file type: ${ext}`)
}
```

## Output Encoding

- Encode output appropriate to the context
- HTML-encode output displayed in web pages
- SQL-encode output used in SQL queries
- Never trust parsed data for output without encoding

## Error Handling

- Don't expose internal details in error messages
- Use typed errors for different failure modes
- Log errors with sufficient context for debugging
- Fail securely - deny by default on errors
- Clean up resources in error paths

```typescript
// GOOD - typed, safe error
class ParseError extends Error {
  constructor(message: string, public readonly fileName: string) {
    super(`Parse error in ${fileName}: ${message}`)
  }
}

// BAD - exposes internals
throw new Error(`Failed at position ${pos} in buffer: ${buf.toString()}`)
```

## Cryptographic Operations

- Use well-established libraries (never roll your own crypto)
- Use appropriate algorithms for the use case
- Handle key material securely
- Don't log keys, tokens, or secrets

## File Operations

- Validate paths before operations
- Use `path.resolve()` and verify containment
- Set appropriate file permissions
- Handle symbolic links carefully
- Close resources in finally blocks

## Dependency Management

- Audit dependencies for known vulnerabilities
- Use `npm audit` regularly
- Pin versions in lockfiles
- Review transitive dependencies
- Prefer minimal dependency trees

## Secrets Management

- Never hardcode secrets in source code
- Use environment variables for configuration
- Never commit `.env` files
- Rotate secrets regularly
- Use `.gitignore` for sensitive files

## Denial of Service Prevention

- Set maximum file size limits
- Set maximum processing time limits
- Use streaming for large files
- Implement rate limiting where applicable
- Handle resource exhaustion gracefully
