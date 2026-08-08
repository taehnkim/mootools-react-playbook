import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { describe, expect, it } from "vitest";

import { planAdapterCodemod } from "../src/codemods/adapter.js";
import { MigrationSpecSchema } from "../src/contracts/schemas.js";

describe("adapter codemod", () => {
  it("plans the adapter, caller, and load-order edits", async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), "mootools-adapter-"));
    await mkdir(join(projectRoot, "legacy"), { recursive: true });
    await writeFile(
      join(projectRoot, "legacy/main.js"),
      "var pane = new TabPane('tabs');\n",
      "utf8",
    );
    await writeFile(
      join(projectRoot, "legacy/bootstrap.ts"),
      [
        '// import mountAdapterUrl from "./adapters/mount-tab-pane.js?url";',
        'import mainUrl from "./main.js?url";',
        "const scripts = [",
        "  // mountAdapterUrl,",
        "  mainUrl,",
        "];",
        "",
      ].join("\n"),
      "utf8",
    );
    const config = MigrationSpecSchema.parse({
      schemaVersion: 1,
      id: "tab-pane",
      legacyGlobal: "TabPane",
      sourceFiles: ["legacy/TabPane.js"],
      cssFiles: [],
      markupFiles: [],
      bootstrapFiles: ["legacy/bootstrap.ts"],
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
        eventNames: ["change"],
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
            {
              assertionId: "component-image",
              afterStepId: "observe",
              target: "component",
              kind: "screenshot",
              matcher: "pixel-diff",
              name: "component",
              maxDiffRatio: 0,
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

    const result = await planAdapterCodemod({
      context: { projectRoot, toolsRoot: projectRoot },
      config,
    });

    expect(result.kind).toBe("ready");
    if (result.kind !== "ready") {
      throw new Error(result.reasons.join("\n"));
    }
    expect(result.edits.map((edit) => edit.path).sort()).toEqual([
      "legacy/adapters/mount-tab-pane.js",
      "legacy/bootstrap.ts",
      "legacy/main.js",
    ]);
    expect(
      result.edits.find((edit) => edit.path === "legacy/main.js")?.after,
    ).toContain("mountTabPane('tabs')");
    const bootstrapAfter = result.edits.find(
      (edit) => edit.path === "legacy/bootstrap.ts",
    )?.after;
    expect(bootstrapAfter).toMatch(/^import mountAdapterUrl/m);
    expect(bootstrapAfter).toMatch(/^\s+mountAdapterUrl,$/m);
  });
});
