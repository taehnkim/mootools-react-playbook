import {
  mkdir,
  mkdtemp,
  readFile,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { analyzeComponent } from "../src/analyze/index.js";
import {
  writeDecisionStubsIfEmpty,
} from "../src/checks/decisions.js";
import {
  createContext,
  loadMigrationSpec,
} from "../src/core/context.js";
import { MigrationSpecSchema } from "../src/contracts/schemas.js";

describe("analyze decision stubs", () => {
  it("creates stubs only for an empty human decision section", async () => {
    const sourceToolsRoot = resolve(process.cwd());
    const projectRoot = resolve(sourceToolsRoot, "../..");
    const sourceContext = await createContext({
      toolsRoot: sourceToolsRoot,
      projectRoot,
    });
    const config = await loadMigrationSpec(sourceContext, "tab-pane");
    const worksheet = await analyzeComponent({
      context: sourceContext,
      config,
    });
    const toolsRoot = await mkdtemp(join(tmpdir(), "decision-stubs-"));
    const componentRoot = join(toolsRoot, "components/tab-pane");
    await mkdir(componentRoot, { recursive: true });
    const emptyConfig = MigrationSpecSchema.parse({
      ...config,
      decisions: [],
    });

    expect(
      await writeDecisionStubsIfEmpty({
        context: { toolsRoot, projectRoot },
        config: emptyConfig,
        worksheet,
      }),
    ).toBe(true);
    const written = MigrationSpecSchema.parse(
      JSON.parse(
        await readFile(join(componentRoot, "migration.json"), "utf8"),
      ),
    );
    expect(written.decisions).toHaveLength(
      worksheet.findings.filter((finding) => finding.decisionRequired).length,
    );

    await writeFile(join(componentRoot, "migration.json"), "human-owned\n");
    const configuredDecisions = MigrationSpecSchema.parse({
      ...config,
      decisions: written.decisions,
    });
    expect(
      await writeDecisionStubsIfEmpty({
        context: { toolsRoot, projectRoot },
        config: configuredDecisions,
        worksheet,
      }),
    ).toBe(false);
    expect(
      await readFile(join(componentRoot, "migration.json"), "utf8"),
    ).toBe("human-owned\n");
  });
});
