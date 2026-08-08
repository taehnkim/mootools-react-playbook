#!/usr/bin/env node

import { resolve } from "node:path";

import { Command } from "commander";

import {
  analyzeComponent,
  checkWorksheetFreshness,
  writeWorksheet,
} from "./analyze/index.js";
import {
  checkDecisions,
  loadWorksheet,
  writeDecisionStubsIfEmpty,
} from "./checks/decisions.js";
import { runComponentTest } from "./checks/component-tests.js";
import { checkNoNewUse } from "./checks/no-new-use.js";
import { runProjectChecks } from "./checks/project-checks.js";
import {
  applyAdapterCodemod,
  planAdapterCodemod,
} from "./codemods/adapter.js";
import {
  componentArtifactPath,
  createContext,
  defaultToolsRoot,
  loadMigrationSpec,
  type ToolContext,
} from "./core/context.js";
import {
  JsonValueSchema,
  RunIdSchema,
  type MigrationSpec,
  type Worksheet,
} from "./contracts/schemas.js";
import {
  captureSurface,
  selectorMap,
} from "./parity/capture.js";
import { compareCandidate } from "./parity/compare.js";

type WriteOptions = {
  write: boolean;
};

type BaseUrlOptions = {
  baseUrl: string;
};

const program = new Command();
program
  .name("mootools-migrate")
  .addHelpCommand(false)
  .description("Analyze, adapt, and prove one MooTools component migration.");

program
  .command("analyze")
  .description("Analyze one component and prepare its worksheet.")
  .argument("<component>")
  .action(async (componentId: string) => {
    const context = await getContext();
    const config = await loadMigrationSpec(context, componentId);
    const worksheet = await analyzeComponent({ context, config });
    const worksheetPath = await writeWorksheet({ context, worksheet });
    const decisionStubsCreated = await writeDecisionStubsIfEmpty({
      context,
      config,
      worksheet,
    });
    writeResult({ worksheetPath, decisionStubsCreated });
  });

program
  .command("baseline")
  .description("Run the legacy test and capture browser evidence.")
  .argument("<component>")
  .requiredOption("--base-url <url>", "Running legacy server base URL.")
  .option("--replace", "Replace the current baseline atomically.", false)
  .action(
    async (
      componentId: string,
      options: BaseUrlOptions & { replace: boolean },
    ) => {
      const context = await getContext();
      const config = await loadMigrationSpec(context, componentId);
      await requireReadyWorksheet(context, config);
      const unitTest = await runComponentTest({
        context,
        config,
        surface: "legacy",
      });
      if (!unitTest.passed) {
        writeResult({ ok: false, unitTest });
        process.exitCode = 2;
        return;
      }

      const baselineDirectory = componentArtifactPath(
        context,
        config.id,
        "baseline",
      );
      const manifest = await captureSurface({
        context,
        config,
        scenarios: config.scenarios,
        selectors: selectorMap(config, "legacy"),
        fixtures: config.fixtures,
        baseUrl: options.baseUrl,
        surface: "legacy",
        outputDirectory: baselineDirectory,
        runId: createRunId("legacy"),
        viewport: config.viewport,
        checks: {
          componentTests: [unitTest],
          projectChecks: [],
        },
        enforceExpected: true,
        replaceExisting: options.replace,
      });
      writeResult({
        ok: true,
        unitTest,
        runId: manifest.runId,
        scenarios: manifest.results.length,
        evidencePath: baselineDirectory,
        recordingPaths: manifest.results.map((result) =>
          resolve(baselineDirectory, result.videoPath),
        ),
        screenshotPaths: manifest.results.flatMap((result) =>
          result.observations.flatMap((observation) =>
            observation.kind === "screenshot"
              ? [resolve(baselineDirectory, observation.screenshotPath)]
              : [],
          ),
        ),
      });
    },
  );

program
  .command("adapter")
  .description("Create the legacy adapter with an atomic codemod.")
  .argument("<component>")
  .option("--write", "Apply the planned edits.", false)
  .action(async (componentId: string, options: WriteOptions) => {
    const context = await getContext();
    const config = await loadMigrationSpec(context, componentId);
    const result = await planAdapterCodemod({ context, config });
    if (result.kind === "unsupported") {
      writeResult(result);
      process.exitCode = 2;
      return;
    }
    if (options.write) {
      await applyAdapterCodemod({
        context,
        result,
      });
    }
    writeResult({
      kind: options.write ? "applied" : "dry-run",
      files: result.edits.map((edit) => edit.path),
    });
  });

program
  .command("verify")
  .description("Run all checks and write the passing React proof.")
  .argument("<component>")
  .requiredOption("--base-url <url>", "Running React server base URL.")
  .action(async (componentId: string, options: BaseUrlOptions) => {
    const context = await getContext();
    const config = await loadMigrationSpec(context, componentId);
    const worksheet = await requireReadyWorksheet(context, config);
    const decisionCheck = checkDecisions({
      worksheet,
      decisions: config.decisions,
    });
    const legacyUseCheck = await checkNoNewUse({ context, config });
    const unitTests = [];
    for (const surface of ["legacy", "react"] as const) {
      unitTests.push(
        await runComponentTest({ context, config, surface }),
      );
    }
    const projectChecks = await runProjectChecks(context.projectRoot);
    const checksPass =
      decisionCheck.ok &&
      legacyUseCheck.ok &&
      unitTests.every((test) => test.passed) &&
      projectChecks.every((check) => check.ok);
    if (!checksPass) {
      writeResult({
        ok: false,
        decisionCheck,
        legacyUseCheck,
        unitTests,
        projectChecks,
      });
      process.exitCode = 2;
      return;
    }

    const finalDirectory = componentArtifactPath(
      context,
      config.id,
      "final",
    );
    const baselineDirectory = componentArtifactPath(
      context,
      config.id,
      "baseline",
    );
    const parity = await compareCandidate({
      context,
      config,
      scenarios: config.scenarios,
      fixtures: config.fixtures,
      legacySelectors: selectorMap(config, "legacy"),
      reactSelectors: selectorMap(config, "react"),
      baselineDirectory,
      finalDirectory,
      reactBaseUrl: options.baseUrl,
      runId: createRunId("react"),
      acceptedDifferences: config.acceptedDifferences,
      decisions: config.decisions,
      checks: {
        componentTests: unitTests,
        projectChecks,
      },
    });
    const ok = parity.status === "PARITY" && parity.attested;
    const evidencePath = ok
      ? finalDirectory
      : `${finalDirectory}.failed`;
    writeResult({
      ok,
      decisionCheck,
      legacyUseCheck,
      unitTests,
      projectChecks,
      parity,
      evidencePath,
      baselineRecordingPaths: parity.recordings.map((recording) =>
        resolve(baselineDirectory, recording.baselineVideoPath),
      ),
      reactRecordingPaths: parity.recordings.map((recording) =>
        resolve(evidencePath, recording.reactVideoPath),
      ),
      baselineScreenshotPaths: parity.imageComparisons.map(
        (comparison) =>
          resolve(baselineDirectory, comparison.baselineScreenshotPath),
      ),
      reactScreenshotPaths: parity.imageComparisons.map((comparison) =>
        resolve(evidencePath, comparison.reactScreenshotPath),
      ),
      diffScreenshotPaths: parity.imageComparisons.map((comparison) =>
        resolve(evidencePath, comparison.diffPath),
      ),
    });
    if (!ok) {
      process.exitCode = 2;
    }
  });

program.parseAsync().catch((error: unknown) => {
  writeFailure(error);
  process.exitCode = 1;
});

async function getContext(): Promise<ToolContext> {
  return createContext({
    toolsRoot: defaultToolsRoot(),
    projectRoot: null,
  });
}

async function requireReadyWorksheet(
  context: ToolContext,
  config: MigrationSpec,
): Promise<Worksheet> {
  const worksheet = await loadWorksheet({
    context,
    componentId: config.id,
  });
  const freshness = await checkWorksheetFreshness({
    context,
    config,
    worksheet,
  });
  if (!freshness.ok) {
    throw new Error(
      `Worksheet is stale for ${config.id}. Run analyze ${config.id}.`,
    );
  }
  return worksheet;
}

function createRunId(surface: "legacy" | "react"): string {
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  return RunIdSchema.parse(`${surface}-${timestamp}`);
}

function writeResult(value: unknown): void {
  const json = JsonValueSchema.parse(value);
  process.stdout.write(`${JSON.stringify(json, null, 2)}\n`);
}

function writeFailure(error: unknown): void {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`${message}\n`);
}
