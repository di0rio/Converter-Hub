---
name: nextjs
description: "Use when implementing Next.js features, routes, components, API routes, or Next.js configuration. Covers Next.js 16+ App Router patterns, server components, and client components."
---

# Next.js Skill

## Version

This project uses Next.js 16+. APIs and conventions may differ from older versions.

Always check `node_modules/next/dist/docs/` for the latest documentation before writing Next.js code.

## Project Structure

```
apps/web/  (or client/)
  app/
    layout.tsx       - Root layout
    page.tsx         - Home page
    globals.css      - Global styles
  components/        - React components
  hooks/             - Custom React hooks
  lib/               - Utilities and helpers
  public/            - Static assets
```

## App Router Conventions

- Use App Router (not Pages Router)
- Server Components by default - add `'use client'` only when needed
- Client components for interactive UI (file upload, form handling)
- Server Components for static content and data fetching

## Component Patterns

- Keep components small and focused
- One component per file
- Co-locate related components
- Use CSS modules or Tailwind CSS for styling
- Avoid inline styles

## File Upload

For SQL file upload:
- Use `<input type="file">` with proper accept attributes
- Validate file type client-side before upload
- Show upload progress
- Handle errors gracefully
- Process files locally - no server upload

## State Management

- Use React state for local component state
- Use URL state for shareable state
- Avoid global state libraries - keep it simple
- Use `useState` and `useReducer` for complex local state

## Performance

- Use dynamic imports for heavy components
- Lazy load non-critical features
- Optimize images with `next/image`
- Use React Suspense for loading states
