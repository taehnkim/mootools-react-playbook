---
name: mootools-react-migrate
description: Migrates one MooTools component to React with a saved legacy baseline, explicit behavior decisions, a narrow adapter codemod, and real-browser parity proof. Use when moving a registered component from legacy MooTools code to React.
---

# Migrate one MooTools component

Run this workflow from the repository root. The human gives you one component.
You run the commands, write the React component and tests, and stop only when
verification passes.

## Rules

- Migrate one component at a time.
- Give MooTools and React separate DOM ownership.
- Do not change a valid baseline to make React pass.
- Record product-visible choices in
  `tools/mootools-migrate/components/<component>/migration.json`.
- Stop for human approval when a decision is pending.
- Use the adapter only when callers need an intermediate mount function.
- Do not push, deploy, or write an adapter without user authority.

## TypeScript

Use TypeScript for new React code. Keep the types focused on the migration.

- Type component props, local state, function inputs and outputs, and new React
  API contracts.
- Use inference when an initializer or function body makes the same type clear.
  Do not repeat that type in an annotation.
- Define a small interface for only the legacy members that the React boundary
  calls.
- Use `unknown` for untrusted legacy values. Use narrowly scoped `any` only
  when a MooTools value cannot be described cheaply. Do not let `any` spread
  past the boundary.
- Prefer inline unions and callback types inside one boundary type. Extract a
  named type only when code reuses it or it names a real domain concept.
- Do not model the full MooTools class or type untouched legacy files.
- Do not add generics, branded types, mapped types, conditional types, wrappers,
  or helper abstractions only to improve typing.
- Do not refactor behavior or expand the migration scope to improve types.
- Preserve behavior and parity first. Add stronger types only when a migrated
  caller or a failing check requires them.
- Remove a type if it does not catch a migration bug or make the boundary
  easier to understand.

**Type the seam, not the legacy implementation.**

## 1. Analyze

```bash
npm run migrate -- analyze <component>
```

Read `worksheet.generated.json`. Review callers, public methods, events,
side effects, DOM, CSS, dependencies, and unknown forms. The command creates
decision stubs only when `migration.json` has no decisions.

## 2. Capture the legacy baseline

Backfill the configured MooTools unit test if it is missing. Start the
application. Then run:

```bash
npm run migrate -- baseline <component> \
  --base-url http://127.0.0.1:5173
```

This command runs the legacy unit test before browser capture. Review the
worksheet and baseline. Resolve every pending product decision in
`migration.json` before writing React.

## 3. Define the boundary

Read all current callers. Prefer stable IDs and React callbacks over the
legacy class API.

Preview the optional adapter:

```bash
npm run migrate -- adapter <component>
```

The adapter command is a dry run unless the user approves `--write`. One
unsupported caller cancels the complete write plan.

## 4. Implement and verify

Write the React component and its focused unit test. Then run:

```bash
npm run migrate -- verify <component> \
  --base-url http://127.0.0.1:5173
```

`verify` checks decisions, new MooTools uses, both unit tests, type checking,
the production build, baseline freshness, browser behavior, event order,
focus, styles, and screenshots. Fix React and rerun until the result is
`PARITY` with `attested: true`.

## Rebase and cleanup

If upstream changes the legacy component, rerun `baseline` and port the change
before verification.

Remove obsolete globals, compatibility wrappers, feature flags, temporary
selectors, and direct MooTools calls when React takes ownership.
