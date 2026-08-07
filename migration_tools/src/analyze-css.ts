import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import postcss, {
  type ChildNode,
  type Declaration,
  type Rule,
} from "postcss";
import selectorParser from "postcss-selector-parser";

import {
  addDraft,
  slug,
  type EvidenceLocation,
  type FindingDraft,
} from "./analysis-shared.js";
import type { ComponentConfig } from "./schemas.js";

export async function analyzeCssAst(options: {
  projectRoot: string;
  config: ComponentConfig;
  drafts: Map<string, FindingDraft>;
}): Promise<void> {
  const knownMarkup = collectKnownMarkup(options.drafts, options.config);
  const usedCustomProperties = new Set<string>();
  const stylesheets: {
    path: string;
    root: ReturnType<typeof postcss.parse>;
  }[] = [];
  for (const path of options.config.cssFiles) {
    const source = await readFile(resolve(options.projectRoot, path), "utf8");
    stylesheets.push({ path, root: postcss.parse(source, { from: path }) });
  }

  for (const { path, root } of stylesheets) {
    root.walkAtRules("import", (rule) => {
      addDraft(options.drafts, {
        id: `${options.config.id}:dependency:css-import:${slug(rule.params)}`,
        kind: "dependency",
        summary: `CSS imports ${rule.params}.`,
        evidence: [nodeLocation(path, rule)],
        suggestedAction:
          "Keep required CSS load order until React owns these styles.",
        contractRelevant: true,
        decisionRequired: true,
      });
    });

    root.walkRules((rule) => {
      const parsed = parseSelectorHooks(rule.selector);
      if (parsed.kind === "error") {
        addDraft(options.drafts, {
          id: `${options.config.id}:unknown:css-selector:${slug(
            rule.selector,
          )}`,
          kind: "unknown",
          summary: `Could not parse CSS selector ${rule.selector}.`,
          evidence: [nodeLocation(path, rule)],
          suggestedAction: "Review this selector manually.",
          contractRelevant: true,
          decisionRequired: true,
        });
        return;
      }
      const matchingBranches = parsed.branches.filter((branch) =>
        selectorBranchMatches(branch, knownMarkup),
      );
      if (matchingBranches.length === 0) {
        return;
      }
      addRuleFindings({
        componentId: options.config.id,
        path,
        rule,
        selectorHooks: [
          ...new Set(matchingBranches.flatMap((branch) => branch.hooks)),
        ],
        usedCustomProperties,
        drafts: options.drafts,
      });
    });

  }

  for (const property of usedCustomProperties) {
    for (const { path, root } of stylesheets) {
      root.walkDecls(property, (declaration) => {
        addDraft(options.drafts, {
          id: `${options.config.id}:style:custom-property:${slug(property)}`,
          kind: "style",
          summary: `Defines required CSS custom property ${property}.`,
          evidence: [nodeLocation(path, declaration)],
          suggestedAction:
            "Preserve the value source or replace all consumers together.",
          contractRelevant: true,
          decisionRequired: true,
        });
      });
    }
  }
}

function addRuleFindings(options: {
  componentId: string;
  path: string;
  rule: Rule;
  selectorHooks: string[];
  usedCustomProperties: Set<string>;
  drafts: Map<string, FindingDraft>;
}): void {
  const location = nodeLocation(options.path, options.rule);
  addDraft(options.drafts, {
    id: `${options.componentId}:selector:${slug(options.rule.selector)}`,
    kind: "selector",
    summary: `CSS selector ${options.rule.selector}.`,
    evidence: [location],
    suggestedAction:
      "Preserve required targeting and states, then move style ownership.",
    contractRelevant: true,
    decisionRequired: true,
  });

  const declarations: string[] = [];
  options.rule.walkDecls((declaration) => {
    declarations.push(`${declaration.prop}: ${declaration.value}`);
    for (const customProperty of customPropertiesIn(declaration)) {
      options.usedCustomProperties.add(customProperty);
    }
    if (declaration.prop.startsWith("--")) {
      addDraft(options.drafts, {
        id: `${options.componentId}:style:custom-property:${slug(
          declaration.prop,
        )}`,
        kind: "style",
        summary: `Defines component CSS custom property ${declaration.prop}.`,
        evidence: [nodeLocation(options.path, declaration)],
        suggestedAction:
          "Keep this public variable when callers or themes provide it.",
        contractRelevant: true,
        decisionRequired: true,
      });
    }
  });
  const context = atRuleContext(options.rule);
  addDraft(options.drafts, {
    id: `${options.componentId}:style-rule:${slug(
      `${options.rule.selector}-${context}`,
    )}`,
    kind: "style",
    summary: `CSS rule ${options.rule.selector}${
      context === "" ? "" : ` under ${context}`
    } sets ${declarations.join("; ")}.`,
    evidence: [location],
    suggestedAction:
      "Compare these computed properties in each matching visual state.",
    contractRelevant: true,
    decisionRequired: true,
  });

  for (const hook of options.selectorHooks) {
    addDraft(options.drafts, {
      id: `${options.componentId}:selector:${slug(hook)}`,
      kind: "selector",
      summary: `CSS uses hook ${hook}.`,
      evidence: [location],
      suggestedAction:
        "Search markup, scripts, tests, and callers before changing this hook.",
      contractRelevant: true,
      decisionRequired: true,
    });
  }
}

function parseSelectorHooks(
  selector: string,
):
  | {
      kind: "ok";
      branches: { hooks: string[]; tags: string[] }[];
    }
  | { kind: "error" } {
  try {
    const branches: { hooks: string[]; tags: string[] }[] = [];
    selectorParser((root) => {
      root.each((selectorNode) => {
        const hooks = new Set<string>();
        const tags = new Set<string>();
        selectorNode.walkClasses((node) => {
          hooks.add(`.${node.value}`);
        });
        selectorNode.walkIds((node) => {
          hooks.add(`#${node.value}`);
        });
        selectorNode.walkAttributes((node) => {
          hooks.add(`[${node.attribute}]`);
        });
        selectorNode.walkTags((node) => {
          tags.add(node.value.toLowerCase());
        });
        branches.push({ hooks: [...hooks], tags: [...tags] });
      });
    }).processSync(selector);
    return { kind: "ok", branches };
  } catch {
    return { kind: "error" };
  }
}

function collectKnownMarkup(
  drafts: Map<string, FindingDraft>,
  config: ComponentConfig,
): { hooks: Set<string>; tags: Set<string> } {
  const hooks = new Set(
    config.markupFiles.map((entry) => normalizeHook(entry.rootSelector)),
  );
  const tags = new Set<string>();
  for (const draft of drafts.values()) {
    if (draft.kind === "selector") {
      const match = /(?:selector|hook) (.+)\.$/.exec(draft.summary);
      const hook = match?.[1];
      if (hook !== undefined) {
        hooks.add(normalizeHook(hook));
      }
    }
    if (draft.kind === "markup") {
      const markupTag = /^(?:Markup contains|Creates dynamic) <([a-zA-Z0-9-]+)/.exec(
        draft.summary,
      )?.[1];
      if (markupTag !== undefined) {
        tags.add(markupTag.toLowerCase());
      }
    }
  }
  return { hooks, tags };
}

function isStructuralHook(hook: string): boolean {
  return (
    hook.startsWith(".") ||
    hook.startsWith("#") ||
    hook.startsWith("[")
  );
}

function normalizeHook(hook: string): string {
  if (!hook.startsWith("[")) {
    return hook;
  }
  const attribute = /^\[([^=\]]+)/.exec(hook)?.[1];
  return attribute === undefined ? hook : `[${attribute}]`;
}

function selectorBranchMatches(
  branch: { hooks: string[]; tags: string[] },
  known: { hooks: Set<string>; tags: Set<string> },
): boolean {
  const requiredHooks = branch.hooks.filter(isStructuralHook);
  if (requiredHooks.length > 0) {
    return requiredHooks.every((hook) =>
      known.hooks.has(normalizeHook(hook)),
    );
  }
  return branch.tags.some((tag) => known.tags.has(tag));
}

function customPropertiesIn(declaration: Declaration): string[] {
  const matches = declaration.value.matchAll(/var\(\s*(--[a-zA-Z0-9_-]+)/g);
  return [...matches].map((match) => match[1]).filter(isString);
}

function atRuleContext(node: ChildNode): string {
  const rules: string[] = [];
  let parent: unknown = node.parent;
  while (isPostCssNode(parent)) {
    if (Reflect.get(parent, "type") === "atrule") {
      const name = Reflect.get(parent, "name");
      const params = Reflect.get(parent, "params");
      if (typeof name === "string" && typeof params === "string") {
        rules.push(`@${name} ${params}`.trim());
      }
    }
    parent = Reflect.get(parent, "parent");
  }
  return rules.reverse().join(" / ");
}

function nodeLocation(
  path: string,
  node: ChildNode,
): EvidenceLocation {
  return {
    path,
    startLine: node.source?.start?.line ?? 1,
    endLine: node.source?.end?.line ?? node.source?.start?.line ?? 1,
  };
}

function isString(value: string | undefined): value is string {
  return value !== undefined;
}

function isPostCssNode(value: unknown): value is object {
  return typeof value === "object" && value !== null;
}
