import { execFile } from "node:child_process";
import { promisify } from "node:util";

import { loadComponentConfig, type ToolContext } from "../core/context.js";

const execFileAsync = promisify(execFile);

export type RebasePort = {
  componentId: string;
  pathsChangedUpstream: string[];
  pathsChangedLocally: string[];
};

export async function detectRebasePorts(options: {
  context: ToolContext;
  upstreamRef: string;
  headRef: string;
}): Promise<RebasePort[]> {
  const mergeBase = (
    await runGit(options.context.projectRoot, [
      "merge-base",
      options.upstreamRef,
      options.headRef,
    ])
  ).trim();
  const upstreamChanged = new Set(
    lines(
      await runGit(options.context.projectRoot, [
        "diff",
        "--name-only",
        `${mergeBase}..${options.upstreamRef}`,
      ]),
    ),
  );
  const locallyChanged = new Set(
    lines(
      await runGit(options.context.projectRoot, [
        "diff",
        "--name-only",
        `${mergeBase}..${options.headRef}`,
      ]),
    ),
  );
  const ports: RebasePort[] = [];

  for (const entry of options.context.registry.components) {
    const config = await loadComponentConfig(options.context, entry.id);
    const pathsChangedUpstream = config.sourceFiles.filter((path) =>
      upstreamChanged.has(path),
    );
    const pathsChangedLocally = config.sourceFiles.filter((path) =>
      locallyChanged.has(path),
    );
    if (
      pathsChangedUpstream.length > 0 &&
      pathsChangedLocally.length > 0
    ) {
      ports.push({
        componentId: entry.id,
        pathsChangedUpstream,
        pathsChangedLocally,
      });
    }
  }
  return ports;
}

async function runGit(projectRoot: string, args: string[]): Promise<string> {
  try {
    const result = await execFileAsync("git", args, { cwd: projectRoot });
    return result.stdout;
  } catch (error: unknown) {
    throw new Error(
      `Git command failed: git ${args.join(" ")}. Rebase detection needs a git repository.`,
      { cause: error },
    );
  }
}

function lines(value: string): string[] {
  return value
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line !== "");
}
