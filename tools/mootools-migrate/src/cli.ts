#!/usr/bin/env node

import { access } from "node:fs/promises";
import { resolve } from "node:path";

import { Command } from "commander";

import {
  applyAdapterCodemod,
  planAdapterCodemod,
} from "./adapter-codemod.js";
import {
  analyzeComponent,
  checkWorksheetFreshness,
  writeWorksheet,
} from "./analyze.js";
import { captureSurface, type CaptureSurface } from "./capture.js";
import { compareCandidate } from "./compare.js";
import {
  checkComponentTest,
  runComponentTest,
  type ComponentTestSurface,
} from "./component-tests.js";
import {
  createContext,
  defaultToolsRoot,
  loadComponentConfig,
  type ToolContext,
} from "./context.js";
import {
  checkDecisions,
  createDecisionDraft,
  loadDecisions,
  loadWorksheet,
  writeDecisionDraft,
} from "./decisions.js";
import { buildInventory, writeInventory } from "./inventory.js";
import { checkNoNewUse, loadLegacyUseAllowlist } from "./no-new-use.js";
import {
  loadPilotData,
  loadPilotDecisions,
  pilotPaths,
} from "./pilot-data.js";
import { runProjectChecks } from "./project-checks.js";
import { detectRebasePorts } from "./rebase.js";
import { writeFailure, writeMessage, writeResult } from "./report.js";
import {
  RunIdSchema,
  type ComponentConfig,
  type Worksheet,
} from "./schemas.js";
import { getMigrationStatus } from "./status.js";

type GlobalOptions = {
  toolsRoot: string;
  projectRoot: string | undefined;
};

type WriteOptions = {
  write: boolean;
};

type ComponentWriteOptions = WriteOptions & {
  force: boolean;
};

type CaptureOptions = {
  baseUrl: string;
  surface: string;
  runId: string | undefined;
  width: number;
  height: number;
  replace: boolean;
};

const program = new Command();
program
  .name("mootools-migrate")
  .description("Analyze, transform, and prove MooTools component migrations.")
  .option("--tools-root <path>", "Migration tools directory.", defaultToolsRoot())
  .option("--project-root <path>", "Project directory. Defaults to tools parent.");

program
  .command("inventory")
  .description("Scan registered components and direct legacy uses.")
  .option("--write", "Write generated/inventory.json.", false)
  .action(async (commandOptions: WriteOptions) => {
    const context = await getContext();
    const inventory = await buildInventory(context);
    if (commandOptions.write) {
      writeMessage(await writeInventory(context, inventory));
    } else {
      writeResult(inventory);
    }
  });

program
  .command("analyze")
  .description("Create a static worksheet for one component.")
  .argument("<component>")
  .option("--write", "Write worksheet.generated.json.", false)
  .action(async (componentId: string, commandOptions: WriteOptions) => {
    const context = await getContext();
    const config = await loadComponentConfig(context, componentId);
    const worksheet = await analyzeComponent({ context, config });
    if (commandOptions.write) {
      writeMessage(await writeWorksheet({ context, worksheet }));
    } else {
      writeResult(worksheet);
    }
  });

const decisions = program
  .command("decisions")
  .description("Initialize or validate migration decisions.");

decisions
  .command("init")
  .argument("<component>")
  .option("--write", "Write decisions.json.", false)
  .option("--force", "Replace an existing decision file.", false)
  .action(
    async (componentId: string, commandOptions: ComponentWriteOptions) => {
      const context = await getContext();
      const config = await loadComponentConfig(context, componentId);
      const draft = createDecisionDraft(
        await requireFreshWorksheet(context, config),
      );
      if (commandOptions.write) {
        writeMessage(
          await writeDecisionDraft({
            context,
            decisions: draft,
            force: commandOptions.force,
          }),
        );
      } else {
        writeResult(draft);
      }
    },
  );

decisions
  .command("check")
  .argument("<component>")
  .action(async (componentId: string) => {
    const context = await getContext();
    const config = await loadComponentConfig(context, componentId);
    const check = checkDecisions({
      worksheet: await requireFreshWorksheet(context, config),
      decisions: await loadDecisions({ context, componentId }),
    });
    writeResult(check);
    if (!check.ok) {
      process.exitCode = 2;
    }
  });

program
  .command("adapter")
  .description("Create a shared legacy adapter with an atomic codemod.")
  .argument("<component>")
  .option("--write", "Apply the planned edits.", false)
  .option(
    "--allow-unsafe-write",
    "Permit writes without clean git paths. Use only in a disposable sandbox.",
    false,
  )
  .action(
    async (
      componentId: string,
      commandOptions: WriteOptions & { allowUnsafeWrite: boolean },
    ) => {
      const context = await getContext();
      const config = await loadComponentConfig(context, componentId);
      const result = await planAdapterCodemod({ context, config });
      if (result.kind === "unsupported") {
        writeResult(result);
        process.exitCode = 2;
        return;
      }
      if (commandOptions.write) {
        await applyAdapterCodemod({
          context,
          result,
          allowUnsafeWrite: commandOptions.allowUnsafeWrite,
        });
      }
      writeResult({
        kind: commandOptions.write ? "applied" : "dry-run",
        files: result.edits.map((edit) => edit.path),
      });
    },
  );

program
  .command("no-new-use")
  .description("Fail when a new direct legacy use appears.")
  .argument("<component>")
  .action(async (componentId: string) => {
    const context = await getContext();
    const config = await loadComponentConfig(context, componentId);
    const check = await checkNoNewUse({
      context,
      config,
      allowlist: await loadLegacyUseAllowlist({ context, componentId }),
    });
    writeResult(check);
    if (!check.ok) {
      process.exitCode = 2;
    }
  });

program
  .command("test")
  .description("Run and record one component unit-test surface.")
  .argument("<surface>", "legacy or react")
  .argument("<component>")
  .action(async (surfaceValue: string, componentId: string) => {
    const surface = parseTestSurface(surfaceValue);
    const context = await getContext();
    const config = await loadComponentConfig(context, componentId);
    const result = await runComponentTest({ context, config, surface });
    writeResult(result);
    if (!result.passed) {
      process.exitCode = 2;
    }
  });

program
  .command("capture")
  .description("Capture one legacy or React surface in a real browser.")
  .argument("<component>")
  .requiredOption("--base-url <url>", "Running Vite server base URL.")
  .requiredOption("--surface <surface>", "legacy or react")
  .option("--run-id <id>", "Stable run ID.")
  .option("--width <pixels>", "Viewport width.", parsePositiveInteger, 1280)
  .option("--height <pixels>", "Viewport height.", parsePositiveInteger, 900)
  .option("--replace", "Atomically replace existing capture evidence.", false)
  .action(async (componentId: string, commandOptions: CaptureOptions) => {
    const context = await getContext();
    const config = await loadComponentConfig(context, componentId);
    await requireFreshWorksheet(context, config);
    const surface = parseSurface(commandOptions.surface);
    await requireFreshComponentTest(context, config, surface);
    const data = await loadPilotData(context, componentId);
    const runId = RunIdSchema.parse(
      commandOptions.runId ?? createRunId(surface),
    );
    const outputDirectory =
      surface === "legacy"
        ? data.paths.baseline
        : data.paths.candidate(runId);
    const selectors =
      surface === "legacy" ? data.legacySelectors : data.reactSelectors;
    const selectorsPath =
      surface === "legacy"
        ? data.paths.legacySelectors
        : data.paths.reactSelectors;
    const manifest = await captureSurface({
      context,
      config,
      scenarios: data.scenarios,
      selectors,
      fixturesPath: data.paths.fixtures,
      scenariosPath: data.paths.scenarios,
      selectorsPath,
      baseUrl: commandOptions.baseUrl,
      surface,
      outputDirectory,
      runId,
      viewport: {
        width: commandOptions.width,
        height: commandOptions.height,
      },
      enforceExpected: surface === "legacy",
      replaceExisting: commandOptions.replace,
    });
    writeResult({
      runId: manifest.runId,
      surface: manifest.surface,
      scenarios: manifest.results.length,
      outputDirectory,
    });
  });

program
  .command("compare")
  .description("Capture React and compare it with the legacy baseline.")
  .argument("<component>")
  .requiredOption("--base-url <url>", "Running Vite server base URL.")
  .option("--run-id <id>", "Stable run ID.")
  .option("--width <pixels>", "Viewport width.", parsePositiveInteger, 1280)
  .option("--height <pixels>", "Viewport height.", parsePositiveInteger, 900)
  .action(
    async (
      componentId: string,
      commandOptions: Omit<CaptureOptions, "surface" | "replace">,
    ) => {
      const context = await getContext();
      const config = await loadComponentConfig(context, componentId);
      const worksheet = await requireFreshWorksheet(context, config);
      await requireFreshComponentTest(context, config, "legacy");
      await requireFreshComponentTest(context, config, "react");
      const decisionFile = await loadPilotDecisions(context, componentId);
      const decisionCheck = checkDecisions({
        worksheet,
        decisions: decisionFile,
      });
      if (!decisionCheck.ok) {
        throw new Error(
          `Decisions are not ready:\n${decisionCheck.issues.join("\n")}`,
        );
      }
      const data = await loadPilotData(context, componentId);
      const runId = RunIdSchema.parse(
        commandOptions.runId ?? createRunId("react"),
      );
      const result = await compareCandidate({
        context,
        config,
        scenarios: data.scenarios,
        legacySelectors: data.legacySelectors,
        reactSelectors: data.reactSelectors,
        fixturesPath: data.paths.fixtures,
        scenariosPath: data.paths.scenarios,
        legacySelectorsPath: data.paths.legacySelectors,
        reactSelectorsPath: data.paths.reactSelectors,
        baselineDirectory: data.paths.baseline,
        candidateDirectory: data.paths.candidate(runId),
        reactBaseUrl: commandOptions.baseUrl,
        runId,
        viewport: {
          width: commandOptions.width,
          height: commandOptions.height,
        },
        acceptedDifferences: data.acceptedDifferences,
        decisions: decisionFile,
      });
      writeResult(result);
      if (result.status !== "PARITY" || !result.attested) {
        process.exitCode = 2;
      }
    },
  );

program
  .command("status")
  .description("Show the next safe action for one component.")
  .argument("<component>")
  .action(async (componentId: string) => {
    const context = await getContext();
    const config = await loadComponentConfig(context, componentId);
    writeResult(await getMigrationStatus({ context, config }));
  });

program
  .command("verify")
  .description("Run component guards and project checks.")
  .argument("<component>")
  .option("--skip-project-checks", "Skip root typecheck and build.", false)
  .action(
    async (
      componentId: string,
      commandOptions: { skipProjectChecks: boolean },
    ) => {
      const context = await getContext();
      const config = await loadComponentConfig(context, componentId);
      const decisionCheck = checkDecisions({
        worksheet: await requireFreshWorksheet(context, config),
        decisions: await loadDecisions({ context, componentId }),
      });
      const useCheck = await checkNoNewUse({
        context,
        config,
        allowlist: await loadLegacyUseAllowlist({ context, componentId }),
      });
      const legacyTestCheck = await checkComponentTest({
        context,
        config,
        surface: "legacy",
      });
      const reactTestCheck = await checkComponentTest({
        context,
        config,
        surface: "react",
      });
      const projectChecks = commandOptions.skipProjectChecks
        ? []
        : await runProjectChecks(context.projectRoot);
      const status = await getMigrationStatus({ context, config });
      const ok =
        decisionCheck.ok &&
        useCheck.ok &&
        legacyTestCheck.ok &&
        reactTestCheck.ok &&
        projectChecks.every((check) => check.ok) &&
        status.phase === "done";
      writeResult({
        ok,
        decisionCheck,
        useCheck,
        legacyTestCheck,
        reactTestCheck,
        projectChecks,
        status,
      });
      if (!ok) {
        process.exitCode = 2;
      }
    },
  );

program
  .command("loop")
  .description("Run deterministic phases and stop at agent or human work.")
  .argument("<component>")
  .option("--legacy-url <url>", "Running legacy server base URL.")
  .option("--react-url <url>", "Running React server base URL.")
  .option(
    "--max-iterations <count>",
    "Maximum deterministic steps.",
    parsePositiveInteger,
    5,
  )
  .action(
    async (
      componentId: string,
      commandOptions: {
        legacyUrl: string | undefined;
        reactUrl: string | undefined;
        maxIterations: number;
      },
    ) => {
      await runDeterministicLoop({
        context: await getContext(),
        componentId,
        ...commandOptions,
      });
    },
  );

program
  .command("rebase-detect")
  .description("Find components changed both upstream and locally.")
  .requiredOption("--upstream <ref>", "Upstream ref.")
  .option("--head <ref>", "Local head ref.", "HEAD")
  .action(
    async (commandOptions: { upstream: string; head: string }) => {
      const context = await getContext();
      writeResult(
        await detectRebasePorts({
          context,
          upstreamRef: commandOptions.upstream,
          headRef: commandOptions.head,
        }),
      );
    },
  );

program.parseAsync().catch((error: unknown) => {
  writeFailure(error);
  process.exitCode = 1;
});

async function getContext(): Promise<ToolContext> {
  const options = program.opts<GlobalOptions>();
  return createContext({
    toolsRoot: options.toolsRoot,
    projectRoot: options.projectRoot ?? null,
  });
}

async function requireFreshWorksheet(
  context: ToolContext,
  config: ComponentConfig,
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
      `Worksheet is stale for ${config.id}. Run analyze --write before continuing.`,
    );
  }
  return worksheet;
}

async function requireFreshComponentTest(
  context: ToolContext,
  config: ComponentConfig,
  surface: ComponentTestSurface,
): Promise<void> {
  const check = await checkComponentTest({ context, config, surface });
  if (!check.ok) {
    throw new Error(
      `${surface} unit test is not current:\n${check.issues.join("\n")}`,
    );
  }
}

async function runDeterministicLoop(options: {
  context: ToolContext;
  componentId: string;
  legacyUrl: string | undefined;
  reactUrl: string | undefined;
  maxIterations: number;
}): Promise<void> {
  const config = await loadComponentConfig(
    options.context,
    options.componentId,
  );
  for (let iteration = 0; iteration < options.maxIterations; iteration += 1) {
    const current = await getMigrationStatus({
      context: options.context,
      config,
    });
    writeResult({ iteration: iteration + 1, ...current });
    switch (current.phase) {
      case "analyze": {
        await writeInventory(
          options.context,
          await buildInventory(options.context),
        );
        const worksheet = await analyzeComponent({
          context: options.context,
          config,
        });
        await writeWorksheet({ context: options.context, worksheet });
        continue;
      }
      case "legacy-test": {
        if (
          !(await fileExists(
            resolve(options.context.projectRoot, config.tests.legacyFile),
          ))
        ) {
          writeMessage(`Stop for agent test backfill: ${current.nextAction}`);
          return;
        }
        const result = await runComponentTest({
          context: options.context,
          config,
          surface: "legacy",
        });
        writeResult(result);
        if (!result.passed) {
          process.exitCode = 2;
          return;
        }
        continue;
      }
      case "baseline": {
        if (options.legacyUrl === undefined) {
          writeMessage("Stop: provide --legacy-url to capture the baseline.");
          return;
        }
        const data = await loadPilotData(
          options.context,
          options.componentId,
        );
        await captureSurface({
          context: options.context,
          config,
          scenarios: data.scenarios,
          selectors: data.legacySelectors,
          fixturesPath: data.paths.fixtures,
          scenariosPath: data.paths.scenarios,
          selectorsPath: data.paths.legacySelectors,
          baseUrl: options.legacyUrl,
          surface: "legacy",
          outputDirectory: data.paths.baseline,
          runId: createRunId("legacy"),
          viewport: { width: 1280, height: 900 },
          enforceExpected: true,
          replaceExisting: false,
        });
        continue;
      }
      case "decisions": {
        const path = pilotPaths(
          options.context,
          options.componentId,
        ).decisions;
        if (!(await fileExists(path))) {
          const draft = createDecisionDraft(
            await loadWorksheet({
              context: options.context,
              componentId: options.componentId,
            }),
          );
          await writeDecisionDraft({
            context: options.context,
            decisions: draft,
            force: false,
          });
        }
        writeMessage(
          `Stop: review and approve ${resolve(path)} before implementation.`,
        );
        return;
      }
      case "implement":
        writeMessage(`Stop for agent implementation: ${current.nextAction}`);
        return;
      case "react-test": {
        if (
          !(await fileExists(
            resolve(options.context.projectRoot, config.tests.reactFile),
          ))
        ) {
          writeMessage(`Stop for agent test work: ${current.nextAction}`);
          return;
        }
        const result = await runComponentTest({
          context: options.context,
          config,
          surface: "react",
        });
        writeResult(result);
        if (!result.passed) {
          process.exitCode = 2;
          return;
        }
        continue;
      }
      case "compare": {
        if (options.reactUrl === undefined) {
          writeMessage("Stop: provide --react-url to compare the React surface.");
          return;
        }
        const data = await loadPilotData(
          options.context,
          options.componentId,
        );
        const runId = createRunId("react");
        const result = await compareCandidate({
          context: options.context,
          config,
          scenarios: data.scenarios,
          legacySelectors: data.legacySelectors,
          reactSelectors: data.reactSelectors,
          fixturesPath: data.paths.fixtures,
          scenariosPath: data.paths.scenarios,
          legacySelectorsPath: data.paths.legacySelectors,
          reactSelectorsPath: data.paths.reactSelectors,
          baselineDirectory: data.paths.baseline,
          candidateDirectory: data.paths.candidate(runId),
          reactBaseUrl: options.reactUrl,
          runId,
          viewport: { width: 1280, height: 900 },
          acceptedDifferences: data.acceptedDifferences,
          decisions: await loadPilotDecisions(
            options.context,
            options.componentId,
          ),
        });
        writeResult(result);
        if (result.status !== "PARITY" || !result.attested) {
          process.exitCode = 2;
        }
        return;
      }
      case "done":
        writeMessage("Migration loop reached PARITY and ATTESTED.");
        return;
      default: {
        const exhaustive: never = current.phase;
        throw new Error(`Unsupported phase: ${String(exhaustive)}`);
      }
    }
  }
  throw new Error("Migration loop reached its maximum deterministic steps.");
}

function parsePositiveInteger(value: string): number {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new Error(`Expected a positive integer, received ${value}.`);
  }
  return parsed;
}

function parseSurface(value: string): CaptureSurface {
  if (value === "legacy" || value === "react") {
    return value;
  }
  throw new Error(`Surface must be legacy or react; received ${value}.`);
}

function parseTestSurface(value: string): ComponentTestSurface {
  if (value === "legacy" || value === "react") {
    return value;
  }
  throw new Error(`Test surface must be legacy or react; received ${value}.`);
}

function createRunId(surface: CaptureSurface): string {
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  return `${surface}-${timestamp}`;
}

async function fileExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}
