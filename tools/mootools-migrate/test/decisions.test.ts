import { describe, expect, it } from "vitest";

import { checkDecisions } from "../src/checks/decisions.js";
import { addFindingFingerprint } from "../src/core/fingerprint.js";
import { DecisionsSchema, WorksheetSchema } from "../src/contracts/schemas.js";

const finding = addFindingFingerprint({
  id: "tab-pane:event:change",
  kind: "event",
  summary: "Fires change.",
  evidence: [
    {
      path: "TabPane.js",
      startLine: 1,
      endLine: 1,
      sourceHash: `sha256:${"a".repeat(64)}`,
    },
  ],
  suggestedAction: "Preserve it.",
  contractRelevant: true,
  decisionRequired: true,
});

const worksheet = WorksheetSchema.parse({
  schemaVersion: 1,
  componentId: "tab-pane",
  source: "analyzer",
  analyzerVersion: "test",
  inputHash: `sha256:${"b".repeat(64)}`,
  generatedAt: "2026-01-01T00:00:00.000Z",
  findings: [finding],
  coverage: [],
});

describe("decision checks", () => {
  it("accepts a matching human approval", () => {
    const decisions = DecisionsSchema.parse([
        {
          findingId: finding.id,
          findingFingerprint: finding.fingerprint,
          resolution: "preserve",
          rationale: "The current caller observes this event.",
          approval: {
            status: "approved",
            approvedBy: "test-user",
            approvedAt: "2026-01-01T00:00:00.000Z",
            findingFingerprint: finding.fingerprint,
          },
        },
    ]);

    expect(checkDecisions({ worksheet, decisions })).toEqual({
      ok: true,
      issues: [],
    });
  });

  it("rejects pending and stale decisions", () => {
    const decisions = DecisionsSchema.parse([
        {
          findingId: finding.id,
          findingFingerprint: `sha256:${"c".repeat(64)}`,
          resolution: "preserve",
          rationale: "TODO: decide",
          approval: { status: "pending" },
        },
    ]);
    const result = checkDecisions({ worksheet, decisions });

    expect(result.ok).toBe(false);
    expect(result.issues).toEqual(
      expect.arrayContaining([
        expect.stringContaining("Stale decision"),
        expect.stringContaining("unresolved"),
        expect.stringContaining("pending"),
      ]),
    );
  });

  it("requires approval for every human decision", () => {
    const decisions = DecisionsSchema.parse([
        {
          findingId: finding.id,
          findingFingerprint: finding.fingerprint,
          resolution: "preserve",
          rationale: "Keep the event.",
          approval: { status: "pending" },
        },
    ]);
    const result = checkDecisions({ worksheet, decisions });

    expect(result.ok).toBe(false);
    expect(result.issues).toContain(
      `Human approval is pending for ${finding.id}.`,
    );
  });
});
