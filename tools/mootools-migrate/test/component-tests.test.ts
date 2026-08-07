import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  checkComponentTest,
  runComponentTest,
} from "../src/component-tests.js";
import {
  ComponentConfigSchema,
  RegistrySchema,
} from "../src/schemas.js";

describe("component test evidence", () => {
  it("becomes stale when the tested source changes", async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), "component-test-"));
    const toolsRoot = join(projectRoot, "tools/mootools-migrate");
    await mkdir(join(projectRoot, "components/widget"), { recursive: true });
    await mkdir(join(projectRoot, "src"), { recursive: true });
    await mkdir(toolsRoot, { recursive: true });
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
    const config = ComponentConfigSchema.parse({
      schemaVersion: 1,
      id: "widget",
      displayName: "Widget",
      legacyGlobal: "Widget",
      sourceFiles: ["components/widget/Widget.js"],
      cssFiles: [],
      markupFiles: [],
      bootstrapFiles: [],
      scanRoots: ["."],
      callsiteGlobs: ["main.js"],
      tests: {
        legacyFile: "components/widget/Widget.legacy.test.ts",
        legacyDependencies: [],
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
      },
      react: {
        entryPath: "/react.html",
        readySelector: "[data-widget]",
        handlePath: null,
        componentPath: "src/Widget.tsx",
      },
      adapter: {
        globalName: "mountWidget",
        outputPath: "adapters/mount-widget.js",
        callsiteFiles: ["main.js"],
        bootstrapFile: "bootstrap.ts",
        bootstrapImportAnchor: 'import mainUrl from "./main.js?url";',
        bootstrapArrayAnchor: "mainUrl,",
        bootstrapImportPath: "./adapters/mount-widget.js",
      },
    });
    const registry = RegistrySchema.parse({
      schemaVersion: 1,
      components: [
        {
          id: "widget",
          mode: "local-pilot",
          configPath: "components/widget/component.json",
          status: "legacy",
          blockers: [],
        },
      ],
    });
    const context = { projectRoot, toolsRoot, registry };

    const result = await runComponentTest({
      context,
      config,
      surface: "legacy",
    });

    expect(result.passed).toBe(true);
    expect(
      await checkComponentTest({
        context,
        config,
        surface: "legacy",
      }),
    ).toMatchObject({ ok: true });

    await writeFile(
      join(projectRoot, "components/widget/Widget.js"),
      "var Widget = function changed() {};\n",
      "utf8",
    );

    const stale = await checkComponentTest({
      context,
      config,
      surface: "legacy",
    });
    expect(stale.ok).toBe(false);
    expect(stale.issues).toContain(
      "legacy source changed after its unit test.",
    );
  });
});
