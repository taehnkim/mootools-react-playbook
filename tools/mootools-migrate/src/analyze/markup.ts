import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { parse, type DefaultTreeAdapterMap } from "parse5";

import {
  addDraft,
  slug,
  type FindingDraft,
} from "./shared.js";
import type { ComponentConfig } from "../contracts/schemas.js";

type HtmlNode = DefaultTreeAdapterMap["node"];
type HtmlElement = DefaultTreeAdapterMap["element"];

const INTERACTIVE_TAGS = new Set([
  "a",
  "button",
  "form",
  "input",
  "select",
  "textarea",
]);

export async function analyzeMarkup(options: {
  projectRoot: string;
  config: ComponentConfig;
  drafts: Map<string, FindingDraft>;
}): Promise<void> {
  for (const entry of options.config.markupFiles) {
    const source = await readFile(resolve(options.projectRoot, entry.path), "utf8");
    const document = parse(source, { sourceCodeLocationInfo: true });
    const root = findElement(document, (element) =>
      matchesSimpleSelector(element, entry.rootSelector),
    );
    if (root === null) {
      addDraft(options.drafts, {
        id: `${options.config.id}:unknown:markup-root:${slug(
          entry.rootSelector,
        )}`,
        kind: "unknown",
        summary: `Markup root ${entry.rootSelector} was not found.`,
        evidence: [{ path: entry.path, startLine: 1, endLine: 1 }],
        suggestedAction:
          "Fix the configured root before using markup analysis.",
        contractRelevant: true,
        decisionRequired: true,
      });
      continue;
    }
    walkElements(root, (element) => {
      addElementFindings({
        componentId: options.config.id,
        path: entry.path,
        rootSelector: entry.rootSelector,
        element,
        drafts: options.drafts,
      });
    });
  }
}

function addElementFindings(options: {
  componentId: string;
  path: string;
  rootSelector: string;
  element: HtmlElement;
  drafts: Map<string, FindingDraft>;
}): void {
  const location = elementLocation(options.path, options.element);
  const signature = elementSignature(options.element);
  const hooks = stableHooks(options.element);
  const contractRelevant =
    hooks.length > 0 || INTERACTIVE_TAGS.has(options.element.tagName);
  addDraft(options.drafts, {
    id: `${options.componentId}:markup:${slug(signature)}`,
    kind: "markup",
    summary: `Markup contains ${signature} under ${options.rootSelector}.`,
    evidence: [location],
    suggestedAction:
      "Preserve required order, semantics, focus behavior, and public hooks.",
    contractRelevant,
    decisionRequired: contractRelevant,
  });

  for (const hook of hooks) {
    addDraft(options.drafts, {
      id: `${options.componentId}:selector:${slug(hook)}`,
      kind: "selector",
      summary: `Markup exposes hook ${hook}.`,
      evidence: [location],
      suggestedAction:
        "Search CSS, tests, and callers before changing this hook.",
      contractRelevant: true,
      decisionRequired: true,
    });
  }

  const childElements = options.element.childNodes.filter(isElement);
  if (childElements.length > 1) {
    const childOrder = childElements.map(elementSignature).join(" -> ");
    addDraft(options.drafts, {
      id: `${options.componentId}:markup-order:${slug(
        `${signature}-${childOrder}`,
      )}`,
      kind: "markup",
      summary: `${signature} child order is ${childOrder}.`,
      evidence: [location],
      suggestedAction:
        "Keep this order when index pairing, CSS, focus, or callers depend on it.",
      contractRelevant: true,
      decisionRequired: true,
    });
  }

  for (const attribute of options.element.attrs) {
    if (attribute.name.startsWith("on")) {
      addDraft(options.drafts, {
        id: `${options.componentId}:side-effect:inline-${slug(
          attribute.name,
        )}`,
        kind: "side-effect",
        summary: `${signature} uses inline handler ${attribute.name}.`,
        evidence: [location],
        suggestedAction:
          "Move this handler to an explicit React callback and preserve ordering.",
        contractRelevant: true,
        decisionRequired: true,
      });
    }
  }
}

function stableHooks(element: HtmlElement): string[] {
  const hooks: string[] = [];
  for (const attribute of element.attrs) {
    if (attribute.name === "id") {
      hooks.push(`#${attribute.value}`);
    } else if (attribute.name === "class") {
      for (const className of attribute.value.split(/\s+/).filter(Boolean)) {
        hooks.push(`.${className}`);
      }
    } else if (attribute.name.startsWith("data-")) {
      hooks.push(`[${attribute.name}="${attribute.value}"]`);
    } else if (attribute.name === "role") {
      hooks.push(`[role="${attribute.value}"]`);
    } else if (attribute.name.startsWith("aria-")) {
      hooks.push(`[${attribute.name}="${attribute.value}"]`);
    }
  }
  return hooks;
}

function elementSignature(element: HtmlElement): string {
  const id = attributeValue(element, "id");
  const classes = attributeValue(element, "class")
    ?.split(/\s+/)
    .filter(Boolean)
    .map((className) => `.${className}`)
    .join("");
  return `<${element.tagName}${id === null ? "" : `#${id}`}${
    classes ?? ""
  }>`;
}

function matchesSimpleSelector(
  element: HtmlElement,
  selector: string,
): boolean {
  if (selector.startsWith("#")) {
    return attributeValue(element, "id") === selector.slice(1);
  }
  if (selector.startsWith(".")) {
    return (
      attributeValue(element, "class")
        ?.split(/\s+/)
        .includes(selector.slice(1)) ?? false
    );
  }
  return element.tagName === selector.toLowerCase();
}

function findElement(
  node: HtmlNode,
  predicate: (element: HtmlElement) => boolean,
): HtmlElement | null {
  if (isElement(node) && predicate(node)) {
    return node;
  }
  if ("childNodes" in node) {
    for (const child of node.childNodes) {
      const found = findElement(child, predicate);
      if (found !== null) {
        return found;
      }
    }
  }
  return null;
}

function walkElements(
  element: HtmlElement,
  visit: (current: HtmlElement) => void,
): void {
  visit(element);
  for (const child of element.childNodes) {
    if (isElement(child)) {
      walkElements(child, visit);
    }
  }
}

function isElement(node: HtmlNode): node is HtmlElement {
  return "tagName" in node && "attrs" in node;
}

function attributeValue(
  element: HtmlElement,
  name: string,
): string | null {
  return element.attrs.find((attribute) => attribute.name === name)?.value ?? null;
}

function elementLocation(
  path: string,
  element: HtmlElement,
): { path: string; startLine: number; endLine: number } {
  return {
    path,
    startLine: element.sourceCodeLocation?.startLine ?? 1,
    endLine: element.sourceCodeLocation?.endLine ?? 1,
  };
}
