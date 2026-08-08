import {
  access,
  mkdir,
  mkdtemp,
  readFile,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { PNG } from "pngjs";
import { describe, expect, it } from "vitest";

import { createContext, loadMigrationSpec } from "../src/core/context.js";
import { sha256 } from "../src/core/json.js";
import {
  CaptureManifestSchema,
  ScenariosSchema,
} from "../src/contracts/schemas.js";
import {
  commitCandidateEvidence,
  compareScreenshotEvidence,
  isAcceptedDifference,
  validateCaptureCoverage,
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

  it("writes a zero-change diff and exact metrics", async () => {
    const root = await mkdtemp(join(tmpdir(), "migration-images-"));
    const baselineDirectory = join(root, "baseline");
    const candidateDirectory = join(root, "candidate");
    const screenshotPath = "initial/component.png";
    const bytes = imageBytes(3, 2);
    await mkdir(join(baselineDirectory, "initial"), { recursive: true });
    await mkdir(join(candidateDirectory, "initial"), { recursive: true });
    await writeFile(join(baselineDirectory, screenshotPath), bytes);
    await writeFile(join(candidateDirectory, screenshotPath), bytes);

    const comparison = await compareScreenshotEvidence({
      baselineDirectory,
      candidateDirectory,
      scenarioId: "initial",
      stepId: "observe",
      assertionId: "component-image",
      baselineScreenshotPath: screenshotPath,
      baselineScreenshotHash: sha256(bytes),
      reactScreenshotPath: screenshotPath,
      reactScreenshotHash: sha256(bytes),
    });
    const diffBytes = await readFile(
      join(candidateDirectory, comparison.diffPath),
    );
    const diff = PNG.sync.read(diffBytes);

    expect(comparison).toMatchObject({
      baselineScreenshotSize: { width: 3, height: 2 },
      reactScreenshotSize: { width: 3, height: 2 },
      diffPath: "diffs/initial/component-image.png",
      diffHash: sha256(diffBytes),
      totalPixels: 6,
      changedPixels: 0,
      diffRatio: 0,
      allowedChangedPixels: 0,
      exact: true,
    });
    expect({ width: diff.width, height: diff.height }).toEqual({
      width: 3,
      height: 2,
    });
  });

  it("records changed pixels as a failed exact comparison", async () => {
    const root = await mkdtemp(join(tmpdir(), "migration-image-change-"));
    const baselineDirectory = join(root, "baseline");
    const candidateDirectory = join(root, "candidate");
    const screenshotPath = "changed/component.png";
    const baselineBytes = imageBytes(1, 1, [15, 30, 45]);
    const reactBytes = imageBytes(1, 1, [240, 225, 210]);
    await mkdir(join(baselineDirectory, "changed"), { recursive: true });
    await mkdir(join(candidateDirectory, "changed"), { recursive: true });
    await writeFile(
      join(baselineDirectory, screenshotPath),
      baselineBytes,
    );
    await writeFile(join(candidateDirectory, screenshotPath), reactBytes);

    const comparison = await compareScreenshotEvidence({
      baselineDirectory,
      candidateDirectory,
      scenarioId: "changed",
      stepId: "observe",
      assertionId: "component-image",
      baselineScreenshotPath: screenshotPath,
      baselineScreenshotHash: sha256(baselineBytes),
      reactScreenshotPath: screenshotPath,
      reactScreenshotHash: sha256(reactBytes),
    });

    expect(comparison).toMatchObject({
      totalPixels: 1,
      changedPixels: 1,
      diffRatio: 1,
      allowedChangedPixels: 0,
      exact: false,
    });
  });

  it("retains failed evidence without replacing the last pass", async () => {
    const root = await mkdtemp(join(tmpdir(), "migration-final-"));
    const candidateDirectory = join(root, "final.pending-failed");
    const finalDirectory = join(root, "final");
    const failedDirectory = `${finalDirectory}.failed`;
    await mkdir(join(candidateDirectory, "state"), { recursive: true });
    await mkdir(join(candidateDirectory, "diffs/state"), { recursive: true });
    await mkdir(finalDirectory);
    await mkdir(failedDirectory);
    await writeFile(join(candidateDirectory, "manifest.json"), "failed-new\n");
    await writeFile(join(candidateDirectory, "state/component.png"), "react\n");
    await writeFile(
      join(candidateDirectory, "diffs/state/component-image.png"),
      "diff\n",
    );
    await writeFile(join(finalDirectory, "manifest.json"), "passing-old\n");
    await writeFile(join(failedDirectory, "manifest.json"), "failed-old\n");

    const committed = await commitCandidateEvidence({
      candidateDirectory,
      finalDirectory,
      passed: false,
    });

    expect(await readFile(join(finalDirectory, "manifest.json"), "utf8")).toBe(
      "passing-old\n",
    );
    expect(await readFile(join(failedDirectory, "manifest.json"), "utf8")).toBe(
      "failed-new\n",
    );
    expect(
      await readFile(join(failedDirectory, "state/component.png"), "utf8"),
    ).toBe("react\n");
    expect(
      await readFile(
        join(failedDirectory, "diffs/state/component-image.png"),
        "utf8",
      ),
    ).toBe("diff\n");
    expect(committed).toBe(failedDirectory);
    await expect(access(candidateDirectory)).rejects.toThrow();
    await expect(access(`${failedDirectory}.backup`)).rejects.toThrow();

    const passingCandidate = join(root, "final.pending-passing");
    await mkdir(passingCandidate);
    await writeFile(join(passingCandidate, "manifest.json"), "passing-new\n");
    await commitCandidateEvidence({
      candidateDirectory: passingCandidate,
      finalDirectory,
      passed: true,
    });

    expect(await readFile(join(finalDirectory, "manifest.json"), "utf8")).toBe(
      "passing-new\n",
    );
    await expect(access(failedDirectory)).rejects.toThrow();
  });

  it("rejects missing or duplicate manifest coverage", () => {
    const scenarios = ScenariosSchema.parse([
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
    ]);
    const hash = `sha256:${"0".repeat(64)}`;
    const manifest = CaptureManifestSchema.parse({
      schemaVersion: 1,
      runId: "legacy-coverage",
      componentId: "widget",
      surface: "legacy",
      createdAt: "2026-08-08T00:00:00.000Z",
      baseUrl: "http://127.0.0.1:5173",
      projectInputHash: hash,
      captureConfigHash: hash,
      scenariosHash: hash,
      fixturesHash: hash,
      selectorsHash: hash,
      browserVersion: "1",
      viewport: { width: 1280, height: 900 },
      checks: {
        componentTests: [
          {
            surface: "legacy",
            command: "npm run test -- widget.test.ts",
            passed: true,
            output: "passed",
            inputHash: hash,
          },
        ],
        projectChecks: [],
      },
      results: [
        {
          scenarioId: "observe",
          observations: [
            {
              assertionId: "component-count",
              afterStepId: "observe",
              kind: "count",
              actual: 1,
              screenshotPath: null,
              screenshotHash: null,
            },
          ],
        },
      ],
    });

    expect(() =>
      validateCaptureCoverage({
        label: "Baseline",
        manifest,
        scenarios,
      }),
    ).not.toThrow();
    expect(() =>
      validateCaptureCoverage({
        label: "Baseline",
        manifest: { ...manifest, results: [] },
        scenarios,
      }),
    ).toThrow("Baseline scenario coverage is incomplete.");
    expect(() =>
      validateCaptureCoverage({
        label: "Baseline",
        manifest: {
          ...manifest,
          results: [...manifest.results, ...manifest.results],
        },
        scenarios,
      }),
    ).toThrow("Baseline scenario coverage is incomplete.");
    expect(() =>
      validateCaptureCoverage({
        label: "Baseline",
        manifest: {
          ...manifest,
          results: [
            {
              scenarioId: "observe",
              observations: [],
            },
          ],
        },
        scenarios,
      }),
    ).toThrow(
      "Baseline observation coverage is incomplete for observe.",
    );
  });
});

function imageBytes(
  width: number,
  height: number,
  color: readonly [number, number, number] = [15, 30, 45],
): Buffer {
  const image = new PNG({ width, height });
  for (let offset = 0; offset < image.data.length; offset += 4) {
    image.data[offset] = color[0];
    image.data[offset + 1] = color[1];
    image.data[offset + 2] = color[2];
    image.data[offset + 3] = 255;
  }
  return PNG.sync.write(image);
}
