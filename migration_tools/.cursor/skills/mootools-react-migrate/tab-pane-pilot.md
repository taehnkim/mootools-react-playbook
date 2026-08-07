# TabPane pilot

## Source

- `legacy/components/tab-pane/TabPane.js`
- `legacy/components/tab-pane/TabPane.Extra.js`
- `legacy/main.js`
- `legacy/styles.css`

## Known contract

- Defaults use `.tab`, `.content`, and `active`.
- `show` selects a tab and emits `change`.
- `add` inserts one tab-panel pair and emits `add`.
- `close` removes one pair and emits `close`, then `change`.
- Tabs and panels pair by array index.
- Content visibility uses inline `display`.
- The demo uses `add`, `close`, and `change`.

## Decisions that need review

- Directly closing a non-active tab selects the wrong remaining panel.
- A close-button click selects the tab before it closes.
- The legacy component has no tab keyboard model.
- The legacy component has no tab ARIA roles.
- The demo blocks closure of the last tab. The component does not.
- `showNow` accepts a function, but the sandbox does not use it.
- The sandbox exposes an imperative global handle.
- The pilot can keep global CSS or move to component-owned CSS.

Do not hide these differences in the parity tool.

## Required scenarios

The checked-in scenario file covers:

- Initial selection.
- Selection by click.
- Dynamic add and focus return.
- Invalid add.
- Direct close of a non-active tab.
- Close through the demo button.
- Imperative `show`.

Add keyboard and accessibility scenarios after their decisions are approved.

## Provisional React model

Use ordered tab records with stable IDs. Selection and close callbacks use the
stable ID.

Keep numeric index callbacks only in an adapter when a real caller needs them.
Do not add an imperative React handle unless an approved caller contract needs
`show`, `add`, or `close` after mount.
