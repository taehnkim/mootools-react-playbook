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

`verify` succeeds only when both focused unit tests and all project checks
pass, every exact screenshot has equal dimensions and zero changed pixels,
and browser comparison reaches `PARITY` with `attested: true`.

## Saved verification evidence

The worksheet, manifests, screenshots, recordings, and diffs are generated
locally and ignored by Git. Each scenario records one legacy WebM and one React
WebM. Videos are inspection evidence. Screenshots remain the exact parity
evidence.

- `tools/mootools-migrate/components/<component>/baseline/manifest.json`
  records the hash-bound legacy test receipt. Baseline screenshots sit beside
  it under `<scenario>/<name>.png`. Legacy recordings use
  `recordings/<scenario>.webm`.
- `tools/mootools-migrate/components/<component>/final/manifest.json` records
  both test receipts and the project checks. React recordings use
  `recordings/<scenario>.webm`.
- `tools/mootools-migrate/components/<component>/final/parity.json` records
  every paired recording and image comparison. The tool verifies each
  recording against its manifest hash but does not compare the two videos.
  React screenshots use `<scenario>/<name>.png`. Diff images use
  `diffs/<scenario>/<assertion>.png`, including exact matches.
- A mismatch writes the complete candidate to
  `tools/mootools-migrate/components/<component>/final.failed/`. The last
  passing `final/` stays unchanged. A later pass removes `final.failed/`.

All generated media stays local and ignored. Review the legacy and React
recordings and the saved baseline, React, and diff images before claiming
parity. Do not refresh a valid baseline to make React pass. An approved visual
difference is not visual parity and must not use an exact screenshot claim.

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
      manifest.json
      recordings/<scenario>.webm
      <scenario>/<name>.png
    final/
      manifest.json
      parity.json
      recordings/<scenario>.webm
      <scenario>/<name>.png
      diffs/<scenario>/<assertion>.png
    final.failed/
components/                 MooTools source and legacy tests
src/components/             React source and tests
```

`migration.json` is the human-owned migration input. It contains scenarios,
paired selectors, decisions, accepted differences, allowed legacy uses, and
the optional adapter configuration.

## Example

See the [TabPane migration example](examples/tab-pane-migration.md) for the
four commands, scenario recordings, sample test receipts, one exact image
comparison, and the accepted differences. The example is documentation, not
live proof.
