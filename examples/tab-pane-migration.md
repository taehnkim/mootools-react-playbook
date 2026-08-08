# TabPane migration example

This tracked sample documents a completed TabPane migration. It is
documentation, not live proof. Run verification and inspect the local evidence
before making a parity claim.

## Run the migration

```sh
npm run migrate -- analyze tab-pane
npm run migrate -- baseline tab-pane \
  --base-url http://127.0.0.1:5173
npm run migrate -- adapter tab-pane
npm run migrate -- verify tab-pane \
  --base-url http://127.0.0.1:5173
```

## Sample saved unit-test receipts

These selected fields come from the local final manifest.

```json
[
  {
    "surface": "legacy",
    "command": "npm run test -- components/tab-pane/TabPane.legacy.test.ts",
    "passed": true,
    "inputHash": "sha256:1e4d2148dd5bcabf7b82ffdba3faeca2eb95dc69e2b0861e0554d11815e7978f"
  },
  {
    "surface": "react",
    "command": "npm run test -- src/components/tab-pane/TabPane.test.tsx",
    "passed": true,
    "inputHash": "sha256:392b21e39edfd55a46a0913612fcccaed6c5f3e021f21ca00e32081247356b1c"
  }
]
```

## Sample exact image comparison

This record has equal dimensions and zero changed pixels.

```json
{
  "scenarioId": "initial-selection",
  "stepId": "observe-initial",
  "assertionId": "initial-component-image",
  "baselineScreenshotPath": "initial-selection/component.png",
  "baselineScreenshotHash": "sha256:3d1551c232afc6e2c9e94864cb6a30e066ebca1ae89550c959353a7f02aa1c8a",
  "baselineScreenshotSize": {
    "width": 1086,
    "height": 206
  },
  "reactScreenshotPath": "initial-selection/component.png",
  "reactScreenshotHash": "sha256:3d1551c232afc6e2c9e94864cb6a30e066ebca1ae89550c959353a7f02aa1c8a",
  "reactScreenshotSize": {
    "width": 1086,
    "height": 206
  },
  "diffPath": "diffs/initial-selection/initial-component-image.png",
  "diffHash": "sha256:d8ba7c9976f81441834d5076d72eb8d00ae0b4765f97d13ac9006e5e32f6de91",
  "totalPixels": 223716,
  "changedPixels": 0,
  "diffRatio": 0,
  "allowedChangedPixels": 0,
  "exact": true
}
```

## Accepted differences

TabPane records four approved behavior differences in `migration.json`.

- When another tab closes, React keeps the selected stable tab. This changes
  the selected-state, status, and event-order observations.
- When the active close button is clicked, React stops propagation. This
  removes the legacy select event before close.

The non-active close difference changes the selected tab, so that scenario has
no exact screenshot claim. The other six visual states require equal
dimensions and zero changed pixels.

## Local generated evidence

```text
tools/mootools-migrate/components/tab-pane/worksheet.generated.json
tools/mootools-migrate/components/tab-pane/baseline/manifest.json
tools/mootools-migrate/components/tab-pane/baseline/<scenario>/<name>.png
tools/mootools-migrate/components/tab-pane/final/manifest.json
tools/mootools-migrate/components/tab-pane/final/parity.json
tools/mootools-migrate/components/tab-pane/final/<scenario>/<name>.png
tools/mootools-migrate/components/tab-pane/final/diffs/<scenario>/<assertion>.png
tools/mootools-migrate/components/tab-pane/final.failed/
```

Git ignores these paths. Regenerate them for the current checkout.
