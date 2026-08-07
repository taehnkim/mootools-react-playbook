import { componentArtifactPath, type ToolContext } from "./context.js";
import { readJson } from "./json.js";
import {
  LegacyUseAllowlistSchema,
  type ComponentConfig,
  type LegacyUse,
  type LegacyUseAllowlist,
} from "./schemas.js";
import { findLegacyUses } from "./source.js";

export type LegacyUseCheck = {
  ok: boolean;
  newUses: LegacyUse[];
  removedUses: LegacyUse[];
};

export async function loadLegacyUseAllowlist(options: {
  context: ToolContext;
  componentId: string;
}): Promise<LegacyUseAllowlist> {
  return readJson(
    componentArtifactPath(
      options.context,
      options.componentId,
      "legacy-use-allowlist.json",
    ),
    LegacyUseAllowlistSchema,
  );
}

export async function checkNoNewUse(options: {
  context: ToolContext;
  config: ComponentConfig;
  allowlist: LegacyUseAllowlist;
}): Promise<LegacyUseCheck> {
  const uses = await findLegacyUses({
    projectRoot: options.context.projectRoot,
    config: options.config,
  });
  const allowedKeys = new Set(options.allowlist.allowedUses.map(useKey));
  const actualKeys = new Set(uses.map(useKey));

  return {
    ok: uses.every((use) => allowedKeys.has(useKey(use))),
    newUses: uses.filter((use) => !allowedKeys.has(useKey(use))),
    removedUses: options.allowlist.allowedUses.filter(
      (use) => !actualKeys.has(useKey(use)),
    ),
  };
}

function useKey(use: LegacyUse): string {
  return `${use.path}:${use.line}:${use.kind}:${use.symbol}`;
}
