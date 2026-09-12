---
name: typescript
description: "Use when writing, reviewing, or configuring TypeScript code in this project. Covers TypeScript conventions, strict mode, module resolution, type patterns, and project configuration."
---

# TypeScript Skill

## Configuration

This project uses TypeScript with strict mode enabled.

```json
{
  "compilerOptions": {
    "strict": true,
    "noEmit": true,
    "module": "esnext",
    "moduleResolution": "bundler",
    "target": "ES2017",
    "esModuleInterop": true,
    "resolveJsonModule": true,
    "isolatedModules": true,
    "skipLibCheck": true
  }
}
```

## Conventions

- Use `type` imports for type-only imports: `import type { Foo } from './bar'`
- Prefer `interface` for object shapes that may be extended
- Use `type` for unions, intersections, and computed types
- Avoid `any` - use `unknown` and narrow with type guards
- Use `as const` for literal types where appropriate
- Prefix internal types with `I` only if the codebase already uses this pattern

## Module Patterns

- Use ES modules (`import`/`export`)
- Avoid CommonJS (`require`/`module.exports`)
- Use barrel exports (`index.ts`) only for public API surfaces
- Keep internal modules private - don't export everything

## Error Handling

- Use typed errors, not string throws
- Use Result types where appropriate
- Never swallow errors silently
- Log errors with context, not raw error objects

## Naming

- `camelCase` for variables, functions, parameters
- `PascalCase` for types, interfaces, classes, components
- `UPPER_SNAKE_CASE` for constants
- Descriptive names over abbreviated - `filePath` not `fp`

## Testing

- Use the project's test framework (check package.json for test scripts)
- Type test files consistently with source files
- Test types with `expectTypeOf` or `assertType` where relevant
