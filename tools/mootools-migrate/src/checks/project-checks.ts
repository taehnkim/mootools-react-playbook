import { execFile } from "node:child_process";
import { promisify } from "node:util";

import type { ProjectCheckResult } from "../contracts/schemas.js";

const execFileAsync = promisify(execFile);

export async function runProjectChecks(
  projectRoot: string,
): Promise<ProjectCheckResult[]> {
  const npm = process.platform === "win32" ? "npm.cmd" : "npm";
  const commands = [
    ["run", "typecheck"],
    ["run", "build"],
  ];
  const results: ProjectCheckResult[] = [];

  for (const args of commands) {
    const command = `npm ${args.join(" ")}`;
    try {
      const result = await execFileAsync(npm, args, { cwd: projectRoot });
      results.push({
        command,
        ok: true,
        output: `${result.stdout}${result.stderr}`.trim(),
      });
    } catch (error: unknown) {
      results.push({
        command,
        ok: false,
        output: errorMessage(error),
      });
    }
  }
  return results;
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}
