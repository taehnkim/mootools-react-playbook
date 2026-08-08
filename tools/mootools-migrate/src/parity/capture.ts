import {
  access,
  mkdir,
  readFile,
  rename,
  rm,
} from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";

import { chromium, type Locator, type Page } from "playwright";

import { hashProjectFiles } from "../core/fingerprint.js";
import { hashJson, sha256, writeJson } from "../core/json.js";
import {
  CaptureManifestSchema,
  EventRecordSchema,
  JsonValueSchema,
  type CaptureManifest,
  type MigrationSpec,
  type Fixtures,
  type JsonValue,
  type Observation,
  type Scenario,
  type ScenarioAction,
  type ScenarioAssertion,
  type Scenarios,
  type SelectorMap,
} from "../contracts/schemas.js";
import {
  componentArtifactPath,
  type ToolContext,
} from "../core/context.js";

const EVENT_STORE = "__mootoolsMigrationEvents";

export type CaptureSurface = "legacy" | "react";

export function selectorMap(
  config: MigrationSpec,
  surface: CaptureSurface,
): SelectorMap {
  return {
    surface,
    selectors: Object.fromEntries(
      Object.entries(config.selectors).map(([target, selectors]) => [
        target,
        selectors[surface],
      ]),
    ),
  };
}

export async function captureSurface(options: {
  context: ToolContext;
  config: MigrationSpec;
  scenarios: Scenarios;
  selectors: SelectorMap;
  fixtures: Fixtures;
  baseUrl: string;
  surface: CaptureSurface;
  outputDirectory: string;
  runId: string;
  viewport: { width: number; height: number };
  enforceExpected: boolean;
  replaceExisting: boolean;
}): Promise<CaptureManifest> {
  requireComponentEvidencePath(
    options.context,
    options.config.id,
    options.outputDirectory,
  );
  validateSurface(options.surface, options.selectors.surface);
  for (const scenario of options.scenarios) {
    if (options.fixtures[scenario.fixture] === undefined) {
      throw new Error(
        `Scenario ${scenario.id} uses unknown fixture ${scenario.fixture}.`,
      );
    }
  }

  if (
    (await fileExists(options.outputDirectory)) &&
    !options.replaceExisting
  ) {
    throw new Error(
      `Capture output already exists: ${options.outputDirectory}. Use an unused run ID or explicit replacement.`,
    );
  }
  const temporaryDirectory = `${options.outputDirectory}.tmp-${options.runId}`;
  await rm(temporaryDirectory, { recursive: true, force: true });
  await mkdir(temporaryDirectory, { recursive: true });
  const browser = await chromium.launch({ headless: true });
  const browserVersion = browser.version();
  const results: CaptureManifest["results"] = [];

  try {
    for (const scenario of options.scenarios) {
      const fixture = options.fixtures[scenario.fixture];
      if (fixture === undefined) {
        throw new Error(
          `Scenario ${scenario.id} uses unknown fixture ${scenario.fixture}.`,
        );
      }
      const page = await browser.newPage({ viewport: options.viewport });
      try {
        const observations = await runScenario({
          page,
          config: options.config,
          scenario,
          selectors: options.selectors,
          baseUrl: options.baseUrl,
          surface: options.surface,
          outputDirectory: temporaryDirectory,
          enforceExpected: options.enforceExpected,
          fixture,
        });
        results.push({ scenarioId: scenario.id, observations });
      } finally {
        await page.close();
      }
    }
  } catch (error: unknown) {
    await rm(temporaryDirectory, { recursive: true, force: true });
    throw error;
  } finally {
    await browser.close();
  }

  const inputPaths = options.config[options.surface].proofFiles;
  const projectInputHash = await hashProjectFiles({
    projectRoot: options.context.projectRoot,
    paths: [...new Set(inputPaths)],
  });
  try {
    const manifest = CaptureManifestSchema.parse({
      schemaVersion: 1,
      runId: options.runId,
      componentId: options.config.id,
      surface: options.surface,
      createdAt: new Date().toISOString(),
      baseUrl: options.baseUrl,
      projectInputHash,
      captureConfigHash: captureConfigHash(
        options.config,
        options.surface,
      ),
      scenariosHash: hashJson(JsonValueSchema.parse(options.scenarios)),
      fixturesHash: hashJson(JsonValueSchema.parse(options.fixtures)),
      selectorsHash: hashJson(JsonValueSchema.parse(options.selectors)),
      browserVersion,
      viewport: options.viewport,
      results,
    });
    await writeJson(
      join(temporaryDirectory, "manifest.json"),
      JsonValueSchema.parse(manifest),
    );
    await commitCaptureDirectory({
      temporaryDirectory,
      outputDirectory: options.outputDirectory,
      replaceExisting: options.replaceExisting,
    });
    return manifest;
  } catch (error: unknown) {
    await rm(temporaryDirectory, { recursive: true, force: true });
    throw error;
  }
}

export function captureConfigHash(
  config: MigrationSpec,
  surface: CaptureSurface,
): string {
  return hashJson(
    JsonValueSchema.parse({
      fixtureBridge: config.fixtureBridge,
      eventNames: config.legacy.eventNames,
      surface: config[surface],
    }),
  );
}

async function runScenario(options: {
  page: Page;
  config: MigrationSpec;
  scenario: Scenario;
  selectors: SelectorMap;
  baseUrl: string;
  surface: CaptureSurface;
  outputDirectory: string;
  enforceExpected: boolean;
  fixture: JsonValue;
}): Promise<Observation[]> {
  const errors: string[] = [];
  options.page.on("console", (message) => {
    if (message.type() === "error") {
      errors.push(`console: ${message.text()}`);
    }
  });
  options.page.on("pageerror", (error) => {
    errors.push(`page: ${error.message}`);
  });
  options.page.on("requestfailed", (request) => {
    errors.push(
      `request: ${request.url()} ${request.failure()?.errorText ?? "failed"}`,
    );
  });

  rejectStartupEventAssertions(options.scenario);
  await options.page.addInitScript(
    ({ fixtureId, fixtureJson, idKey, valueKey }) => {
      const fixture: unknown = JSON.parse(fixtureJson);
      Reflect.set(window, idKey, fixtureId);
      Reflect.set(window, valueKey, fixture);
    },
    {
      fixtureId: options.scenario.fixture,
      fixtureJson: JSON.stringify(options.fixture),
      idKey: options.config.fixtureBridge.windowIdKey,
      valueKey: options.config.fixtureBridge.windowValueKey,
    },
  );
  const entryPath =
    options.surface === "legacy"
      ? options.config.legacy.entryPath
      : options.config.react.entryPath;
  await options.page.goto(new URL(entryPath, options.baseUrl).toString(), {
    waitUntil: "networkidle",
  });
  await waitUntilReady({
    page: options.page,
    config: options.config,
    surface: options.surface,
  });
  await confirmFixture({
    page: options.page,
    config: options.config,
    surface: options.surface,
    fixtureId: options.scenario.fixture,
  });
  await attachEventRecorder({
    page: options.page,
    config: options.config,
    surface: options.surface,
  });

  const observations: Observation[] = [];
  for (const step of options.scenario.steps) {
    await runAction({
      page: options.page,
      config: options.config,
      selectors: options.selectors,
      surface: options.surface,
      action: step,
    });
    for (const assertion of options.scenario.assertions.filter(
      (item) => item.afterStepId === step.stepId,
    )) {
      const observation = await observeAssertion({
        page: options.page,
        assertion,
        selectors: options.selectors,
        scenarioId: options.scenario.id,
        outputDirectory: options.outputDirectory,
      });
      if (options.enforceExpected) {
        assertExpected(assertion, observation.actual);
      }
      observations.push(observation);
    }
  }

  if (errors.length > 0) {
    throw new Error(
      `Browser errors in scenario ${options.scenario.id}:\n${errors.join("\n")}`,
    );
  }
  if (observations.length !== options.scenario.assertions.length) {
    throw new Error(
      `Scenario ${options.scenario.id} did not exercise every assertion.`,
    );
  }
  return observations;
}

async function waitUntilReady(options: {
  page: Page;
  config: MigrationSpec;
  surface: CaptureSurface;
}): Promise<void> {
  if (options.surface === "react") {
    await options.page.locator(options.config.react.readySelector).waitFor();
    return;
  }
  await options.page.waitForFunction((path) => {
    let value: unknown = window;
    for (const segment of path) {
      if (
        (typeof value !== "object" || value === null) &&
        typeof value !== "function"
      ) {
        return false;
      }
      value = Reflect.get(value, segment);
    }
    return value !== undefined && value !== null;
  }, options.config.legacy.readyPath);
}

async function attachEventRecorder(options: {
  page: Page;
  config: MigrationSpec;
  surface: CaptureSurface;
}): Promise<void> {
  const path =
    options.surface === "legacy"
      ? options.config.legacy.readyPath
      : options.config.react.handlePath;
  if (path === null || options.config.legacy.eventNames.length === 0) {
    return;
  }
  await options.page.evaluate(
    ({ eventNames, eventStore, handlePath }) => {
      let handle: unknown = window;
      for (const segment of handlePath) {
        if (
          (typeof handle !== "object" || handle === null) &&
          typeof handle !== "function"
        ) {
          throw new Error(`Event handle path failed at ${segment}.`);
        }
        handle = Reflect.get(handle, segment);
      }
      if (
        (typeof handle !== "object" || handle === null) &&
        typeof handle !== "function"
      ) {
        throw new Error("Event handle is not an object.");
      }
      const addEvent = Reflect.get(handle, "addEvent");
      if (typeof addEvent !== "function") {
        throw new Error("Event handle has no addEvent method.");
      }
      const records: { name: string; args: JsonValue[] }[] = [];
      const activeObjects = new WeakSet<object>();
      Reflect.set(window, eventStore, records);
      for (const eventName of eventNames) {
        Reflect.apply(addEvent, handle, [
          eventName,
          (...args: unknown[]) => {
            records.push({
              name: eventName,
              args: args.map(toStableJson),
            });
          },
        ]);
      }

      function toStableJson(value: unknown): JsonValue {
        if (
          value === null ||
          typeof value === "string" ||
          typeof value === "number" ||
          typeof value === "boolean"
        ) {
          return value;
        }
        if (Array.isArray(value)) {
          if (activeObjects.has(value)) {
            throw new Error("Cyclic event payload is not supported.");
          }
          activeObjects.add(value);
          const result = value.map(toStableJson);
          activeObjects.delete(value);
          return result;
        }
        if (typeof value === "object") {
          const prototype: unknown = Object.getPrototypeOf(value);
          if (prototype !== Object.prototype && prototype !== null) {
            throw new Error("Unsupported event payload object prototype.");
          }
          if (activeObjects.has(value)) {
            throw new Error("Cyclic event payload is not supported.");
          }
          activeObjects.add(value);
          const result: { [key: string]: JsonValue } = {};
          for (const key of Object.keys(value).sort()) {
            const child = Reflect.get(value, key);
            if (child === undefined) {
              throw new Error(
                `Undefined event payload field is not supported: ${key}.`,
              );
            }
            result[key] = toStableJson(child);
          }
          activeObjects.delete(value);
          return result;
        }
        throw new Error(`Unsupported event payload type: ${typeof value}.`);
      }
    },
    {
      eventNames: options.config.legacy.eventNames,
      eventStore: EVENT_STORE,
      handlePath: path,
    },
  );
}

async function runAction(options: {
  page: Page;
  config: MigrationSpec;
  selectors: SelectorMap;
  surface: CaptureSurface;
  action: ScenarioAction;
}): Promise<void> {
  switch (options.action.action) {
    case "observe":
      return;
    case "click":
      await targetLocator(options.page, options.selectors, options.action.target)
        .click();
      return;
    case "fill":
      await targetLocator(
        options.page,
        options.selectors,
        options.action.target,
      ).fill(options.action.value);
      return;
    case "press":
      await targetLocator(
        options.page,
        options.selectors,
        options.action.target,
      ).press(options.action.key);
      return;
    case "call": {
      const path =
        options.surface === "legacy"
          ? options.config.legacy.readyPath
          : options.config.react.handlePath;
      if (path === null) {
        throw new Error(
          `Surface ${options.surface} has no imperative handle for ${options.action.method}.`,
        );
      }
      await options.page.evaluate(
        ({ argsJson, handlePath, method }) => {
          const parsedArgs: unknown = JSON.parse(argsJson);
          if (!Array.isArray(parsedArgs)) {
            throw new Error("Method arguments are not an array.");
          }
          let handle: unknown = window;
          for (const segment of handlePath) {
            if (
              (typeof handle !== "object" || handle === null) &&
              typeof handle !== "function"
            ) {
              throw new Error(`Handle path failed at ${segment}.`);
            }
            handle = Reflect.get(handle, segment);
          }
          if (
            (typeof handle !== "object" || handle === null) &&
            typeof handle !== "function"
          ) {
            throw new Error("Handle is not an object.");
          }
          const callable = Reflect.get(handle, method);
          if (typeof callable !== "function") {
            throw new Error(`Handle method does not exist: ${method}.`);
          }
          Reflect.apply(callable, handle, parsedArgs);
        },
        {
          argsJson: JSON.stringify(options.action.args),
          handlePath: path,
          method: options.action.method,
        },
      );
      await options.page.evaluate(
        () =>
          new Promise<void>((resolveFrame) => {
            requestAnimationFrame(() =>
              requestAnimationFrame(() => resolveFrame()),
            );
          }),
      );
      return;
    }
    default: {
      const exhaustive: never = options.action;
      throw new Error(`Unsupported action: ${String(exhaustive)}`);
    }
  }
}

async function observeAssertion(options: {
  page: Page;
  assertion: ScenarioAssertion;
  selectors: SelectorMap;
  scenarioId: string;
  outputDirectory: string;
}): Promise<Observation> {
  if (options.assertion.kind === "event-trace") {
    const value = await options.page.evaluate((eventStore) => {
      return Reflect.get(window, eventStore);
    }, EVENT_STORE);
    const records = EventRecordSchema.array().parse(value);
    return {
      assertionId: options.assertion.assertionId,
      afterStepId: options.assertion.afterStepId,
      kind: options.assertion.kind,
      actual: JsonValueSchema.parse(records),
      screenshotPath: null,
      screenshotHash: null,
    };
  }

  const locator = targetLocator(
    options.page,
    options.selectors,
    options.assertion.target,
  );
  switch (options.assertion.kind) {
    case "count":
      return observation(options.assertion, await locator.count());
    case "text": {
      const text = await locator.first().innerText();
      return observation(options.assertion, text.trim());
    }
    case "class": {
      const present = await locator.first().evaluate(
        (element, className) => element.classList.contains(className),
        options.assertion.className,
      );
      return observation(options.assertion, present);
    }
    case "visible":
      return observation(
        options.assertion,
        await locator.first().isVisible(),
      );
    case "focus": {
      const focused = await locator
        .first()
        .evaluate((element) => document.activeElement === element);
      return observation(options.assertion, focused);
    }
    case "attribute":
      return observation(
        options.assertion,
        await locator.first().getAttribute(options.assertion.attribute),
      );
    case "computed-style": {
      const value = await locator.first().evaluate(
        (element, property) =>
          getComputedStyle(element).getPropertyValue(property),
        options.assertion.property,
      );
      return observation(options.assertion, value.trim());
    }
    case "screenshot": {
      const relativePath = join(
        options.scenarioId,
        `${options.assertion.name}.png`,
      );
      const absolutePath = resolveInside(
        options.outputDirectory,
        relativePath,
      );
      await mkdir(dirname(absolutePath), { recursive: true });
      await locator.first().screenshot({ path: absolutePath });
      return {
        assertionId: options.assertion.assertionId,
        afterStepId: options.assertion.afterStepId,
        kind: options.assertion.kind,
        actual: null,
        screenshotPath: relative(
          options.outputDirectory,
          absolutePath,
        ).split("\\").join("/"),
        screenshotHash: sha256(await readFile(absolutePath)),
      };
    }
    default: {
      const exhaustive: never = options.assertion;
      throw new Error(`Unsupported assertion: ${String(exhaustive)}`);
    }
  }
}

function observation(
  assertion: ScenarioAssertion,
  actual: JsonValue,
): Observation {
  return {
    assertionId: assertion.assertionId,
    afterStepId: assertion.afterStepId,
    kind: assertion.kind,
    actual,
    screenshotPath: null,
    screenshotHash: null,
  };
}

function assertExpected(
  assertion: ScenarioAssertion,
  actual: JsonValue,
): void {
  switch (assertion.kind) {
    case "count":
    case "class":
    case "visible":
    case "focus":
    case "attribute":
    case "computed-style":
    case "event-trace":
      if (JSON.stringify(actual) !== JSON.stringify(assertion.expected)) {
        throw new Error(
          `Assertion ${assertion.assertionId} expected ${JSON.stringify(
            assertion.expected,
          )} but received ${JSON.stringify(actual)}.`,
        );
      }
      return;
    case "text":
      if (
        (assertion.matcher === "equals" && actual !== assertion.expected) ||
        (assertion.matcher === "contains" &&
          (typeof actual !== "string" ||
            !actual.includes(assertion.expected)))
      ) {
        throw new Error(
          `Assertion ${assertion.assertionId} did not match ${assertion.matcher}.`,
        );
      }
      return;
    case "screenshot":
      return;
    default: {
      const exhaustive: never = assertion;
      throw new Error(`Unsupported assertion: ${String(exhaustive)}`);
    }
  }
}

function targetLocator(
  page: Page,
  selectors: SelectorMap,
  target: string,
): Locator {
  const selector = selectors.selectors[target];
  if (selector === undefined) {
    throw new Error(`Selector map has no target: ${target}`);
  }
  return page.locator(selector);
}

function validateSurface(
  captureSurface: CaptureSurface,
  selectorSurface: SelectorMap["surface"],
): void {
  if (captureSurface !== selectorSurface) {
    throw new Error(
      `Capture surface ${captureSurface} does not match selector surface ${selectorSurface}.`,
    );
  }
}

function rejectStartupEventAssertions(scenario: Scenario): void {
  const observeStepIds = new Set(
    scenario.steps
      .filter((step) => step.action === "observe")
      .map((step) => step.stepId),
  );
  for (const assertion of scenario.assertions) {
    if (
      assertion.kind === "event-trace" &&
      observeStepIds.has(assertion.afterStepId) &&
      assertion.expected.length > 0
    ) {
      throw new Error(
        `Scenario ${scenario.id} expects startup events. Event recording starts after the component is ready.`,
      );
    }
  }
}

async function confirmFixture(options: {
  page: Page;
  config: MigrationSpec;
  surface: CaptureSurface;
  fixtureId: string;
}): Promise<void> {
  const injectedId = await options.page.evaluate((idKey) => {
    return Reflect.get(window, idKey);
  }, options.config.fixtureBridge.windowIdKey);
  if (injectedId !== options.fixtureId) {
    throw new Error(`Fixture injection failed for ${options.fixtureId}.`);
  }

  if (options.surface === "legacy") {
    if (
      options.fixtureId !==
      options.config.fixtureBridge.legacyStaticFixtureId
    ) {
      throw new Error(
        `Legacy surface supports only static fixture ${options.config.fixtureBridge.legacyStaticFixtureId}.`,
      );
    }
    return;
  }

  await options.page.waitForFunction(
    ({ fixtureId, path }) => {
      let value: unknown = window;
      for (const segment of path) {
        if (
          (typeof value !== "object" || value === null) &&
          typeof value !== "function"
        ) {
          return false;
        }
        value = Reflect.get(value, segment);
      }
      return value === fixtureId;
    },
    {
      fixtureId: options.fixtureId,
      path: options.config.fixtureBridge.reactAcknowledgementPath,
    },
  );
}

async function commitCaptureDirectory(options: {
  temporaryDirectory: string;
  outputDirectory: string;
  replaceExisting: boolean;
}): Promise<void> {
  const exists = await fileExists(options.outputDirectory);
  if (!exists) {
    await rename(options.temporaryDirectory, options.outputDirectory);
    return;
  }
  if (!options.replaceExisting) {
    throw new Error(`Capture output already exists: ${options.outputDirectory}`);
  }

  const backupDirectory = `${options.outputDirectory}.backup`;
  await rm(backupDirectory, { recursive: true, force: true });
  await rename(options.outputDirectory, backupDirectory);
  try {
    await rename(options.temporaryDirectory, options.outputDirectory);
    await rm(backupDirectory, { recursive: true, force: true });
  } catch (error: unknown) {
    await rm(options.outputDirectory, { recursive: true, force: true });
    await rename(backupDirectory, options.outputDirectory);
    throw error;
  }
}

async function fileExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

function resolveInside(root: string, child: string): string {
  const absolutePath = resolve(root, child);
  const relativePath = relative(root, absolutePath);
  if (
    relativePath.startsWith("..") ||
    relativePath === "" ||
    isAbsolute(relativePath)
  ) {
    throw new Error(`Evidence path escapes its output directory: ${child}`);
  }
  return absolutePath;
}

function requireComponentEvidencePath(
  context: ToolContext,
  componentId: string,
  outputDirectory: string,
): void {
  const componentDirectory = componentArtifactPath(context, componentId);
  const child = relative(componentDirectory, resolve(outputDirectory));
  if (
    child === "" ||
    child.startsWith("..") ||
    isAbsolute(child)
  ) {
    throw new Error(
      `Evidence output must stay inside ${componentDirectory}.`,
    );
  }
}
