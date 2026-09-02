# Contributing to SQL Database Extractor

Thanks for your interest in contributing. This guide covers how to get started, what we expect, and how to keep the project clean and secure.

## Development Setup

```bash
git clone <repo-url> sql-database-extractor
cd sql-database-extractor
bun install
```

This is a Bun monorepo. `bun install` sets up workspaces for `packages/core`, `apps/cli`, and `apps/web`.

This repository deliberately has **no `postinstall` hook**. Installing dependencies should never execute project code, because maintainers install contributor branches in order to review them. The one setup step the web app needs (a React symlink fix required by Vitest under Bun workspaces) runs as part of `bun run test`, and can also be run on its own:

```bash
bun run --filter web setup
```

## Project Structure

```
packages/core/     SQL parsing, extraction logic, domain types (no I/O, no UI)
apps/cli/          CLI interface (imports from core, no UI code)
apps/web/          Next.js web interface (imports from core, no CLI code)
examples/          Synthetic sample SQL files
docs/              Documentation
```

### Package Boundaries

- `packages/core` must have no I/O or UI dependencies. Pure logic only.
- `apps/cli` may import from core. Must not contain UI code.
- `apps/web` may import from core. Must not contain CLI code.
- No cross-imports between CLI and Web.

## Coding Conventions

- **TypeScript strict mode.** All packages use strict TypeScript.
- **KISS, YAGNI, DRY.** Simplest solution that works. Don't build what you don't need.
- **English identifiers.** All variable names, function names, comments, and documentation in English.
- **Small modules.** Keep files focused on a single responsibility.
- **Simple APIs.** Minimal surface area. Prefer composition over inheritance.
- **Testable code.** Every function should be testable in isolation.

## Running Tests

```bash
# All tests
bun run test

# Single package
bun run --filter @sql-extractor/core test

# Watch mode
bun run --filter @sql-extractor/core test:watch
```

## Quality Gates

Before submitting a pull request, all of these must pass:

```bash
bun run typecheck
bun run lint
bun run test
bun run build
```

If any of these commands don't exist yet for a package, flag it rather than skipping silently.

## Commit Messages

We use [Conventional Commits](https://www.conventionalcommits.org/):

```
feat: add new extraction mode for views
fix: handle escaped quotes in INSERT statements
docs: update CLI usage examples
test: add parser tests for multi-database dumps
refactor: simplify table boundary detection
```

Keep subject lines under 72 characters. Use imperative mood ("Add feature" not "Added feature").

## Pull Request Process

1. Create a feature branch from `master`: `feat/my-feature` or `fix/my-bug`
2. Make your changes with clear, focused commits
3. Ensure all quality gates pass
4. Open a PR against `master`
5. Fill out the PR template completely

PRs should be focused. One logical change per PR. If you find unrelated issues, open a separate PR.

## Security Considerations

SQL dumps may contain sensitive data. These rules are non-negotiable:

### Sensitive Data Rules

- **Never commit real production dumps.** Use synthetic data only. The `examples/` directory has sample dumps you can use.
- **Never log SQL contents, INSERT values, passwords, tokens, API keys, or personal data.** Even in error messages or debug output.
- **All processing is local.** Do not add external API calls, cloud storage, analytics, or telemetry.
- **Do not commit `.env` files, credentials, production dumps, or private datasets.**

### Before You Commit

Run through this checklist:

```bash
# Check for accidentally staged sensitive files
git status

# Look for .env or credential files that shouldn't be tracked
git ls-files | grep -E '\.env|secret|credential|password'

# Verify no production data made it in
git diff --cached --name-only
```

If you accidentally commit sensitive data, **do not just delete it in a follow-up commit.** The data is already in git history. Contact the maintainers immediately so history can be rewritten.

## Reviewing Contributor Branches (Maintainers)

A pull request is untrusted code. Checking out a branch and installing it
normally is enough to execute whatever the contributor put in a lifecycle
script, a test file, or a build config.

When reviewing a branch you did not write:

```bash
# Read the diff before running anything. Pay attention to package.json,
# bun.lock, .github/, apps/web/scripts/, and the agent instruction files.
git diff master...<branch> -- package.json '**/package.json' '**/bun.lock' \
  .github/ apps/web/scripts/ AGENTS.md opencode.json .claude/ .opencode/

# Install without running any lifecycle script.
bun install --frozen-lockfile --ignore-scripts
```

Running the test suite still executes contributor-authored test files. Read
them first, or let CI run them instead.

## Reporting Issues

- Use the issue templates provided (bug report or feature request).
- **Never attach SQL dumps to issues.** They may contain sensitive data.
- **Never include credentials, API keys, personal data, or production data in issue descriptions.**
- If your bug involves specific SQL syntax, use synthetic examples that demonstrate the pattern without revealing real data.

## Code of Conduct

Be respectful. We're all here to build useful software. Disagreements about technical decisions are healthy; personal attacks are not.
