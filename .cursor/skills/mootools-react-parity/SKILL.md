---
name: mootools-react-parity
description: Captures legacy behavior and compares a React candidate in a real browser. Use when creating a migration baseline, checking event or DOM behavior, comparing screenshots, or deciding whether a component has parity.
---

# MooTools and React parity

## Unit-test preconditions

Before baseline capture:

```bash
npm run migrate -- test legacy <component>
```

Before React comparison:

```bash
npm run migrate -- test react <component>
```

Capture and comparison reject missing, stale, or failed unit-test evidence.

## Capture legacy

Start the application. Then run:

```bash
npm run migrate -- capture <component> \
  --surface legacy \
  --base-url http://127.0.0.1:5173
```

Capture fails on:

- Browser console error.
- Page error.
- Request failure.
- Missing selector.
- Inert action.
- Assertion mismatch.
- Scenario that does not exercise every assertion.

Review the manifest and screenshots before React work.

Capture writes through a temporary directory. It rejects existing evidence.
Use `--replace` only after review when a new baseline is intentional.

The standard recorder attaches after the component is ready. Startup events
are outside this harness contract. If a real caller observes a startup event,
add a pre-initialization application hook before writing that scenario.

## Compare React

```bash
npm run migrate -- compare <component> \
  --base-url http://127.0.0.1:5173
```

Comparison first checks baseline freshness. It then runs the same semantic
scenarios with the React selector map.

## Proof rules

- Use the same browser and viewport.
- Use the same fixtures and scenarios.
- Record only stable contract observations.
- Keep event payloads to stable JSON values.
- Set screenshot tolerance before baseline capture.
- Do not change the baseline because React differs.
- Accept a difference only when the exact difference record and its related
  decision both have current human approval.

Done requires:

```text
PARITY
attested: true
```

## Failure loop

1. Confirm both runs used the same hashes and viewport.
2. Confirm the scenario exercised the changed state.
3. Fix React.
4. Rerun the failed scenario through the full command.
5. Rerun all component scenarios.

After three blind fixes, inspect the exact assertion and write down the theory.
Do not keep changing code without new evidence.

If the baseline is invalid, record the harness defect. Fix the harness. Capture
the unchanged legacy component again. Review the new baseline before more
React work.
