# MooTools to React playbook

Give Cursor one MooTools component. The agent analyzes it, records its current
browser behavior, resolves migration decisions, writes a React component and
tests, and keeps fixing the result until verification passes.

The human should provide the component and review product-visible choices. The
agent should run the commands, edit the code, write the tests, and complete the
verification loop.

Example request:

```text
Migrate components/brand-box/BrandBox.js to React.
Use the mootools-react-migrate skill and run until verification passes.
```

Expected result:

```text
src/components/brand-box/BrandBox.tsx
src/components/brand-box/BrandBox.test.tsx
browser parity evidence
an approved migration decision record
```

## Pipeline

```text
Human gives Cursor a legacy component
                  |
                  v
Agent loads .cursor/skills/mootools-react-migrate
                  |
                  v
       inventory + AST/HTML/CSS analysis
                  |
                  v
       backfill + run MooTools unit test
                  |
                  v
        capture legacy browser baseline
                  |
                  v
       resolve migration decisions
                  |
          human reviews only
       product-visible choices
                  |
                  v
       optional adapter or codemod
                  |
                  v
        write React component + tests
                  |
                  v
             run React unit test
                  |
                  v
      compare React with legacy baseline
                  |
          mismatch? fix React
                  |
                  +--------------+
                  |              |
                  +<-------------+
                  |
                  v
        no-new-MooTools guard + verify
                  |
                  v
        React component, tests, evidence
```

The agent must not change a valid legacy baseline to make React pass. It must
fix React or record an approved intentional difference.

## Repository layout

Cursor discovers project skills automatically from:

```text
.cursor/skills/
  mootools-react-migrate/
  mootools-react-tooling/
  mootools-react-parity/
  mootools-react-rebase-port/
  mootools-react-no-escape-hatch/
```

Executable migration tools and evidence live at:

```text
tools/mootools-migrate/
  src/
  test/
  components/
  registry.json
```

Application code lives at:

```text
components/                 unchanged MooTools references
main.js + styles.css         legacy application at the repository root
src/components/             colocated React components
react.html                  React comparison entry
```

This matches the original everysphere pattern. Skills live in `.cursor/skills`.
Executable codemods and scripts live in `tools/`.

## Setup

The agent should run setup. A human does not normally need to run these
commands.

```sh
npm install
npm run migrate:setup
```

Start both reference pages:

```sh
npm run dev
```

- `http://localhost:5173/` is the root MooTools application.
- `http://localhost:5173/react.html` is the colocated React page.

## Commands the agent runs

These commands document the pipeline. The migration skill tells the agent when
to run each command.

```sh
# Find the next safe action.
npm run migrate -- status <component>

# Find definitions and direct callers.
npm run migrate -- inventory --write

# Analyze events, callsites, DOM, HTML, CSS, APIs, timers, storage,
# dependencies, imports, and global side effects.
npm run migrate -- analyze <component> --write

# Backfill the legacy test file when needed, then run it before capture.
npm run migrate -- test legacy <component>

# Capture the working MooTools component in Chromium.
npm run migrate -- capture <component> \
  --surface legacy \
  --base-url http://127.0.0.1:5173

# Create and validate preserve, replace, fix, or delete decisions.
npm run migrate -- decisions init <component> --write
npm run migrate -- decisions check <component>

# Preview an optional source codemod. Dry-run is the default.
npm run migrate -- adapter <component>

# After the agent writes React and its tests, run the React test first.
npm run migrate -- test react <component>

# Compare both implementations only after both unit-test gates pass.
npm run migrate -- compare <component> \
  --base-url http://127.0.0.1:5173

# Block new legacy use and run final project checks.
npm run migrate -- no-new-use <component>
npm run migrate -- verify <component>
```

The deterministic loop runs current test files automatically. It stops when a
legacy test must be backfilled, a human decision is needed, or React code and
tests must be written:

```sh
npm run migrate -- loop <component> \
  --legacy-url http://127.0.0.1:5173 \
  --react-url http://127.0.0.1:5173
```

The loop stops when a human decision or agent implementation is required.
Cursor then completes that work and runs the loop again.

## Current example

TabPane has completed the full pilot:

- A backfilled MooTools unit test passes before baseline capture.
- React component and tests exist under `src/components/tab-pane/`.
- The focused React unit test passes before browser comparison.
- Browser comparison reached `PARITY`.
- The run is attested.
- No new MooTools use exists.
- Registry status is `pilot-proven`.

See [MIGRATION_RUNBOOK.md](./MIGRATION_RUNBOOK.md) for data contracts, stop
conditions, production rollout, and cleanup.

## Legacy source revisions

The local component files retain their original MIT-style source headers:

- [MooTools-TabPane](https://github.com/akaIDIOT/MooTools-TabPane/tree/90ad8d233f160d7b33380d5857eec79f5780aa0b)
  version 0.5.2.
- [MooTools-BrandBox](https://github.com/akaIDIOT/MooTools-BrandBox/tree/e97eda4fe56751b448eafde17ba38a9130cc97df)
  version 0.2.
- [MooTools-ColorRange](https://github.com/akaIDIOT/MooTools-ColorRange/tree/369437111704df7aeaf84a29e5a0ecc2733bbb53)
  version 0.2.
