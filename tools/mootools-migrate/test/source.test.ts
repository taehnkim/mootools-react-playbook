import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { ComponentConfigSchema } from "../src/schemas.js";
import { findLegacyUses } from "../src/source.js";

describe("legacy-use scanner", () => {
  it("finds bracket access through the browser global", async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), "legacy-use-"));
    await mkdir(join(projectRoot, "legacy"), { recursive: true });
    await writeFile(
      join(projectRoot, "legacy/main.js"),
      'var pane = new window["TabPane"]("tabs");\n',
      "utf8",
    );
    const config = ComponentConfigSchema.parse({
      schemaVersion: 1,
      id: "tab-pane",
      displayName: "TabPane",
      legacyGlobal: "TabPane",
      sourceFiles: ["legacy/TabPane.js"],
      cssFiles: [],
      markupFiles: [],
      bootstrapFiles: [],
      scanRoots: ["legacy"],
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
      },
      react: {
        entryPath: "/",
        readySelector: "[data-component=\"tab-pane\"]",
        handlePath: null,
        componentPath: "src/TabPane.tsx",
      },
      adapter: {
        globalName: "mountTabPane",
        outputPath: "legacy/adapters/mount-tab-pane.js",
        callsiteFiles: ["legacy/main.js"],
        bootstrapFile: "legacy/bootstrap.ts",
        bootstrapImportAnchor: 'import mainUrl from "./main.js?url";',
        bootstrapArrayAnchor: "mainUrl,",
        bootstrapImportPath: "./adapters/mount-tab-pane.js",
      },
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
  });
});
