import {
  access,
  mkdir,
  readFile,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { isDeepStrictEqual } from "node:util";

import pixelmatch from "pixelmatch";
import { PNG } from "pngjs";

import { captureConfigHash, captureSurface } from "./capture.js";
import {
  acceptedDifferenceFingerprint,
  hashProjectFiles,
} from "../core/fingerprint.js";
import { hashJson, readJson, sha256, writeJson } from "../core/json.js";
import {
  ArtifactIdSchema,
  CaptureManifestSchema,
  JsonValueSchema,
  ParityResultSchema,
  type AcceptedDifferences,
  type CaptureChecks,
  type CaptureManifest,
  type ImageComparison,
  type MigrationSpec,
  type Decisions,
  type Fixtures,
  type JsonValue,
  type Observation,
  type ParityResultData,
  type Scenarios,
  type SelectorMap,
} from "../contracts/schemas.js";
import type { ToolContext } from "../core/context.js";

export type ParityMismatch = {
  scenarioId: string;
  assertionId: string;
  reason: string;
  legacyValue: JsonValue;
  reactValue: JsonValue;
};

export type ParityResult = ParityResultData;

type ObservationComparison =
  | {
      kind: "value";
      mismatch: ParityMismatch | null;
    }
  | {
      kind: "image";
      mismatch: ParityMismatch | null;
      imageComparison: ImageComparison;
    };

type CompareCandidateOptions = {
  context: ToolContext;
  config: MigrationSpec;
  scenarios: Scenarios;
  fixtures: Fixtures;
  legacySelectors: SelectorMap;
  reactSelectors: SelectorMap;
  baselineDirectory: string;
  finalDirectory: string;
  reactBaseUrl: string;
  runId: string;
  acceptedDifferences: AcceptedDifferences;
  decisions: Decisions;
  checks: CaptureChecks;
};

export async function compareCandidate(
  options: CompareCandidateOptions,
): Promise<ParityResult> {
  const candidateDirectory = `${options.finalDirectory}.pending-${options.runId}`;
  await rm(candidateDirectory, { recursive: true, force: true });
  try {
    return await compareCandidateInDirectory(options, candidateDirectory);
  } catch (error: unknown) {
    await rm(candidateDirectory, { recursive: true, force: true });
    throw error;
  }
}

async function compareCandidateInDirectory(
  options: CompareCandidateOptions,
  candidateDirectory: string,
): Promise<ParityResult> {
  const baseline = await readJson(
    join(options.baselineDirectory, "manifest.json"),
    CaptureManifestSchema,
  );
  await requireFreshBaseline({
    context: options.context,
    config: options.config,
    baseline,
    scenarios: options.scenarios,
    fixtures: options.fixtures,
    legacySelectors: options.legacySelectors,
    checks: options.checks,
  });

  const candidate = await captureSurface({
    context: options.context,
    config: options.config,
    scenarios: options.scenarios,
    fixtures: options.fixtures,
    selectors: options.reactSelectors,
    baseUrl: options.reactBaseUrl,
    surface: "react",
    outputDirectory: candidateDirectory,
    runId: options.runId,
    viewport: options.config.viewport,
    checks: options.checks,
    enforceExpected: false,
    replaceExisting: false,
  });
  if (candidate.browserVersion !== baseline.browserVersion) {
    throw new Error(
      `Browser mismatch. Baseline used ${baseline.browserVersion}; candidate used ${candidate.browserVersion}.`,
    );
  }
  if (!isDeepStrictEqual(candidate.viewport, baseline.viewport)) {
    throw new Error("Candidate viewport does not match the baseline viewport.");
  }

  const mismatches: ParityMismatch[] = [];
  const imageComparisons: ImageComparison[] = [];
  const acceptedDifferencesUsed = new Set<string>();
  for (const baselineScenario of baseline.results) {
    const candidateScenario = candidate.results.find(
      (result) => result.scenarioId === baselineScenario.scenarioId,
    );
    if (candidateScenario === undefined) {
      mismatches.push({
        scenarioId: baselineScenario.scenarioId,
        assertionId: "$scenario",
        reason: "Candidate did not run this scenario.",
        legacyValue: true,
        reactValue: false,
      });
      continue;
    }
    for (const baselineObservation of baselineScenario.observations) {
      const candidateObservation = candidateScenario.observations.find(
        (item) => item.assertionId === baselineObservation.assertionId,
      );
      if (candidateObservation === undefined) {
        mismatches.push({
          scenarioId: baselineScenario.scenarioId,
          assertionId: baselineObservation.assertionId,
          reason: "Candidate did not produce this observation.",
          legacyValue: baselineObservation.actual,
          reactValue: null,
        });
        continue;
      }
      const comparison = await compareObservation({
        baselineDirectory: options.baselineDirectory,
        candidateDirectory,
        scenarioId: baselineScenario.scenarioId,
        baseline: baselineObservation,
        candidate: candidateObservation,
        scenarios: options.scenarios,
      });
      switch (comparison.kind) {
        case "value": {
          if (comparison.mismatch === null) {
            break;
          }
          const acceptedDifference = acceptedDifferenceId({
            mismatch: comparison.mismatch,
            acceptedDifferences: options.acceptedDifferences,
            decisions: options.decisions,
            afterStepId: baselineObservation.afterStepId,
          });
          if (acceptedDifference === null) {
            mismatches.push(comparison.mismatch);
          } else {
            acceptedDifferencesUsed.add(acceptedDifference);
          }
          break;
        }
        case "image":
          imageComparisons.push(comparison.imageComparison);
          if (comparison.mismatch !== null) {
            mismatches.push(comparison.mismatch);
          }
          break;
        default: {
          const exhaustive: never = comparison;
          throw new Error(`Unsupported comparison: ${String(exhaustive)}`);
        }
      }
    }
  }

  const expectedScenarioIds = new Set(
    options.scenarios.map((scenario) => scenario.id),
  );
  const attested =
    baseline.results.length === expectedScenarioIds.size &&
    candidate.results.length === expectedScenarioIds.size &&
    baseline.results.every((result) => expectedScenarioIds.has(result.scenarioId)) &&
    candidate.results.every((result) =>
      expectedScenarioIds.has(result.scenarioId),
    );
  const result = ParityResultSchema.parse({
    status: mismatches.length === 0 && attested ? "PARITY" : "MISMATCH",
    attested,
    runId: options.runId,
    createdAt: new Date().toISOString(),
    baselineManifestHash: sha256(
      await readFile(join(options.baselineDirectory, "manifest.json")),
    ),
    candidateManifestHash: sha256(
      await readFile(join(candidateDirectory, "manifest.json")),
    ),
    decisionsHash: hashJson(JsonValueSchema.parse(options.decisions)),
    acceptedDifferencesHash: hashJson(
      JsonValueSchema.parse(options.acceptedDifferences),
    ),
    scenariosHash: candidate.scenariosHash,
    mismatches,
    imageComparisons,
    acceptedDifferencesUsed: [...acceptedDifferencesUsed].sort(),
  });
  await writeJson(
    join(candidateDirectory, "parity.json"),
    JsonValueSchema.parse(result),
  );
  await commitCandidateEvidence({
    candidateDirectory,
    finalDirectory: options.finalDirectory,
    passed: result.status === "PARITY" && result.attested,
  });
  return result;
}

async function requireFreshBaseline(options: {
  context: ToolContext;
  config: MigrationSpec;
  baseline: CaptureManifest;
  scenarios: Scenarios;
  fixtures: Fixtures;
  legacySelectors: SelectorMap;
  checks: CaptureChecks;
}): Promise<void> {
  const baselineLegacyTest = options.baseline.checks.componentTests.find(
    (test) => test.surface === "legacy",
  );
  const currentLegacyTest = options.checks.componentTests.find(
    (test) => test.surface === "legacy",
  );
  if (baselineLegacyTest === undefined || currentLegacyTest === undefined) {
    throw new Error("Legacy component test receipt is missing.");
  }
  const checks: { name: string; expected: string; actual: string }[] = [
    {
      name: "capture config",
      expected: options.baseline.captureConfigHash,
      actual: captureConfigHash(options.config, "legacy"),
    },
    {
      name: "scenarios",
      expected: options.baseline.scenariosHash,
      actual: hashJson(JsonValueSchema.parse(options.scenarios)),
    },
    {
      name: "fixtures",
      expected: options.baseline.fixturesHash,
      actual: hashJson(JsonValueSchema.parse(options.fixtures)),
    },
    {
      name: "legacy selectors",
      expected: options.baseline.selectorsHash,
      actual: hashJson(JsonValueSchema.parse(options.legacySelectors)),
    },
    {
      name: "legacy source",
      expected: options.baseline.projectInputHash,
      actual: await hashProjectFiles({
        projectRoot: options.context.projectRoot,
        paths: options.config.legacy.proofFiles,
      }),
    },
    {
      name: "legacy test inputs",
      expected: baselineLegacyTest.inputHash,
      actual: currentLegacyTest.inputHash,
    },
    {
      name: "viewport",
      expected: hashJson(JsonValueSchema.parse(options.baseline.viewport)),
      actual: hashJson(JsonValueSchema.parse(options.config.viewport)),
    },
  ];
  const stale = checks.filter((check) => check.expected !== check.actual);
  if (stale.length > 0) {
    throw new Error(
      `Baseline is stale:\n${stale
        .map((check) => `- ${check.name} hash changed`)
        .join("\n")}`,
    );
  }
}

async function compareObservation(options: {
  baselineDirectory: string;
  candidateDirectory: string;
  scenarioId: string;
  baseline: Observation;
  candidate: Observation;
  scenarios: Scenarios;
}): Promise<ObservationComparison> {
  if (
    options.baseline.kind !== options.candidate.kind ||
    options.baseline.afterStepId !== options.candidate.afterStepId
  ) {
    return {
      kind: "value",
      mismatch: mismatch(
        options,
        "Observation kind or step does not match the baseline.",
        options.baseline.actual,
        options.candidate.actual,
      ),
    };
  }

  if (options.baseline.kind !== "screenshot") {
    return {
      kind: "value",
      mismatch: isDeepStrictEqual(
        options.baseline.actual,
        options.candidate.actual,
      )
        ? null
        : mismatch(
            options,
            "Observed value differs.",
            options.baseline.actual,
            options.candidate.actual,
          ),
    };
  }

  const assertion = findAssertion(
    options.scenarios,
    options.scenarioId,
    options.baseline.assertionId,
  );
  if (assertion.kind !== "screenshot") {
    throw new Error(
      `Observation ${options.baseline.assertionId} changed assertion kind.`,
    );
  }
  if (
    options.baseline.screenshotPath === null ||
    options.candidate.screenshotPath === null ||
    options.baseline.screenshotHash === null ||
    options.candidate.screenshotHash === null
  ) {
    throw new Error(
      `Screenshot evidence is missing for ${options.scenarioId}/${options.baseline.assertionId}.`,
    );
  }

  const imageComparison = await compareScreenshotEvidence({
    baselineDirectory: options.baselineDirectory,
    candidateDirectory: options.candidateDirectory,
    scenarioId: options.scenarioId,
    stepId: options.baseline.afterStepId,
    assertionId: assertion.assertionId,
    baselineScreenshotPath: options.baseline.screenshotPath,
    baselineScreenshotHash: options.baseline.screenshotHash,
    reactScreenshotPath: options.candidate.screenshotPath,
    reactScreenshotHash: options.candidate.screenshotHash,
  });
  const dimensionsMatch =
    imageComparison.baselineScreenshotSize.width ===
      imageComparison.reactScreenshotSize.width &&
    imageComparison.baselineScreenshotSize.height ===
      imageComparison.reactScreenshotSize.height;
  return {
    kind: "image",
    imageComparison,
    mismatch: imageComparison.exact
      ? null
      : mismatch(
          options,
          dimensionsMatch
            ? `${imageComparison.changedPixels} screenshot pixels changed.`
            : "Screenshot dimensions differ.",
          dimensionsMatch
            ? 0
            : `${imageComparison.baselineScreenshotSize.width}x${imageComparison.baselineScreenshotSize.height}`,
          dimensionsMatch
            ? imageComparison.changedPixels
            : `${imageComparison.reactScreenshotSize.width}x${imageComparison.reactScreenshotSize.height}`,
        ),
  };
}

export async function compareScreenshotEvidence(options: {
  baselineDirectory: string;
  candidateDirectory: string;
  scenarioId: string;
  stepId: string;
  assertionId: string;
  baselineScreenshotPath: string;
  baselineScreenshotHash: string;
  reactScreenshotPath: string;
  reactScreenshotHash: string;
}): Promise<ImageComparison> {
  const scenarioId = ArtifactIdSchema.parse(options.scenarioId);
  const assertionId = ArtifactIdSchema.parse(options.assertionId);
  const baselineBytes = await readFile(
    resolve(options.baselineDirectory, options.baselineScreenshotPath),
  );
  const candidateBytes = await readFile(
    resolve(options.candidateDirectory, options.reactScreenshotPath),
  );
  if (
    sha256(baselineBytes) !== options.baselineScreenshotHash ||
    sha256(candidateBytes) !== options.reactScreenshotHash
  ) {
    throw new Error(
      `Screenshot evidence hash failed for ${scenarioId}/${assertionId}.`,
    );
  }
  const baselinePng = PNG.sync.read(baselineBytes);
  const candidatePng = PNG.sync.read(candidateBytes);
  const width = Math.max(baselinePng.width, candidatePng.width);
  const height = Math.max(baselinePng.height, candidatePng.height);
  const diffPng = new PNG({ width, height });
  const changedPixels = pixelmatch(
    rgbaAtSize(baselinePng, width, height),
    rgbaAtSize(candidatePng, width, height),
    diffPng.data,
    width,
    height,
    { threshold: 0, includeAA: true },
  );
  const totalPixels = width * height;
  const diffPath = join(
    "diffs",
    scenarioId,
    `${assertionId}.png`,
  ).split("\\").join("/");
  const diffBytes = PNG.sync.write(diffPng);
  const absoluteDiffPath = resolve(options.candidateDirectory, diffPath);
  await mkdir(dirname(absoluteDiffPath), { recursive: true });
  await writeFile(absoluteDiffPath, diffBytes);
  return {
    scenarioId,
    stepId: options.stepId,
    assertionId,
    baselineScreenshotPath: options.baselineScreenshotPath,
    baselineScreenshotHash: options.baselineScreenshotHash,
    baselineScreenshotSize: {
      width: baselinePng.width,
      height: baselinePng.height,
    },
    reactScreenshotPath: options.reactScreenshotPath,
    reactScreenshotHash: options.reactScreenshotHash,
    reactScreenshotSize: {
      width: candidatePng.width,
      height: candidatePng.height,
    },
    diffPath,
    diffHash: sha256(diffBytes),
    totalPixels,
    changedPixels,
    diffRatio: changedPixels / totalPixels,
    allowedChangedPixels: 0,
    exact:
      baselinePng.width === candidatePng.width &&
      baselinePng.height === candidatePng.height &&
      changedPixels === 0,
  };
}

function rgbaAtSize(image: PNG, width: number, height: number): Buffer {
  if (image.width === width && image.height === height) {
    return image.data;
  }
  const data = Buffer.alloc(width * height * 4);
  for (let row = 0; row < image.height; row += 1) {
    image.data.copy(
      data,
      row * width * 4,
      row * image.width * 4,
      (row + 1) * image.width * 4,
    );
  }
  return data;
}

function findAssertion(
  scenarios: Scenarios,
  scenarioId: string,
  assertionId: string,
) {
  const scenario = scenarios.find((item) => item.id === scenarioId);
  const assertion = scenario?.assertions.find(
    (item) => item.assertionId === assertionId,
  );
  if (assertion === undefined) {
    throw new Error(
      `Scenario assertion does not exist: ${scenarioId}/${assertionId}.`,
    );
  }
  return assertion;
}

function mismatch(
  options: {
    scenarioId: string;
    baseline: Observation;
  },
  reason: string,
  legacyValue: JsonValue,
  reactValue: JsonValue,
): ParityMismatch {
  return {
    scenarioId: options.scenarioId,
    assertionId: options.baseline.assertionId,
    reason,
    legacyValue,
    reactValue,
  };
}

function acceptedDifferenceId(options: {
  mismatch: ParityMismatch;
  acceptedDifferences: AcceptedDifferences;
  decisions: Decisions;
  afterStepId: string;
}): string | null {
  const difference = options.acceptedDifferences.find((candidate) => {
    const calculatedFingerprint = acceptedDifferenceFingerprint({
      id: candidate.id,
      decisionFingerprint: candidate.decisionFingerprint,
      scenarioId: candidate.scenarioId,
      stepId: candidate.stepId,
      assertionId: candidate.assertionId,
      legacyValue: candidate.legacyValue,
      reactValue: candidate.reactValue,
      reason: candidate.reason,
    });
    if (
      candidate.fingerprint !== calculatedFingerprint ||
      candidate.approval.status !== "approved" ||
      candidate.approval.differenceFingerprint !== calculatedFingerprint ||
      candidate.scenarioId !== options.mismatch.scenarioId ||
      candidate.stepId !== options.afterStepId ||
      candidate.assertionId !== options.mismatch.assertionId ||
      !isDeepStrictEqual(
        candidate.legacyValue,
        options.mismatch.legacyValue,
      ) ||
      !isDeepStrictEqual(candidate.reactValue, options.mismatch.reactValue)
    ) {
      return false;
    }
    return options.decisions.some(
      (decision) =>
        decision.findingFingerprint === candidate.decisionFingerprint &&
        decision.approval.status === "approved" &&
        decision.approval.findingFingerprint ===
          candidate.decisionFingerprint,
    );
  });
  return difference?.id ?? null;
}

export function isAcceptedDifference(options: {
  mismatch: ParityMismatch;
  acceptedDifferences: AcceptedDifferences;
  decisions: Decisions;
  afterStepId: string;
}): boolean {
  return acceptedDifferenceId(options) !== null;
}

export async function commitFinalCandidate(options: {
  candidateDirectory: string;
  finalDirectory: string;
}): Promise<void> {
  const backupDirectory = `${options.finalDirectory}.backup`;
  await rm(backupDirectory, { recursive: true, force: true });
  const finalExists = await fileExists(options.finalDirectory);
  if (finalExists) {
    await rename(options.finalDirectory, backupDirectory);
  }
  try {
    await rename(options.candidateDirectory, options.finalDirectory);
    await rm(backupDirectory, { recursive: true, force: true });
  } catch (error: unknown) {
    await rm(options.finalDirectory, { recursive: true, force: true });
    if (finalExists) {
      await rename(backupDirectory, options.finalDirectory);
    }
    throw error;
  }
}

export async function commitCandidateEvidence(options: {
  candidateDirectory: string;
  finalDirectory: string;
  passed: boolean;
}): Promise<string> {
  const failedDirectory = `${options.finalDirectory}.failed`;
  const committedDirectory = options.passed
    ? options.finalDirectory
    : failedDirectory;
  await commitFinalCandidate({
    candidateDirectory: options.candidateDirectory,
    finalDirectory: committedDirectory,
  });
  if (options.passed) {
    await rm(failedDirectory, { recursive: true, force: true });
  }
  return committedDirectory;
}

async function fileExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}
