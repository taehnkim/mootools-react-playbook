import { describe, expect, it } from "vitest";

import { addFindingFingerprint } from "../src/fingerprint.js";

describe("finding fingerprints", () => {
  it("is stable across evidence order", () => {
    const left = addFindingFingerprint({
      id: "tab-pane:event:change",
      kind: "event",
      summary: "Fires change.",
      evidence: [
        {
          path: "b.js",
          startLine: 2,
          endLine: 2,
          sourceHash: `sha256:${"b".repeat(64)}`,
        },
        {
          path: "a.js",
          startLine: 1,
          endLine: 1,
          sourceHash: `sha256:${"a".repeat(64)}`,
        },
      ],
      suggestedAction: "Preserve it.",
      contractRelevant: true,
      decisionRequired: true,
    });
    const right = addFindingFingerprint({
      ...left,
      evidence: [...left.evidence].reverse(),
      suggestedAction: "A changed suggestion does not stale a decision.",
    });

    expect(right.fingerprint).toBe(left.fingerprint);
  });

  it("changes when contract meaning changes", () => {
    const finding = addFindingFingerprint({
      id: "tab-pane:event:change",
      kind: "event",
      summary: "Fires change.",
      evidence: [
        {
          path: "a.js",
          startLine: 1,
          endLine: 1,
          sourceHash: `sha256:${"a".repeat(64)}`,
        },
      ],
      suggestedAction: "Preserve it.",
      contractRelevant: true,
      decisionRequired: true,
    });
    const changed = addFindingFingerprint({
      ...finding,
      summary: "Fires change with a stable ID.",
    });

    expect(changed.fingerprint).not.toBe(finding.fingerprint);
  });
});
