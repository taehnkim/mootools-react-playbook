import { componentArtifactPath, type ToolContext } from "./context.js";
import { readJson } from "./json.js";
import {
  AcceptedDifferencesFileSchema,
  DecisionsFileSchema,
  RunIdSchema,
  ScenariosFileSchema,
  SelectorMapSchema,
} from "./schemas.js";

export function pilotPaths(context: ToolContext, componentId: string) {
  const path = (...segments: string[]) =>
    componentArtifactPath(context, componentId, ...segments);
  return {
    fixtures: path("fixtures.json"),
    scenarios: path("scenarios.json"),
    legacySelectors: path("selectors.legacy.json"),
    reactSelectors: path("selectors.react.json"),
    acceptedDifferences: path("accepted-differences.json"),
    decisions: path("decisions.json"),
    baseline: path("baseline"),
    candidate: (runId: string) => {
      const safeRunId = RunIdSchema.parse(runId);
      return path("candidate", safeRunId);
    },
  };
}

export async function loadPilotData(
  context: ToolContext,
  componentId: string,
) {
  const paths = pilotPaths(context, componentId);
  const [scenarios, legacySelectors, reactSelectors, acceptedDifferences] =
    await Promise.all([
      readJson(paths.scenarios, ScenariosFileSchema),
      readJson(paths.legacySelectors, SelectorMapSchema),
      readJson(paths.reactSelectors, SelectorMapSchema),
      readJson(paths.acceptedDifferences, AcceptedDifferencesFileSchema),
    ]);
  return {
    paths,
    scenarios,
    legacySelectors,
    reactSelectors,
    acceptedDifferences,
  };
}

export async function loadPilotDecisions(
  context: ToolContext,
  componentId: string,
) {
  return readJson(
    pilotPaths(context, componentId).decisions,
    DecisionsFileSchema,
  );
}
