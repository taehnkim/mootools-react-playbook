import { access } from "node:fs/promises";

import { componentArtifactPath, type ToolContext } from "./context.js";
import { readJson, writeJson } from "./json.js";
import {
  DecisionsFileSchema,
  JsonValueSchema,
  WorksheetSchema,
  type DecisionsFile,
  type Worksheet,
} from "./schemas.js";

export type DecisionCheck = {
  ok: boolean;
  issues: string[];
};

export async function loadWorksheet(options: {
  context: ToolContext;
  componentId: string;
}): Promise<Worksheet> {
  const generatedPath = componentArtifactPath(
    options.context,
    options.componentId,
    "worksheet.generated.json",
  );
  const manualPath = componentArtifactPath(
    options.context,
    options.componentId,
    "worksheet.json",
  );
  const path = (await fileExists(generatedPath)) ? generatedPath : manualPath;
  return readJson(path, WorksheetSchema);
}

export async function loadDecisions(options: {
  context: ToolContext;
  componentId: string;
}): Promise<DecisionsFile> {
  return readJson(
    componentArtifactPath(
      options.context,
      options.componentId,
      "decisions.json",
    ),
    DecisionsFileSchema,
  );
}

export function createDecisionDraft(
  worksheet: Worksheet,
): DecisionsFile {
  return DecisionsFileSchema.parse({
    schemaVersion: 1,
    componentId: worksheet.componentId,
    decisions: worksheet.findings
      .filter((finding) => finding.decisionRequired)
      .map((finding) => ({
        findingId: finding.id,
        findingFingerprint: finding.fingerprint,
        resolution: "preserve",
        rationale: `TODO: confirm how to handle ${finding.summary}`,
        requiresHumanApproval: finding.contractRelevant,
        approval: finding.contractRelevant
          ? { status: "pending" }
          : { status: "not-required" },
      })),
  });
}

export async function writeDecisionDraft(options: {
  context: ToolContext;
  decisions: DecisionsFile;
  force: boolean;
}): Promise<string> {
  const path = componentArtifactPath(
    options.context,
    options.decisions.componentId,
    "decisions.json",
  );
  if (!options.force && (await fileExists(path))) {
    throw new Error(
      `Decision file already exists: ${path}. Use --force only after review.`,
    );
  }
  await writeJson(path, JsonValueSchema.parse(options.decisions));
  return path;
}

export function checkDecisions(options: {
  worksheet: Worksheet;
  decisions: DecisionsFile;
}): DecisionCheck {
  const issues: string[] = [];
  const decisionsById = new Map(
    options.decisions.decisions.map((decision) => [
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
    if (decision.requiresHumanApproval !== finding.contractRelevant) {
      issues.push(
        `Decision approval requirement differs from finding contract relevance for ${finding.id}.`,
      );
    }
    if (finding.contractRelevant) {
      if (decision.approval.status !== "approved") {
        issues.push(`Human approval is pending for ${finding.id}.`);
      } else if (
        decision.approval.findingFingerprint !== finding.fingerprint
      ) {
        issues.push(`Human approval is stale for ${finding.id}.`);
      }
    }
  }

  const findingIds = new Set(
    options.worksheet.findings.map((finding) => finding.id),
  );
  for (const decision of options.decisions.decisions) {
    if (!findingIds.has(decision.findingId)) {
      issues.push(`Decision has no current finding: ${decision.findingId}.`);
    }
  }

  return { ok: issues.length === 0, issues };
}

async function fileExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}
