import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { MigrationSpecSchema } from "../src/contracts/schemas.js";
import { findLegacyUses } from "../src/analyze/source.js";
import { checkNoNewUse } from "../src/checks/no-new-use.js";

describe("legacy-use scanner", () => {
  it("finds bracket access through the browser global", async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), "legacy-use-"));
    await mkdir(join(projectRoot, "legacy"), { recursive: true });
    await writeFile(
      join(projectRoot, "legacy/main.js"),
      'var pane = new window["TabPane"]("tabs");\n',
      "utf8",
    );
    const config = MigrationSpecSchema.parse({
      schemaVersion: 1,
      id: "tab-pane",
      legacyGlobal: "TabPane",
      sourceFiles: ["legacy/TabPane.js"],
      cssFiles: [],
      markupFiles: [],
      bootstrapFiles: [],
      callsiteGlobs: ["legacy/main.js"],
      tests: {
        legacyFile: "legacy/TabPane.legacy.test.ts",
        legacyDependencies: [],
        reactFile: "src/TabPane.test.tsx",
        reactDependencies: [],
      },
      fixtureBridge: {
        windowValueKey: "__FIXTURE__",
        windowIdKey: "__FIXTURE_ID__",
        legacyStaticFixtureId: "default",
        reactAcknowledgementPath: ["ReactSandbox", "fixtureId"],
      },
      legacy: {
        entryPath: "/legacy/",
        readyPath: ["MooSandbox", "tabPane"],
        eventNames: [],
        proofFiles: ["legacy/TabPane.js"],
      },
      react: {
        entryPath: "/",
        readySelector: "[data-component=\"tab-pane\"]",
        handlePath: null,
        componentPath: "src/TabPane.tsx",
        proofFiles: ["src/TabPane.tsx"],
      },
      viewport: { width: 1280, height: 900 },
      adapter: {
        globalName: "mountTabPane",
        outputPath: "legacy/adapters/mount-tab-pane.js",
        callsiteFiles: ["legacy/main.js"],
        bootstrapFile: "legacy/bootstrap.ts",
        bootstrapImportPath: "./adapters/mount-tab-pane.js",
      },
      fixtures: { default: {} },
      scenarios: [
        {
          id: "observe",
          fixture: "default",
          steps: [{ stepId: "observe", action: "observe" }],
          assertions: [
            {
              assertionId: "component-count",
              afterStepId: "observe",
              target: "component",
              kind: "count",
              matcher: "equals",
              expected: 1,
            },
          ],
        },
      ],
      selectors: {
        component: { legacy: "#tab-pane", react: "[data-tab-pane]" },
      },
      decisions: [],
      acceptedDifferences: [],
      allowedLegacyUses: [],
    });

    const uses = await findLegacyUses({ projectRoot, config });

    expect(uses).toEqual([
      {
        path: "legacy/main.js",
        kind: "constructor",
        symbol: "TabPane",
        line: 1,
      },
    ]);
    expect(
      await checkNoNewUse({
        context: { projectRoot, toolsRoot: projectRoot },
        config,
      }),
    ).toMatchObject({ ok: false });

    await writeFile(
      join(projectRoot, "legacy/main.js"),
      'var pane = mountTabPane("tabs");\n',
      "utf8",
    );
    expect(
      await checkNoNewUse({
        context: { projectRoot, toolsRoot: projectRoot },
        config,
      }),
    ).toMatchObject({ ok: true });
  });
});
