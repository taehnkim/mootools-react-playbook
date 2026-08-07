import ts from "typescript";

import type { FindingKind } from "../contracts/schemas.js";
import { lineForNode } from "./source.js";

export type EvidenceLocation = {
  path: string;
  startLine: number;
  endLine: number;
};

export type FindingDraft = {
  id: string;
  kind: FindingKind;
  summary: string;
  evidence: EvidenceLocation[];
  suggestedAction: string;
  contractRelevant: boolean;
  decisionRequired: boolean;
};

export function addNodeDraft(options: {
  drafts: Map<string, FindingDraft>;
  sourceFile: ts.SourceFile;
  node: ts.Node;
  path: string;
  id: string;
  kind: FindingKind;
  summary: string;
  suggestedAction: string;
  contractRelevant: boolean;
  decisionRequired: boolean;
}): void {
  addDraft(options.drafts, {
    id: options.id,
    kind: options.kind,
    summary: options.summary,
    evidence: [
      {
        path: options.path,
        startLine: lineForNode(options.sourceFile, options.node),
        endLine:
          options.sourceFile.getLineAndCharacterOfPosition(options.node.end)
            .line + 1,
      },
    ],
    suggestedAction: options.suggestedAction,
    contractRelevant: options.contractRelevant,
    decisionRequired: options.decisionRequired,
  });
}

export function addDraft(
  drafts: Map<string, FindingDraft>,
  draft: FindingDraft,
): void {
  const existing = drafts.get(draft.id);
  if (existing === undefined) {
    drafts.set(draft.id, draft);
    return;
  }

  for (const location of draft.evidence) {
    if (
      !existing.evidence.some(
        (item) =>
          item.path === location.path &&
          item.startLine === location.startLine &&
          item.endLine === location.endLine,
      )
    ) {
      existing.evidence.push(location);
    }
  }
}

export function propertyName(
  name: ts.PropertyName | undefined,
): string | null {
  if (name === undefined) {
    return null;
  }
  if (
    ts.isIdentifier(name) ||
    ts.isStringLiteral(name) ||
    ts.isNumericLiteral(name)
  ) {
    return name.text;
  }
  return null;
}

export function stringValue(node: ts.Expression | undefined): string | null {
  return node !== undefined && ts.isStringLiteralLike(node) ? node.text : null;
}

export function slug(value: string): string {
  const result = value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
  return result === "" ? "value" : result;
}
