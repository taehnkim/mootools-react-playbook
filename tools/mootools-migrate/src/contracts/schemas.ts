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

const RelativePathSchema = z.string().min(1);
const ComponentIdSchema = z
  .string()
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);
const Sha256Schema = z.string().regex(/^sha256:[a-f0-9]{64}$/);
export const RunIdSchema = z
  .string()
  .regex(/^[a-zA-Z0-9]+(?:[._-][a-zA-Z0-9]+)*$/);
export const ArtifactIdSchema = z
  .string()
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);

export const ComponentConfigSchema = z.object({
  schemaVersion: z.literal(1),
  id: ComponentIdSchema,
  displayName: z.string().min(1),
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
  scanRoots: z.array(RelativePathSchema).min(1),
  callsiteGlobs: z.array(z.string().min(1)).min(1),
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
  legacy: z.object({
    entryPath: z.string().startsWith("/"),
    readyPath: z.array(z.string().min(1)).min(1),
    eventNames: z.array(z.string().min(1)),
  }),
  react: z.object({
    entryPath: z.string().startsWith("/"),
    readySelector: z.string().min(1),
    handlePath: z.array(z.string().min(1)).nullable(),
    componentPath: RelativePathSchema,
  }),
  adapter: z.object({
    globalName: z.string().min(1),
    outputPath: RelativePathSchema,
    callsiteFiles: z.array(RelativePathSchema).min(1),
    bootstrapFile: RelativePathSchema,
    bootstrapImportAnchor: z.string().min(1),
    bootstrapArrayAnchor: z.string().min(1),
    bootstrapImportPath: z.string().min(1),
  }),
});

export type ComponentConfig = z.infer<typeof ComponentConfigSchema>;

export const RegistryStatusSchema = z.enum([
  "legacy",
  "analyzed",
  "baseline-captured",
  "decisions-ready",
  "react-draft",
  "parity-ready",
  "pilot-proven",
  "react",
  "blocked",
]);

export const RegistrySchema = z.object({
  schemaVersion: z.literal(1),
  components: z.array(
    z.object({
      id: ComponentIdSchema,
      mode: z.enum(["local-pilot", "production"]),
      configPath: RelativePathSchema,
      status: RegistryStatusSchema,
      blockers: z.array(z.string()),
    }),
  ),
});

export type Registry = z.infer<typeof RegistrySchema>;

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
  source: z.enum(["manual", "analyzer"]),
  analyzerVersion: z.string().nullable(),
  inputHash: Sha256Schema,
  generatedAt: z.string().datetime(),
  findings: z.array(FindingSchema),
  coverage: z.array(AnalysisCoverageSchema),
});

export type Worksheet = z.infer<typeof WorksheetSchema>;

export const ApprovalSchema = z.discriminatedUnion("status", [
  z.object({ status: z.literal("not-required") }),
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
  requiresHumanApproval: z.boolean(),
  approval: ApprovalSchema,
});

export type Decision = z.infer<typeof DecisionSchema>;

export const DecisionsFileSchema = z.object({
  schemaVersion: z.literal(1),
  componentId: ComponentIdSchema,
  decisions: z.array(DecisionSchema),
});

export type DecisionsFile = z.infer<typeof DecisionsFileSchema>;

export const FixturesFileSchema = z.object({
  schemaVersion: z.literal(1),
  componentId: ComponentIdSchema,
  fixtures: z.record(z.string().min(1), JsonValueSchema),
});

export const SelectorMapSchema = z.object({
  schemaVersion: z.literal(1),
  componentId: ComponentIdSchema,
  surface: z.enum(["legacy", "react"]),
  selectors: z.record(z.string().min(1), z.string().min(1)),
});

export type SelectorMap = z.infer<typeof SelectorMapSchema>;

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
  assertionId: z.string().min(1),
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
    assertionId: z.string().min(1),
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
    maxDiffRatio: z.number().min(0).max(1),
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
    for (const assertion of scenario.assertions) {
      if (assertionIds.has(assertion.assertionId)) {
        context.addIssue({
          code: "custom",
          message: `Duplicate assertionId: ${assertion.assertionId}`,
        });
      }
      assertionIds.add(assertion.assertionId);
      if (!stepIds.has(assertion.afterStepId)) {
        context.addIssue({
          code: "custom",
          message: `Unknown afterStepId: ${assertion.afterStepId}`,
        });
      }
    }
  });

export const ScenariosFileSchema = z.object({
  schemaVersion: z.literal(1),
  componentId: ComponentIdSchema,
  scenarios: z.array(ScenarioSchema).min(1),
});

export type ScenariosFile = z.infer<typeof ScenariosFileSchema>;
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

export const AcceptedDifferencesFileSchema = z.object({
  schemaVersion: z.literal(1),
  componentId: ComponentIdSchema,
  differences: z.array(AcceptedDifferenceSchema),
});

export type AcceptedDifferencesFile = z.infer<
  typeof AcceptedDifferencesFileSchema
>;

export const LegacyUseSchema = z.object({
  path: RelativePathSchema,
  kind: z.enum(["constructor", "global-reference", "adapter-call"]),
  symbol: z.string().min(1),
  line: z.number().int().positive(),
});

export const LegacyUseAllowlistSchema = z.object({
  schemaVersion: z.literal(1),
  componentId: ComponentIdSchema,
  searchRoots: z.array(RelativePathSchema).min(1),
  fileGlobs: z.array(z.string().min(1)).min(1),
  allowedUses: z.array(LegacyUseSchema),
});

export type LegacyUse = z.infer<typeof LegacyUseSchema>;
export type LegacyUseAllowlist = z.infer<typeof LegacyUseAllowlistSchema>;

export const EventRecordSchema = z.object({
  name: z.string().min(1),
  args: z.array(JsonValueSchema),
});

export type EventRecord = z.infer<typeof EventRecordSchema>;

export const ObservationSchema = z.object({
  assertionId: z.string().min(1),
  afterStepId: z.string().min(1),
  kind: AssertionKindSchema,
  actual: JsonValueSchema,
  screenshotPath: z.string().nullable(),
  screenshotHash: Sha256Schema.nullable(),
});

export type Observation = z.infer<typeof ObservationSchema>;

export const ScenarioResultSchema = z.object({
  scenarioId: z.string().min(1),
  observations: z.array(ObservationSchema),
});

export const CaptureManifestSchema = z.object({
  schemaVersion: z.literal(1),
  runId: RunIdSchema,
  componentId: ComponentIdSchema,
  surface: z.enum(["legacy", "react"]),
  createdAt: z.string().datetime(),
  baseUrl: z.string().url(),
  projectInputHash: Sha256Schema,
  componentConfigHash: Sha256Schema,
  scenariosHash: Sha256Schema,
  fixturesHash: Sha256Schema,
  selectorsHash: Sha256Schema,
  browserVersion: z.string().min(1),
  viewport: z.object({
    width: z.number().int().positive(),
    height: z.number().int().positive(),
  }),
  results: z.array(ScenarioResultSchema),
});

export type CaptureManifest = z.infer<typeof CaptureManifestSchema>;

export const ComponentTestResultSchema = z.object({
  schemaVersion: z.literal(1),
  componentId: ComponentIdSchema,
  surface: z.enum(["legacy", "react"]),
  testFile: RelativePathSchema,
  testFileHash: Sha256Schema,
  sourceHash: Sha256Schema,
  createdAt: z.string().datetime(),
  command: z.string().min(1),
  passed: z.boolean(),
  output: z.string(),
});

export type ComponentTestResult = z.infer<
  typeof ComponentTestResultSchema
>;

export const ParityMismatchSchema = z.object({
  scenarioId: z.string().min(1),
  assertionId: z.string().min(1),
  reason: z.string().min(1),
  legacyValue: JsonValueSchema,
  reactValue: JsonValueSchema,
});

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
});

export type ParityResultData = z.infer<typeof ParityResultSchema>;

export const RegistryInventorySchema = z.object({
  schemaVersion: z.literal(1),
  generatedAt: z.string().datetime(),
  components: z.array(
    z.object({
      id: ComponentIdSchema,
      definitions: z.array(RelativePathSchema),
      uses: z.array(LegacyUseSchema),
    }),
  ),
});

export type RegistryInventory = z.infer<typeof RegistryInventorySchema>;
