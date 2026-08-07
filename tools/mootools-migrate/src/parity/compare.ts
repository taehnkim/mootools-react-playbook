import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { isDeepStrictEqual } from "node:util";

import pixelmatch from "pixelmatch";
import { PNG } from "pngjs";

import { captureSurface } from "./capture.js";
import {
  acceptedDifferenceFingerprint,
  hashProjectFiles,
} from "../core/fingerprint.js";
import { hashJson, readJson, sha256, writeJson } from "../core/json.js";
import {
  AcceptedDifferencesFileSchema,
  CaptureManifestSchema,
  DecisionsFileSchema,
  JsonValueSchema,
  ParityResultSchema,
  type AcceptedDifferencesFile,
  type CaptureManifest,
  type ComponentConfig,
  type DecisionsFile,
  type JsonValue,
  type Observation,
  type ParityResultData,
  type ScenariosFile,
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

export async function compareCandidate(options: {
  context: ToolContext;
  config: ComponentConfig;
  scenarios: ScenariosFile;
  legacySelectors: SelectorMap;
  reactSelectors: SelectorMap;
  fixturesPath: string;
  scenariosPath: string;
  legacySelectorsPath: string;
  reactSelectorsPath: string;
  baselineDirectory: string;
  candidateDirectory: string;
  reactBaseUrl: string;
  runId: string;
  viewport: { width: number; height: number };
  acceptedDifferences: AcceptedDifferencesFile;
  decisions: DecisionsFile;
}): Promise<ParityResult> {
  const baseline = await readJson(
    join(options.baselineDirectory, "manifest.json"),
    CaptureManifestSchema,
  );
  await requireFreshBaseline({
    context: options.context,
    config: options.config,
    baseline,
    scenariosPath: options.scenariosPath,
    fixturesPath: options.fixturesPath,
    legacySelectorsPath: options.legacySelectorsPath,
  });

  const candidate = await captureSurface({
    context: options.context,
    config: options.config,
    scenarios: options.scenarios,
    selectors: options.reactSelectors,
    fixturesPath: options.fixturesPath,
    scenariosPath: options.scenariosPath,
    selectorsPath: options.reactSelectorsPath,
    baseUrl: options.reactBaseUrl,
    surface: "react",
    outputDirectory: options.candidateDirectory,
    runId: options.runId,
    viewport: options.viewport,
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
      const mismatch = await compareObservation({
        baselineDirectory: options.baselineDirectory,
        candidateDirectory: options.candidateDirectory,
        scenarioId: baselineScenario.scenarioId,
        baseline: baselineObservation,
        candidate: candidateObservation,
        scenarios: options.scenarios,
      });
      if (
        mismatch !== null &&
        !isAccepted({
          mismatch,
          acceptedDifferences: options.acceptedDifferences,
          decisions: options.decisions,
          afterStepId: baselineObservation.afterStepId,
        })
      ) {
        mismatches.push(mismatch);
      }
    }
  }

  const expectedScenarioIds = new Set(
    options.scenarios.scenarios.map((scenario) => scenario.id),
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
      await readFile(join(options.candidateDirectory, "manifest.json")),
    ),
    decisionsHash: hashJson(JsonValueSchema.parse(options.decisions)),
    acceptedDifferencesHash: hashJson(
      JsonValueSchema.parse(options.acceptedDifferences),
    ),
    scenariosHash: candidate.scenariosHash,
    mismatches,
  });
  await writeJson(
    join(options.candidateDirectory, "parity.json"),
    JsonValueSchema.parse(result),
  );
  return result;
}

export async function loadAcceptedDifferences(
  path: string,
): Promise<AcceptedDifferencesFile> {
  return readJson(path, AcceptedDifferencesFileSchema);
}

export async function loadDecisionFile(path: string): Promise<DecisionsFile> {
  return readJson(path, DecisionsFileSchema);
}

async function requireFreshBaseline(options: {
  context: ToolContext;
  config: ComponentConfig;
  baseline: CaptureManifest;
  scenariosPath: string;
  fixturesPath: string;
  legacySelectorsPath: string;
}): Promise<void> {
  const checks: { name: string; expected: string; actual: string }[] = [
    {
      name: "component config",
      expected: options.baseline.componentConfigHash,
      actual: hashJson(JsonValueSchema.parse(options.config)),
    },
    {
      name: "scenarios",
      expected: options.baseline.scenariosHash,
      actual: sha256(await readFile(options.scenariosPath)),
    },
    {
      name: "fixtures",
      expected: options.baseline.fixturesHash,
      actual: sha256(await readFile(options.fixturesPath)),
    },
    {
      name: "legacy selectors",
      expected: options.baseline.selectorsHash,
      actual: sha256(await readFile(options.legacySelectorsPath)),
    },
    {
      name: "legacy source",
      expected: options.baseline.projectInputHash,
      actual: await hashProjectFiles({
        projectRoot: options.context.projectRoot,
        paths: [
          ...options.config.sourceFiles,
          ...options.config.cssFiles,
        ],
      }),
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
  scenarios: ScenariosFile;
}): Promise<ParityMismatch | null> {
  if (
    options.baseline.kind !== options.candidate.kind ||
    options.baseline.afterStepId !== options.candidate.afterStepId
  ) {
    return mismatch(
      options,
      "Observation kind or step does not match the baseline.",
      options.baseline.actual,
      options.candidate.actual,
    );
  }

  if (options.baseline.kind !== "screenshot") {
    return isDeepStrictEqual(options.baseline.actual, options.candidate.actual)
      ? null
      : mismatch(
          options,
          "Observed value differs.",
          options.baseline.actual,
          options.candidate.actual,
        );
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
    return mismatch(
      options,
      "Screenshot path or content hash is missing.",
      null,
      null,
    );
  }

  const baselineBytes = await readFile(
    resolve(options.baselineDirectory, options.baseline.screenshotPath),
  );
  const candidateBytes = await readFile(
    resolve(options.candidateDirectory, options.candidate.screenshotPath),
  );
  if (
    sha256(baselineBytes) !== options.baseline.screenshotHash ||
    sha256(candidateBytes) !== options.candidate.screenshotHash
  ) {
    throw new Error(
      `Screenshot evidence hash failed for ${options.scenarioId}/${options.baseline.assertionId}.`,
    );
  }
  const baselinePng = PNG.sync.read(baselineBytes);
  const candidatePng = PNG.sync.read(candidateBytes);
  if (
    baselinePng.width !== candidatePng.width ||
    baselinePng.height !== candidatePng.height
  ) {
    return mismatch(
      options,
      "Screenshot dimensions differ.",
      `${baselinePng.width}x${baselinePng.height}`,
      `${candidatePng.width}x${candidatePng.height}`,
    );
  }
  const changedPixels = pixelmatch(
    baselinePng.data,
    candidatePng.data,
    undefined,
    baselinePng.width,
    baselinePng.height,
    { threshold: 0.1 },
  );
  const diffRatio =
    changedPixels / (baselinePng.width * baselinePng.height);
  return diffRatio <= assertion.maxDiffRatio
    ? null
    : mismatch(
        options,
        `Screenshot diff ratio ${diffRatio} exceeds ${assertion.maxDiffRatio}.`,
        0,
        diffRatio,
      );
}

function findAssertion(
  scenarios: ScenariosFile,
  scenarioId: string,
  assertionId: string,
) {
  const scenario = scenarios.scenarios.find((item) => item.id === scenarioId);
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

function isAccepted(options: {
  mismatch: ParityMismatch;
  acceptedDifferences: AcceptedDifferencesFile;
  decisions: DecisionsFile;
  afterStepId: string;
}): boolean {
  return options.acceptedDifferences.differences.some((difference) => {
    const calculatedFingerprint = acceptedDifferenceFingerprint({
      id: difference.id,
      decisionFingerprint: difference.decisionFingerprint,
      scenarioId: difference.scenarioId,
      stepId: difference.stepId,
      assertionId: difference.assertionId,
      legacyValue: difference.legacyValue,
      reactValue: difference.reactValue,
      reason: difference.reason,
    });
    if (
      difference.fingerprint !== calculatedFingerprint ||
      difference.approval.status !== "approved" ||
      difference.approval.differenceFingerprint !== calculatedFingerprint ||
      difference.scenarioId !== options.mismatch.scenarioId ||
      difference.stepId !== options.afterStepId ||
      difference.assertionId !== options.mismatch.assertionId ||
      !isDeepStrictEqual(
        difference.legacyValue,
        options.mismatch.legacyValue,
      ) ||
      !isDeepStrictEqual(difference.reactValue, options.mismatch.reactValue)
    ) {
      return false;
    }
    return options.decisions.decisions.some(
      (decision) =>
        decision.findingFingerprint === difference.decisionFingerprint &&
        decision.approval.status === "approved" &&
        decision.approval.findingFingerprint ===
          difference.decisionFingerprint,
    );
  });
}
