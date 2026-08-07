# MooTools to React sandbox

This project keeps a small React target and a working MooTools reference in the
same Vite server. Use it to migrate one legacy component at a time.

See [MIGRATION_RUNBOOK.md](./MIGRATION_RUNBOOK.md) for the proposed skills,
tools, evidence files, and agent loop.

The executable first pass is in
[`migration_tools/`](./migration_tools/README.md).

## Start the sandbox

```sh
npm install
npm run dev
```

Open:

- `http://localhost:5173/` for the React and TypeScript target.
- `http://localhost:5173/legacy/` for the MooTools reference page.

Run `npm run build` to type-check the React code and build both pages.

## Project layout

- `index.html` and `src/main.tsx` are the root React entry point.
- `src/global.css` supplies shared page-level styles.
- `legacy/index.html` is the separate MooTools entry point.
- `legacy/main.js` wires the legacy examples to their page controls.
- `legacy/components/` contains the unchanged migration targets.
- `legacy/styles.css` supplies all component and page styling for the legacy
  examples.

The legacy page contains TabPane, BrandBox, and ColorRange. It loads MooTools
Core 1.4.2 and the required MooTools More Color utility from URLs pinned to a
source revision. The page needs network access for those two framework files.

## Source revisions

The local component files retain their original MIT-style source headers:

- [MooTools-TabPane](https://github.com/akaIDIOT/MooTools-TabPane/tree/90ad8d233f160d7b33380d5857eec79f5780aa0b)
  version 0.5.2.
- [MooTools-BrandBox](https://github.com/akaIDIOT/MooTools-BrandBox/tree/e97eda4fe56751b448eafde17ba38a9130cc97df)
  version 0.2.
- [MooTools-ColorRange](https://github.com/akaIDIOT/MooTools-ColorRange/tree/369437111704df7aeaf84a29e5a0ecc2733bbb53)
  version 0.2.

## Suggested migration loop

1. Pick one folder under `legacy/components/`.
2. Record its visible behavior and public methods from the running legacy page.
3. Create the React version under `src/components/<component-name>/`.
4. Add the same example data to the root React page.
5. Compare selection, events, timers, dynamic updates, and styling in both
   pages.
6. Add React tests for the preserved behavior and for any intentional
   accessibility improvements.

The running legacy instances are also available as `window.MooSandbox` in the
browser console. This makes it easy for a future agent or test harness to call
the old component methods directly.
