import { componentArtifactPath, type ToolContext } from "../core/context.js";
import { readJson, writeJson } from "../core/json.js";
import {
  MigrationSpecSchema,
  JsonValueSchema,
  WorksheetSchema,
  type MigrationSpec,
  type Decisions,
  type Worksheet,
} from "../contracts/schemas.js";

export type DecisionCheck = {
  ok: boolean;
  issues: string[];
};

export async function loadWorksheet(options: {
  context: ToolContext;
  componentId: string;
}): Promise<Worksheet> {
  return readJson(
    componentArtifactPath(
      options.context,
      options.componentId,
      "worksheet.generated.json",
    ),
    WorksheetSchema,
  );
}

export function createDecisionDraft(
  worksheet: Worksheet,
): Decisions {
  return worksheet.findings
    .filter((finding) => finding.decisionRequired)
    .map((finding) => ({
      findingId: finding.id,
      findingFingerprint: finding.fingerprint,
      resolution: "preserve" as const,
      rationale: `TODO: confirm how to handle ${finding.summary}`,
      approval: { status: "pending" as const },
    }));
}

export async function writeDecisionStubsIfEmpty(options: {
  context: ToolContext;
  config: MigrationSpec;
  worksheet: Worksheet;
}): Promise<boolean> {
  if (options.config.decisions.length > 0) {
    return false;
  }
  const path = componentArtifactPath(
    options.context,
    options.config.id,
    "migration.json",
  );
  const config = MigrationSpecSchema.parse({
    ...options.config,
    decisions: createDecisionDraft(options.worksheet),
  });
  await writeJson(path, JsonValueSchema.parse(config));
  return true;
}

export function checkDecisions(options: {
  worksheet: Worksheet;
  decisions: Decisions;
}): DecisionCheck {
  const issues: string[] = [];
  const decisionsById = new Map(
    options.decisions.map((decision) => [
      decision.findingId,
      decision,
    ]),
  );

  for (const finding of options.worksheet.findings) {
    if (!finding.decisionRequired) {
      continue;
    }
    const decision = decisionsById.get(finding.id);
    if (decision === undefined) {
      issues.push(`Missing decision for ${finding.id}.`);
      continue;
    }
    if (decision.findingFingerprint !== finding.fingerprint) {
      issues.push(`Stale decision fingerprint for ${finding.id}.`);
    }
    if (decision.rationale.startsWith("TODO:")) {
      issues.push(`Decision rationale is unresolved for ${finding.id}.`);
    }
    if (decision.approval.status !== "approved") {
      issues.push(`Human approval is pending for ${finding.id}.`);
    } else if (
      decision.approval.findingFingerprint !== finding.fingerprint
    ) {
      issues.push(`Human approval is stale for ${finding.id}.`);
    }
  }

  const findingIds = new Set(
    options.worksheet.findings.map((finding) => finding.id),
  );
  for (const decision of options.decisions) {
    if (!findingIds.has(decision.findingId)) {
      issues.push(`Decision has no current finding: ${decision.findingId}.`);
    }
  }

  return { ok: issues.length === 0, issues };
}
