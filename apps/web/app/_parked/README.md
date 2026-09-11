# Parked tools

Pages for tools that are built but kept off the hub for now: Encoding, Case,
Timestamps and Colors. A folder whose name starts with `_` is private in the
Next.js App Router, so nothing here is a route.

Their conversions live in `packages/core/src/utilities` and stay tested there,
and their specs stay in `components/text-tool.tsx`.

To bring one back, for example `case`:

1. Move `app/_parked/case` to `app/case`.
2. In `lib/tools.ts`, uncomment its entry at the end of `TOOLS` and its icon
   import.
3. Add its id to the list in `tests/tools.test.ts`, and a test for it in
   `tests/text-tool.test.tsx`.
4. Add it back to the tool tables in `README.md`, `AGENTS.md` and
   `apps/web/README.md`.
