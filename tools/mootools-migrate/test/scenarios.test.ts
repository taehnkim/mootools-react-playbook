import { describe, expect, it } from "vitest";

import {
  ObservationSchema,
  RecordingComparisonSchema,
  RunIdSchema,
  ScenarioResultSchema,
  ScenarioSchema,
} from "../src/contracts/schemas.js";

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

  it("requires safe scenario video paths and SHA-256 hashes", () => {
    const hash = `sha256:${"0".repeat(64)}`;
    const result = {
      scenarioId: "visual-state",
      observations: [],
      videoPath: "recordings/visual-state.webm",
      videoHash: hash,
    };

    expect(ScenarioResultSchema.safeParse(result).success).toBe(true);
    expect(
      ScenarioResultSchema.safeParse({
        scenarioId: result.scenarioId,
        observations: result.observations,
      }).success,
    ).toBe(false);
    expect(
      ScenarioResultSchema.safeParse({
        ...result,
        videoPath: "../visual-state.webm",
      }).success,
    ).toBe(false);
    expect(
      ScenarioResultSchema.safeParse({
        ...result,
        videoHash: "not-a-sha256-hash",
      }).success,
    ).toBe(false);
  });

  it("requires the deterministic recording path for the scenario ID", () => {
    const hash = `sha256:${"0".repeat(64)}`;

    expect(
      ScenarioResultSchema.safeParse({
        scenarioId: "visual-state",
        observations: [],
        videoPath: "recordings/other-state.webm",
        videoHash: hash,
      }).success,
    ).toBe(false);
    expect(
      ScenarioResultSchema.parse({
        scenarioId: "visual-state",
        observations: [],
        videoPath: "recordings/visual-state.webm",
        videoHash: hash,
      }).videoPath,
    ).toBe("recordings/visual-state.webm");
  });

  it("requires safe paths and hashes for paired recordings", () => {
    const hash = `sha256:${"0".repeat(64)}`;
    const recording = {
      scenarioId: "visual-state",
      baselineVideoPath: "recordings/visual-state.webm",
      baselineVideoHash: hash,
      reactVideoPath: "recordings/visual-state.webm",
      reactVideoHash: hash,
    };

    expect(RecordingComparisonSchema.safeParse(recording).success).toBe(
      true,
    );
    expect(
      RecordingComparisonSchema.safeParse({
        ...recording,
        reactVideoPath: "../../outside.webm",
      }).success,
    ).toBe(false);
    expect(
      RecordingComparisonSchema.safeParse({
        ...recording,
        reactVideoHash: undefined,
      }).success,
    ).toBe(false);
  });

  it("rejects a positive screenshot tolerance", () => {
    const result = ScenarioSchema.safeParse({
      id: "visual-state",
      fixture: "default",
      steps: [{ stepId: "observe", action: "observe" }],
      assertions: [
        {
          assertionId: "component-image",
          afterStepId: "observe",
          target: "component",
          kind: "screenshot",
          matcher: "pixel-diff",
          name: "component",
          maxDiffRatio: 0.001,
        },
      ],
    });

    expect(result.success).toBe(false);
  });

  it("allows a scenario without exact visual proof", () => {
    const result = ScenarioSchema.safeParse({
      id: "approved-visual-difference",
      fixture: "default",
      steps: [{ stepId: "observe", action: "observe" }],
      assertions: [
        {
          assertionId: "component-count",
          afterStepId: "observe",
          target: "component",
          kind: "count",
          matcher: "equals",
          expected: 1,
        },
      ],
    });

    expect(result.success).toBe(true);
  });

  it("rejects duplicate screenshot names in one scenario", () => {
    const result = ScenarioSchema.safeParse({
      id: "duplicate-images",
      fixture: "default",
      steps: [{ stepId: "observe", action: "observe" }],
      assertions: [
        {
          assertionId: "first-image",
          afterStepId: "observe",
          target: "component",
          kind: "screenshot",
          matcher: "pixel-diff",
          name: "component",
          maxDiffRatio: 0,
        },
        {
          assertionId: "second-image",
          afterStepId: "observe",
          target: "component",
          kind: "screenshot",
          matcher: "pixel-diff",
          name: "component",
          maxDiffRatio: 0,
        },
      ],
    });

    expect(result.success).toBe(false);
    if (result.success) {
      throw new Error("Duplicate screenshot names passed validation.");
    }
    expect(result.error.issues.map((issue) => issue.message)).toContain(
      "Duplicate screenshot name: component",
    );
  });

  it("requires screenshot artifacts only for screenshot observations", () => {
    const hash = `sha256:${"0".repeat(64)}`;
    expect(
      ObservationSchema.safeParse({
        assertionId: "image",
        afterStepId: "observe",
        kind: "screenshot",
        actual: null,
        screenshotPath: null,
        screenshotHash: null,
      }).success,
    ).toBe(false);
    expect(
      ObservationSchema.safeParse({
        assertionId: "count",
        afterStepId: "observe",
        kind: "count",
        actual: 1,
        screenshotPath: "state/component.png",
        screenshotHash: hash,
      }).success,
    ).toBe(false);
  });
});
