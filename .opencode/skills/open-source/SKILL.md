---
name: open-source
description: "Use when preparing open-source release, writing CONTRIBUTING guides, LICENSE files, SECURITY policies, CHANGELOG management, or repository hygiene. Covers open-source best practices and community standards."
---

# Open Source Skill

## Required Files

Every open-source project should include:

### README.md
- Project description (what it does, why it exists)
- Installation instructions
- Usage examples
- Contributing link
- License badge

### LICENSE
- Choose an appropriate license (MIT for simple tools)
- Include the full license text
- Add copyright notice

### CONTRIBUTING.md
- How to set up the development environment
- How to run tests
- Code style guidelines
- Pull request process
- Issue templates

### SECURITY.md
- How to report security vulnerabilities
- Expected response time
- Scope of security coverage

### CHANGELOG.md
- Version history following Keep a Changelog format
- Added, Changed, Deprecated, Removed, Fixed categories

## Repository Hygiene

### .gitignore
```
node_modules/
.env
.env.*
*.log
dist/
.next/
.turbo/
coverage/
```

### Commit Messages
- Use conventional commits: `feat:`, `fix:`, `docs:`, `test:`, `refactor:`
- Keep subject line under 72 characters
- Use imperative mood ("Add feature" not "Added feature")

### Branch Naming
- `main` - production-ready code
- `feat/*` - feature branches
- `fix/*` - bug fix branches
- `docs/*` - documentation changes

## Sensitive Data Audit

Before public release:
1. Scan for hardcoded credentials
2. Check for API keys in code or config
3. Verify no real production data in tests
4. Ensure `.env` files are gitignored
5. Check git history for accidentally committed secrets
6. Verify no private URLs or internal endpoints

## Release Checklist

- [ ] All tests pass
- [ ] Type check passes
- [ ] Lint passes
- [ ] Build succeeds
- [ ] Documentation is up to date
- [ ] Changelog is updated
- [ ] No sensitive data in repository
- [ ] License is correct
- [ ] README has installation and usage instructions
