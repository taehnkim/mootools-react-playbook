import { access, readFile, readdir } from "node:fs/promises";
import { resolve } from "node:path";

import { componentArtifactPath, type ToolContext } from "./context.js";
import { checkWorksheetFreshness } from "./analyze.js";
import { checkComponentTest } from "./component-tests.js";
import { checkDecisions, loadDecisions, loadWorksheet } from "./decisions.js";
import { hashProjectFiles } from "./fingerprint.js";
import { hashJson, readJson, sha256 } from "./json.js";
import {
  AcceptedDifferencesFileSchema,
  CaptureManifestSchema,
  DecisionsFileSchema,
  JsonValueSchema,
  ParityResultSchema,
  type CaptureManifest,
  type ComponentConfig,
  type ParityResultData,
} from "./schemas.js";

export type MigrationPhase =
  | "analyze"
  | "legacy-test"
  | "baseline"
  | "decisions"
  | "implement"
  | "react-test"
  | "compare"
  | "done";

export type MigrationStatus = {
  componentId: string;
  phase: MigrationPhase;
  nextAction: string;
  blockers: string[];
};

export async function getMigrationStatus(options: {
  context: ToolContext;
  config: ComponentConfig;
}): Promise<MigrationStatus> {
  const componentId = options.config.id;
  const worksheetExists =
    (await fileExists(
      componentArtifactPath(
        options.context,
        componentId,
        "worksheet.generated.json",
      ),
    )) ||
    (await fileExists(
      componentArtifactPath(options.context, componentId, "worksheet.json"),
    ));
  if (!worksheetExists) {
    return status(
      componentId,
      "analyze",
      `npm run migrate -- analyze ${componentId} --write`,
    );
  }
  const worksheet = await loadWorksheet({
    context: options.context,
    componentId,
  });
  const freshness = await checkWorksheetFreshness({
    context: options.context,
    config: options.config,
    worksheet,
  });
  if (!freshness.ok) {
    return status(
      componentId,
      "analyze",
      `npm run migrate -- analyze ${componentId} --write`,
      ["The stored worksheet input hash is stale."],
    );
  }
  const legacyTest = await checkComponentTest({
    context: options.context,
    config: options.config,
    surface: "legacy",
  });
  if (!legacyTest.ok) {
    return status(
      componentId,
      "legacy-test",
      `Create ${options.config.tests.legacyFile}, then run npm run migrate -- test legacy ${componentId}`,
      legacyTest.issues,
    );
  }

  const baselinePath = componentArtifactPath(
    options.context,
    componentId,
    "baseline",
    "manifest.json",
  );
  if (!(await fileExists(baselinePath))) {
    return status(
      componentId,
      "baseline",
      `npm run migrate -- capture ${componentId} --surface legacy --base-url <url>`,
    );
  }
  await readJson(baselinePath, CaptureManifestSchema);

  const decisionsPath = componentArtifactPath(
    options.context,
    componentId,
    "decisions.json",
  );
  if (!(await fileExists(decisionsPath))) {
    return status(
      componentId,
      "decisions",
      `npm run migrate -- decisions init ${componentId} --write`,
      ["Decision file does not exist."],
    );
  }
  const decisionCheck = checkDecisions({
    worksheet,
    decisions: await loadDecisions({
      context: options.context,
      componentId,
    }),
  });
  if (!decisionCheck.ok) {
    return status(
      componentId,
      "decisions",
      `Review tools/mootools-migrate/components/${componentId}/decisions.json`,
      decisionCheck.issues,
    );
  }

  if (
    !(await fileExists(
      resolve(options.context.projectRoot, options.config.react.componentPath),
    ))
  ) {
    return status(
      componentId,
      "implement",
      `Implement ${options.config.react.componentPath} with the approved decisions.`,
    );
  }
  const reactTest = await checkComponentTest({
    context: options.context,
    config: options.config,
    surface: "react",
  });
  if (!reactTest.ok) {
    return status(
      componentId,
      "react-test",
      `Create ${options.config.tests.reactFile}, then run npm run migrate -- test react ${componentId}`,
      reactTest.issues,
    );
  }

  const parity = await latestParity(
    options.context,
    componentId,
    options.config,
  );
  if (parity === null || parity.status !== "PARITY" || !parity.attested) {
    return status(
      componentId,
      "compare",
      `npm run migrate -- compare ${componentId} --base-url <url>`,
      parity?.mismatches.map(
        (mismatch) =>
          `${mismatch.scenarioId}/${mismatch.assertionId}: ${mismatch.reason}`,
      ) ?? [],
    );
  }

  return status(
    componentId,
    "done",
    "Run project checks and record pilot-proven status.",
  );
}

function status(
  componentId: string,
  phase: MigrationPhase,
  nextAction: string,
  blockers: string[] = [],
): MigrationStatus {
  return { componentId, phase, nextAction, blockers };
}

async function latestParity(
  context: ToolContext,
  componentId: string,
  config: ComponentConfig,
): Promise<ParityResultData | null> {
  const candidateRoot = componentArtifactPath(
    context,
    componentId,
    "candidate",
  );
  if (!(await fileExists(candidateRoot))) {
    return null;
  }
  const entries = await readdir(candidateRoot, { withFileTypes: true });
  const directories = entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name);
  const current: ParityResultData[] = [];
  for (const directory of directories) {
    const path = resolve(candidateRoot, directory, "parity.json");
    if (await fileExists(path)) {
      const parity = await readJson(path, ParityResultSchema);
      if (
        await parityIsFresh({
          context,
          componentId,
          config,
          candidateDirectory: resolve(candidateRoot, directory),
          parity,
        })
      ) {
        current.push(parity);
      }
    }
  }
  current.sort(
    (left, right) =>
      Date.parse(right.createdAt) - Date.parse(left.createdAt),
  );
  return current[0] ?? null;
}

async function parityIsFresh(options: {
  context: ToolContext;
  componentId: string;
  config: ComponentConfig;
  candidateDirectory: string;
  parity: ParityResultData;
}): Promise<boolean> {
  const componentRoot = componentArtifactPath(
    options.context,
    options.componentId,
  );
  const requiredPaths = [
    resolve(componentRoot, "baseline", "manifest.json"),
    resolve(options.candidateDirectory, "manifest.json"),
    resolve(componentRoot, "decisions.json"),
    resolve(componentRoot, "accepted-differences.json"),
    resolve(componentRoot, "scenarios.json"),
    resolve(componentRoot, "fixtures.json"),
    resolve(componentRoot, "selectors.legacy.json"),
    resolve(componentRoot, "selectors.react.json"),
  ];
  if (!(await allFilesExist(requiredPaths))) {
    return false;
  }
  const decisions = await readJson(
    resolve(componentRoot, "decisions.json"),
    DecisionsFileSchema,
  );
  const acceptedDifferences = await readJson(
    resolve(componentRoot, "accepted-differences.json"),
    AcceptedDifferencesFileSchema,
  );
  const baselineManifest = await readJson(
    resolve(componentRoot, "baseline", "manifest.json"),
    CaptureManifestSchema,
  );
  const candidateManifest = await readJson(
    resolve(options.candidateDirectory, "manifest.json"),
    CaptureManifestSchema,
  );
  const fixturesPath = resolve(componentRoot, "fixtures.json");
  const scenariosPath = resolve(componentRoot, "scenarios.json");
  const legacySelectorsPath = resolve(
    componentRoot,
    "selectors.legacy.json",
  );
  const reactSelectorsPath = resolve(componentRoot, "selectors.react.json");
  const componentConfigHash = hashJson(
    JsonValueSchema.parse(options.config),
  );
  const fixturesHash = sha256(await readFile(fixturesPath));
  const scenariosHash = sha256(await readFile(scenariosPath));
  const baselineInputsAreCurrent =
    baselineManifest.componentConfigHash === componentConfigHash &&
    baselineManifest.fixturesHash === fixturesHash &&
    baselineManifest.scenariosHash === scenariosHash &&
    baselineManifest.selectorsHash ===
      sha256(await readFile(legacySelectorsPath)) &&
    baselineManifest.projectInputHash ===
      (await hashProjectFiles({
        projectRoot: options.context.projectRoot,
        paths: [
          ...options.config.sourceFiles,
          ...options.config.cssFiles,
        ],
      })) &&
    (await manifestScreenshotsAreCurrent(
      baselineManifest,
      resolve(componentRoot, "baseline"),
    ));
  const candidateInputsAreCurrent =
    candidateManifest.componentConfigHash === componentConfigHash &&
    candidateManifest.fixturesHash === fixturesHash &&
    candidateManifest.scenariosHash === scenariosHash &&
    candidateManifest.selectorsHash ===
      sha256(await readFile(reactSelectorsPath)) &&
    candidateManifest.projectInputHash ===
      (await hashProjectFiles({
        projectRoot: options.context.projectRoot,
        paths: [options.config.react.componentPath],
      })) &&
    (await manifestScreenshotsAreCurrent(
      candidateManifest,
      options.candidateDirectory,
    ));
  return (
    baselineInputsAreCurrent &&
    candidateInputsAreCurrent &&
    options.parity.baselineManifestHash ===
      sha256(
        await readFile(resolve(componentRoot, "baseline", "manifest.json")),
      ) &&
    options.parity.candidateManifestHash ===
      sha256(
        await readFile(resolve(options.candidateDirectory, "manifest.json")),
      ) &&
    options.parity.decisionsHash ===
      hashJson(JsonValueSchema.parse(decisions)) &&
    options.parity.acceptedDifferencesHash ===
      hashJson(JsonValueSchema.parse(acceptedDifferences)) &&
    options.parity.scenariosHash ===
      scenariosHash
  );
}

async function manifestScreenshotsAreCurrent(
  manifest: CaptureManifest,
  directory: string,
): Promise<boolean> {
  for (const result of manifest.results) {
    for (const observation of result.observations) {
      if (observation.screenshotPath === null) {
        if (observation.screenshotHash !== null) {
          return false;
        }
        continue;
      }
      if (observation.screenshotHash === null) {
        return false;
      }
      const path = resolve(directory, observation.screenshotPath);
      if (!(await fileExists(path))) {
        return false;
      }
      if (sha256(await readFile(path)) !== observation.screenshotHash) {
        return false;
      }
    }
  }
  return true;
}

async function allFilesExist(paths: string[]): Promise<boolean> {
  const results = await Promise.all(paths.map(fileExists));
  return results.every(Boolean);
}

async function fileExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}
