import ts from "typescript";

import {
  addNodeDraft,
  propertyName,
  slug,
  stringValue,
  type FindingDraft,
} from "./shared.js";
import { isLikelyDomReceiver } from "./dom.js";
import { walk } from "./source.js";

const TIMER_CALLS = new Set([
  "clearInterval",
  "clearTimeout",
  "setInterval",
  "setTimeout",
]);
const TIMER_METHODS = new Set(["delay", "periodical"]);
const EVENT_METHODS = new Set([
  "addEvent",
  "addEvents",
  "removeEvent",
  "removeEvents",
]);
const AXIOS_METHODS = new Set([
  "delete",
  "get",
  "head",
  "options",
  "patch",
  "post",
  "put",
  "request",
]);
const STORAGE_GLOBALS = new Set(["localStorage", "sessionStorage"]);
const ELEMENT_STORAGE_METHODS = new Set(["eliminate", "retrieve", "store"]);

export function analyzeEffects(options: {
  componentId: string;
  path: string;
  sourceFile: ts.SourceFile;
  drafts: Map<string, FindingDraft>;
  root?: ts.Node;
}): void {
  walk(options.root ?? options.sourceFile, (node) => {
    analyzeEventRegistration({ ...options, node });
    analyzeNetworkCall({ ...options, node });
    analyzeTimer({ ...options, node });
    analyzeStorage({ ...options, node });
    analyzeGlobalWrite({ ...options, node });
  });
}

function analyzeEventRegistration(options: {
  componentId: string;
  path: string;
  sourceFile: ts.SourceFile;
  drafts: Map<string, FindingDraft>;
  node: ts.Node;
}): void {
  if (
    !ts.isCallExpression(options.node) ||
    !ts.isPropertyAccessExpression(options.node.expression)
  ) {
    return;
  }
  const method = options.node.expression.name.text;
  if (!EVENT_METHODS.has(method)) {
    return;
  }

  if (method === "addEvents" || method === "removeEvents") {
    const eventMap = options.node.arguments[0];
    if (eventMap !== undefined && ts.isObjectLiteralExpression(eventMap)) {
      for (const property of eventMap.properties) {
        const eventName = propertyName(property.name);
        if (eventName !== null) {
          addEventDraft(options, property, method, eventName);
        }
      }
      return;
    }
  }

  const eventExpression = options.node.arguments[0];
  const eventName =
    stringValue(eventExpression) ??
    eventExpression?.getText(options.sourceFile) ??
    "unknown-event";
  addEventDraft(options, options.node, method, eventName);
  if (eventExpression !== undefined) {
    addRelaySelectorFindings(options, eventExpression, eventName);
  }
}

function addEventDraft(
  options: {
    componentId: string;
    path: string;
    sourceFile: ts.SourceFile;
    drafts: Map<string, FindingDraft>;
  },
  node: ts.Node,
  method: string,
  eventName: string,
): void {
  const action = method.startsWith("remove") ? "Removes" : "Registers";
  addNodeDraft({
    drafts: options.drafts,
    sourceFile: options.sourceFile,
    node,
    path: options.path,
    id: `${options.componentId}:event-listener:${slug(
      `${action}-${eventName}`,
    )}`,
    kind: "event-listener",
    summary: `${action} listener ${eventName}.`,
    suggestedAction:
      "Preserve required trigger, delegation, ordering, and cleanup behavior.",
    contractRelevant: true,
    decisionRequired: true,
  });
}

function addRelaySelectorFindings(
  options: {
    componentId: string;
    path: string;
    sourceFile: ts.SourceFile;
    drafts: Map<string, FindingDraft>;
  },
  expression: ts.Expression,
  eventName: string,
): void {
  const literalSelector = ts.isStringLiteralLike(expression)
    ? /:relay\(([^)]+)\)/.exec(eventName)?.[1]
    : undefined;
  if (literalSelector !== undefined) {
    addNodeDraft({
      drafts: options.drafts,
      sourceFile: options.sourceFile,
      node: expression,
      path: options.path,
      id: `${options.componentId}:selector:${slug(literalSelector)}`,
      kind: "selector",
      summary: `Delegated event uses selector ${literalSelector}.`,
      suggestedAction:
        "Preserve this event target or replace it with an explicit React handler.",
      contractRelevant: true,
      decisionRequired: true,
    });
  }

  walk(expression, (node) => {
    if (
      ts.isPropertyAccessExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      node.expression.name.text === "options" &&
      node.expression.expression.kind === ts.SyntaxKind.ThisKeyword
    ) {
      addNodeDraft({
        drafts: options.drafts,
        sourceFile: options.sourceFile,
        node,
        path: options.path,
        id: `${options.componentId}:selector-option:${slug(node.name.text)}`,
        kind: "selector",
        summary: `Delegated event uses selector option ${node.name.text}.`,
        suggestedAction:
          "Resolve the option default and caller overrides before migration.",
        contractRelevant: true,
        decisionRequired: true,
      });
    }
  });
}

function analyzeNetworkCall(options: {
  componentId: string;
  path: string;
  sourceFile: ts.SourceFile;
  drafts: Map<string, FindingDraft>;
  node: ts.Node;
}): void {
  const callName = networkCallName(options.node);
  if (callName === null) {
    return;
  }
  addNodeDraft({
    drafts: options.drafts,
    sourceFile: options.sourceFile,
    node: options.node,
    path: options.path,
    id: `${options.componentId}:api-call:${slug(callName)}`,
    kind: "api-call",
    summary: `Calls network API through ${callName}.`,
    suggestedAction:
      "Record URL, method, payload, response handling, cancellation, and errors.",
    contractRelevant: true,
    decisionRequired: true,
  });
}

function networkCallName(node: ts.Node): string | null {
  if (ts.isCallExpression(node)) {
    if (ts.isIdentifier(node.expression) && node.expression.text === "fetch") {
      return "fetch";
    }
    if (
      ts.isPropertyAccessExpression(node.expression) &&
      ts.isIdentifier(node.expression.expression) &&
      node.expression.expression.text === "axios" &&
      AXIOS_METHODS.has(node.expression.name.text)
    ) {
      return `axios.${node.expression.name.text}`;
    }
    if (
      ts.isPropertyAccessExpression(node.expression) &&
      node.expression.name.text === "send" &&
      ts.isIdentifier(node.expression.expression) &&
      /(?:request|xhr)/i.test(node.expression.expression.text)
    ) {
      return `${node.expression.expression.text}.send`;
    }
  }
  if (ts.isNewExpression(node)) {
    const name = expressionName(node.expression);
    if (
      name === "Request" ||
      name === "Request.JSON" ||
      name === "XMLHttpRequest" ||
      name === "WebSocket" ||
      name === "EventSource"
    ) {
      return name;
    }
  }
  return null;
}

function analyzeTimer(options: {
  componentId: string;
  path: string;
  sourceFile: ts.SourceFile;
  drafts: Map<string, FindingDraft>;
  node: ts.Node;
}): void {
  if (!ts.isCallExpression(options.node)) {
    return;
  }
  let timerName: string | null = null;
  if (
    ts.isIdentifier(options.node.expression) &&
    TIMER_CALLS.has(options.node.expression.text)
  ) {
    timerName = options.node.expression.text;
  } else if (
    ts.isPropertyAccessExpression(options.node.expression) &&
    TIMER_METHODS.has(options.node.expression.name.text)
  ) {
    timerName = options.node.expression.name.text;
  }
  if (timerName === null) {
    return;
  }
  addNodeDraft({
    drafts: options.drafts,
    sourceFile: options.sourceFile,
    node: options.node,
    path: options.path,
    id: `${options.componentId}:timer:${slug(timerName)}`,
    kind: "timer",
    summary: `Uses timer operation ${timerName}.`,
    suggestedAction:
      "Record start, reset, cleanup, interval, and user-action behavior.",
    contractRelevant: true,
    decisionRequired: true,
  });
}

function analyzeStorage(options: {
  componentId: string;
  path: string;
  sourceFile: ts.SourceFile;
  drafts: Map<string, FindingDraft>;
  node: ts.Node;
}): void {
  let storageName: string | null = null;
  if (
    ts.isPropertyAccessExpression(options.node) &&
    ts.isIdentifier(options.node.expression) &&
    STORAGE_GLOBALS.has(options.node.expression.text)
  ) {
    storageName = `${options.node.expression.text}.${options.node.name.text}`;
  } else if (
    ts.isPropertyAccessExpression(options.node) &&
    ts.isIdentifier(options.node.expression) &&
    options.node.expression.text === "document" &&
    options.node.name.text === "cookie"
  ) {
    storageName = "document.cookie";
  } else if (
    ts.isCallExpression(options.node) &&
    ts.isPropertyAccessExpression(options.node.expression) &&
    ELEMENT_STORAGE_METHODS.has(options.node.expression.name.text) &&
    isLikelyDomReceiver(options.node.expression.expression)
  ) {
    storageName = `Element.${options.node.expression.name.text}`;
  }
  if (storageName === null) {
    return;
  }
  addNodeDraft({
    drafts: options.drafts,
    sourceFile: options.sourceFile,
    node: options.node,
    path: options.path,
    id: `${options.componentId}:storage:${slug(storageName)}`,
    kind: "storage",
    summary: `Uses storage operation ${storageName}.`,
    suggestedAction:
      "Record key ownership, lifetime, cleanup, and cross-component consumers.",
    contractRelevant: true,
    decisionRequired: true,
  });
}

function analyzeGlobalWrite(options: {
  componentId: string;
  path: string;
  sourceFile: ts.SourceFile;
  drafts: Map<string, FindingDraft>;
  node: ts.Node;
}): void {
  if (
    !ts.isBinaryExpression(options.node) ||
    options.node.operatorToken.kind !== ts.SyntaxKind.EqualsToken
  ) {
    return;
  }
  const target = globalTargetName(options.node.left);
  if (target === null) {
    return;
  }
  addNodeDraft({
    drafts: options.drafts,
    sourceFile: options.sourceFile,
    node: options.node,
    path: options.path,
    id: `${options.componentId}:global-write:${slug(target)}`,
    kind: "side-effect",
    summary: `Writes browser global ${target}.`,
    suggestedAction:
      "Identify all consumers and keep the global only on the legacy boundary.",
    contractRelevant: true,
    decisionRequired: true,
  });
}

function globalTargetName(node: ts.Expression): string | null {
  if (
    ts.isPropertyAccessExpression(node) &&
    isGlobalObject(node.expression)
  ) {
    return `${node.expression.getText()}.${node.name.text}`;
  }
  if (
    ts.isElementAccessExpression(node) &&
    isGlobalObject(node.expression) &&
    node.argumentExpression !== undefined &&
    ts.isStringLiteralLike(node.argumentExpression)
  ) {
    return `${node.expression.getText()}[${node.argumentExpression.text}]`;
  }
  return null;
}

function isGlobalObject(node: ts.Expression): boolean {
  return (
    ts.isIdentifier(node) &&
    (node.text === "window" || node.text === "globalThis")
  );
}

function expressionName(node: ts.Expression): string {
  if (ts.isIdentifier(node)) {
    return node.text;
  }
  if (ts.isPropertyAccessExpression(node)) {
    return `${expressionName(node.expression)}.${node.name.text}`;
  }
  return node.getText();
}
