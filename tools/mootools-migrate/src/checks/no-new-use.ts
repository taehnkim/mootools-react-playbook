import {
  type MigrationSpec,
  type LegacyUse,
} from "../contracts/schemas.js";
import type { ToolContext } from "../core/context.js";
import { findLegacyUses } from "../analyze/source.js";

export type LegacyUseCheck = {
  ok: boolean;
  newUses: LegacyUse[];
  removedUses: LegacyUse[];
};

export async function checkNoNewUse(options: {
  context: ToolContext;
  config: MigrationSpec;
}): Promise<LegacyUseCheck> {
  const foundUses = await findLegacyUses({
    projectRoot: options.context.projectRoot,
    config: options.config,
  });
  const uses = foundUses.filter(isDirectLegacyUse);
  const allowedUses = options.config.allowedLegacyUses.filter(isDirectLegacyUse);
  const allowedKeys = new Set(allowedUses.map(useKey));
  const actualKeys = new Set(uses.map(useKey));

  return {
    ok: uses.every((use) => allowedKeys.has(useKey(use))),
    newUses: uses.filter((use) => !allowedKeys.has(useKey(use))),
    removedUses: allowedUses.filter(
      (use) => !actualKeys.has(useKey(use)),
    ),
  };
}

function isDirectLegacyUse(use: LegacyUse): boolean {
  return use.kind === "constructor" || use.kind === "global-reference";
}

function useKey(use: LegacyUse): string {
  return `${use.path}:${use.line}:${use.kind}:${use.symbol}`;
}
