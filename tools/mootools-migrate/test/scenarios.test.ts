import { describe, expect, it } from "vitest";

import { RunIdSchema, ScenarioSchema } from "../src/schemas.js";

describe("scenario schema", () => {
  it("rejects duplicate step IDs and unknown assertion steps", () => {
    const result = ScenarioSchema.safeParse({
      id: "bad-scenario",
      fixture: "default",
      steps: [
        { stepId: "same", action: "observe" },
        { stepId: "same", action: "observe" },
      ],
      assertions: [
        {
          assertionId: "status",
          afterStepId: "missing",
          target: "status",
          kind: "text",
          matcher: "equals",
          expected: "ready",
        },
      ],
    });

    expect(result.success).toBe(false);
    if (result.success) {
      throw new Error("Invalid scenario passed validation.");
    }
    expect(result.error.issues.map((issue) => issue.message)).toEqual(
      expect.arrayContaining([
        "Duplicate stepId: same",
        "Unknown afterStepId: missing",
      ]),
    );
  });

  it("rejects run IDs that can escape an evidence directory", () => {
    expect(RunIdSchema.safeParse("../baseline").success).toBe(false);
    expect(RunIdSchema.safeParse("react-2026-08-07").success).toBe(true);
  });

  it("rejects scenario IDs that can escape screenshot storage", () => {
    const result = ScenarioSchema.safeParse({
      id: "../../assets",
      fixture: "default",
      steps: [{ stepId: "observe", action: "observe" }],
      assertions: [
        {
          assertionId: "image",
          afterStepId: "observe",
          target: "component",
          kind: "screenshot",
          matcher: "pixel-diff",
          name: "../outside",
          maxDiffRatio: 0,
        },
      ],
    });

    expect(result.success).toBe(false);
  });
});
