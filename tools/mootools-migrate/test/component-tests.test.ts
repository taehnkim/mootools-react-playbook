import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { runComponentTest } from "../src/checks/component-tests.js";
import { MigrationSpecSchema } from "../src/contracts/schemas.js";
import { hashProjectFiles } from "../src/core/fingerprint.js";

describe("component tests", () => {
  it("binds the test receipt to its configured inputs", async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), "component-test-"));
    await mkdir(join(projectRoot, "components/widget"), { recursive: true });
    await mkdir(join(projectRoot, "src"), { recursive: true });
    await writeFile(
      join(projectRoot, "package.json"),
      JSON.stringify({
        scripts: {
          test: 'node -e "process.exit(0)"',
        },
      }),
      "utf8",
    );
    await writeFile(
      join(projectRoot, "components/widget/Widget.js"),
      "var Widget = function() {};\n",
      "utf8",
    );
    await writeFile(
      join(projectRoot, "components/widget/Widget.legacy.test.ts"),
      "export {};\n",
      "utf8",
    );
    await writeFile(
      join(projectRoot, "components/widget/runtime.js"),
      "export const ready = true;\n",
      "utf8",
    );
    const config = MigrationSpecSchema.parse({
      schemaVersion: 1,
      id: "widget",
      legacyGlobal: "Widget",
      sourceFiles: ["components/widget/Widget.js"],
      cssFiles: [],
      markupFiles: [],
      bootstrapFiles: [],
      callsiteGlobs: ["main.js"],
      tests: {
        legacyFile: "components/widget/Widget.legacy.test.ts",
        legacyDependencies: ["components/widget/runtime.js"],
        reactFile: "src/Widget.test.tsx",
        reactDependencies: [],
      },
      fixtureBridge: {
        windowValueKey: "__FIXTURE__",
        windowIdKey: "__FIXTURE_ID__",
        legacyStaticFixtureId: "default",
        reactAcknowledgementPath: ["ReactSandbox", "fixtureId"],
      },
      legacy: {
        entryPath: "/",
        readyPath: ["Widget"],
        eventNames: [],
        proofFiles: ["components/widget/Widget.js"],
      },
      react: {
        entryPath: "/react.html",
        readySelector: "[data-widget]",
        handlePath: null,
        componentPath: "src/Widget.tsx",
        proofFiles: ["src/Widget.tsx"],
      },
      viewport: { width: 1280, height: 900 },
      adapter: {
        globalName: "mountWidget",
        outputPath: "adapters/mount-widget.js",
        callsiteFiles: ["main.js"],
        bootstrapFile: "bootstrap.ts",
        bootstrapImportPath: "./adapters/mount-widget.js",
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
        component: { legacy: "#widget", react: "[data-widget]" },
      },
      decisions: [],
      acceptedDifferences: [],
      allowedLegacyUses: [],
    });

    const first = await runComponentTest({
      context: { projectRoot, toolsRoot: projectRoot },
      config,
      surface: "legacy",
    });
    const expectedInputHash = await hashProjectFiles({
      projectRoot,
      paths: [
        "components/widget/Widget.js",
        "components/widget/Widget.legacy.test.ts",
        "components/widget/runtime.js",
      ],
    });
    await writeFile(
      join(projectRoot, "components/widget/Widget.js"),
      "var Widget = function changed() {};\n",
      "utf8",
    );
    const second = await runComponentTest({
      context: { projectRoot, toolsRoot: projectRoot },
      config,
      surface: "legacy",
    });

    expect(first.passed).toBe(true);
    expect(first.inputHash).toBe(expectedInputHash);
    expect(second.passed).toBe(true);
    expect(second.inputHash).not.toBe(first.inputHash);
  });
});
