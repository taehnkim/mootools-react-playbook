# MooTools to React migration runbook

Status: first pass for the TabPane pilot.

Cursor skills are in root `.cursor/skills/`. The executable package and
migration evidence are in `tools/mootools-migrate/`.

This runbook defines a safe way to move one MooTools component to React. It
also defines the skills, local tools, evidence files, and agent loop that the
migration needs.

The first pilot is manual. The tools must first analyze and prove. They must
not try to create a complete React component from unknown MooTools code.

## Decision summary

1. Migrate one component at a time.
2. Save the legacy baseline before any behavior change.
3. Resolve every contract-relevant finding and every behavior-affecting
   unknown before implementation.
4. Give one framework sole ownership of a DOM subtree.
5. Use scripts for stable and repeatable work.
6. Use the agent for semantic work and integration.
7. Use the same real browser scenarios for legacy and React.
8. Fix the React candidate when parity fails. Do not change a valid baseline.
9. Record each intentional difference.
10. Delete legacy code and temporary migration code after proof.

Do not build a general MooTools-to-React source converter yet. Finish TabPane
and at least one different component by hand. Use those diffs to identify work
that is truly mechanical.

## What the StyleX migration teaches

The StyleX migration used four separate parts.

- A skill owned the recipe.
- A checked-in tool made a limited draft.
- An agent completed semantic work and integration.
- A separate proof tool decided whether the result was ready.

The draft tool did not edit callers, update the migration registry, delete old
files, or claim parity. Unsupported input stayed visible as source-linked TODO
items.

The migration also used these rules.

- Hand migrations came before automation.
- The migration registry and source tree tracked fleet progress.
- One generated report did not prove migration status.
- One small component formed one review unit when possible.
- Rebase work preserved upstream product changes.
- Temporary migration tools were removed when the migration ended.

These lessons come from:

- [MooTools React Migration Runbook](bc-15b063ee-a841-4eee-8572-780f2e0b45ad)
- [StyleX Migration Workflow Lessons](bc-2e3c2902-1ae4-4bd6-ad09-f749dd94412f)
- [StyleX Lessons for MooTools Migration](bc-19f97096-4db9-423d-880e-db19a5b573ba)
- [Component Migration Playbook](https://app.notion.com/p/cursorai/Component-Migration-Playbook-3b1da74ef045805d9f78e74b488d67f8)
- [Current Glass StyleX loop](https://github.com/anysphere/everysphere/blob/6fe4f8e5ab46a38d0abbef435c0d835808dbd0bd/.cursor/skills/lauren/glass-stylex-migrate/SKILL.md)
- [Historical StyleX component recipe](https://github.com/anysphere/everysphere/blob/d3d1920c29f678399a6102a58b6fa7fd4ffbcfa6/.cursor/skills/client/cursor-ui-primitives-stylex/SKILL.md)
- [Historical migration tool](https://github.com/anysphere/everysphere/tree/d3d1920c29f678399a6102a58b6fa7fd4ffbcfa6/tools/migrate-primitive)

## Terms

**Baseline**

A saved record of valid legacy behavior before the migration starts. It
contains browser actions, state, events, DOM facts, styles, accessibility
facts, and screenshots.

**Contract**

Behavior that a caller or user can observe and may depend on. Examples include
constructor inputs, methods, events, focus, DOM hooks, and visual states.

**Finding**

A fact or an unknown item found by static analysis or runtime capture.

**Decision**

One resolution for a finding. The allowed values are `preserve`, `replace`,
`fix`, and `delete`.

**Adapter**

A shared mount function that can start the legacy or React implementation.
Use it when incremental caller movement or rollback needs both
implementations. Some production migrations can switch in one change. Some
local tests may need an adapter to prove caller behavior. The current local
pilot can compare two separate pages.

**Parity**

The required legacy and React behavior is equal for the same scenario.
Intentional differences are valid only when a decision file records them.

**Codemod**

A checked-in program that reads source code and makes a known mechanical
change. It must stop or report an unknown form. It must not guess.

## Two operating modes

### Local pilot mode

Use this mode in this repository.

- Set the registry mode to `local-pilot`.
- Keep `/legacy/` as the legacy reference.
- Put the React result on the root page.
- Use the same fixture data and scenario IDs on both pages.
- Skip feature flags, canary traffic, production telemetry, and deployment.
- Do not push unless the user asks.

The pilot is done when deterministic local proof is green.

### Production migration mode

Use this mode in a customer application.

- Set the registry mode to `production`.
- Capture the baseline first.
- Create a shared mount adapter after the contract is known when incremental
  traffic or rollback needs one.
- If an adapter is required, move callers to it while it still selects
  MooTools and verify that caller-only change.
- If an adapter is required, put React behind its feature flag.
- Increase React traffic only after deterministic proof is green.
- Use preset metric thresholds and representative interaction counts.
- Keep a tested rollback path until React serves all traffic.
- Delete the flag, legacy path, temporary telemetry, and migration guard.

An error-free period alone is not enough. The rollout must include enough real
interactions to exercise the component.

## Repository artifact layout

Use this layout for the first implementation:

```text
.cursor/skills/
  mootools-react-migrate/
    SKILL.md
    contracts.md
    tooling.md
    parity.md
    tab-pane-pilot.md

tools/mootools-migrate/
  package.json
  registry.json
  generated/
    inventory.json
  components/
    tab-pane/
      worksheet.generated.json
      decisions.json
      fixtures.json
      scenarios.json
      selectors.legacy.json
      selectors.react.json
      legacy-use-allowlist.json
      accepted-differences.json
      baseline/
      candidate/
        <run-id>/
  src/
    cli.ts
    capture.ts
    compare.ts
    schemas.ts
```

The analyzer may replace `worksheet.generated.json`. It must not replace
`decisions.json` or `accepted-differences.json`.

Generated evidence and human decisions must stay in different files. Each
decision stores the finding fingerprint that it approved. A changed
fingerprint makes that decision stale.

`schemas.ts` calculates fingerprints for manual and generated worksheets. It
uses SHA-256 over canonical JSON with lexicographically sorted object keys. The
fingerprinted fields are schema version, finding ID, kind, summary,
`contractRelevant`, `decisionRequired`, and sorted evidence records. Each
evidence record includes path, line range, and source-slice hash. Suggested
actions and analyzer version do not affect the fingerprint.

A run writes `runs/<run-id>.json`. An optional current-run pointer may name the
active run. Never replace old run records.

## Skill set

### First-pass skill: `mootools-react-migrate`

This is the core loop skill.

Use it when an agent must migrate one named MooTools component to React.

It must:

1. Select one leaf component.
2. Create or refresh the component inventory and worksheet.
3. Capture and validate the legacy baseline.
4. Check that every decision-required finding has a current decision.
5. Define DOM ownership and the caller contract.
6. Implement the React candidate.
7. Run the parity workflow.
8. In local mode, remove MooTools only from the React target. In production
   mode, remove approved legacy callers and files after proof.
9. Run final project checks.
10. Report evidence and unresolved decisions.

It must not:

- Change more than one component without a clear dependency reason.
- Generate a new public API without caller evidence.
- Let MooTools and React write to the same DOM subtree.
- Mark an unsupported finding as resolved.
- Modify a valid baseline to make React pass.
- Add production rollout work in local pilot mode.

Keep the main `SKILL.md` short. Put the data contracts and TabPane details in
reference files. Keep tool and parity instructions in `tooling.md` and
`parity.md` until repeated use proves that they need separate skill triggers.

### Target extracted skill: `mootools-react-tooling`

Extract this skill after more than one workflow needs the command reference
without the full migration loop.

Use it when an agent must run or change a migration tool.

For each command, it must state:

- Input.
- Processing.
- Output.
- Exit codes.
- Files it may write.
- Files it must not write.
- One small example.

This skill must call generated output a draft or evidence. It must never call
generated output a completed migration.

### Target extracted skill: `mootools-react-parity`

Extract this skill after the proof workflow is stable across at least two
different components.

Use it after baseline capture and after each React behavior change.

It must:

- Use a real browser.
- Run the same scenario, viewport, fixture, theme, and build type.
- Record the contract-relevant event order and stable primitive payload fields
  named by each scenario.
- Record only the state and focus facts named by each scenario.
- Check stable DOM hooks and relevant computed styles.
- Save screenshots for key states.
- Run accessibility checks.
- Require at least one real interaction.
- Write a machine result and a short human-readable result.

A run needs both results:

- `PARITY`: all machine checks pass.
- `ATTESTED`: the run proves that it exercised the changed state.

### Target extracted skill: `mootools-react-rebase-port`

Use this skill only for a long migration branch or a changed legacy component.

It must:

1. Find components changed on both sides of the branch split.
2. Capture the latest upstream legacy behavior.
3. Port the upstream behavior change to React.
4. Run parity against the new upstream baseline.
5. Keep one ported component in one review unit.

It must not discard an upstream legacy change because the legacy file is due
for deletion.

This skill can wait until the project uses a long-lived migration branch.

### Target extracted skill: `mootools-react-no-escape-hatch`

Extract this skill only when the first migrations reveal repeated cleanup
patterns.

It must find and remove:

- New direct `new TabPane(...)` calls outside approved legacy code.
- Global bridge objects that no caller needs.
- Dual MooTools and React DOM ownership.
- Hidden dependencies on MooTools element extensions.
- Temporary selectors and compatibility wrappers.

Track the exact identity and location of every temporary escape hatch. Fail on
every new identity. A total count is only a summary and may stay equal or
decrease.

### Customer React and UI skills

The migration skill must apply existing project-specific React and UI guidance
when it is present. Do not create extra customer skills only for this pilot.
The migration skill must not contain copies of another product's UI
components.

Examples include:

- React component and state rules.
- TypeScript rules.
- Customer design tokens.
- Customer UI primitives.
- Accessibility rules.

These are target-system skills. They are not part of the migration engine.

## Tool set

Build one checked-in TypeScript command package. Do not create a separate
package for each small command.

The TabPane pilot needs schema validation, browser capture, and browser
comparison. Write its worksheet and registry entry by hand. Do not build a
generic analyzer first.

After a second manual pilot, add a JavaScript parser for source locations and
known syntax forms. Add a CSS parser only when repeated selector analysis
earns it. Use Playwright or an equal real-browser tool for runtime evidence.

Do not use Codemod.com for the first version. The StyleX work used a custom
checked-in tool with a narrow translation table. The same ownership model fits
this migration.

### `inventory`

Defer this command until after the second manual pilot.

Example:

```bash
npm run migrate -- inventory --write
npm run migrate -- inventory --check
```

Input:

- Repository source.
- Known MooTools component definitions.
- Known React migration targets.

Processing:

- Find component definitions.
- Find direct constructors and global references.
- Find component source, CSS, fixtures, and React target files.
- Build dependency edges between components.

Output:

- `migration/inventory.generated.json`.
- A nonzero exit code when `--check` finds generated inventory drift.
- A nonzero exit code when a discovered component has no human-owned registry
  entry.

Non-goals:

- It does not write status, blockers, or decisions.
- It does not decide behavior.
- It does not measure runtime use.

### `analyze <component>`

Defer this command until after the second manual pilot.

Example:

```bash
npm run migrate -- analyze tab-pane --write
```

Input:

- One registry component.
- Its source files and call sites.

Processing:

- Read options, methods, events, and source locations.
- Find DOM reads and writes.
- Find selectors, CSS classes, and inline style writes.
- Find timers, network calls, storage, cache, and global state.
- Find lifecycle and cleanup behavior.
- Find caller use of methods and events.
- Mark unsupported syntax as an unknown finding.

Output:

- `worksheet.generated.json`.
- Stable finding IDs.
- Analyzer version and input hashes.
- A fingerprint for each finding. The fingerprint covers normalized meaning,
  evidence, and the relevant source input.
- Evidence with file and line locations.
- A suggested action for each finding.

Non-goals:

- A suggested action is not a decision.
- The command does not edit source.
- The command does not generate React.

### `decisions check <component>`

Example:

```bash
npm run migrate -- decisions check tab-pane
```

Input:

- Manual or generated worksheet that passes schema validation.
- Decision file.

Processing:

- Match decisions to stable finding IDs and fingerprints.
- Validate allowed resolutions.
- Reject missing, fingerprint-stale, or conflicting decisions.

Output:

- Zero only when every contract-relevant or behavior-affecting
  decision-required finding is resolved.

### `baseline capture <component>`

Example:

```bash
npm run migrate -- baseline capture tab-pane
```

Input:

- Valid fixture data.
- Valid scenario file.
- Valid legacy selector map.
- Running legacy page.

Processing:

- Run every scenario in a real browser.
- Save only the actions and stable contract observations named by the
  scenario.
- Serialize only stable primitive event payload fields.
- Save named DOM facts, focus facts, styles, accessibility output, and
  screenshots.

Output:

- Versioned files under `baseline/`.
- A manifest with source commit, source hashes, scenario hash, fixture hash,
  runtime script hashes, browser, viewport, theme, and build.

Before the first baseline, store the pinned MooTools runtime files in this
repository. Do not make proof depend on changing network bytes.

The command must fail on a resource failure, page error, console error,
metadata mismatch, missing selector, inert action, or named state that was not
exercised.

### `compare <component>`

Example:

```bash
npm run migrate -- compare tab-pane
```

Input:

- Valid legacy baseline.
- Running React candidate.
- Valid React selector map.
- Accepted difference file.

Processing:

- Recalculate and verify every baseline manifest hash before candidate
  capture.
- Run the same scenarios against React.
- Compare each assertion with its named matcher.
- Compare only contract-relevant behavior and named visual evidence.
- Apply only recorded accepted differences.

Output:

- Files under `candidate/<run-id>/`.
- A result with `PARITY` or a precise mismatch.
- An attestation result.

It must not write to `baseline/`.

The first matcher set supports:

- Selected tab.
- Visible panel.
- Text.
- Element count.
- Focus target.
- Attribute.
- Stable event trace.
- Named computed style.
- Accessibility violation.
- Screenshot.

The scenario sets screenshot tolerance before baseline capture. A selector map
may only map a semantic target to an implementation selector. It may not
change expected output or normalize a mismatch.

Each accepted difference must name:

- Its own stable ID and fingerprint.
- One current decision fingerprint.
- One scenario.
- One step.
- One assertion.
- The exact legacy result.
- The exact React result.
- The approved reason.
- Human approval of the complete difference fingerprint.

Reject wildcard differences and stale fingerprints.

### `no-new-use <component>`

Example:

```bash
npm run migrate -- no-new-use tab-pane
```

Input:

- Current source.
- Approved legacy call-site allowlist.
- Declared repository search roots and file types.

Processing:

- Find direct constructors, imports, global references, and mount calls.
- Compare them with the allowlist.

Output:

- Nonzero when a new direct use appears.

This guard blocks new use. It does not block necessary fixes in legacy source.
The allowlist stores exact use identities and locations.

### `verify <component>`

Example:

```bash
npm run migrate -- verify tab-pane
```

This is an aggregate command. It runs:

1. Registry check.
2. Worksheet freshness check.
3. Decision check.
4. No-new-use check.
5. Baseline manifest freshness check.
6. Candidate comparison.
7. Type check.
8. Unit and integration tests.
9. Production build.
10. Orphan check.

The command returns zero only when the component is ready for its current
mode. In `local-pilot` mode it may accept `pilot-proven` while the reference
legacy page remains. Production rollout and deletion checks remain separate.

### Deferred `draft <component>`

Do not build this command before the pilots.

After two or three manual migrations, compare the diffs. Add a draft command
only for edits that repeat with the same input and output.

A future draft command may:

- Create a React file shell.
- Create a typed fixture shell.
- Create an adapter from a proven adapter shape.
- Convert known call-site forms.
- Add source-linked TODO items inside a new draft component.

It must not:

- Infer product behavior.
- Copy a MooTools class object into React state.
- Delete legacy code.
- Update the registry to `react`.
- Accept a behavior difference.
- Claim completion.

The command uses dry-run by default. It must preflight every target caller
before a write. If any caller form is unsupported, it writes nothing. A
component-level call-site change is atomic. It must not place TODO items in
partly converted caller code.

## Data contracts

### Registry

The registry is the fleet ledger. It is not a generated migration report.
People own its mode, status, blockers, and approved paths. The future
`inventory.generated.json` file contains scanner output only.

Example:

```json
{
  "schemaVersion": 1,
  "components": [
    {
      "id": "tab-pane",
      "mode": "local-pilot",
      "legacyFiles": [
        "legacy/components/tab-pane/TabPane.js",
        "legacy/components/tab-pane/TabPane.Extra.js"
      ],
      "legacyEntry": "/legacy/",
      "reactEntry": "/",
      "reactPath": "src/components/tab-pane/TabPane.tsx",
      "fixturePath": "migration/components/tab-pane/fixtures.json",
      "scenarioPath": "migration/components/tab-pane/scenarios.json",
      "legacySelectorPath": "migration/components/tab-pane/selectors.legacy.json",
      "reactSelectorPath": "migration/components/tab-pane/selectors.react.json",
      "status": "baseline-captured",
      "blockers": []
    }
  ]
}
```

Allowed status values:

- `legacy`
- `analyzed`
- `baseline-captured`
- `decisions-ready`
- `react-draft`
- `parity-ready`
- `pilot-proven`
- `react`
- `blocked`

`pilot-proven` is complete only for `local-pilot` mode. Only `react` counts as
a completed production migration.

### Worksheet finding

Example:

```json
{
  "id": "tab-pane:event:change",
  "source": "manual",
  "analyzerVersion": null,
  "inputHash": "sha256:...",
  "fingerprint": "sha256:...",
  "kind": "event",
  "summary": "show fires change with a numeric index",
  "evidence": [
    {
      "path": "legacy/components/tab-pane/TabPane.js",
      "startLine": 85,
      "endLine": 102
    }
  ],
  "suggestedAction": "preserve the observable event contract",
  "contractRelevant": true,
  "decisionRequired": true
}
```

The first version needs finding kinds for:

- Public input.
- Public method.
- Event.
- DOM read.
- DOM write.
- Selector.
- Style.
- State.
- Lifecycle.
- Timer.
- Network.
- Storage.
- Global.
- Caller.
- Unknown.

### Decision

Example:

```json
{
  "findingId": "tab-pane:event:change",
  "findingFingerprint": "sha256:...",
  "resolution": "replace",
  "rationale": "React exposes onSelectionChange with the selected stable ID",
  "requiresHumanApproval": true,
  "approval": {
    "status": "pending"
  }
}
```

An agent may propose a decision. It must not approve a product-visible change
for the user. An approved record has `status: "approved"`, `approvedBy`,
`approvedAt`, and the approved finding fingerprint. The approval must come
from an explicit user action.

The decision checker fails when the current finding fingerprint differs from
`findingFingerprint`.

### Fixture and selector maps

`fixtures.json` owns stable input data. A fixture must not contain page
selectors.

The legacy and React selector maps each translate one semantic target, such as
`tab:behavior`, to one page selector. The maps are versioned and hashed into
each run. They may not change expected values or remove assertions.

### Scenario

Example:

```json
{
  "id": "select-second-tab",
  "fixture": "default-tabs",
  "steps": [
    {
      "stepId": "click-behavior-tab",
      "action": "click",
      "target": "tab:behavior"
    }
  ],
  "assertions": [
    {
      "assertionId": "selected-tab-after-click",
      "afterStepId": "click-behavior-tab",
      "kind": "selected-tab",
      "matcher": "equals",
      "expected": "behavior"
    },
    {
      "assertionId": "visible-panel-after-click",
      "afterStepId": "click-behavior-tab",
      "kind": "visible-panel",
      "matcher": "equals",
      "expected": "behavior"
    }
  ]
}
```

Use semantic fixture IDs. Keep page selectors in each implementation's
fixture adapter. This lets one scenario run against both pages.

Each assertion names its matcher. Screenshot assertions set their threshold
before baseline capture.

### Accepted difference

Example:

```json
{
  "id": "fix-close-selection",
  "fingerprint": "sha256:...",
  "decisionFingerprint": "sha256:...",
  "scenarioId": "close-non-active-tab",
  "stepId": "close-first-tab",
  "assertionId": "selected-tab-after-close",
  "legacyValue": "third-tab",
  "reactValue": "second-tab",
  "reason": "Fix the legacy index-shift defect",
  "approval": {
    "status": "approved",
    "approvedBy": "person",
    "approvedAt": "2026-01-01T00:00:00.000Z",
    "differenceFingerprint": "sha256:..."
  }
}
```

Wildcards are not valid. One accepted difference can suppress only the named
assertion in the named scenario and step. Approval of the related behavior
decision does not approve the difference by itself.

## Core component loop

### Phase 0. Select one component

Choose a leaf component with:

- A working legacy surface.
- A small caller set.
- A clear DOM boundary.
- Representative interactive states.

Do not select a component when its required child must move first.

Gate:

- The registry entry exists.
- The legacy surface runs.
- The component boundary is known.

### Phase 1. Inventory and analyze

For the manual pilots, write the registry entry and worksheet by hand. Run
`inventory` and `analyze` only after those commands exist.

Review source and all known callers. Confirm which methods and options callers
actually use. Declare the repository roots and file types that the search
covers. Record any public or external call surface that this repository cannot
prove.

Gate:

- The worksheet exists.
- Every evidence path is current.
- Unknown syntax is visible.

Stop when:

- A caller cannot be found or understood.
- The component has an unknown owner.
- The analyzer output is stale.

### Phase 2. Capture the legacy baseline

Write scenarios from the source contract and caller behavior. Run the scenarios
against the real legacy page.

Save the complete output before editing component behavior.

Store the pinned MooTools runtime in the repository before the first accepted
baseline.

Gate:

- Every required state has a scenario.
- Every scenario performs at least one real interaction when the state is
  interactive.
- Baseline metadata is complete.
- The baseline has no missing selectors or inert actions.
- No resource, page, or console error occurred.
- Source, runtime, scenario, fixture, selector, and browser hashes are present.

No valid baseline means no migration.

### Phase 3. Resolve decisions

Classify every decision-required finding as:

- `preserve`
- `replace`
- `fix`
- `delete`

Use `preserve` for behavior that the new component must keep.

Use `replace` when React provides a new contract and callers will move to it.

Use `fix` for a known legacy defect. Record the expected new behavior.

Use `delete` only when the declared repository search and runtime evidence show
no required use in scope. Public or externally callable behavior also needs
owner approval. A finite scenario set cannot prove that external use does not
exist.

Gate:

- `decisions check` returns zero.
- Each product-visible difference has human approval.

Resolved findings do not prove that the analysis was complete. The run record
must keep the declared search scope and known evidence gaps.

### Phase 4. Define ownership and the target contract

Define:

- The React component boundary.
- The data model.
- Controlled and uncontrolled state.
- Events and callback payloads.
- Required imperative operations.
- Cleanup behavior.
- Stable DOM and automation hooks.
- Styling ownership.

Do not return an imperative handle unless a caller needs to control the
component after mount.

When incremental movement or rollback needs both implementations, create the
shared adapter now. Move callers to it while it still selects MooTools. Verify
this as a separate change.

Gate:

- One implementation owns the target DOM subtree.
- The target API has caller evidence.
- Any required adapter keeps legacy behavior unchanged.

### Phase 5. Implement React

For the first pilots, implement by hand with the core skill and customer React
skills.

Keep pure utilities when they already model valid domain behavior. Replace
MooTools DOM and event helpers at the React boundary.

Do not preserve a class-shaped design only because the legacy code uses a
class.

Run focused tests after each small behavior unit.

Gate:

- Type check passes.
- Unit tests cover pure state changes.
- Event contract tests cover required callbacks.
- No React source imports or calls MooTools.

### Phase 6. Prove parity

Run `compare`.

When a check fails:

1. Confirm that the baseline and candidate used the same scenario and
   environment.
2. Confirm that the scenario exercised the named state.
3. Fix the React candidate.
4. Rerun the failed scenario.
5. Run all component scenarios after the focused check passes.

After three blind fixes, stop. Inspect the exact element, event, property, or
state transition. Record the theory before another change.

Do not change a valid baseline to make the candidate pass.

If proof reveals that the baseline itself is invalid, record the harness
defect and discard that candidate comparison. Fix the harness, capture the
unchanged legacy component again, and review the new baseline before more
React work. Do not tune the new baseline from the React result.

Gate:

- `PARITY`.
- `ATTESTED`.
- Every accepted difference has an approved decision.
- Type check, tests, and production build pass.

### Phase 7. Switch ownership and clean up

In local pilot mode:

- Put the final React example on the root page.
- Keep the legacy page as the training reference until the runbook is stable.
- Change registry status to `pilot-proven`.
- Confirm that React has no MooTools dependency.
- Keep the legacy page outside the React ownership and completion checks.

Local pilot gate:

- All pilot scenarios pass.
- The legacy reference still runs.
- Type check, tests, and production build pass.
- The proof can run from a clean checkout.

In production mode:

- Enable the React path for a canary group.
- Check preset error, latency, and interaction thresholds.
- Increase traffic only when proof and metrics are green.
- Test rollback before full traffic.
- Move to full React traffic.
- Confirm no normal traffic reaches legacy.
- Change registry status to `react`.
- Delete old callers and unused legacy files.
- Delete the adapter branch for MooTools.
- Delete the feature flag.
- Delete temporary telemetry and allowlists.
- Lower the escape-hatch budget.

Production gate:

- No direct legacy caller remains.
- No orphaned legacy CSS or script remains.
- The full project check passes.

## Agent loop

Use one coordinator for the component. Let it delegate read-only inventory and
proof analysis. Keep source writes serial because the registry, fixture, and
component files are shared state.

```text
select component
  -> build inventory and worksheet
  -> capture baseline
  -> resolve decisions
  -> define contract
  -> implement one behavior unit
  -> run focused proof
       -> mismatch: fix React and retry
       -> intentional difference: require approved decision
       -> invalid evidence: fix harness and recapture before more code
  -> run full component proof
  -> clean up
  -> final project proof
  -> done
```

The coordinator writes one immutable `runs/<run-id>.json` record. It may also
update a small current-run pointer. Each run record contains:

- Current phase.
- Commands run.
- Input commit.
- Artifact hashes.
- Open findings.
- Decisions that need a human.
- Last failed assertion.
- Retry count.
- Final proof result.

The loop may continue without a user turn for:

- Read-only analysis.
- Baseline capture.
- Mechanical changes with known transforms.
- Candidate fixes that restore an approved contract.
- Deterministic verification.

The loop must stop for:

- Pre-existing changes in a target file that are not part of this run.
- A planned write outside the declared component file set.
- A product-visible behavior choice with no approved decision.
- A conflict between caller behavior and the written contract.
- A legacy defect that may need to remain for compatibility.
- A required API with no caller evidence.
- A request to change two frameworks in the same DOM subtree.
- A baseline that cannot exercise the required state.
- An unknown source form that a tool cannot safely transform.
- A production threshold or rollout choice that is not set.
- A failed check after a mechanical write. Revert that write before another
  transform attempt.

The loop must never:

- Hide an unknown item.
- Accept its own product decision.
- Push or deploy without user authority.
- Run two source-writing agents on the same component.
- Change the baseline because React differs.

## First pilot: TabPane

The first pilot uses:

- `legacy/components/tab-pane/TabPane.js`
- `legacy/components/tab-pane/TabPane.Extra.js`
- The only current call site in `legacy/main.js`
- The reference page at `/legacy/`
- The future React target under `src/components/tab-pane/`

### Known static contract

The analyzer should find:

- Default selectors `.tab` and `.content`.
- Default active class `active`.
- Constructor inputs `container`, `options`, and `showNow`.
- Core methods `get`, `indexOf`, and `show`.
- Extra methods `add` and `close`.
- Events `change`, `add`, and `close`.
- Index-based pairing between tabs and panels.
- Inline `display` writes on panels.
- Active-class writes on tabs.
- Dynamic DOM insertion and deletion.
- CSS and caller dependence on `.tab`, `.content`, and `.active`.
- One sandbox call site that uses `add`, `close`, and `change`.
- No timer, cache, API call, or server rendering path in TabPane.

### Decisions that need explicit review

Do not decide these from source shape alone:

1. Closing a non-active tab can select the wrong remaining panel.
2. A close-button click can select the tab before it closes.
3. The legacy component has no tab keyboard model or tab ARIA roles.
4. The demo prevents closure of the final tab. The component itself does not.
5. The constructor accepts a function for `showNow`. The sandbox does not use
   it.
6. The sandbox exposes an imperative handle through `window.MooSandbox`.
7. The React result may keep legacy global CSS for the pilot or take local
   style ownership.

Each item needs `preserve`, `replace`, `fix`, or `delete`.

### Required pilot scenarios

Create scenarios for:

1. Initial selection.
2. Select the second and third tabs.
3. Add and open a new tab.
4. Reject an incomplete add form.
5. Close the active tab.
6. Close a non-active tab.
7. Click the close button and record the contract-relevant event order.
8. Prevent closure of the last tab if that demo rule stays.
9. Call `show`, `get`, and `indexOf` through the legacy handle.
10. Check focus after add and close.
11. Check narrow and wide layouts.
12. Run keyboard and accessibility checks.

Record `add` then `change` order. Record `close` then `change` order. Also
record any earlier `change` caused by the close-button relay.

### Provisional React data shape

Do not treat this as approved API. Confirm it against caller needs.

```text
TabPane
  tabs: ordered records with stable IDs, labels, content, and close policy
  selectedId: controlled or initial selected ID
  onSelectionChange: selected stable ID
  onTabClose: requested stable ID
```

Use stable IDs instead of array positions in the React contract. Keep any
numeric index event only in an adapter when a real caller requires it.

Do not add an imperative handle unless a migrated caller needs `show`, `add`,
or `close` after mount.

## Definition of done

### Local pilot

TabPane is done when:

- The worksheet and baseline are saved.
- Every decision-required finding has a current decision.
- React renders the same fixture data.
- All required scenarios pass.
- Each intentional difference is approved and recorded.
- Type check, tests, and production build pass.
- React has no MooTools dependency.
- Registry status is `pilot-proven`.
- The run can be repeated from a clean checkout.

The legacy page can remain as a training reference in this repository.

### Production component

A production component is done when:

- Local proof is green.
- All callers use the shared contract.
- React serves all intended traffic.
- Representative interaction volume meets preset thresholds.
- Rollback was tested.
- No normal traffic reaches legacy.
- Legacy source, CSS, caller code, flag, temporary telemetry, and migration
  guards are removed.
- Registry and source tree agree.

## Build order for the migration system

### Pass 1

1. Store the pinned MooTools runtime in the repository.
2. Create one core skill and the smallest fixture, scenario, decision, and run
   schemas.
3. Write the TabPane registry entry, worksheet, fixtures, selector maps,
   scenarios, and decisions by hand.
4. Create a TabPane-focused Playwright capture and compare command.
5. Add Vitest and React Testing Library for React behavior tests.
6. Capture the TabPane baseline.
7. Migrate TabPane by hand and make its proof green.

### Pass 2

1. Run the same process on BrandBox or another component with different
   lifecycle behavior.
2. Compare both manual diffs.
3. Generalize the proof command only where both pilots use the same contract.
4. Add `inventory`, `analyze`, and fingerprint-aware decision validation.
5. Add only repeated transforms to a draft command.
6. Add `no-new-use` and aggregate `verify`.

### Pass 3

1. Add the fleet coordinator when more than a few components remain.
2. Add rebase-port support if branches remain open long enough to need it.
3. Add production adapter and rollout support only in the customer project.
4. Delete temporary tools and skills when the registry has no legacy entries.

## Open questions

The TabPane pilot should answer:

- Which DOM and event differences are intentional?
- Does the React API need an imperative handle?
- Which CSS hooks must stay public?
- What percentage of work is mechanical after two pilots?
- Which analyzer findings are reliable enough to become a write transform?
- Which proof checks should run in continuous integration?

The customer project must answer:

- Which feature flag system controls migration traffic?
- Which metrics and thresholds block rollout?
- What interaction volume is representative?
- What rollback time is required?
- Which browser and accessibility support levels apply?

Do not encode guesses for these questions in a codemod.

