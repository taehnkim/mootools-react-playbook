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
human approves product-visible decisions
          |
          v
build shared mount and apply reviewed adapter
          |
          v
run legacy fallback test and capture baseline
          |
          v
run React branch tests, browser parity, typecheck, and build
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

- `http://localhost:5173/` runs the untouched MooTools application.
- `http://localhost:5173/react.html` runs the empty React migration root.

Before `bootstrap.ts` runs, the host can set
`window.__TAB_PANE_IMPLEMENTATION__` to `legacy-TabPane` or `react-TabPane`.
The mock feature flagger defaults missing and unknown values to
`legacy-TabPane`. The browser proof runner sets the configured value before it
loads `/`; the URL does not select the implementation.

## Migration commands

The workflow has four stages. The adapter stage generates the source artifact
that belongs in the migration draft PR:

```sh
# Analyze source, callers, events, DOM, CSS, and side effects.
npm run migrate -- analyze <component>

# Generate the configured caller adapter and load-order edit.
npm run migrate -- adapter <component> --write

# Run the legacy fallback test and capture the reviewed baseline.
npm run migrate -- baseline <component> \
  --base-url http://127.0.0.1:5173

# Run both unit tests, guards, browser parity, typecheck, and build.
npm run migrate -- verify <component> \
  --base-url http://127.0.0.1:5173
```

The adapter command applies the generated adapter, caller rewrite, and
load-order edit atomically.

The generated adapter calls `featureFlagger.get("TabPane")`. A missing flagger
or the `legacy-TabPane` result constructs the legacy class. The
`react-TabPane` result requires the React mount and forwards the same container,
options, and initial index. Any other flag value throws. A missing React mount
throws.

The repository starts with only the migration groundwork:

- `src/feature-flagger/mockFeatureFlagger.ts` provides the local flag lookup.
- `src/main.tsx` owns an empty React root.
- `bootstrap.ts` reads `window.__TAB_PANE_IMPLEMENTATION__` and configures the
  feature flagger before classic scripts load.

The migration run creates the React component, mount, tests, generated adapter,
caller rewrite, and bootstrap load-order edit. Those files belong in the
migration draft PR. Do not create codemod edits by hand.

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

Generated media stays local and ignored in the worktree, then becomes review
evidence through the draft PR. Review the legacy and React recordings and the
saved baseline, React, and diff images before claiming parity. Do not refresh a
valid baseline to make React pass. An approved visual difference is not visual
parity and must not use an exact screenshot claim.

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
src/main.tsx                Empty React migration root
src/feature-flagger/        Local feature flag test double
```

`migration.json` is a starting migration plan, not generated evidence. It
contains source paths, scenarios, paired selectors, allowed legacy uses, and
the implementation bridge and adapter configuration. A fresh clone has no
decisions or accepted differences. `analyze` adds pending decision stubs, and
the migration run records approvals and accepted differences before it opens
the draft PR.

The draft PR is the migration handoff. It includes the adapter, React source,
tests, and links to the generated verification evidence.
