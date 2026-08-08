import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { runInNewContext } from "node:vm";

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
        flagName: "react-tab-pane",
        tableManagerGlobal: "tableManager",
        reactMountGlobal: "mountReactTabPane",
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

    const adapterAfter = result.edits.find(
      (edit) => edit.path === "legacy/adapters/mount-tab-pane.js",
    )?.after;
    if (adapterAfter === undefined) {
      throw new Error("The generated adapter edit is missing.");
    }
    expect(adapterAfter).toContain(
      'if (tableManager && tableManager.isEnabled("react-tab-pane"))',
    );
    expect(adapterAfter).toContain(
      "return reactMount(container, options, initialIndex);",
    );
    expect(adapterAfter).toContain(
      'return new global["TabPane"](container, options, initialIndex);',
    );

    const container = { id: "tabs" };
    const options = { activeClass: "selected" };
    const initialIndex = 2;
    const legacyCalls: unknown[][] = [];
    class LegacyTabPane {
      constructor(...args: unknown[]) {
        legacyCalls.push(args);
      }
    }
    const legacyAdapter = evaluateAdapter(adapterAfter, {
      TabPane: LegacyTabPane,
    });

    const legacyResult = legacyAdapter(container, options, initialIndex);

    expect(legacyResult).toBeInstanceOf(LegacyTabPane);
    expectForwarded(legacyCalls, container, options, initialIndex);

    const disabledFlags: string[] = [];
    const disabledCalls: unknown[][] = [];
    class DisabledLegacyTabPane {
      constructor(...args: unknown[]) {
        disabledCalls.push(args);
      }
    }
    const disabledAdapter = evaluateAdapter(adapterAfter, {
      TabPane: DisabledLegacyTabPane,
      tableManager: {
        isEnabled(flagName: string) {
          disabledFlags.push(flagName);
          return false;
        },
      },
    });

    expect(disabledAdapter(container, options, initialIndex)).toBeInstanceOf(
      DisabledLegacyTabPane,
    );
    expect(disabledFlags).toEqual(["react-tab-pane"]);
    expectForwarded(disabledCalls, container, options, initialIndex);

    const requestedFlags: string[] = [];
    const reactCalls: unknown[][] = [];
    const reactResult = { owner: "react" };
    const reactAdapter = evaluateAdapter(adapterAfter, {
      TabPane: class {
        constructor() {
          throw new Error("The legacy branch ran.");
        }
      },
      tableManager: {
        isEnabled(flagName: string) {
          requestedFlags.push(flagName);
          return true;
        },
      },
      mountReactTabPane(...args: unknown[]) {
        reactCalls.push(args);
        return reactResult;
      },
    });

    expect(reactAdapter(container, options, initialIndex)).toBe(reactResult);
    expect(requestedFlags).toEqual(["react-tab-pane"]);
    expectForwarded(reactCalls, container, options, initialIndex);

    const missingMountAdapter = evaluateAdapter(adapterAfter, {
      TabPane: LegacyTabPane,
      tableManager: {
        isEnabled() {
          return true;
        },
      },
    });
    expect(() =>
      missingMountAdapter(container, options, initialIndex),
    ).toThrow(
      "React mount global mountReactTabPane is not available.",
    );

    const escapedFlag = 'react-"tab\npane';
    const escapedManagerName = 'table"Manager';
    const escapedMountName = "mount\\React";
    const escapedConfig = MigrationSpecSchema.parse({
      ...config,
      adapter: {
        ...config.adapter,
        flagName: escapedFlag,
        tableManagerGlobal: escapedManagerName,
        reactMountGlobal: escapedMountName,
      },
    });
    const escapedPlan = await planAdapterCodemod({
      context: { projectRoot, toolsRoot: projectRoot },
      config: escapedConfig,
    });
    if (escapedPlan.kind !== "ready") {
      throw new Error(escapedPlan.reasons.join("\n"));
    }
    const escapedSource = escapedPlan.edits.find(
      (edit) => edit.path === "legacy/adapters/mount-tab-pane.js",
    )?.after;
    if (escapedSource === undefined) {
      throw new Error("The escaped adapter edit is missing.");
    }
    const escapedFlags: string[] = [];
    const escapedAdapter = evaluateAdapter(escapedSource, {
      TabPane: LegacyTabPane,
      [escapedManagerName]: {
        isEnabled(flagName: string) {
          escapedFlags.push(flagName);
          return true;
        },
      },
      [escapedMountName]() {
        return reactResult;
      },
    });

    expect(escapedAdapter(container, options, initialIndex)).toBe(reactResult);
    expect(escapedFlags).toEqual([escapedFlag]);
  });
});

function evaluateAdapter(
  source: string,
  globals: Record<string, unknown>,
): (
  container: unknown,
  options: unknown,
  initialIndex: unknown,
) => unknown {
  runInNewContext(source, { window: globals });
  const adapter = globals.mountTabPane;
  if (typeof adapter !== "function") {
    throw new Error("The generated mountTabPane global is missing.");
  }
  return (container, options, initialIndex) =>
    Reflect.apply(adapter, globals, [container, options, initialIndex]);
}

function expectForwarded(
  calls: readonly unknown[][],
  container: unknown,
  options: unknown,
  initialIndex: unknown,
): void {
  expect(calls).toHaveLength(1);
  const args = calls[0];
  if (args === undefined) {
    throw new Error("The adapter call was not recorded.");
  }
  expect(args).toHaveLength(3);
  expect(args[0]).toBe(container);
  expect(args[1]).toBe(options);
  expect(args[2]).toBe(initialIndex);
}
