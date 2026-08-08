import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import {
  createContext,
  loadMigrationSpec,
} from "../src/core/context.js";
import { MigrationSpecSchema } from "../src/contracts/schemas.js";
import {
  captureConfigHash,
  captureSurface,
  selectorMap,
} from "../src/parity/capture.js";

const toolsRoot = resolve(process.cwd());
const projectRoot = resolve(toolsRoot, "../..");

describe("migration config", () => {
  it("loads migration.json by component convention", async () => {
    const context = await createContext({ toolsRoot, projectRoot });
    const config = await loadMigrationSpec(context, "tab-pane");

    expect(config.id).toBe("tab-pane");
    expect(config.scenarios).toHaveLength(7);
    expect(config.selectors.component).toEqual({
      legacy: "#tab-pane",
      react: '[data-migration-component="tab-pane"]',
    });
    expect(config.implementationBridge).toEqual({
      windowKey: "__TAB_PANE_IMPLEMENTATION__",
      legacyValue: "legacy-TabPane",
      reactValue: "react-TabPane",
    });
    expect(config.legacy.entryPath).toBe("/");
    expect(config.react.entryPath).toBe("/");
  });

  it("rejects component paths that can escape the tools directory", async () => {
    const context = await createContext({ toolsRoot, projectRoot });

    await expect(loadMigrationSpec(context, "../tab-pane")).rejects.toThrow();
  });

  it("requires terminal screenshot proof for exact scenarios", async () => {
    const context = await createContext({ toolsRoot, projectRoot });
    const config = await loadMigrationSpec(context, "tab-pane");
    const result = MigrationSpecSchema.safeParse({
      ...config,
      scenarios: config.scenarios.map((scenario) =>
        scenario.id === "initial-selection"
          ? {
              ...scenario,
              assertions: scenario.assertions.filter(
                (assertion) => assertion.kind !== "screenshot",
              ),
            }
          : scenario,
      ),
    });

    expect(result.success).toBe(false);
    if (result.success) {
      throw new Error("Migration without screenshot proof passed validation.");
    }
    expect(result.error.issues.map((issue) => issue.message)).toContain(
      "Scenario initial-selection requires a terminal screenshot or an approved difference.",
    );
  });

  it("hashes legacy and React proof inputs independently", async () => {
    const context = await createContext({ toolsRoot, projectRoot });
    const config = await loadMigrationSpec(context, "tab-pane");
    const decisionEdit = MigrationSpecSchema.parse({
      ...config,
      decisions: [],
    });
    const reactEdit = MigrationSpecSchema.parse({
      ...config,
      react: {
        ...config.react,
        entryPath: "/changed-react.html",
      },
    });
    const bridgeEdit = MigrationSpecSchema.parse({
      ...config,
      implementationBridge: {
        ...config.implementationBridge,
        reactValue: "react-TabPane-next",
      },
    });

    expect(captureConfigHash(decisionEdit, "legacy")).toBe(
      captureConfigHash(config, "legacy"),
    );
    expect(captureConfigHash(decisionEdit, "react")).toBe(
      captureConfigHash(config, "react"),
    );
    expect(captureConfigHash(reactEdit, "legacy")).toBe(
      captureConfigHash(config, "legacy"),
    );
    expect(captureConfigHash(reactEdit, "react")).not.toBe(
      captureConfigHash(config, "react"),
    );
    expect(captureConfigHash(bridgeEdit, "legacy")).toBe(
      captureConfigHash(config, "legacy"),
    );
    expect(captureConfigHash(bridgeEdit, "react")).not.toBe(
      captureConfigHash(config, "react"),
    );
  });

  it("rejects evidence output outside the component directory", async () => {
    const context = await createContext({ toolsRoot, projectRoot });
    const config = await loadMigrationSpec(context, "tab-pane");

    await expect(
      captureSurface({
        context,
        config,
        scenarios: config.scenarios,
        selectors: selectorMap(config, "legacy"),
        fixtures: config.fixtures,
        baseUrl: "http://127.0.0.1:1",
        surface: "legacy",
        outputDirectory: resolve(toolsRoot, "outside"),
        runId: "outside",
        viewport: config.viewport,
        checks: {
          componentTests: [
            {
              surface: "legacy",
              command: "npm run test -- legacy.test.ts",
              passed: true,
              output: "passed",
              inputHash: `sha256:${"0".repeat(64)}`,
            },
          ],
          projectChecks: [],
        },
        enforceExpected: true,
        replaceExisting: false,
      }),
    ).rejects.toThrow("Evidence output must stay inside");
  });
});
