---
name: testing
description: "Use when creating, reviewing, or maintaining tests in this project. Covers test strategy, unit tests, integration tests, test fixtures, mocking, and quality gates."
---

# Testing Skill

## Test Strategy

### Unit Tests
- Test individual functions and classes in isolation
- Mock external dependencies (file system, network)
- Focus on edge cases and error paths
- Keep tests fast and deterministic

### Integration Tests
- Test package interactions (core + CLI, core + Web)
- Use real file system operations with temp directories
- Test complete workflows end-to-end
- Verify build outputs

### Test Fixtures
- Use synthetic SQL data only - never real production dumps
- Create minimal fixtures that exercise specific edge cases
- Cover MySQL and MariaDB specific syntax differences
- Include encoding variants (UTF-8, latin1, binary)
- Include edge cases: empty files, malformed SQL, huge files

## Quality Gates

Before marking work complete:

1. Run type check: verify no type errors
2. Run lint: verify no lint errors
3. Run tests: verify all tests pass
4. Run build: verify packages build successfully

## Test Organization

```
packages/core/
  src/
    __tests__/        - Unit tests colocated with source
  tests/
    fixtures/         - Test SQL files (synthetic only)
    integration/      - Integration tests

apps/cli/
  src/
    __tests__/        - CLI unit tests

apps/web/
  src/
    __tests__/        - Web component tests
```

## Mocking Patterns

- Mock file system operations for unit tests
- Use real file system for integration tests
- Mock network requests (if any) with fixed responses
- Never mock the core library when testing CLI or Web

## Coverage

- Aim for high coverage on core parsing logic
- Test all error paths
- Test all user-facing error messages
- Don't chase 100% coverage on trivial code
