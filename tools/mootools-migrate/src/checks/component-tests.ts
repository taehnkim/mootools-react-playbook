import { execFile } from "node:child_process";
import { access, readFile } from "node:fs/promises";
import { resolve } from "node:path";

import {
  componentArtifactPath,
  type ToolContext,
} from "../core/context.js";
import { hashProjectFiles } from "../core/fingerprint.js";
import { readJson, sha256, writeJson } from "../core/json.js";
import {
  ComponentTestResultSchema,
  JsonValueSchema,
  type ComponentConfig,
  type ComponentTestResult,
} from "../contracts/schemas.js";

export type ComponentTestSurface = "legacy" | "react";

export type ComponentTestCheck = {
  ok: boolean;
  issues: string[];
  result: ComponentTestResult | null;
};

export async function runComponentTest(options: {
  context: ToolContext;
  config: ComponentConfig;
  surface: ComponentTestSurface;
}): Promise<ComponentTestResult> {
  const testFile = testFileFor(options.config, options.surface);
  const inputPaths = testInputPaths(options.config, options.surface);
  for (const path of inputPaths) {
    if (!(await fileExists(resolve(options.context.projectRoot, path)))) {
      throw new Error(
        `${options.surface} test input does not exist: ${path}`,
      );
    }
  }

  const command = `npm run test -- ${testFile}`;
  const execution = await executeNpmTest(
    options.context.projectRoot,
    testFile,
  );
  const result = ComponentTestResultSchema.parse({
    schemaVersion: 1,
    componentId: options.config.id,
    surface: options.surface,
    testFile,
    testFileHash: sha256(
      await readFile(resolve(options.context.projectRoot, testFile)),
    ),
    sourceHash: await hashProjectFiles({
      projectRoot: options.context.projectRoot,
      paths: inputPaths,
    }),
    createdAt: new Date().toISOString(),
    command,
    passed: execution.passed,
    output: execution.output,
  });
  await writeJson(
    testResultPath(options.context, options.config.id, options.surface),
    JsonValueSchema.parse(result),
  );
  return result;
}

export async function checkComponentTest(options: {
  context: ToolContext;
  config: ComponentConfig;
  surface: ComponentTestSurface;
}): Promise<ComponentTestCheck> {
  const path = testResultPath(
    options.context,
    options.config.id,
    options.surface,
  );
  if (!(await fileExists(path))) {
    return {
      ok: false,
      issues: [`No ${options.surface} unit-test evidence exists.`],
      result: null,
    };
  }
  const result = await readJson(path, ComponentTestResultSchema);
  const testFile = testFileFor(options.config, options.surface);
  const inputPaths = testInputPaths(options.config, options.surface);
  const issues: string[] = [];
  if (!(await fileExists(resolve(options.context.projectRoot, testFile)))) {
    issues.push(`${options.surface} unit-test file is missing: ${testFile}.`);
  } else if (
    result.testFileHash !==
    sha256(await readFile(resolve(options.context.projectRoot, testFile)))
  ) {
    issues.push(`${options.surface} unit-test file changed after its run.`);
  }
  const inputExistence = await Promise.all(
    inputPaths.map((inputPath) =>
      fileExists(resolve(options.context.projectRoot, inputPath)),
    ),
  );
  if (inputExistence.every(Boolean)) {
    const currentSourceHash = await hashProjectFiles({
      projectRoot: options.context.projectRoot,
      paths: inputPaths,
    });
    if (result.sourceHash !== currentSourceHash) {
      issues.push(`${options.surface} source changed after its unit test.`);
    }
  } else {
    issues.push(`${options.surface} unit-test inputs are missing.`);
  }
  if (!result.passed) {
    issues.push(`${options.surface} unit test failed.`);
  }
  return { ok: issues.length === 0, issues, result };
}

function testFileFor(
  config: ComponentConfig,
  surface: ComponentTestSurface,
): string {
  return surface === "legacy"
    ? config.tests.legacyFile
    : config.tests.reactFile;
}

function testInputPaths(
  config: ComponentConfig,
  surface: ComponentTestSurface,
): string[] {
  return surface === "legacy"
    ? [
        ...config.sourceFiles,
        config.tests.legacyFile,
        ...config.tests.legacyDependencies,
      ]
    : [
        config.react.componentPath,
        config.tests.reactFile,
        ...config.tests.reactDependencies,
      ];
}

function testResultPath(
  context: ToolContext,
  componentId: string,
  surface: ComponentTestSurface,
): string {
  return componentArtifactPath(
    context,
    componentId,
    "test-results",
    `${surface}.json`,
  );
}

function executeNpmTest(
  projectRoot: string,
  testFile: string,
): Promise<{ passed: boolean; output: string }> {
  const npm = process.platform === "win32" ? "npm.cmd" : "npm";
  return new Promise((resolveExecution) => {
    execFile(
      npm,
      ["run", "test", "--", testFile],
      { cwd: projectRoot },
      (error, stdout, stderr) => {
        resolveExecution({
          passed: error === null,
          output: `${stdout}${stderr}`.trim(),
        });
      },
    );
  });
}

async function fileExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}
