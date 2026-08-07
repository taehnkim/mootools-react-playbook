# MooTools migration tools

This directory contains the executable first pass of the migration runbook.
It is a separate TypeScript package.

## Included

Skills:

- `mootools-react-migrate`
- `mootools-react-tooling`
- `mootools-react-parity`
- `mootools-react-rebase-port`
- `mootools-react-no-escape-hatch`

Tools:

- Registry inventory.
- MooTools `Class`, event, call-site, API, side-effect, dependency, markup, and
  CSS analysis.
- Fingerprint-aware decision checks.
- A dry-run-first adapter codemod.
- A no-new-legacy-use guard.
- Real-browser baseline capture.
- DOM, event, focus, style, and screenshot comparison.
- Rebase collision detection.
- Migration status and a deterministic agent loop.

The first codemod is intentionally narrow. It wraps supported
`new TabPane(...)` callers with a shared legacy adapter and updates the
classic-script load order. It does not generate React behavior or delete
legacy source.

## Install

```bash
cd migration_tools
npm install
npx playwright install chromium
```

## Run

Start the sandbox from the repository root:

```bash
npm run dev
```

In another terminal:

```bash
cd migration_tools
npm run migrate -- status tab-pane
```

Run the deterministic phases:

```bash
npm run migrate -- loop tab-pane \
  --legacy-url http://127.0.0.1:5173 \
  --react-url http://127.0.0.1:5173
```

The loop stops at `decisions` until a person approves the product-visible
choices. It then stops at `implement` so an agent can write the React
component.

## Common commands

```bash
npm run migrate -- inventory --write
npm run migrate -- analyze tab-pane --write
npm run migrate -- decisions check tab-pane
npm run migrate -- adapter tab-pane
npm run migrate -- no-new-use tab-pane
npm run migrate -- verify tab-pane
npm run migrate -- capture tab-pane \
  --surface legacy \
  --base-url http://127.0.0.1:5173
npm run migrate -- compare tab-pane \
  --base-url http://127.0.0.1:5173
```

`adapter` is dry-run by default. The current sandbox is not a git repository,
so a write also needs `--allow-unsafe-write`. Use that option only when the
sandbox is disposable.

`capture` rejects an existing evidence directory. Add `--replace` only when
you intend to replace a reviewed baseline atomically.

The analyzer parses JavaScript and TypeScript ASTs, MooTools metadata, HTML,
and CSS. Its worksheet includes category coverage and known limitations. It
reports computed or project-specific forms as unknown instead of guessing.

## TabPane pilot data

`components/tab-pane/` contains:

- Component and adapter configuration.
- Shared fixture data.
- Legacy and React semantic selector maps.
- Seven browser scenarios.
- The exact legacy-use allowlist.
- Generated static worksheet.
- Pending decision records.
- Captured legacy baseline and screenshots.

The React component implements the selector map, approved compatibility
handle, and fixture acknowledgement. The `react-pilot-3` evidence run reached
`PARITY` with `attested: true`.

## Skills in Cursor

The project skills are under `migration_tools/.cursor/skills`.

Open `migration_tools` as the Cursor project root to make these skills
discoverable without copying them. If the parent repository remains the
project root, attach a skill by its file path or move the final approved skill
set to the parent `.cursor/skills` directory.

## Checks

```bash
npm run check
npm run build
```

The browser baseline command is the end-to-end check for the legacy surface.
React parity becomes the end-to-end completion check after the React pilot
exists.
