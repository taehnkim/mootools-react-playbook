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
- Do not push or deploy.
- Generate, inspect, and report the worksheet, manifests, screenshots,
  recordings, and diffs. Keep generated media local and ignored. Attach the
  media and final report to the draft PR.

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

## 2. Define the boundary

Read all current callers. Prefer stable IDs and React callbacks over the
legacy class API.

Build and test these mount artifacts before changing callers:

- The implementation bridge. It names the injected window key and the exact
  legacy and React values.
- The configured table manager global. A missing manager selects legacy.
- The configured React mount global. The React value without this mount throws.
- Bootstrap reads the injected value, creates the manager, and registers both
  globals before classic scripts load.

The host sets the implementation value before bootstrap. The browser proof
runner does the same before it loads `/` for either surface. Do not select an
implementation from the URL.

The generated adapter reads the configured selection key. A missing manager or
the configured legacy value constructs the legacy class with the original
arguments. The configured React value calls the React mount with those
arguments. Any other manager value throws.

Generate the configured adapter:

```bash
npm run migrate -- adapter <component> --write
```

The command writes the generated adapter, caller rewrite, and load-order edit
atomically. One unsupported caller cancels the complete plan. Do not create
these migration artifacts by hand.

## 3. Capture the legacy baseline

Backfill the configured MooTools unit test if it is missing. Start the
application. Then run:

```bash
npm run migrate -- baseline <component> \
  --base-url http://127.0.0.1:5173
```

This command runs the legacy unit test before browser capture. Review the
worksheet and baseline. Resolve every pending product decision in
`migration.json` before writing React. The baseline saves one legacy WebM for
each scenario under `recordings/<scenario>.webm`. The shared mount must select
the legacy branch during this capture. The browser runner injects the configured
legacy implementation value before bootstrap.

## 4. Implement and verify

Write the React component and its focused unit test. Then run:

```bash
npm run migrate -- verify <component> \
  --base-url http://127.0.0.1:5173
```

`verify` checks decisions, new MooTools uses, both unit tests, type checking,
the production build, baseline freshness, browser behavior, event order,
focus, styles, and screenshots. It prints the saved `final` or `final.failed`
evidence directory.

Open or update a draft PR after verification. Include the adapter, React
component, tests, verification result, approved behavior differences, and
links to the attached recordings, screenshots, diffs, and `parity.json`.

## Verification gate

Do not claim parity until every item passes.

- Run the focused legacy and React unit tests. The saved test receipts must
  match the configured source, test file, and dependencies.
- Add a component screenshot for every meaningful visual state that must be
  exact.
- Save one legacy WebM and one React WebM for every scenario. Recordings are
  inspection evidence, not a visual parity assertion. Screenshots remain exact
  parity evidence.
- Require equal image dimensions and zero changed pixels. Do not add visual
  tolerance.
- Save the baseline image, the React image, and the diff image for every
  screenshot assertion, including exact matches.
- Review the saved manifests, recordings, images, diffs, and `parity.json`.
- Do not update the baseline to make React pass.
- Do not claim parity for an approved visual difference. Leave that scenario
  without an exact screenshot assertion and document the approved difference.

Fix React and rerun until the result is `PARITY` with `attested: true`.

## Rebase and cleanup

If upstream changes the legacy component, rerun `baseline` and port the change
before verification.

Remove obsolete globals, compatibility wrappers, implementation bridges,
temporary selectors, and direct MooTools calls when React takes ownership.
