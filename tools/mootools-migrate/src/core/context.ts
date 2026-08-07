import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  ComponentConfigSchema,
  RegistrySchema,
  type ComponentConfig,
  type Registry,
} from "../contracts/schemas.js";

export type ToolContext = {
  toolsRoot: string;
  projectRoot: string;
  registry: Registry;
};

export function defaultToolsRoot(): string {
  const moduleDirectory = dirname(fileURLToPath(import.meta.url));
  const candidates = [
    resolve(moduleDirectory, "../.."),
    resolve(moduleDirectory, "../../.."),
  ];
  const toolsRoot = candidates.find((candidate) =>
    existsSync(resolve(candidate, "registry.json")),
  );
  if (toolsRoot === undefined) {
    throw new Error("Could not locate the migration tools root.");
  }
  return toolsRoot;
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
  const registrySource = await readFile(
    resolve(toolsRoot, "registry.json"),
    "utf8",
  );
  const registry = RegistrySchema.parse(JSON.parse(registrySource));
  return { toolsRoot, projectRoot, registry };
}

export async function loadComponentConfig(
  context: ToolContext,
  componentId: string,
): Promise<ComponentConfig> {
  const entry = context.registry.components.find(
    (component) => component.id === componentId,
  );
  if (entry === undefined) {
    throw new Error(`Unknown component: ${componentId}`);
  }

  const configSource = await readFile(
    resolve(context.toolsRoot, entry.configPath),
    "utf8",
  );
  const config = ComponentConfigSchema.parse(JSON.parse(configSource));
  if (config.id !== componentId) {
    throw new Error(
      `Registry component ${componentId} points to config for ${config.id}.`,
    );
  }
  return config;
}

export function componentArtifactPath(
  context: ToolContext,
  componentId: string,
  ...segments: string[]
): string {
  return resolve(
    context.toolsRoot,
    "components",
    componentId,
    ...segments,
  );
}
