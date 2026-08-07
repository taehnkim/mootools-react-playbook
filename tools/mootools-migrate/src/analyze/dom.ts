import ts from "typescript";

import {
  addNodeDraft,
  propertyName,
  slug,
  stringValue,
  type FindingDraft,
} from "./shared.js";
import { walk } from "./source.js";

const DOM_READ_METHODS = new Set([
  "closest",
  "contains",
  "get",
  "getElement",
  "getElementById",
  "getElements",
  "getElementsByClassName",
  "getElementsByTagName",
  "getParent",
  "id",
  "match",
  "matches",
  "querySelector",
  "querySelectorAll",
]);
const DOM_WRITE_METHODS = new Set([
  "addClass",
  "adopt",
  "after",
  "append",
  "appendChild",
  "before",
  "destroy",
  "empty",
  "inject",
  "insertBefore",
  "prepend",
  "remove",
  "removeAttribute",
  "removeChild",
  "removeClass",
  "replaceChildren",
  "replaceWith",
  "set",
  "setAttribute",
  "setStyle",
  "setStyles",
  "toggleAttribute",
]);
const DOM_PROPERTY_WRITES = new Set([
  "className",
  "hidden",
  "innerHTML",
  "outerHTML",
  "textContent",
  "value",
]);

export function analyzeDomOperations(options: {
  componentId: string;
  path: string;
  sourceFile: ts.SourceFile;
  drafts: Map<string, FindingDraft>;
  root?: ts.Node;
}): void {
  walk(options.root ?? options.sourceFile, (node) => {
    analyzeDomCall({ ...options, node });
    analyzeDomConstruction({ ...options, node });
    analyzeDomAssignment({ ...options, node });
  });
}

function analyzeDomCall(options: {
  componentId: string;
  path: string;
  sourceFile: ts.SourceFile;
  drafts: Map<string, FindingDraft>;
  node: ts.Node;
}): void {
  if (!ts.isCallExpression(options.node)) {
    return;
  }
  let method: string | null = null;
  let receiver: ts.Expression | null = null;
  if (ts.isPropertyAccessExpression(options.node.expression)) {
    method = options.node.expression.name.text;
    receiver = options.node.expression.expression;
  } else if (
    ts.isIdentifier(options.node.expression) &&
    (options.node.expression.text === "$" ||
      options.node.expression.text === "$$")
  ) {
    method = options.node.expression.text;
  }
  if (method === null) {
    return;
  }

  const hasDomReceiver =
    receiver !== null && isLikelyDomReceiver(receiver);
  if (
    (DOM_READ_METHODS.has(method) && hasDomReceiver) ||
    method === "$" ||
    method === "$$"
  ) {
    addDomFinding(options, options.node, "dom-read", method);
    addSelectorArgument(options, options.node, method);
  }
  if (DOM_WRITE_METHODS.has(method) && hasDomReceiver) {
    addDomFinding(options, options.node, "dom-write", method);
    if (
      method === "setAttribute" ||
      method === "removeAttribute" ||
      method === "toggleAttribute"
    ) {
      const attribute = stringValue(options.node.arguments[0]);
      if (attribute !== null) {
        addHookFinding(options, options.node, `[${attribute}]`);
      }
    }
  }
  if (
    ts.isPropertyAccessExpression(options.node.expression) &&
    ts.isPropertyAccessExpression(options.node.expression.expression) &&
    options.node.expression.expression.name.text === "classList"
  ) {
    addDomFinding(
      options,
      options.node,
      "dom-write",
      `classList.${method}`,
    );
  }
  if (
    ts.isPropertyAccessExpression(options.node.expression) &&
    ts.isIdentifier(options.node.expression.expression) &&
    options.node.expression.expression.text === "document" &&
    method === "createElement"
  ) {
    const tag = stringValue(options.node.arguments[0]);
    if (tag !== null) {
      addMarkupFinding(options, options.node, tag);
    }
  }
}

export function isLikelyDomReceiver(node: ts.Expression): boolean {
  if (ts.isIdentifier(node)) {
    return (
      node.text === "document" ||
      node.text === "window" ||
      /(?:button|container|content|element|input|node|panel|tab|target)s?$/i.test(
        node.text,
      )
    );
  }
  if (ts.isPropertyAccessExpression(node)) {
    if (
      ts.isIdentifier(node.expression) &&
      (node.expression.text === "document" ||
        node.expression.text === "window")
    ) {
      return true;
    }
    return /(?:button|container|content|element|input|node|panel|tab|target)s?$/i.test(
      node.name.text,
    );
  }
  if (
    ts.isCallExpression(node) &&
    ts.isPropertyAccessExpression(node.expression)
  ) {
    return (
      DOM_READ_METHODS.has(node.expression.name.text) &&
      isLikelyDomReceiver(node.expression.expression)
    );
  }
  if (ts.isElementAccessExpression(node)) {
    return isLikelyDomReceiver(node.expression);
  }
  if (
    ts.isNewExpression(node) &&
    ts.isIdentifier(node.expression) &&
    node.expression.text === "Element"
  ) {
    return true;
  }
  return false;
}

function analyzeDomConstruction(options: {
  componentId: string;
  path: string;
  sourceFile: ts.SourceFile;
  drafts: Map<string, FindingDraft>;
  node: ts.Node;
}): void {
  if (
    !ts.isNewExpression(options.node) ||
    !ts.isIdentifier(options.node.expression) ||
    options.node.expression.text !== "Element"
  ) {
    return;
  }
  const tag = stringValue(options.node.arguments?.[0]);
  if (tag !== null) {
    addMarkupFinding(options, options.node, tag);
  }
  const properties = options.node.arguments?.[1];
  if (properties === undefined || !ts.isObjectLiteralExpression(properties)) {
    return;
  }
  for (const property of properties.properties) {
    if (!ts.isPropertyAssignment(property)) {
      continue;
    }
    const name = propertyName(property.name);
    const value = stringValue(property.initializer);
    if (name === null || value === null) {
      continue;
    }
    if (name === "class") {
      for (const className of value.split(/\s+/).filter(Boolean)) {
        addHookFinding(options, property, `.${className}`);
      }
    } else if (
      name === "id" ||
      name.startsWith("data-") ||
      name.startsWith("aria-") ||
      name === "role"
    ) {
      addHookFinding(options, property, `[${name}="${value}"]`);
    }
  }
}

function analyzeDomAssignment(options: {
  componentId: string;
  path: string;
  sourceFile: ts.SourceFile;
  drafts: Map<string, FindingDraft>;
  node: ts.Node;
}): void {
  if (
    !ts.isBinaryExpression(options.node) ||
    options.node.operatorToken.kind !== ts.SyntaxKind.EqualsToken ||
    !ts.isPropertyAccessExpression(options.node.left)
  ) {
    return;
  }
  const property = options.node.left.name.text;
  if (
    DOM_PROPERTY_WRITES.has(property) ||
    (ts.isPropertyAccessExpression(options.node.left.expression) &&
      options.node.left.expression.name.text === "style")
  ) {
    addDomFinding(options, options.node, "dom-write", `property.${property}`);
  }
}

function addDomFinding(
  options: {
    componentId: string;
    path: string;
    sourceFile: ts.SourceFile;
    drafts: Map<string, FindingDraft>;
  },
  node: ts.Node,
  kind: "dom-read" | "dom-write",
  operation: string,
): void {
  addNodeDraft({
    drafts: options.drafts,
    sourceFile: options.sourceFile,
    node,
    path: options.path,
    id: `${options.componentId}:${kind}:${slug(operation)}`,
    kind,
    summary: `${kind === "dom-read" ? "Reads" : "Writes"} DOM through ${operation}.`,
    suggestedAction:
      kind === "dom-read"
        ? "Map this read to fixture data, React state, or a boundary ref."
        : "Give React sole ownership of this mutation.",
    contractRelevant: kind === "dom-write",
    decisionRequired: false,
  });
}

function addSelectorArgument(
  options: {
    componentId: string;
    path: string;
    sourceFile: ts.SourceFile;
    drafts: Map<string, FindingDraft>;
  },
  node: ts.CallExpression,
  method: string,
): void {
  const value = stringValue(node.arguments[0]);
  if (value === null) {
    return;
  }
  const selector =
    method === "getElementById" || method === "id" || method === "$"
      ? `#${value}`
      : value;
  if (
    selector.startsWith("#") ||
    selector.startsWith(".") ||
    selector.startsWith("[")
  ) {
    addHookFinding(options, node, selector);
  }
}

function addHookFinding(
  options: {
    componentId: string;
    path: string;
    sourceFile: ts.SourceFile;
    drafts: Map<string, FindingDraft>;
  },
  node: ts.Node,
  hook: string,
): void {
  addNodeDraft({
    drafts: options.drafts,
    sourceFile: options.sourceFile,
    node,
    path: options.path,
    id: `${options.componentId}:selector:${slug(hook)}`,
    kind: "selector",
    summary: `DOM code uses hook ${hook}.`,
    suggestedAction:
      "Search scripts, markup, CSS, tests, and callers before changing this hook.",
    contractRelevant: true,
    decisionRequired: true,
  });
}

function addMarkupFinding(
  options: {
    componentId: string;
    path: string;
    sourceFile: ts.SourceFile;
    drafts: Map<string, FindingDraft>;
  },
  node: ts.Node,
  tag: string,
): void {
  addNodeDraft({
    drafts: options.drafts,
    sourceFile: options.sourceFile,
    node,
    path: options.path,
    id: `${options.componentId}:markup:dynamic-${slug(tag)}`,
    kind: "markup",
    summary: `Creates dynamic <${tag}> element.`,
    suggestedAction:
      "Preserve required semantics, hooks, order, and focus behavior in React.",
    contractRelevant: true,
    decisionRequired: true,
  });
}
