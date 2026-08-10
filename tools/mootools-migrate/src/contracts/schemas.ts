import { z } from "zod";

export type JsonValue =
  | null
  | boolean
  | number
  | string
  | JsonValue[]
  | { [key: string]: JsonValue };

export const JsonValueSchema: z.ZodType<JsonValue> = z.lazy(() =>
  z.union([
    z.null(),
    z.boolean(),
    z.number(),
    z.string(),
    z.array(JsonValueSchema),
    z.record(z.string(), JsonValueSchema),
  ]),
);

const RelativePathSchema = z.string().min(1).superRefine((value, context) => {
  if (
    value.startsWith("/") ||
    value.includes("\\") ||
    value.split("/").some((segment) => segment === ".." || segment === "")
  ) {
    context.addIssue({
      code: "custom",
      message: `Expected a safe relative path, received ${value}.`,
    });
  }
});
const ProjectGlobSchema = z.string().min(1).superRefine((value, context) => {
  if (
    value.startsWith("/") ||
    value.includes("\\") ||
    value.split("/").some((segment) => segment === ".." || segment === "")
  ) {
    context.addIssue({
      code: "custom",
      message: `Expected a safe project glob, received ${value}.`,
    });
  }
});
const RelativeImportSchema = z
  .string()
  .startsWith("./")
  .superRefine((value, context) => {
    if (
      value.includes("\\") ||
      value.split("/").some((segment) => segment === "..")
    ) {
      context.addIssue({
        code: "custom",
        message: `Expected a safe relative import, received ${value}.`,
      });
    }
  });
const IdentifierSchema = z.string().regex(/^[A-Za-z_$][A-Za-z0-9_$]*$/);
export const ComponentIdSchema = z
  .string()
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);
const Sha256Schema = z.string().regex(/^sha256:[a-f0-9]{64}$/);
export const RunIdSchema = z
  .string()
  .regex(/^[a-zA-Z0-9]+(?:[._-][a-zA-Z0-9]+)*$/);
export const ArtifactIdSchema = z
  .string()
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);

export function scenarioVideoPath(scenarioId: string): string {
  return `recordings/${ArtifactIdSchema.parse(scenarioId)}.webm`;
}

const MigrationDefinitionSchema = z.object({
  schemaVersion: z.literal(1),
  id: ComponentIdSchema,
  legacyGlobal: z.string().min(1),
  sourceFiles: z.array(RelativePathSchema).min(1),
  cssFiles: z.array(RelativePathSchema),
  markupFiles: z.array(
    z.object({
      path: RelativePathSchema,
      rootSelector: z.string().min(1),
    }),
  ),
  bootstrapFiles: z.array(RelativePathSchema),
  callsiteGlobs: z.array(ProjectGlobSchema).min(1),
  tests: z.object({
    legacyFile: RelativePathSchema,
    legacyDependencies: z.array(RelativePathSchema),
    reactFile: RelativePathSchema,
    reactDependencies: z.array(RelativePathSchema),
  }),
  fixtureBridge: z.object({
    windowValueKey: z.string().min(1),
    windowIdKey: z.string().min(1),
    legacyStaticFixtureId: z.string().min(1),
    reactAcknowledgementPath: z.array(z.string().min(1)).min(1),
  }),
  implementationBridge: z.object({
    windowKey: z.string().min(1),
    legacyValue: z.string().min(1),
    reactValue: z.string().min(1),
  }),
  legacy: z.object({
    entryPath: z.string().startsWith("/"),
    readyPath: z.array(z.string().min(1)).min(1),
    eventNames: z.array(z.string().min(1)),
    proofFiles: z.array(RelativePathSchema).min(1),
  }),
  react: z.object({
    entryPath: z.string().startsWith("/"),
    readySelector: z.string().min(1),
    handlePath: z.array(z.string().min(1)).nullable(),
    componentPath: RelativePathSchema,
    proofFiles: z.array(RelativePathSchema).min(1),
  }),
  viewport: z.object({
    width: z.number().int().positive(),
    height: z.number().int().positive(),
  }),
  adapter: z.object({
    globalName: z.string().min(1),
    selectionKey: z.string().min(1),
    legacyValue: z.string().min(1),
    reactValue: z.string().min(1),
    featureFlaggerGlobal: z.string().min(1),
    featureFlaggerImportPath: RelativeImportSchema,
    reactMountGlobal: z.string().min(1),
    outputPath: RelativePathSchema,
    callsiteFiles: z.array(RelativePathSchema).min(1),
    bootstrapFile: RelativePathSchema,
    bootstrapImportPath: RelativeImportSchema,
    bootstrapImportLocal: IdentifierSchema,
  }),
});

export const FindingKindSchema = z.enum([
  "public-input",
  "public-method",
  "event",
  "event-listener",
  "dom-read",
  "dom-write",
  "selector",
  "style",
  "markup",
  "state",
  "lifecycle",
  "timer",
  "network",
  "api-call",
  "storage",
  "global",
  "dependency",
  "import",
  "side-effect",
  "caller",
  "unknown",
]);

export type FindingKind = z.infer<typeof FindingKindSchema>;

export const EvidenceSchema = z.object({
  path: RelativePathSchema,
  startLine: z.number().int().positive(),
  endLine: z.number().int().positive(),
  sourceHash: Sha256Schema,
});

export type Evidence = z.infer<typeof EvidenceSchema>;

export const FindingSchema = z.object({
  id: z.string().min(1),
  fingerprint: Sha256Schema,
  kind: FindingKindSchema,
  summary: z.string().min(1),
  evidence: z.array(EvidenceSchema).min(1),
  suggestedAction: z.string().min(1),
  contractRelevant: z.boolean(),
  decisionRequired: z.boolean(),
});

export type Finding = z.infer<typeof FindingSchema>;

export const AnalysisCategorySchema = z.enum([
  "events",
  "selectors",
  "api-calls",
  "dom",
  "side-effects",
  "dependencies",
  "callsites",
  "imports",
  "markup",
  "css",
  "timers",
  "storage",
  "globals",
]);

export type AnalysisCategory = z.infer<typeof AnalysisCategorySchema>;

export const AnalysisCoverageSchema = z.object({
  category: AnalysisCategorySchema,
  filesScanned: z.array(RelativePathSchema),
  findingCount: z.number().int().nonnegative(),
  limitations: z.array(z.string()),
});

export const WorksheetSchema = z.object({
  schemaVersion: z.literal(1),
  componentId: ComponentIdSchema,
  source: z.literal("analyzer"),
  analyzerVersion: z.string().min(1),
  inputHash: Sha256Schema,
  generatedAt: z.string().datetime(),
  findings: z.array(FindingSchema),
  coverage: z.array(AnalysisCoverageSchema),
});

export type Worksheet = z.infer<typeof WorksheetSchema>;

export const ApprovalSchema = z.discriminatedUnion("status", [
  z.object({ status: z.literal("pending") }),
  z.object({
    status: z.literal("approved"),
    approvedBy: z.string().min(1),
    approvedAt: z.string().datetime(),
    findingFingerprint: Sha256Schema,
  }),
]);

export const DecisionSchema = z.object({
  findingId: z.string().min(1),
  findingFingerprint: Sha256Schema,
  resolution: z.enum(["preserve", "replace", "fix", "delete"]),
  rationale: z.string().min(1),
  approval: ApprovalSchema,
});

export type Decision = z.infer<typeof DecisionSchema>;

export const DecisionsSchema = z.array(DecisionSchema);
export type Decisions = z.infer<typeof DecisionsSchema>;

export const FixturesSchema = z.record(z.string().min(1), JsonValueSchema);
export type Fixtures = z.infer<typeof FixturesSchema>;

export const SelectorsSchema = z.record(
  z.string().min(1),
  z.object({
    legacy: z.string().min(1),
    react: z.string().min(1),
  }),
);

export type Selectors = z.infer<typeof SelectorsSchema>;
export type SelectorMap = {
  surface: "legacy" | "react";
  selectors: Record<string, string>;
};

export const ScenarioActionSchema = z.discriminatedUnion("action", [
  z.object({
    stepId: z.string().min(1),
    action: z.literal("observe"),
  }),
  z.object({
    stepId: z.string().min(1),
    action: z.literal("click"),
    target: z.string().min(1),
  }),
  z.object({
    stepId: z.string().min(1),
    action: z.literal("fill"),
    target: z.string().min(1),
    value: z.string(),
  }),
  z.object({
    stepId: z.string().min(1),
    action: z.literal("press"),
    target: z.string().min(1),
    key: z.string().min(1),
  }),
  z.object({
    stepId: z.string().min(1),
    action: z.literal("call"),
    method: z.string().min(1),
    args: z.array(JsonValueSchema),
  }),
]);

export type ScenarioAction = z.infer<typeof ScenarioActionSchema>;

const AssertionBaseSchema = z.object({
  assertionId: ArtifactIdSchema,
  afterStepId: z.string().min(1),
  target: z.string().min(1),
});

export const AssertionKindSchema = z.enum([
  "count",
  "text",
  "class",
  "visible",
  "focus",
  "attribute",
  "computed-style",
  "event-trace",
  "screenshot",
]);

export const ScenarioAssertionSchema = z.discriminatedUnion("kind", [
  AssertionBaseSchema.extend({
    kind: z.literal("count"),
    matcher: z.literal("equals"),
    expected: z.number().int().nonnegative(),
  }),
  AssertionBaseSchema.extend({
    kind: z.literal("text"),
    matcher: z.enum(["equals", "contains"]),
    expected: z.string(),
  }),
  AssertionBaseSchema.extend({
    kind: z.literal("class"),
    matcher: z.literal("present"),
    className: z.string().min(1),
    expected: z.boolean(),
  }),
  AssertionBaseSchema.extend({
    kind: z.literal("visible"),
    matcher: z.literal("equals"),
    expected: z.boolean(),
  }),
  AssertionBaseSchema.extend({
    kind: z.literal("focus"),
    matcher: z.literal("equals"),
    expected: z.boolean(),
  }),
  AssertionBaseSchema.extend({
    kind: z.literal("attribute"),
    matcher: z.literal("equals"),
    attribute: z.string().min(1),
    expected: z.string().nullable(),
  }),
  AssertionBaseSchema.extend({
    kind: z.literal("computed-style"),
    matcher: z.literal("equals"),
    property: z.string().min(1),
    expected: z.string(),
  }),
  z.object({
    assertionId: ArtifactIdSchema,
    afterStepId: z.string().min(1),
    target: z.literal("$events"),
    kind: z.literal("event-trace"),
    matcher: z.literal("equals"),
    expected: z.array(
      z.object({
        name: z.string().min(1),
        args: z.array(JsonValueSchema),
      }),
    ),
  }),
  AssertionBaseSchema.extend({
    kind: z.literal("screenshot"),
    matcher: z.literal("pixel-diff"),
    name: ArtifactIdSchema,
    maxDiffRatio: z.literal(0),
  }),
]);

export type ScenarioAssertion = z.infer<typeof ScenarioAssertionSchema>;

export const ScenarioSchema = z
  .object({
    id: ArtifactIdSchema,
    fixture: z.string().min(1),
    steps: z.array(ScenarioActionSchema).min(1),
    assertions: z.array(ScenarioAssertionSchema).min(1),
  })
  .superRefine((scenario, context) => {
    const stepIds = new Set<string>();
    for (const step of scenario.steps) {
      if (stepIds.has(step.stepId)) {
        context.addIssue({
          code: "custom",
          message: `Duplicate stepId: ${step.stepId}`,
        });
      }
      stepIds.add(step.stepId);
    }

    const assertionIds = new Set<string>();
    const screenshotNames = new Set<string>();
    for (const assertion of scenario.assertions) {
      if (assertionIds.has(assertion.assertionId)) {
        context.addIssue({
          code: "custom",
          message: `Duplicate assertionId: ${assertion.assertionId}`,
        });
      }
      assertionIds.add(assertion.assertionId);
      if (assertion.kind === "screenshot") {
        if (screenshotNames.has(assertion.name)) {
          context.addIssue({
            code: "custom",
            message: `Duplicate screenshot name: ${assertion.name}`,
          });
        }
        screenshotNames.add(assertion.name);
      }
      if (!stepIds.has(assertion.afterStepId)) {
        context.addIssue({
          code: "custom",
          message: `Unknown afterStepId: ${assertion.afterStepId}`,
        });
      }
    }
  });

export const ScenariosSchema = z
  .array(ScenarioSchema)
  .min(1)
  .superRefine((scenarios, context) => {
    const ids = new Set<string>();
    for (const scenario of scenarios) {
      if (ids.has(scenario.id)) {
        context.addIssue({
          code: "custom",
          message: `Duplicate scenario ID: ${scenario.id}`,
        });
      }
      ids.add(scenario.id);
    }
  });
export type Scenarios = z.infer<typeof ScenariosSchema>;
export type Scenario = z.infer<typeof ScenarioSchema>;

export const AcceptedDifferenceSchema = z.object({
  id: z.string().min(1),
  fingerprint: Sha256Schema,
  decisionFingerprint: Sha256Schema,
  scenarioId: z.string().min(1),
  stepId: z.string().min(1),
  assertionId: z.string().min(1),
  legacyValue: JsonValueSchema,
  reactValue: JsonValueSchema,
  reason: z.string().min(1),
  approval: z.discriminatedUnion("status", [
    z.object({ status: z.literal("pending") }),
    z.object({
      status: z.literal("approved"),
      approvedBy: z.string().min(1),
      approvedAt: z.string().datetime(),
      differenceFingerprint: Sha256Schema,
    }),
  ]),
});

export type AcceptedDifference = z.infer<typeof AcceptedDifferenceSchema>;

export const AcceptedDifferencesSchema = z.array(AcceptedDifferenceSchema);
export type AcceptedDifferences = z.infer<
  typeof AcceptedDifferencesSchema
>;

export const LegacyUseSchema = z.object({
  path: RelativePathSchema,
  kind: z.enum(["constructor", "global-reference", "adapter-call"]),
  symbol: z.string().min(1),
  line: z.number().int().positive(),
});

export type LegacyUse = z.infer<typeof LegacyUseSchema>;

export const EventRecordSchema = z.object({
  name: z.string().min(1),
  args: z.array(JsonValueSchema),
});

export type EventRecord = z.infer<typeof EventRecordSchema>;

const NonScreenshotAssertionKindSchema = z.enum([
  "count",
  "text",
  "class",
  "visible",
  "focus",
  "attribute",
  "computed-style",
  "event-trace",
]);

const ObservationBaseSchema = z.object({
  assertionId: z.string().min(1),
  afterStepId: z.string().min(1),
});

export const ObservationSchema = z.discriminatedUnion("kind", [
  ObservationBaseSchema.extend({
    kind: NonScreenshotAssertionKindSchema,
    actual: JsonValueSchema,
    screenshotPath: z.null(),
    screenshotHash: z.null(),
  }),
  ObservationBaseSchema.extend({
    kind: z.literal("screenshot"),
    actual: z.null(),
    screenshotPath: RelativePathSchema,
    screenshotHash: Sha256Schema,
  }),
]);

export type Observation = z.infer<typeof ObservationSchema>;

export const ScenarioResultSchema = z
  .object({
    scenarioId: ArtifactIdSchema,
    observations: z.array(ObservationSchema),
    videoPath: RelativePathSchema,
    videoHash: Sha256Schema,
  })
  .superRefine((result, context) => {
    const expectedPath = scenarioVideoPath(result.scenarioId);
    if (result.videoPath !== expectedPath) {
      context.addIssue({
        code: "custom",
        path: ["videoPath"],
        message: `Expected scenario video path ${expectedPath}.`,
      });
    }
  });

export type ScenarioResult = z.infer<typeof ScenarioResultSchema>;

export const ComponentTestSurfaceSchema = z.enum(["legacy", "react"]);
export type ComponentTestSurface = z.infer<
  typeof ComponentTestSurfaceSchema
>;

export const ComponentTestResultSchema = z.object({
  surface: ComponentTestSurfaceSchema,
  command: z.string().min(1),
  passed: z.boolean(),
  output: z.string(),
  inputHash: Sha256Schema,
});
export type ComponentTestResult = z.infer<
  typeof ComponentTestResultSchema
>;

export const ProjectCheckResultSchema = z.object({
  command: z.string().min(1),
  ok: z.boolean(),
  output: z.string(),
});
export type ProjectCheckResult = z.infer<
  typeof ProjectCheckResultSchema
>;

export const CaptureChecksSchema = z.object({
  componentTests: z.array(ComponentTestResultSchema),
  projectChecks: z.array(ProjectCheckResultSchema),
});
export type CaptureChecks = z.infer<typeof CaptureChecksSchema>;

export const CaptureManifestSchema = z
  .object({
    schemaVersion: z.literal(2),
    runId: RunIdSchema,
    componentId: ComponentIdSchema,
    surface: ComponentTestSurfaceSchema,
    createdAt: z.string().datetime(),
    baseUrl: z.string().url(),
    projectInputHash: Sha256Schema,
    captureConfigHash: Sha256Schema,
    scenariosHash: Sha256Schema,
    fixturesHash: Sha256Schema,
    selectorsHash: Sha256Schema,
    browserVersion: z.string().min(1),
    viewport: z.object({
      width: z.number().int().positive(),
      height: z.number().int().positive(),
    }),
    checks: CaptureChecksSchema,
    results: z.array(ScenarioResultSchema),
  })
  .superRefine((manifest, context) => {
    const testSurfaces = manifest.checks.componentTests.map(
      (test) => test.surface,
    );
    if (manifest.checks.componentTests.some((test) => !test.passed)) {
      context.addIssue({
        code: "custom",
        path: ["checks", "componentTests"],
        message: "Capture evidence cannot contain a failed component test.",
      });
    }
    if (manifest.checks.projectChecks.some((check) => !check.ok)) {
      context.addIssue({
        code: "custom",
        path: ["checks", "projectChecks"],
        message: "Capture evidence cannot contain a failed project check.",
      });
    }
    if (
      manifest.surface === "legacy" &&
      (testSurfaces.length !== 1 ||
        testSurfaces[0] !== "legacy" ||
        manifest.checks.projectChecks.length !== 0)
    ) {
      context.addIssue({
        code: "custom",
        path: ["checks"],
        message:
          "Legacy captures require one legacy component test and no project checks.",
      });
    }
    if (
      manifest.surface === "react" &&
      (testSurfaces.length !== 2 ||
        !testSurfaces.includes("legacy") ||
        !testSurfaces.includes("react") ||
        manifest.checks.projectChecks.length === 0)
    ) {
      context.addIssue({
        code: "custom",
        path: ["checks"],
        message:
          "React captures require legacy and React component tests plus project checks.",
      });
    }
  });

export type CaptureManifest = z.infer<typeof CaptureManifestSchema>;

export const ParityMismatchSchema = z.object({
  scenarioId: z.string().min(1),
  assertionId: z.string().min(1),
  reason: z.string().min(1),
  legacyValue: JsonValueSchema,
  reactValue: JsonValueSchema,
});

const ScreenshotSizeSchema = z.object({
  width: z.number().int().positive(),
  height: z.number().int().positive(),
});

export const ImageComparisonSchema = z.object({
  scenarioId: ArtifactIdSchema,
  stepId: z.string().min(1),
  assertionId: ArtifactIdSchema,
  baselineScreenshotPath: RelativePathSchema,
  baselineScreenshotHash: Sha256Schema,
  baselineScreenshotSize: ScreenshotSizeSchema,
  reactScreenshotPath: RelativePathSchema,
  reactScreenshotHash: Sha256Schema,
  reactScreenshotSize: ScreenshotSizeSchema,
  diffPath: RelativePathSchema,
  diffHash: Sha256Schema,
  totalPixels: z.number().int().positive(),
  changedPixels: z.number().int().nonnegative(),
  diffRatio: z.number().min(0).max(1),
  allowedChangedPixels: z.literal(0),
  exact: z.boolean(),
});
export type ImageComparison = z.infer<typeof ImageComparisonSchema>;

export const RecordingComparisonSchema = z
  .object({
    scenarioId: ArtifactIdSchema,
    baselineVideoPath: RelativePathSchema,
    baselineVideoHash: Sha256Schema,
    reactVideoPath: RelativePathSchema,
    reactVideoHash: Sha256Schema,
  })
  .superRefine((recording, context) => {
    const expectedPath = scenarioVideoPath(recording.scenarioId);
    if (recording.baselineVideoPath !== expectedPath) {
      context.addIssue({
        code: "custom",
        path: ["baselineVideoPath"],
        message: `Expected baseline video path ${expectedPath}.`,
      });
    }
    if (recording.reactVideoPath !== expectedPath) {
      context.addIssue({
        code: "custom",
        path: ["reactVideoPath"],
        message: `Expected React video path ${expectedPath}.`,
      });
    }
  });

export type RecordingComparison = z.infer<
  typeof RecordingComparisonSchema
>;

export const ParityResultSchema = z.object({
  status: z.enum(["PARITY", "MISMATCH"]),
  attested: z.boolean(),
  runId: RunIdSchema,
  createdAt: z.string().datetime(),
  baselineManifestHash: Sha256Schema,
  candidateManifestHash: Sha256Schema,
  decisionsHash: Sha256Schema,
  acceptedDifferencesHash: Sha256Schema,
  scenariosHash: Sha256Schema,
  mismatches: z.array(ParityMismatchSchema),
  recordings: z.array(RecordingComparisonSchema),
  imageComparisons: z.array(ImageComparisonSchema),
  acceptedDifferencesUsed: z.array(ArtifactIdSchema),
});

export type ParityResultData = z.infer<typeof ParityResultSchema>;

export const MigrationSpecSchema = MigrationDefinitionSchema.extend({
  fixtures: FixturesSchema,
  scenarios: ScenariosSchema,
  selectors: SelectorsSchema,
  decisions: DecisionsSchema,
  acceptedDifferences: AcceptedDifferencesSchema,
  allowedLegacyUses: z.array(LegacyUseSchema),
}).superRefine((config, context) => {
  const scenarios = new Map(
    config.scenarios.map((scenario) => [scenario.id, scenario]),
  );
  for (const scenario of config.scenarios) {
    const terminalStep = scenario.steps.at(-1);
    const hasTerminalScreenshot =
      terminalStep !== undefined &&
      scenario.assertions.some(
        (assertion) =>
          assertion.kind === "screenshot" &&
          assertion.afterStepId === terminalStep.stepId,
      );
    const hasApprovedDifference = config.acceptedDifferences.some(
      (difference) =>
        difference.scenarioId === scenario.id &&
        difference.approval.status === "approved",
    );
    if (!hasTerminalScreenshot && !hasApprovedDifference) {
      context.addIssue({
        code: "custom",
        path: ["scenarios"],
        message: `Scenario ${scenario.id} requires a terminal screenshot or an approved difference.`,
      });
    }
    if (config.fixtures[scenario.fixture] === undefined) {
      context.addIssue({
        code: "custom",
        message: `Scenario ${scenario.id} uses unknown fixture ${scenario.fixture}.`,
      });
    }
    for (const step of scenario.steps) {
      if (
        (step.action === "click" ||
          step.action === "fill" ||
          step.action === "press") &&
        config.selectors[step.target] === undefined
      ) {
        context.addIssue({
          code: "custom",
          message: `Scenario ${scenario.id} uses unknown target ${step.target}.`,
        });
      }
    }
    for (const assertion of scenario.assertions) {
      if (
        assertion.target !== "$events" &&
        config.selectors[assertion.target] === undefined
      ) {
        context.addIssue({
          code: "custom",
          message: `Scenario ${scenario.id} uses unknown target ${assertion.target}.`,
        });
      }
    }
  }
  for (const difference of config.acceptedDifferences) {
    if (
      difference.scenarioId.includes("*") ||
      difference.stepId.includes("*") ||
      difference.assertionId.includes("*")
    ) {
      context.addIssue({
        code: "custom",
        message: `Accepted difference ${difference.id} cannot use wildcards.`,
      });
      continue;
    }
    const scenario = scenarios.get(difference.scenarioId);
    const stepExists = scenario?.steps.some(
      (step) => step.stepId === difference.stepId,
    );
    const assertionExists = scenario?.assertions.some(
      (assertion) =>
        assertion.assertionId === difference.assertionId &&
        assertion.afterStepId === difference.stepId,
    );
    if (!stepExists || !assertionExists) {
      context.addIssue({
        code: "custom",
        message: `Accepted difference ${difference.id} does not match one exact observation.`,
      });
    }
  }
});

export type MigrationSpec = z.infer<typeof MigrationSpecSchema>;
