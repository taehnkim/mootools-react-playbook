import { readFile } from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  ComponentIdSchema,
  MigrationSpecSchema,
  type MigrationSpec,
} from "../contracts/schemas.js";

export type ToolContext = {
  toolsRoot: string;
  projectRoot: string;
};

export function defaultToolsRoot(): string {
  return resolve(dirname(fileURLToPath(import.meta.url)), "../..");
}

export async function createContext(options: {
  toolsRoot: string;
  projectRoot: string | null;
}): Promise<ToolContext> {
  const toolsRoot = resolve(options.toolsRoot);
  const projectRoot =
    options.projectRoot === null
      ? resolve(toolsRoot, "../..")
      : resolve(options.projectRoot);
  return { toolsRoot, projectRoot };
}

export async function loadMigrationSpec(
  context: ToolContext,
  componentId: string,
): Promise<MigrationSpec> {
  const safeComponentId = ComponentIdSchema.parse(componentId);
  const configSource = await readFile(
    componentArtifactPath(
      context,
      safeComponentId,
      "migration.json",
    ),
    "utf8",
  );
  const config = MigrationSpecSchema.parse(JSON.parse(configSource));
  if (config.id !== safeComponentId) {
    throw new Error(
      `Component directory ${safeComponentId} contains config for ${config.id}.`,
    );
  }
  return config;
}

export function componentArtifactPath(
  context: ToolContext,
  componentId: string,
  ...segments: string[]
): string {
  const componentRoot = resolve(
    context.toolsRoot,
    "components",
    ComponentIdSchema.parse(componentId),
  );
  const artifactPath = resolve(componentRoot, ...segments);
  const child = relative(componentRoot, artifactPath);
  if (child.startsWith("..") || isAbsolute(child)) {
    throw new Error("Component artifact path escapes its component directory.");
  }
  return artifactPath;
}
