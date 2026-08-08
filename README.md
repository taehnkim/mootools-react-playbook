# MooTools to React playbook

Give Cursor one MooTools component. The agent analyzes the legacy contract,
captures a browser baseline, writes React and its tests, and verifies parity.

```text
Human names one component
          |
          v
analyze source and callers
          |
          v
run legacy test and capture baseline
          |
          v
human approves product-visible decisions
          |
          v
write React component and test
          |
          v
run tests, browser parity, typecheck, and build
          |
          v
React component + tests + final proof
```

## Ask Cursor

```text
Migrate components/brand-box/BrandBox.js to React.
Use the mootools-react-migrate skill and continue until verify passes.
```

The human names the component and approves behavior changes. The agent runs
the tools and writes the code.

## Setup

```sh
npm install
npm run migrate:setup
npm run dev
```

- `http://localhost:5173/` runs the MooTools application.
- `http://localhost:5173/react.html` runs the React comparison page.

## Migration commands

The agent runs four commands:

```sh
# Analyze source, callers, events, DOM, CSS, and side effects.
npm run migrate -- analyze <component>

# Run the legacy unit test and capture the reviewed baseline.
npm run migrate -- baseline <component> \
  --base-url http://127.0.0.1:5173

# Preview an optional caller adapter. Add --write only with approval.
npm run migrate -- adapter <component>

# Run both unit tests, guards, browser parity, typecheck, and build.
npm run migrate -- verify <component> \
  --base-url http://127.0.0.1:5173
```

`verify` succeeds only when browser comparison reaches `PARITY` with
`attested: true`.

## Layout

```text
.cursor/skills/mootools-react-migrate/SKILL.md
tools/mootools-migrate/
  src/
  test/
  components/<component>/
    migration.json
    worksheet.generated.json
    baseline/
    final/
components/                 MooTools source and legacy tests
src/components/             React source and tests
```

`migration.json` is the human-owned migration input. It contains scenarios,
paired selectors, decisions, accepted differences, allowed legacy uses, and
the optional adapter configuration.

## Current example

TabPane includes:

- A passing MooTools unit test.
- A passing React unit test.
- A reviewed legacy baseline.
- A final attested parity result with no mismatches.

Open `http://localhost:5173/tab-pane-migration.html` for the source-to-proof
walkthrough.
