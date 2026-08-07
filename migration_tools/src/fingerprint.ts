import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { hashJson, sha256 } from "./json.js";
import type {
  AcceptedDifference,
  Evidence,
  Finding,
  JsonValue,
} from "./schemas.js";

export async function createEvidence(options: {
  projectRoot: string;
  path: string;
  startLine: number;
  endLine: number;
}): Promise<Evidence> {
  const source = await readFile(resolve(options.projectRoot, options.path), "utf8");
  const lines = source.split(/\r?\n/);
  const sourceSlice = lines
    .slice(options.startLine - 1, options.endLine)
    .join("\n");
  return {
    path: options.path,
    startLine: options.startLine,
    endLine: options.endLine,
    sourceHash: sha256(sourceSlice),
  };
}

export function addFindingFingerprint(
  finding: Omit<Finding, "fingerprint">,
): Finding {
  const evidence: JsonValue[] = [...finding.evidence]
    .sort(compareEvidence)
    .map((item) => ({
      path: item.path,
      startLine: item.startLine,
      endLine: item.endLine,
      sourceHash: item.sourceHash,
    }));
  const fingerprintInput: JsonValue = {
    schemaVersion: 1,
    id: finding.id,
    kind: finding.kind,
    summary: finding.summary,
    contractRelevant: finding.contractRelevant,
    decisionRequired: finding.decisionRequired,
    evidence,
  };
  return {
    ...finding,
    fingerprint: hashJson(fingerprintInput),
  };
}

export async function hashProjectFiles(options: {
  projectRoot: string;
  paths: string[];
}): Promise<string> {
  const files: JsonValue[] = [];
  for (const path of [...options.paths].sort()) {
    const source = await readFile(resolve(options.projectRoot, path));
    files.push({ path, hash: sha256(source) });
  }
  return hashJson(files);
}

export function acceptedDifferenceFingerprint(
  difference: Omit<AcceptedDifference, "fingerprint" | "approval">,
): string {
  return hashJson({
    schemaVersion: 1,
    id: difference.id,
    decisionFingerprint: difference.decisionFingerprint,
    scenarioId: difference.scenarioId,
    stepId: difference.stepId,
    assertionId: difference.assertionId,
    legacyValue: difference.legacyValue,
    reactValue: difference.reactValue,
    reason: difference.reason,
  });
}

function compareEvidence(left: Evidence, right: Evidence): number {
  return (
    left.path.localeCompare(right.path) ||
    left.startLine - right.startLine ||
    left.endLine - right.endLine
  );
}
