import { resolve } from "node:path";

import ts from "typescript";

import {
  addNodeDraft,
  slug,
  stringValue,
  type FindingDraft,
} from "./analysis-shared.js";
import { analyzeDomOperations } from "./analyze-dom.js";
import { analyzeEffects } from "./analyze-effects.js";
import type { ComponentConfig } from "./schemas.js";
import {
  expandProjectGlobs,
  walk,
} from "./source.js";

export async function analyzeCallsites(options: {
  projectRoot: string;
  config: ComponentConfig;
  drafts: Map<string, FindingDraft>;
}): Promise<void> {
  const paths = await expandProjectGlobs({
    projectRoot: options.projectRoot,
    patterns: options.config.callsiteGlobs,
  });
  const absolutePaths = paths.map((path) =>
    resolve(options.projectRoot, path),
  );
  const program = ts.createProgram(absolutePaths, {
    allowJs: true,
    checkJs: false,
    module: ts.ModuleKind.ESNext,
    noResolve: true,
    skipLibCheck: true,
    target: ts.ScriptTarget.Latest,
  });
  const checker = program.getTypeChecker();
  for (const path of paths) {
    const sourceFile = program.getSourceFile(
      resolve(options.projectRoot, path),
    );
    if (sourceFile === undefined) {
      throw new Error(`TypeScript could not load callsite ${path}.`);
    }
    analyzeCallsiteFile({
      config: options.config,
      path,
      sourceFile,
      checker,
      drafts: options.drafts,
    });
  }
}

function analyzeCallsiteFile(options: {
  config: ComponentConfig;
  path: string;
  sourceFile: ts.SourceFile;
  checker: ts.TypeChecker;
  drafts: Map<string, FindingDraft>;
}): void {
  const instanceSymbols = findInstanceBindings(
    options.sourceFile,
    options.config,
    options.checker,
  );

  walk(options.sourceFile, (node) => {
    if (
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      isTrackedExpression(
        node.expression.expression,
        instanceSymbols,
        options.checker,
      )
    ) {
      const instanceName = node.expression.expression.getText(
        options.sourceFile,
      );
      const method = node.expression.name.text;
      addNodeDraft({
        drafts: options.drafts,
        sourceFile: options.sourceFile,
        node,
        path: options.path,
        id: `${options.config.id}:caller-method:${slug(method)}`,
        kind: "caller",
        summary: `Caller invokes ${instanceName}.${method}.`,
        suggestedAction:
          "Use this call as evidence for the required React or adapter API.",
        contractRelevant: true,
        decisionRequired: true,
      });
      if (method === "addEvent" || method === "removeEvent") {
        const eventName =
          stringValue(node.arguments[0]) ??
          node.arguments[0]?.getText(options.sourceFile) ??
          "unknown-event";
        addNodeDraft({
          drafts: options.drafts,
          sourceFile: options.sourceFile,
          node,
          path: options.path,
          id: `${options.config.id}:caller-event-listener:${slug(
            `${method}-${eventName}`,
          )}`,
          kind: "event-listener",
          summary: `Caller ${method} registers ${eventName} on ${instanceName}.`,
          suggestedAction:
            "Preserve callback timing, payload, ordering, and cleanup if used.",
          contractRelevant: true,
          decisionRequired: true,
        });
        analyzeEffects({
          componentId: options.config.id,
          path: options.path,
          sourceFile: options.sourceFile,
          drafts: options.drafts,
          root: node,
        });
        for (const body of callbackBodies(node, options.checker)) {
          analyzeEffects({
            componentId: options.config.id,
            path: options.path,
            sourceFile: options.sourceFile,
            drafts: options.drafts,
            root: body,
          });
          analyzeDomOperations({
            componentId: options.config.id,
            path: options.path,
            sourceFile: options.sourceFile,
            drafts: options.drafts,
            root: body,
          });
        }
      }
    }

    if (
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      (node.expression.name.text === "addEvent" ||
        node.expression.name.text === "addEvents")
    ) {
      const callbackMethods = methodsCalledInCallbacks(
        node,
        instanceSymbols,
        options.checker,
      );
      if (callbackMethods.length > 0) {
        const eventName =
          stringValue(node.arguments[0]) ??
          node.arguments[0]?.getText(options.sourceFile) ??
          "event-map";
        addNodeDraft({
          drafts: options.drafts,
          sourceFile: options.sourceFile,
          node,
          path: options.path,
          id: `${options.config.id}:caller-dom-listener:${slug(
            `${eventName}-${callbackMethods.join("-")}`,
          )}`,
          kind: "event-listener",
          summary: `Caller listener ${eventName} invokes ${callbackMethods.join(
            ", ",
          )}.`,
          suggestedAction:
            "Move this trigger to React or keep it in an explicit host adapter.",
          contractRelevant: true,
          decisionRequired: true,
        });
        analyzeEffects({
          componentId: options.config.id,
          path: options.path,
          sourceFile: options.sourceFile,
          drafts: options.drafts,
          root: node,
        });
        for (const body of directCallbackBodies(node)) {
          analyzeEffects({
            componentId: options.config.id,
            path: options.path,
            sourceFile: options.sourceFile,
            drafts: options.drafts,
            root: body,
          });
          analyzeDomOperations({
            componentId: options.config.id,
            path: options.path,
            sourceFile: options.sourceFile,
            drafts: options.drafts,
            root: body,
          });
        }
      }
    }

    if (
      ts.isBinaryExpression(node) &&
      node.operatorToken.kind === ts.SyntaxKind.EqualsToken &&
      isBrowserGlobalTarget(node.left) &&
      containsInstanceReference(
        node.right,
        instanceSymbols,
        options.checker,
      )
    ) {
      addNodeDraft({
        drafts: options.drafts,
        sourceFile: options.sourceFile,
        node,
        path: options.path,
        id: `${options.config.id}:caller-global-exposure:${slug(
          node.left.getText(options.sourceFile),
        )}`,
        kind: "side-effect",
        summary: `Caller exposes the component through ${node.left.getText(
          options.sourceFile,
        )}.`,
        suggestedAction:
          "Keep this global only as an approved test or compatibility boundary.",
        contractRelevant: true,
        decisionRequired: true,
      });
    }
  });
}

function functionBody(node: ts.Node): ts.ConciseBody | null {
  if (
    ts.isFunctionDeclaration(node) ||
    ts.isFunctionExpression(node) ||
    ts.isArrowFunction(node) ||
    ts.isMethodDeclaration(node)
  ) {
    return node.body ?? null;
  }
  return null;
}

type InstanceBindings = {
  symbols: Set<ts.Symbol>;
  propertyExpressions: Set<string>;
};

function findInstanceBindings(
  sourceFile: ts.SourceFile,
  config: ComponentConfig,
  checker: ts.TypeChecker,
): InstanceBindings {
  const bindings: InstanceBindings = {
    symbols: new Set<ts.Symbol>(),
    propertyExpressions: new Set<string>(),
  };
  const factorySymbols = new Set<ts.Symbol>();
  walk(sourceFile, (node) => {
    if (
      ts.isFunctionDeclaration(node) &&
      node.name !== undefined &&
      node.body !== undefined &&
      containsConstructionReturn(node.body, config)
    ) {
      const symbol = checker.getSymbolAtLocation(node.name);
      if (symbol !== undefined) {
        factorySymbols.add(symbol);
      }
    }
  });

  walk(sourceFile, (node) => {
    if (
      ts.isVariableDeclaration(node) &&
      node.initializer !== undefined &&
      isComponentConstruction(node.initializer, config, checker, factorySymbols)
    ) {
      addBinding(node.name, sourceFile, checker, bindings);
    }
    if (
      ts.isBinaryExpression(node) &&
      node.operatorToken.kind === ts.SyntaxKind.EqualsToken &&
      isComponentConstruction(node.right, config, checker, factorySymbols)
    ) {
      addBinding(node.left, sourceFile, checker, bindings);
    }
  });

  let changed = true;
  while (changed) {
    changed = false;
    walk(sourceFile, (node) => {
      if (
        ts.isVariableDeclaration(node) &&
        node.initializer !== undefined &&
        isTrackedExpression(node.initializer, bindings, checker)
      ) {
        changed =
          addBinding(node.name, sourceFile, checker, bindings) || changed;
      }
      if (
        ts.isBinaryExpression(node) &&
        node.operatorToken.kind === ts.SyntaxKind.EqualsToken &&
        isTrackedExpression(node.right, bindings, checker)
      ) {
        changed =
          addBinding(node.left, sourceFile, checker, bindings) || changed;
      }
    });
  }
  return bindings;
}

function isComponentConstruction(
  node: ts.Expression,
  config: ComponentConfig,
  checker: ts.TypeChecker,
  factorySymbols: Set<ts.Symbol>,
): boolean {
  if (ts.isNewExpression(node)) {
    return expressionMatchesName(node.expression, config.legacyGlobal);
  }
  if (
    ts.isCallExpression(node) &&
    ts.isIdentifier(node.expression) &&
    node.expression.text === config.adapter.globalName
  ) {
    return true;
  }
  if (ts.isCallExpression(node)) {
    const symbol = checker.getSymbolAtLocation(node.expression);
    return symbol !== undefined && factorySymbols.has(symbol);
  }
  return false;
}

function addBinding(
  node: ts.Node,
  sourceFile: ts.SourceFile,
  checker: ts.TypeChecker,
  bindings: InstanceBindings,
): boolean {
  const symbol = checker.getSymbolAtLocation(node);
  if (symbol !== undefined) {
    const previousSize = bindings.symbols.size;
    bindings.symbols.add(symbol);
    return bindings.symbols.size !== previousSize;
  }
  if (
    ts.isPropertyAccessExpression(node) ||
    ts.isElementAccessExpression(node)
  ) {
    const text = node.getText(sourceFile);
    const previousSize = bindings.propertyExpressions.size;
    bindings.propertyExpressions.add(text);
    return bindings.propertyExpressions.size !== previousSize;
  }
  return false;
}

function isTrackedExpression(
  node: ts.Expression,
  bindings: InstanceBindings,
  checker: ts.TypeChecker,
): boolean {
  const symbol = checker.getSymbolAtLocation(node);
  if (symbol !== undefined && bindings.symbols.has(symbol)) {
    return true;
  }
  return (
    (ts.isPropertyAccessExpression(node) ||
      ts.isElementAccessExpression(node)) &&
    bindings.propertyExpressions.has(node.getText())
  );
}

function containsConstructionReturn(
  body: ts.Block,
  config: ComponentConfig,
): boolean {
  let found = false;
  walk(body, (node) => {
    if (
      ts.isReturnStatement(node) &&
      node.expression !== undefined &&
      isDirectConstruction(node.expression, config)
    ) {
      found = true;
    }
  });
  return found;
}

function isDirectConstruction(
  node: ts.Expression,
  config: ComponentConfig,
): boolean {
  if (ts.isNewExpression(node)) {
    return expressionMatchesName(node.expression, config.legacyGlobal);
  }
  return (
    ts.isCallExpression(node) &&
    ts.isIdentifier(node.expression) &&
    node.expression.text === config.adapter.globalName
  );
}

function expressionMatchesName(
  expression: ts.Expression,
  name: string,
): boolean {
  if (ts.isIdentifier(expression)) {
    return expression.text === name;
  }
  if (
    ts.isPropertyAccessExpression(expression) &&
    expression.name.text === name
  ) {
    return true;
  }
  return (
    ts.isElementAccessExpression(expression) &&
    expression.argumentExpression !== undefined &&
    ts.isStringLiteralLike(expression.argumentExpression) &&
    expression.argumentExpression.text === name
  );
}

function methodsCalledInCallbacks(
  call: ts.CallExpression,
  bindings: InstanceBindings,
  checker: ts.TypeChecker,
): string[] {
  const methods = new Set<string>();
  for (const body of callbackBodies(call, checker)) {
    walk(body, (node) => {
      if (
        ts.isCallExpression(node) &&
        ts.isPropertyAccessExpression(node.expression) &&
        isTrackedExpression(node.expression.expression, bindings, checker)
      ) {
        methods.add(
          `${node.expression.expression.getText()}.${node.expression.name.text}`,
        );
      }
    });
  }
  return [...methods].sort();
}

function callbackBodies(
  call: ts.CallExpression,
  checker: ts.TypeChecker,
): ts.ConciseBody[] {
  const bodies: ts.ConciseBody[] = [];
  for (const argument of call.arguments) {
    const directBody = functionBody(argument);
    if (directBody !== null) {
      bodies.push(directBody);
      continue;
    }
    if (!ts.isIdentifier(argument)) {
      continue;
    }
    const symbol = checker.getSymbolAtLocation(argument);
    for (const declaration of symbol?.declarations ?? []) {
      const body = functionBody(declaration);
      if (body !== null) {
        bodies.push(body);
      } else if (
        ts.isVariableDeclaration(declaration) &&
        declaration.initializer !== undefined
      ) {
        const initializerBody = functionBody(declaration.initializer);
        if (initializerBody !== null) {
          bodies.push(initializerBody);
        }
      }
    }
  }
  return bodies;
}

function directCallbackBodies(call: ts.CallExpression): ts.ConciseBody[] {
  return call.arguments
    .map(functionBody)
    .filter((body): body is ts.ConciseBody => body !== null);
}

function isBrowserGlobalTarget(node: ts.Expression): boolean {
  if (
    ts.isPropertyAccessExpression(node) ||
    ts.isElementAccessExpression(node)
  ) {
    const expression = node.expression;
    return (
      expression.kind === ts.SyntaxKind.ThisKeyword ||
      (ts.isIdentifier(expression) &&
        (expression.text === "window" || expression.text === "globalThis"))
    );
  }
  return false;
}

function containsInstanceReference(
  node: ts.Node,
  bindings: InstanceBindings,
  checker: ts.TypeChecker,
): boolean {
  let found = false;
  walk(node, (child) => {
    if (isTrackableExpression(child) && isTrackedExpression(child, bindings, checker)) {
      found = true;
    }
  });
  return found;
}

function isTrackableExpression(node: ts.Node): node is ts.Expression {
  return (
    ts.isIdentifier(node) ||
    ts.isPropertyAccessExpression(node) ||
    ts.isElementAccessExpression(node) ||
    ts.isCallExpression(node) ||
    ts.isNewExpression(node)
  );
}
