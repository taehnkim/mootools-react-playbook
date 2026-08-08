import {
  access,
  mkdir,
  mkdtemp,
  readFile,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { createContext, loadMigrationSpec } from "../src/core/context.js";
import {
  commitFinalCandidate,
  isAcceptedDifference,
} from "../src/parity/compare.js";

describe("parity comparison", () => {
  it("accepts only the exact approved observation difference", async () => {
    const toolsRoot = resolve(process.cwd());
    const context = await createContext({
      toolsRoot,
      projectRoot: resolve(toolsRoot, "../.."),
    });
    const config = await loadMigrationSpec(context, "tab-pane");
    const difference = config.acceptedDifferences[0];
    if (difference === undefined) {
      throw new Error("Expected an accepted difference fixture.");
    }
    const mismatch = {
      scenarioId: difference.scenarioId,
      assertionId: difference.assertionId,
      reason: "Observed value differs.",
      legacyValue: difference.legacyValue,
      reactValue: difference.reactValue,
    };

    expect(
      isAcceptedDifference({
        mismatch,
        acceptedDifferences: config.acceptedDifferences,
        decisions: config.decisions,
        afterStepId: difference.stepId,
      }),
    ).toBe(true);
    expect(
      isAcceptedDifference({
        mismatch: { ...mismatch, reactValue: difference.legacyValue },
        acceptedDifferences: config.acceptedDifferences,
        decisions: config.decisions,
        afterStepId: difference.stepId,
      }),
    ).toBe(false);
  });

  it("replaces final evidence as one directory", async () => {
    const root = await mkdtemp(join(tmpdir(), "migration-final-"));
    const candidateDirectory = join(root, "final.pending");
    const finalDirectory = join(root, "final");
    await mkdir(candidateDirectory);
    await mkdir(finalDirectory);
    await writeFile(join(candidateDirectory, "manifest.json"), "new\n");
    await writeFile(join(finalDirectory, "manifest.json"), "old\n");

    await commitFinalCandidate({ candidateDirectory, finalDirectory });

    expect(await readFile(join(finalDirectory, "manifest.json"), "utf8")).toBe(
      "new\n",
    );
    await expect(access(candidateDirectory)).rejects.toThrow();
    await expect(access(`${finalDirectory}.backup`)).rejects.toThrow();
  });
});
