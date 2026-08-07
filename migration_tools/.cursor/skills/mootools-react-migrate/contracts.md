# Migration artifact contracts

## Ownership

- `registry.json` is human-owned fleet state.
- `generated/inventory.json` is replaceable scanner output.
- `worksheet.generated.json` is replaceable analyzer output.
- `decisions.json` is human-owned.
- `accepted-differences.json` is human-owned.
- `baseline/` is immutable evidence for one legacy input set.
- `candidate/<run-id>/` is evidence for one React run.

Never let a generated command overwrite a human-owned file without an explicit
force flag.

## Finding freshness

Each finding has a SHA-256 fingerprint over:

- Schema version.
- Finding ID.
- Kind.
- Summary.
- Contract relevance.
- Decision requirement.
- Sorted evidence paths, line ranges, and source-slice hashes.

Each decision stores that fingerprint. A changed fingerprint makes the
decision stale.

## Decision approval

The approval shape is one of:

```json
{ "status": "not-required" }
```

```json
{ "status": "pending" }
```

```json
{
  "status": "approved",
  "approvedBy": "person",
  "approvedAt": "2026-01-01T00:00:00.000Z",
  "findingFingerprint": "sha256:..."
}
```

An agent may propose a decision. It may not create human approval.

## Scenario identity

Every action has a stable `stepId`. Every assertion has a stable
`assertionId`, `afterStepId`, and matcher.

Selector maps translate a semantic target to a page selector. They may not
change expected values.

An accepted difference names exactly one decision fingerprint, scenario,
step, assertion, legacy value, and React value. Wildcards are invalid.

The complete difference record has its own fingerprint and human approval.
Approval of the related behavior decision does not approve an arbitrary
parity mismatch.

## Baseline freshness

Comparison checks:

- Legacy source and CSS hash.
- Component configuration hash.
- Fixture hash.
- Scenario hash.
- Legacy selector hash.
- Browser version.
- Viewport.
- Fixture acknowledgement by the React test surface.

If one value changes, capture and review a new legacy baseline before more
comparison work.

## Completion

Local pilot completion is `pilot-proven`. The legacy reference may remain.

Production completion is `react`. No normal caller or traffic may reach the
legacy implementation.
