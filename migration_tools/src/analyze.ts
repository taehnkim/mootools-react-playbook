import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import ts from "typescript";

import {
  addDraft,
  addNodeDraft,
  propertyName,
  slug,
  stringValue,
  type FindingDraft,
} from "./analysis-shared.js";
import { analyzeCallsites } from "./analyze-callsites.js";
import { analyzeCssAst } from "./analyze-css.js";
import { analyzeDependencies } from "./analyze-dependencies.js";
import { analyzeDomOperations } from "./analyze-dom.js";
import { analyzeEffects } from "./analyze-effects.js";
import { analyzeMarkup } from "./analyze-markup.js";
import { componentArtifactPath, type ToolContext } from "./context.js";
import {
  addFindingFingerprint,
  createEvidence,
  hashProjectFiles,
} from "./fingerprint.js";
import { hashJson, writeJson } from "./json.js";
import type {
  AnalysisCategory,
  ComponentConfig,
  Evidence,
  Finding,
  JsonValue,
  Worksheet,
} from "./schemas.js";
import { JsonValueSchema, WorksheetSchema } from "./schemas.js";
import {
  expandProjectGlobs,
  findLegacyUses,
  scriptKindForPath,
  walk,
} from "./source.js";

const ANALYZER_VERSION = "0.2.0";

export async function analyzeComponent(options: {
  context: ToolContext;
  config: ComponentConfig;
}): Promise<Worksheet> {
  const drafts = new Map<string, FindingDraft>();

  for (const path of options.config.sourceFiles) {
    const source = await readFile(
      resolve(options.context.projectRoot, path),
      "utf8",
    );
    analyzeJavaScriptSource({
      componentId: options.config.id,
      legacyGlobal: options.config.legacyGlobal,
      path,
      source,
      drafts,
    });
  }

  const uses = await findLegacyUses({
    projectRoot: options.context.projectRoot,
    config: options.config,
  });
  for (const use of uses) {
    addDraft(drafts, {
      id: `${options.config.id}:caller:${slug(
        `${use.path}-${use.line}-${use.kind}`,
      )}`,
      kind: "caller",
      summary: `${use.kind} use of ${use.symbol}`,
      evidence: [
        {
          path: use.path,
          startLine: use.line,
          endLine: use.line,
        },
      ],
      suggestedAction: "Confirm this caller's required contract.",
      contractRelevant: true,
      decisionRequired: true,
    });
  }

  await analyzeCallsites({
    projectRoot: options.context.projectRoot,
    config: options.config,
    drafts,
  });
  await analyzeDependencies({
    projectRoot: options.context.projectRoot,
    config: options.config,
    drafts,
  });
  await analyzeMarkup({
    projectRoot: options.context.projectRoot,
    config: options.config,
    drafts,
  });
  await analyzeCssAst({
    projectRoot: options.context.projectRoot,
    config: options.config,
    drafts,
  });

  const findings: Finding[] = [];
  for (const draft of [...drafts.values()].sort((left, right) =>
    left.id.localeCompare(right.id),
  )) {
    const evidence: Evidence[] = [];
    for (const location of draft.evidence) {
      evidence.push(
        await createEvidence({
          projectRoot: options.context.projectRoot,
          ...location,
        }),
      );
    }
    findings.push(
      addFindingFingerprint({
        ...draft,
        evidence,
      }),
    );
  }
  const callsiteFiles = await expandProjectGlobs({
    projectRoot: options.context.projectRoot,
    patterns: options.config.callsiteGlobs,
  });

  return WorksheetSchema.parse({
    schemaVersion: 1,
    componentId: options.config.id,
    source: "analyzer",
    analyzerVersion: ANALYZER_VERSION,
    inputHash: await calculateAnalyzerInputHash(
      options.context,
      options.config,
    ),
    generatedAt: new Date().toISOString(),
    findings,
    coverage: buildCoverage(
      findings,
      callsiteFiles,
      options.config,
    ),
  });
}

export async function calculateAnalyzerInputHash(
  context: ToolContext,
  config: ComponentConfig,
): Promise<string> {
  const paths = await analysisInputPaths(context, config);
  const projectFilesHash = await hashProjectFiles({
    projectRoot: context.projectRoot,
    paths,
  });
  return hashJson({
    analyzerVersion: ANALYZER_VERSION,
    componentConfig: JsonValueSchema.parse(config),
    projectFilesHash,
  });
}

async function analysisInputPaths(
  context: ToolContext,
  config: ComponentConfig,
): Promise<string[]> {
  const callsitePaths = await expandProjectGlobs({
    projectRoot: context.projectRoot,
    patterns: config.callsiteGlobs,
  });
  return [
    ...new Set([
      ...config.sourceFiles,
      ...config.cssFiles,
      ...config.markupFiles.map((entry) => entry.path),
      ...config.bootstrapFiles,
      ...callsitePaths,
    ]),
  ].sort();
}

function buildCoverage(
  findings: Finding[],
  callsiteFiles: string[],
  config: ComponentConfig,
) {
  const entries: {
    category: AnalysisCategory;
    kinds: Finding["kind"][];
    files: string[];
    limitations: string[];
  }[] = [
    {
      category: "events",
      kinds: ["event", "event-listener"],
      files: [...config.sourceFiles, ...callsiteFiles],
      limitations: [
        "Computed event names remain source expressions.",
        "Runtime listener order still needs browser capture.",
      ],
    },
    {
      category: "selectors",
      kinds: ["selector"],
      files: [
        ...config.sourceFiles,
        ...callsiteFiles,
        ...config.markupFiles.map((entry) => entry.path),
        ...config.cssFiles,
      ],
      limitations: ["Selectors assembled through arbitrary functions are unknown."],
    },
    {
      category: "api-calls",
      kinds: ["api-call", "network"],
      files: [...config.sourceFiles, ...callsiteFiles],
      limitations: [
        "Project-specific API wrappers need configured or added recognizers.",
      ],
    },
    {
      category: "dom",
      kinds: ["dom-read", "dom-write"],
      files: [
        ...config.sourceFiles,
        ...callsiteFiles,
        ...config.markupFiles.map((entry) => entry.path),
      ],
      limitations: ["Runtime-generated DOM still needs browser scenarios."],
    },
    {
      category: "side-effects",
      kinds: ["side-effect", "timer", "storage", "api-call"],
      files: [...config.sourceFiles, ...callsiteFiles],
      limitations: ["Effects hidden behind unrecognized helpers remain unknown."],
    },
    {
      category: "dependencies",
      kinds: ["dependency"],
      files: [
        ...config.sourceFiles,
        ...config.bootstrapFiles,
        ...callsiteFiles,
        ...config.cssFiles,
      ],
      limitations: ["Dynamic global dependencies may require runtime evidence."],
    },
    {
      category: "callsites",
      kinds: ["caller"],
      files: callsiteFiles,
      limitations: ["Dynamic and external callers are outside repository proof."],
    },
    {
      category: "imports",
      kinds: ["import"],
      files: [
        ...config.sourceFiles,
        ...config.bootstrapFiles,
        ...callsiteFiles,
      ],
      limitations: ["Runtime script injection outside scanned files is unknown."],
    },
    {
      category: "markup",
      kinds: ["markup"],
      files: [
        ...config.markupFiles.map((entry) => entry.path),
        ...config.sourceFiles,
        ...callsiteFiles,
      ],
      limitations: ["DOM added after startup needs browser capture."],
    },
    {
      category: "css",
      kinds: ["style"],
      files: config.cssFiles,
      limitations: ["Computed cascade and layout still need browser comparison."],
    },
    {
      category: "timers",
      kinds: ["timer"],
      files: [...config.sourceFiles, ...callsiteFiles],
      limitations: ["Timers hidden behind project wrappers need new recognizers."],
    },
    {
      category: "storage",
      kinds: ["storage"],
      files: [...config.sourceFiles, ...callsiteFiles],
      limitations: ["Project-specific storage wrappers need new recognizers."],
    },
    {
      category: "globals",
      kinds: ["global", "side-effect"],
      files: [...config.sourceFiles, ...callsiteFiles],
      limitations: ["Globals created through eval or computed names are unknown."],
    },
  ];
  return entries.map((entry) => ({
    category: entry.category,
    filesScanned: [...new Set(entry.files)].sort(),
    findingCount: findings.filter((finding) => {
      if (!entry.kinds.includes(finding.kind)) {
        return false;
      }
      if (entry.category !== "globals" || finding.kind === "global") {
        return true;
      }
      return (
        finding.summary.includes("browser global") ||
        finding.summary.includes("exposes the component")
      );
    }).length,
    limitations: entry.limitations,
  }));
}

export async function checkWorksheetFreshness(options: {
  context: ToolContext;
  config: ComponentConfig;
  worksheet: Worksheet;
}): Promise<{ ok: boolean; expected: string; actual: string }> {
  const actual = await calculateAnalyzerInputHash(
    options.context,
    options.config,
  );
  return {
    ok: options.worksheet.inputHash === actual,
    expected: options.worksheet.inputHash,
    actual,
  };
}

export async function writeWorksheet(options: {
  context: ToolContext;
  worksheet: Worksheet;
}): Promise<string> {
  const path = componentArtifactPath(
    options.context,
    options.worksheet.componentId,
    "worksheet.generated.json",
  );
  await writeJson(path, worksheetToJson(options.worksheet));
  return path;
}

function analyzeJavaScriptSource(options: {
  componentId: string;
  legacyGlobal: string;
  path: string;
  source: string;
  drafts: Map<string, FindingDraft>;
}): void {
  const sourceFile = ts.createSourceFile(
    options.path,
    options.source,
    ts.ScriptTarget.Latest,
    true,
    scriptKindForPath(options.path),
  );
  analyzeEffects({
    componentId: options.componentId,
    path: options.path,
    sourceFile,
    drafts: options.drafts,
  });
  analyzeDomOperations({
    componentId: options.componentId,
    path: options.path,
    sourceFile,
    drafts: options.drafts,
  });
  let foundClassShape = false;

  walk(sourceFile, (node) => {
    if (
      ts.isNewExpression(node) &&
      ts.isIdentifier(node.expression) &&
      node.expression.text === "Class"
    ) {
      foundClassShape = true;
      const classBody = node.arguments?.[0];
      if (classBody !== undefined && ts.isObjectLiteralExpression(classBody)) {
        analyzeClassBody({
          componentId: options.componentId,
          path: options.path,
          sourceFile,
          classBody,
          drafts: options.drafts,
        });
      } else {
        addNodeDraft({
          drafts: options.drafts,
          sourceFile,
          node,
          path: options.path,
          id: `${options.componentId}:unknown:class-shape`,
          kind: "unknown",
          summary: "Class constructor does not use a supported object literal.",
          suggestedAction: "Review this class shape manually.",
          contractRelevant: true,
          decisionRequired: true,
        });
      }
    }

    if (
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      node.expression.name.text === "implement" &&
      matchesLegacyReceiver(
        node.expression.expression,
        options.legacyGlobal,
      )
    ) {
      const extensionBody = node.arguments[0];
      if (
        extensionBody !== undefined &&
        ts.isObjectLiteralExpression(extensionBody)
      ) {
        analyzeClassBody({
          componentId: options.componentId,
          path: options.path,
          sourceFile,
          classBody: extensionBody,
          drafts: options.drafts,
        });
      }
    }

    if (
      ts.isPropertyAccessExpression(node) &&
      node.name.text === options.legacyGlobal &&
      node.expression.kind === ts.SyntaxKind.ThisKeyword
    ) {
      addNodeDraft({
        drafts: options.drafts,
        sourceFile,
        node,
        path: options.path,
        id: `${options.componentId}:global:${slug(options.legacyGlobal)}`,
        kind: "global",
        summary: `${options.legacyGlobal} is exported as a browser global.`,
        suggestedAction: "Keep the global only on the legacy surface.",
        contractRelevant: true,
        decisionRequired: true,
      });
    }
  });

  if (!foundClassShape && !options.path.endsWith(".Extra.js")) {
    addDraft(options.drafts, {
      id: `${options.componentId}:unknown:no-class-shape:${slug(options.path)}`,
      kind: "unknown",
      summary: `No supported MooTools Class shape was found in ${options.path}.`,
      evidence: [
        {
          path: options.path,
          startLine: 1,
          endLine: 1,
        },
      ],
      suggestedAction: "Review the source manually.",
      contractRelevant: true,
      decisionRequired: true,
    });
  }
}

function analyzeClassBody(options: {
  componentId: string;
  path: string;
  sourceFile: ts.SourceFile;
  classBody: ts.ObjectLiteralExpression;
  drafts: Map<string, FindingDraft>;
}): void {
  for (const property of options.classBody.properties) {
    const name = propertyName(property.name);
    if (name === null) {
      continue;
    }

    if (
      name === "options" &&
      ts.isPropertyAssignment(property) &&
      ts.isObjectLiteralExpression(property.initializer)
    ) {
      for (const option of property.initializer.properties) {
        const optionName = propertyName(option.name);
        if (optionName === null) {
          continue;
        }
        addNodeDraft({
          drafts: options.drafts,
          sourceFile: options.sourceFile,
          node: option,
          path: options.path,
          id: `${options.componentId}:public-input:${slug(optionName)}`,
          kind: "public-input",
          summary: `Option ${optionName} has default ${option.getText(
            options.sourceFile,
          )}.`,
          suggestedAction: "Check caller use before defining the React input.",
          contractRelevant: true,
          decisionRequired: true,
        });
        if (
          ts.isPropertyAssignment(option) &&
          ts.isStringLiteralLike(option.initializer)
        ) {
          const selector = isSelector(option.initializer.text)
            ? option.initializer.text
            : optionName.toLowerCase().endsWith("class")
              ? `.${option.initializer.text}`
              : null;
          if (selector !== null) {
            addNodeDraft({
              drafts: options.drafts,
              sourceFile: options.sourceFile,
              node: option.initializer,
              path: options.path,
              id: `${options.componentId}:selector:${slug(selector)}`,
              kind: "selector",
              summary: `Uses selector ${selector}.`,
              suggestedAction:
                "Check CSS, callers, and automation before removal.",
              contractRelevant: true,
              decisionRequired: true,
            });
          }
        }
      }
      continue;
    }

    const functionNode = functionForProperty(property);
    if (functionNode === null) {
      continue;
    }

    const parameters = functionNode.parameters
      .map((parameter) => parameter.name.getText(options.sourceFile))
      .join(", ");
    addNodeDraft({
      drafts: options.drafts,
      sourceFile: options.sourceFile,
      node: property,
      path: options.path,
      id: `${options.componentId}:public-method:${slug(name)}`,
      kind: name === "initialize" ? "lifecycle" : "public-method",
      summary: `${name}(${parameters})`,
      suggestedAction:
        name === "initialize"
          ? "Model mount behavior at the React boundary."
          : "Preserve only when caller or scenario evidence requires it.",
      contractRelevant: true,
      decisionRequired: true,
    });
    analyzeFunctionBody({
      componentId: options.componentId,
      path: options.path,
      sourceFile: options.sourceFile,
      functionNode,
      drafts: options.drafts,
    });
  }
}

function analyzeFunctionBody(options: {
  componentId: string;
  path: string;
  sourceFile: ts.SourceFile;
  functionNode: ts.FunctionLikeDeclaration;
  drafts: Map<string, FindingDraft>;
}): void {
  if (options.functionNode.body === undefined) {
    return;
  }

  walk(options.functionNode.body, (node) => {
    if (
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression)
    ) {
      const method = node.expression.name.text;
      if (method === "fireEvent") {
        const eventName =
          stringValue(node.arguments[0]) ??
          node.arguments[0]?.getText(options.sourceFile) ??
          "unknown-event";
        addNodeDraft({
          drafts: options.drafts,
          sourceFile: options.sourceFile,
          node,
          path: options.path,
          id: `${options.componentId}:event:${slug(eventName)}`,
          kind: "event",
          summary: `Fires ${eventName}.`,
          suggestedAction: "Record payload and order in a browser scenario.",
          contractRelevant: true,
          decisionRequired: true,
        });
      }

    }

    if (ts.isStringLiteralLike(node) && isSelector(node.text)) {
      addNodeDraft({
        drafts: options.drafts,
        sourceFile: options.sourceFile,
        node,
        path: options.path,
        id: `${options.componentId}:selector:${slug(node.text)}`,
        kind: "selector",
        summary: `Uses selector ${node.text}.`,
        suggestedAction: "Check CSS, callers, and automation before removal.",
        contractRelevant: true,
        decisionRequired: true,
      });
    }
  });
}

function functionForProperty(
  property: ts.ObjectLiteralElementLike,
): ts.FunctionLikeDeclaration | null {
  if (
    ts.isPropertyAssignment(property) &&
    (ts.isFunctionExpression(property.initializer) ||
      ts.isArrowFunction(property.initializer))
  ) {
    return property.initializer;
  }
  if (ts.isMethodDeclaration(property)) {
    return property;
  }
  return null;
}

function matchesLegacyReceiver(
  expression: ts.Expression,
  legacyGlobal: string,
): boolean {
  if (ts.isIdentifier(expression)) {
    return expression.text === legacyGlobal;
  }
  return (
    ts.isPropertyAccessExpression(expression) &&
    expression.name.text === legacyGlobal &&
    expression.expression.kind === ts.SyntaxKind.ThisKeyword
  );
}

function isSelector(value: string): boolean {
  return value.length > 1 && (value.startsWith(".") || value.startsWith("#"));
}

function worksheetToJson(worksheet: Worksheet): JsonValue {
  return JsonValueSchema.parse(worksheet);
}
