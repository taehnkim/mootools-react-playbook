import { readFile } from "node:fs/promises";
import { basename, resolve } from "node:path";

import ts from "typescript";
import { parseDocument } from "yaml";

import {
  addDraft,
  addNodeDraft,
  slug,
  type FindingDraft,
} from "./shared.js";
import type { ComponentConfig } from "../contracts/schemas.js";
import {
  expandProjectGlobs,
  scriptKindForPath,
  walk,
} from "./source.js";

export async function analyzeDependencies(options: {
  projectRoot: string;
  config: ComponentConfig;
  drafts: Map<string, FindingDraft>;
}): Promise<void> {
  const callsitePaths = await expandProjectGlobs({
    projectRoot: options.projectRoot,
    patterns: options.config.callsiteGlobs,
  });
  for (const path of [
    ...new Set([
      ...options.config.sourceFiles,
      ...options.config.bootstrapFiles,
      ...callsitePaths,
    ]),
  ]) {
    const source = await readFile(resolve(options.projectRoot, path), "utf8");
    analyzeMetadata({
      componentId: options.config.id,
      path,
      source,
      drafts: options.drafts,
    });
    const sourceFile = ts.createSourceFile(
      path,
      source,
      ts.ScriptTarget.Latest,
      true,
      scriptKindForPath(path),
    );
    analyzeImports({
      componentId: options.config.id,
      config: options.config,
      path,
      sourceFile,
      drafts: options.drafts,
    });
    analyzeScriptOrder({
      componentId: options.config.id,
      config: options.config,
      path,
      sourceFile,
      drafts: options.drafts,
    });
    analyzeImplicitGlobal({
      config: options.config,
      path,
      sourceFile,
      drafts: options.drafts,
    });
  }
}

function analyzeMetadata(options: {
  componentId: string;
  path: string;
  source: string;
  drafts: Map<string, FindingDraft>;
}): void {
  const match = /\/\*\s*---\s*\n([\s\S]*?)\n\.\.\.\s*\*\//.exec(
    options.source,
  );
  const body = match?.[1];
  if (match === null || body === undefined || match.index === undefined) {
    return;
  }
  const parsed: unknown = parseDocument(body).toJS();
  if (!isRecord(parsed)) {
    return;
  }
  const startLine =
    options.source.slice(0, match.index).split(/\r?\n/).length;
  const endLine = startLine + match[0].split(/\r?\n/).length - 1;

  for (const dependency of flattenMetadata(parsed.requires)) {
    addDraft(options.drafts, {
      id: `${options.componentId}:dependency:${slug(dependency)}`,
      kind: "dependency",
      summary: `Declares dependency ${dependency}.`,
      evidence: [
        {
          path: options.path,
          startLine,
          endLine,
        },
      ],
      suggestedAction:
        "Map this runtime capability to React, browser APIs, or retained utilities.",
      contractRelevant: true,
      decisionRequired: true,
    });
  }
  for (const provided of flattenMetadata(parsed.provides)) {
    addDraft(options.drafts, {
      id: `${options.componentId}:dependency:provided-module:${slug(provided)}`,
      kind: "dependency",
      summary: `Declares provided MooTools module ${provided}.`,
      evidence: [
        {
          path: options.path,
          startLine,
          endLine,
        },
      ],
      suggestedAction:
        "Use source and caller findings to decide which provided behavior remains.",
      contractRelevant: false,
      decisionRequired: false,
    });
  }
}

function analyzeImports(options: {
  componentId: string;
  config: ComponentConfig;
  path: string;
  sourceFile: ts.SourceFile;
  drafts: Map<string, FindingDraft>;
}): void {
  walk(options.sourceFile, (node) => {
    let moduleName: string | null = null;
    let importKind = "static import";
    if (
      ts.isImportDeclaration(node) &&
      ts.isStringLiteral(node.moduleSpecifier)
    ) {
      moduleName = node.moduleSpecifier.text;
    } else if (
      ts.isCallExpression(node) &&
      node.expression.kind === ts.SyntaxKind.ImportKeyword &&
      node.arguments[0] !== undefined &&
      ts.isStringLiteralLike(node.arguments[0])
    ) {
      moduleName = node.arguments[0].text;
      importKind = "dynamic import";
    } else if (
      ts.isCallExpression(node) &&
      ts.isIdentifier(node.expression) &&
      node.expression.text === "require" &&
      node.arguments[0] !== undefined &&
      ts.isStringLiteralLike(node.arguments[0])
    ) {
      moduleName = node.arguments[0].text;
      importKind = "require";
    }
    if (moduleName === null) {
      return;
    }
    const required = isRequiredModule(moduleName, options.config);
    addNodeDraft({
      drafts: options.drafts,
      sourceFile: options.sourceFile,
      node,
      path: options.path,
      id: `${options.componentId}:import:${slug(
        `${importKind}-${moduleName}`,
      )}`,
      kind: "import",
      summary: `${
        required ? "Uses" : "Co-loads"
      } ${importKind} ${moduleName}.`,
      suggestedAction:
        "Classify this as legacy-only, reusable, or replaced in React.",
      contractRelevant: required,
      decisionRequired: required,
    });
  });
}

function analyzeScriptOrder(options: {
  componentId: string;
  config: ComponentConfig;
  path: string;
  sourceFile: ts.SourceFile;
  drafts: Map<string, FindingDraft>;
}): void {
  const imports = new Map<string, string>();
  for (const statement of options.sourceFile.statements) {
    if (
      ts.isImportDeclaration(statement) &&
      statement.importClause?.name !== undefined &&
      ts.isStringLiteral(statement.moduleSpecifier)
    ) {
      imports.set(statement.importClause.name.text, statement.moduleSpecifier.text);
    }
  }

  walk(options.sourceFile, (node) => {
    if (!ts.isArrayLiteralExpression(node)) {
      return;
    }
    const orderedDependencies: string[] = [];
    for (const element of node.elements) {
      if (ts.isIdentifier(element)) {
        const moduleName = imports.get(element.text);
        if (
          moduleName !== undefined &&
          isRequiredModule(moduleName, options.config)
        ) {
          orderedDependencies.push(moduleName);
        }
      } else if (
        ts.isStringLiteralLike(element) &&
        /^https?:\/\//.test(element.text)
      ) {
        orderedDependencies.push(element.text);
      }
    }
    if (orderedDependencies.length < 2) {
      return;
    }
    addNodeDraft({
      drafts: options.drafts,
      sourceFile: options.sourceFile,
      node,
      path: options.path,
      id: `${options.componentId}:dependency:script-order:${slug(
        orderedDependencies.join("-then-"),
      )}`,
      kind: "dependency",
      summary: `Loads scripts in order: ${orderedDependencies.join(" -> ")}.`,
      suggestedAction:
        "Preserve required load order until imports replace browser globals.",
      contractRelevant: true,
      decisionRequired: true,
    });
  });
}

function isRequiredModule(
  moduleName: string,
  config: ComponentConfig,
): boolean {
  if (/^https?:\/\//.test(moduleName)) {
    return true;
  }
  const moduleBaseName = basename(moduleName.replace(/\?url$/, ""));
  const requiredBaseNames = new Set(
    [
      ...config.sourceFiles,
      ...config.callsiteGlobs.filter((pattern) => !/[*?{}]/.test(pattern)),
    ].map((path) => basename(path)),
  );
  return requiredBaseNames.has(moduleBaseName);
}

function analyzeImplicitGlobal(options: {
  config: ComponentConfig;
  path: string;
  sourceFile: ts.SourceFile;
  drafts: Map<string, FindingDraft>;
}): void {
  for (const statement of options.sourceFile.statements) {
    if (!ts.isVariableStatement(statement)) {
      continue;
    }
    for (const declaration of statement.declarationList.declarations) {
      if (
        ts.isIdentifier(declaration.name) &&
        declaration.name.text === options.config.legacyGlobal
      ) {
        addNodeDraft({
          drafts: options.drafts,
          sourceFile: options.sourceFile,
          node: declaration,
          path: options.path,
          id: `${options.config.id}:global:${slug(
            options.config.legacyGlobal,
          )}`,
          kind: "global",
          summary: `Defines script global ${options.config.legacyGlobal}.`,
          suggestedAction:
            "Identify direct and external callers before removing this global.",
          contractRelevant: true,
          decisionRequired: true,
        });
      }
    }
  }
}

function flattenMetadata(value: unknown, prefix = ""): string[] {
  if (typeof value === "string" || typeof value === "number") {
    return [prefix === "" ? String(value) : `${prefix}:${String(value)}`];
  }
  if (Array.isArray(value)) {
    return value.flatMap((item) => flattenMetadata(item, prefix));
  }
  if (isRecord(value)) {
    return Object.entries(value).flatMap(([key, child]) =>
      flattenMetadata(child, prefix === "" ? key : `${prefix}:${key}`),
    );
  }
  if (value === true && prefix !== "") {
    return [prefix];
  }
  return prefix === "" ? [] : [prefix];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
