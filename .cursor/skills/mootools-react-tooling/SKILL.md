---
name: mootools-react-tooling
description: Operates and changes the checked-in MooTools migration CLI. Use when running inventory, static analysis, decision checks, the adapter codemod, legacy-use guards, status, or rebase detection.
---

# MooTools migration tooling

Run commands from the repository root.

## Command contract

Each command must state its input, output, files written, and non-goals.
Commands must be deterministic for the same source and configuration.

## Commands

### Inventory

```bash
npm run migrate -- inventory
npm run migrate -- inventory --write
```

Reads registered definitions and call-site globs. Writes only
`generated/inventory.json`.

### Analyze

```bash
npm run migrate -- analyze <component>
npm run migrate -- analyze <component> --write
```

Reads source, CSS, and callers. Writes only
`tools/mootools-migrate/components/<id>/worksheet.generated.json`.

It analyzes:

- Emitted events and registered listeners.
- Delegated event expressions.
- Constructor and adapter callsites.
- Instance method calls and caller event subscriptions.
- DOM reads, writes, markup structure, and stable hooks.
- CSS selectors, declarations, media rules, and custom properties.
- Imports, MooTools metadata dependencies, and script load order.
- Known API calls, timers, storage, and browser-global writes.

The worksheet has coverage counts and explicit limitations for every category.
It records unknown forms. It does not edit source or choose behavior.

### Decisions

```bash
npm run migrate -- decisions init <component> --write
npm run migrate -- decisions check <component>
```

Initialization does not replace an existing file without `--force`. Checking
fails on missing rationale, pending approval, stale fingerprints, and orphaned
decisions.

### Adapter codemod

```bash
npm run migrate -- adapter <component>
```

Dry-run is the default. The codemod:

1. Preflights every configured caller.
2. Replaces only exact supported constructors.
3. Creates a behavior-preserving legacy adapter.
4. Adds that adapter to the classic-script load order.
5. Writes all planned files as one component operation.

It writes nothing when one form is unsupported.

### No-new-use

```bash
npm run migrate -- no-new-use <component>
```

Compares exact use identities and locations with the approved allowlist. New
uses fail. Removed uses are reported for allowlist cleanup.

### Status and loop

```bash
npm run migrate -- status <component>
npm run migrate -- loop <component> --legacy-url <url> --react-url <url>
```

The loop executes deterministic phases only. It stops for decisions and React
implementation.

### Verify

```bash
npm run migrate -- verify <component>
```

Runs decision freshness, the no-new-use guard, migration status, the target
project type check, and the production build. It stays nonzero until parity is
complete.

### Rebase detection

```bash
npm run migrate -- rebase-detect --upstream origin/main
```

Reports registered legacy files changed both upstream and locally. It does not
resolve conflicts.

## Write safety

- Keep dry-run as the default.
- Require clean git target paths for a codemod write.
- Use `--allow-unsafe-write` only in a disposable non-git sandbox.
- Use atomic temporary files.
- Restore original files after a failed write.
- Never write outside the registered component file set.
