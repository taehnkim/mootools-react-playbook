---
name: mootools-react-migrate
description: Migrates one MooTools component to React with a saved legacy baseline, explicit behavior decisions, a narrow adapter codemod, and real-browser parity proof. Use when moving a registered component from legacy MooTools code to React.
---

# Migrate one MooTools component

Run this workflow from `migration_tools`.

## Hard rules

- Migrate one registered component at a time.
- Capture the legacy baseline before React behavior work.
- Keep generated findings separate from approved decisions.
- Give one framework sole ownership of the component DOM.
- Treat generated code as a draft.
- Do not change a valid baseline to make React pass.
- Stop for every pending product-visible decision.
- Do not push, deploy, or apply a write codemod without user authority.

## Loop

Start with:

```bash
npm run migrate -- status <component>
```

Run the command in `nextAction`. Repeat until the status stops at human or
agent work.

The deterministic helper can run analysis and baseline phases:

```bash
npm run migrate -- loop <component> \
  --legacy-url http://127.0.0.1:5173 \
  --react-url http://127.0.0.1:5173
```

It must stop at pending decisions or React implementation. It must not approve
decisions or write React code.

## Phase 1. Analyze

```bash
npm run migrate -- inventory --write
npm run migrate -- analyze <component> --write
```

Review every unknown and contract-relevant finding. Static analysis is not
proof that all external callers are known.

## Phase 2. Capture legacy

Start the sandbox or customer application. Then run:

```bash
npm run migrate -- capture <component> \
  --surface legacy \
  --base-url http://127.0.0.1:5173
```

The capture must have no page, console, request, selector, or assertion error.
Do not continue without a valid baseline.

## Phase 3. Decide

Create a decision draft once:

```bash
npm run migrate -- decisions init <component> --write
```

Edit each decision. Replace the `TODO` rationale. A human must approve every
record that says `requiresHumanApproval: true`.

Check:

```bash
npm run migrate -- decisions check <component>
```

Stop while this command is nonzero.

## Phase 4. Define the boundary

Read all current callers before choosing the React API.

Use an adapter only when incremental caller movement or rollback needs both
implementations. Preview the exact adapter change:

```bash
npm run migrate -- adapter <component>
```

The codemod is dry-run by default. It must preflight every target file. Do not
use `--allow-unsafe-write` outside a disposable non-git sandbox.

## Phase 5. Implement React

- Model state with stable IDs.
- Preserve only caller-observed contracts.
- Keep pure utilities when they still model the domain.
- Replace MooTools DOM and event helpers at the React boundary.
- Add focused component tests.
- Expose a test handle only when an approved imperative contract needs it.

Run the target project type check and build after each behavior unit.

## Phase 6. Prove

```bash
npm run migrate -- compare <component> \
  --base-url http://127.0.0.1:5173
```

Fix the React candidate when proof fails. After three blind fixes, stop and
inspect the exact assertion, event, DOM element, or style.

Done requires `PARITY` and `attested: true`.

## Phase 7. Clean up

```bash
npm run migrate -- no-new-use <component>
npm run migrate -- status <component>
```

In local pilot mode, keep the separate legacy reference page. Remove MooTools
only from the React target.

In production mode, remove approved legacy callers and files only after full
traffic, stable metrics, and tested rollback.

## Stop conditions

Stop and report evidence when:

- A behavior choice has no approved decision.
- A legacy defect may need compatibility.
- A public API has no caller evidence.
- A baseline state cannot be exercised.
- A tool finds an unsupported source form.
- A target file has unrelated changes.
- A planned write leaves the declared component file set.
- A post-write check fails.

## References

- Read [contracts.md](contracts.md) for artifact ownership and freshness.
- Read [tab-pane-pilot.md](tab-pane-pilot.md) for the first pilot contract.
