import {
  access,
  mkdtemp,
  mkdir,
  readFile,
  rename,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  applyAdapterCodemod,
  planAdapterCodemod,
} from "../src/codemods/adapter.js";
import {
  ComponentConfigSchema,
  RegistrySchema,
} from "../src/contracts/schemas.js";

describe("adapter codemod atomicity", () => {
  it("plans no writes when one target is unsupported", async () => {
    const fixture = await createAdapterProject();
    await writeFile(
      join(fixture.projectRoot, "legacy/unsupported.js"),
      'var pane = new window["TabPane"]("tabs");\n',
      "utf8",
    );
    fixture.config.adapter.callsiteFiles.push("legacy/unsupported.js");
    const originalMain = await readFile(
      join(fixture.projectRoot, "legacy/main.js"),
      "utf8",
    );

    const result = await planAdapterCodemod(fixture);

    expect(result.kind).toBe("unsupported");
    expect(
      await readFile(join(fixture.projectRoot, "legacy/main.js"), "utf8"),
    ).toBe(originalMain);
    await expect(
      access(
        join(
          fixture.projectRoot,
          "legacy/adapters/mount-tab-pane.js",
        ),
      ),
    ).rejects.toThrow();
  });

  it("restores every file after a write failure", async () => {
    const fixture = await createAdapterProject();
    const result = await planAdapterCodemod(fixture);
    if (result.kind !== "ready") {
      throw new Error(result.reasons.join("\n"));
    }
    const mainPath = join(fixture.projectRoot, "legacy/main.js");
    const bootstrapPath = join(
      fixture.projectRoot,
      "legacy/bootstrap.ts",
    );
    const originalMain = await readFile(mainPath, "utf8");
    const originalBootstrap = await readFile(bootstrapPath, "utf8");
    let renameCount = 0;

    await expect(
      applyAdapterCodemod({
        context: fixture.context,
        result,
        allowUnsafeWrite: true,
        fileOperations: {
          rename: async (oldPath, newPath) => {
            renameCount += 1;
            if (renameCount === 2) {
              throw new Error("simulated rename failure");
            }
            await rename(oldPath, newPath);
          },
        },
      }),
    ).rejects.toThrow("simulated rename failure");

    expect(await readFile(mainPath, "utf8")).toBe(originalMain);
    expect(await readFile(bootstrapPath, "utf8")).toBe(originalBootstrap);
    await expect(
      access(
        join(
          fixture.projectRoot,
          "legacy/adapters/mount-tab-pane.js",
        ),
      ),
    ).rejects.toThrow();
  });
});

async function createAdapterProject() {
  const projectRoot = await mkdtemp(join(tmpdir(), "adapter-atomicity-"));
  await mkdir(join(projectRoot, "legacy"), { recursive: true });
  await writeFile(
    join(projectRoot, "legacy/main.js"),
    "var pane = new TabPane('tabs');\n",
    "utf8",
  );
  await writeFile(
    join(projectRoot, "legacy/bootstrap.ts"),
    [
      'import mainUrl from "./main.js?url";',
      "const scripts = [",
      "  mainUrl,",
      "];",
      "",
    ].join("\n"),
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
    bootstrapFiles: ["legacy/bootstrap.ts"],
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
      eventNames: ["change"],
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
  const registry = RegistrySchema.parse({
    schemaVersion: 1,
    components: [
      {
        id: "tab-pane",
        mode: "local-pilot",
        configPath: "component.json",
        status: "legacy",
        blockers: [],
      },
    ],
  });
  return {
    projectRoot,
    config,
    context: { projectRoot, toolsRoot: projectRoot, registry },
  };
}
