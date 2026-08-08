import { execFile } from "node:child_process";
import { access } from "node:fs/promises";
import { resolve } from "node:path";

import type { ToolContext } from "../core/context.js";
import type { MigrationSpec } from "../contracts/schemas.js";

export type ComponentTestSurface = "legacy" | "react";

export type ComponentTestResult = {
  surface: ComponentTestSurface;
  command: string;
  passed: boolean;
  output: string;
};

export async function runComponentTest(options: {
  context: ToolContext;
  config: MigrationSpec;
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
  return {
    surface: options.surface,
    command,
    passed: execution.passed,
    output: execution.output,
  };
}

function testFileFor(
  config: MigrationSpec,
  surface: ComponentTestSurface,
): string {
  return surface === "legacy"
    ? config.tests.legacyFile
    : config.tests.reactFile;
}

function testInputPaths(
  config: MigrationSpec,
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
