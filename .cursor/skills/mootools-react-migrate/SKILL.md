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
