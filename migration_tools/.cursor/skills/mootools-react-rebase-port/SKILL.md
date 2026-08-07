---
name: mootools-react-rebase-port
description: Preserves upstream legacy behavior during a long MooTools-to-React migration branch. Use before rebasing when a registered component changed upstream and locally.
---

# Port changes during a rebase

Run before the rebase:

```bash
npm run migrate -- rebase-detect --upstream origin/main
```

For each reported component:

1. Record the merge base and changed paths.
2. Check the upstream legacy change and its caller effect.
3. Run the legacy scenarios against the upstream behavior.
4. Save a reviewed replacement baseline.
5. Port the upstream intent to React.
6. Run full parity against the replacement baseline.
7. Keep one component port in one review unit.

Do not:

- Keep the React side and silently discard changed legacy behavior.
- Restore deleted legacy code as the final result.
- Reuse a stale baseline.
- Mark a text conflict as resolved before behavior proof.

If this directory is not in a git repository, stop. Rebase detection cannot
provide useful evidence.
