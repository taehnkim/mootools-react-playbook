---
name: mootools-react-no-escape-hatch
description: Removes temporary MooTools migration bridges and blocks new legacy use. Use during component cleanup or when direct constructors, global handles, duplicate DOM ownership, or compatibility wrappers remain.
---

# Remove migration escape hatches

Run:

```bash
npm run migrate -- no-new-use <component>
```

Review exact new and removed use identities. A total count is not enough. One
new unsafe use cannot replace one removed use.

Search the component boundary for:

- Direct legacy constructors.
- Unneeded browser globals.
- React code that imports MooTools.
- MooTools and React writing the same subtree.
- Temporary CSS selectors.
- Compatibility event bridges.
- Feature flags that can no longer select legacy.
- Temporary telemetry and allowlists.

In local pilot mode, the root legacy application may remain as a reference. It
must not be imported by the React target.

In production mode, complete cleanup only after React serves all intended
traffic and rollback proof is complete.

Update the allowlist when a use is removed. Never add a new allowlist entry
without an explicit migration reason and owner.
