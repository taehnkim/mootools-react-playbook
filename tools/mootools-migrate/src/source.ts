import { readFile } from "node:fs/promises";
import { extname, relative, resolve } from "node:path";

import fg from "fast-glob";
import ts from "typescript";

import type { ComponentConfig, LegacyUse } from "./schemas.js";

const DEFAULT_IGNORES = [
  "**/node_modules/**",
  "**/dist/**",
  "**/.git/**",
  "tools/mootools-migrate/artifacts/**",
];

export async function expandProjectGlobs(options: {
  projectRoot: string;
  patterns: string[];
}): Promise<string[]> {
  return fg(options.patterns, {
    cwd: options.projectRoot,
    ignore: DEFAULT_IGNORES,
    onlyFiles: true,
    unique: true,
  });
}

export async function findLegacyUses(options: {
  projectRoot: string;
  config: ComponentConfig;
}): Promise<LegacyUse[]> {
  const paths = await expandProjectGlobs({
    projectRoot: options.projectRoot,
    patterns: options.config.callsiteGlobs,
  });
  const uses: LegacyUse[] = [];

  for (const path of paths.sort()) {
    const source = await readFile(resolve(options.projectRoot, path), "utf8");
    const sourceFile = ts.createSourceFile(
      path,
      source,
      ts.ScriptTarget.Latest,
      true,
      scriptKindForPath(path),
    );
    const hasLocalLegacyBinding = hasLocalBinding(
      sourceFile,
      options.config.legacyGlobal,
    );
    walk(sourceFile, (node) => {
      if (
        ts.isNewExpression(node) &&
        matchesLegacyGlobalExpression(
          node.expression,
          options.config.legacyGlobal,
        ) &&
        !(
          ts.isIdentifier(node.expression) &&
          hasLocalLegacyBinding
        )
      ) {
        uses.push({
          path,
          kind: "constructor",
          symbol: options.config.legacyGlobal,
          line: lineForNode(sourceFile, node),
        });
        return;
      }

      if (
        ts.isCallExpression(node) &&
        ts.isIdentifier(node.expression) &&
        node.expression.text === options.config.adapter.globalName
      ) {
        uses.push({
          path,
          kind: "adapter-call",
          symbol: options.config.adapter.globalName,
          line: lineForNode(sourceFile, node),
        });
        return;
      }

      if (
        isLegacyGlobalReference(
          node,
          options.config.legacyGlobal,
          hasLocalLegacyBinding,
        )
      ) {
        uses.push({
          path,
          kind: "global-reference",
          symbol: options.config.legacyGlobal,
          line: lineForNode(sourceFile, node),
        });
      }
    });
  }

  return deduplicateUses(uses);
}

export function projectRelativePath(projectRoot: string, path: string): string {
  return relative(projectRoot, resolve(path)).split("\\").join("/");
}

export function walk(
  node: ts.Node,
  visit: (current: ts.Node) => void,
): void {
  visit(node);
  node.forEachChild((child) => walk(child, visit));
}

export function lineForNode(
  sourceFile: ts.SourceFile,
  node: ts.Node,
): number {
  return sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1;
}

export function scriptKindForPath(path: string): ts.ScriptKind {
  switch (extname(path)) {
    case ".tsx":
      return ts.ScriptKind.TSX;
    case ".ts":
      return ts.ScriptKind.TS;
    case ".jsx":
      return ts.ScriptKind.JSX;
    case ".json":
      return ts.ScriptKind.JSON;
    default:
      return ts.ScriptKind.JS;
  }
}

function isDeclarationName(node: ts.Identifier): boolean {
  const parent = node.parent;
  return (
    (ts.isVariableDeclaration(parent) && parent.name === node) ||
    (ts.isFunctionDeclaration(parent) && parent.name === node) ||
    (ts.isClassDeclaration(parent) && parent.name === node) ||
    (ts.isParameter(parent) && parent.name === node) ||
    (ts.isPropertyAssignment(parent) && parent.name === node)
  );
}

function isLegacyGlobalReference(
  node: ts.Node,
  legacyGlobal: string,
  hasLocalLegacyBinding: boolean,
): boolean {
  if (
    ts.isIdentifier(node) &&
    node.text === legacyGlobal &&
    !hasLocalLegacyBinding &&
    !isDeclarationName(node) &&
    !isMemberName(node) &&
    !isTypePosition(node)
  ) {
    return !isConstructorExpression(node);
  }
  if (
    (ts.isPropertyAccessExpression(node) ||
      ts.isElementAccessExpression(node)) &&
    matchesLegacyGlobalExpression(node, legacyGlobal)
  ) {
    return !isConstructorExpression(node);
  }
  return false;
}

function hasLocalBinding(
  sourceFile: ts.SourceFile,
  name: string,
): boolean {
  let found = false;
  walk(sourceFile, (node) => {
    if (
      (ts.isImportClause(node) && node.name?.text === name) ||
      (ts.isImportSpecifier(node) && node.name.text === name) ||
      (ts.isNamespaceImport(node) && node.name.text === name) ||
      ((ts.isVariableDeclaration(node) ||
        ts.isFunctionDeclaration(node) ||
        ts.isClassDeclaration(node) ||
        ts.isInterfaceDeclaration(node) ||
        ts.isTypeAliasDeclaration(node) ||
        ts.isParameter(node)) &&
        node.name !== undefined &&
        ts.isIdentifier(node.name) &&
        node.name.text === name)
    ) {
      found = true;
    }
  });
  return found;
}

function matchesLegacyGlobalExpression(
  expression: ts.Expression,
  legacyGlobal: string,
): boolean {
  if (ts.isIdentifier(expression)) {
    return expression.text === legacyGlobal;
  }
  if (ts.isPropertyAccessExpression(expression)) {
    return (
      expression.name.text === legacyGlobal &&
      isBrowserGlobal(expression.expression)
    );
  }
  if (ts.isElementAccessExpression(expression)) {
    return (
      isBrowserGlobal(expression.expression) &&
      expression.argumentExpression !== undefined &&
      ts.isStringLiteralLike(expression.argumentExpression) &&
      expression.argumentExpression.text === legacyGlobal
    );
  }
  return false;
}

function isBrowserGlobal(expression: ts.Expression): boolean {
  return (
    expression.kind === ts.SyntaxKind.ThisKeyword ||
    (ts.isIdentifier(expression) &&
      (expression.text === "window" || expression.text === "globalThis"))
  );
}

function isConstructorExpression(node: ts.Node): boolean {
  return ts.isNewExpression(node.parent) && node.parent.expression === node;
}

function isMemberName(node: ts.Identifier): boolean {
  return (
    (ts.isPropertyAccessExpression(node.parent) &&
      node.parent.name === node) ||
    (ts.isElementAccessExpression(node.parent) &&
      node.parent.argumentExpression === node)
  );
}

function isTypePosition(node: ts.Identifier): boolean {
  let current: ts.Node = node;
  while (
    ts.isQualifiedName(current.parent) ||
    ts.isTypeReferenceNode(current.parent) ||
    ts.isExpressionWithTypeArguments(current.parent) ||
    ts.isTypeQueryNode(current.parent) ||
    ts.isImportTypeNode(current.parent)
  ) {
    if (
      ts.isTypeReferenceNode(current.parent) ||
      ts.isExpressionWithTypeArguments(current.parent) ||
      ts.isTypeQueryNode(current.parent) ||
      ts.isImportTypeNode(current.parent)
    ) {
      return true;
    }
    current = current.parent;
  }
  return false;
}

function deduplicateUses(uses: LegacyUse[]): LegacyUse[] {
  const seen = new Set<string>();
  const result: LegacyUse[] = [];
  for (const use of uses) {
    const key = `${use.path}:${use.line}:${use.kind}:${use.symbol}`;
    if (!seen.has(key)) {
      seen.add(key);
      result.push(use);
    }
  }
  return result.sort(
    (left, right) =>
      left.path.localeCompare(right.path) ||
      left.line - right.line ||
      left.kind.localeCompare(right.kind),
  );
}
