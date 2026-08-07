import { access } from "node:fs/promises";
import { resolve } from "node:path";

import { loadComponentConfig, type ToolContext } from "../core/context.js";
import { writeJson } from "../core/json.js";
import {
  RegistryInventorySchema,
  type JsonValue,
  type RegistryInventory,
} from "../contracts/schemas.js";
import { findLegacyUses } from "../analyze/source.js";

export async function buildInventory(
  context: ToolContext,
): Promise<RegistryInventory> {
  const components: RegistryInventory["components"] = [];

  for (const entry of context.registry.components) {
    const config = await loadComponentConfig(context, entry.id);
    const definitions: string[] = [];
    for (const path of config.sourceFiles) {
      await access(resolve(context.projectRoot, path));
      definitions.push(path);
    }
    components.push({
      id: config.id,
      definitions,
      uses: await findLegacyUses({
        projectRoot: context.projectRoot,
        config,
      }),
    });
  }

  return RegistryInventorySchema.parse({
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    components,
  });
}

export async function writeInventory(
  context: ToolContext,
  inventory: RegistryInventory,
): Promise<string> {
  const path = resolve(context.toolsRoot, "generated", "inventory.json");
  await writeJson(path, inventoryToJson(inventory));
  return path;
}

function inventoryToJson(inventory: RegistryInventory): JsonValue {
  return {
    schemaVersion: inventory.schemaVersion,
    generatedAt: inventory.generatedAt,
    components: inventory.components.map((component) => ({
      id: component.id,
      definitions: [...component.definitions],
      uses: component.uses.map((use) => ({
        path: use.path,
        kind: use.kind,
        symbol: use.symbol,
        line: use.line,
      })),
    })),
  };
}
