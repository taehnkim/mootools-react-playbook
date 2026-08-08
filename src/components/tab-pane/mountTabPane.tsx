import { createElement, type ReactNode } from "react";
import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";

import {
  TabPane,
  type TabPaneEventListener,
  type TabPaneEventName,
  type TabPaneHandle,
  type TabPaneTab,
} from "./TabPane";

type TabTarget = number | Element;

export type MountedTabPane = {
  add(
    tab: Element,
    panel: Element,
    location?: number | null,
    showNow?: boolean,
  ): void;
  addEvent(name: TabPaneEventName, listener: TabPaneEventListener): void;
  close(target: TabTarget): void;
  removeEvent(name: TabPaneEventName, listener: TabPaneEventListener): void;
  show(target: TabTarget): void;
};

export function mountReactTabPane(
  container: Element,
  options: unknown = undefined,
  initialIndex: number | (() => number) = 0,
): MountedTabPane {
  void options;
  const initialTabs = snapshotTabs(container);
  const stableIds = initialTabs.map((tab) => tab.id);
  const selectedIndex = resolveInitialIndex(initialIndex, initialTabs.length);
  const selectedTab = initialTabs[selectedIndex];
  if (selectedTab === undefined) {
    throw new Error("The TabPane container has no matching tabs and panels.");
  }

  container.setAttribute("data-migration-component", "tab-pane");
  let tabPaneHandle: TabPaneHandle | null = null;
  const root = createRoot(container);
  flushSync(() => {
    root.render(
      <TabPane
        closeOwner="host"
        initialSelectedId={selectedTab.id}
        initialTabs={initialTabs}
        onMinimumTabClose={() => undefined}
        ref={(handle) => {
          tabPaneHandle = handle;
        }}
      />,
    );
  });

  const handle = requireHandle(tabPaneHandle);
  handle.addEvent("close", (index) => {
    if (index >= 0 && index < stableIds.length) {
      stableIds.splice(index, 1);
    }
  });
  window.ReactSandbox = {
    fixtureId: readFixtureId(),
    tabPane: handle,
  };

  return {
    add(tab, panel, location, showNow = false) {
      const usedIds = new Set(stableIds);
      const nextTab = snapshotTab(
        tab,
        panel,
        usedIds,
        stableIds.length,
      );
      const insertionIndex = resolveInsertionIndex(
        location,
        stableIds.length,
      );
      stableIds.splice(insertionIndex, 0, nextTab.id);
      flushSync(() => {
        handle.add(nextTab, showNow, insertionIndex);
      });
    },
    addEvent(name, listener) {
      handle.addEvent(name, listener);
    },
    close(target) {
      const index = resolveTargetIndex(target, stableIds);
      if (index === -1) {
        return;
      }
      flushSync(() => {
        handle.close(index);
      });
    },
    removeEvent(name, listener) {
      handle.removeEvent(name, listener);
    },
    show(target) {
      const index = resolveTargetIndex(target, stableIds);
      if (index === -1) {
        return;
      }
      flushSync(() => {
        handle.show(index);
      });
    },
  };
}

function snapshotTabs(container: Element): TabPaneTab[] {
  const tabElements = [...container.querySelectorAll<Element>(".tab")];
  const panelElements = [...container.querySelectorAll<Element>(".content")];
  if (
    tabElements.length === 0 ||
    tabElements.length !== panelElements.length
  ) {
    throw new Error("The TabPane container needs one panel for every tab.");
  }

  const usedIds = new Set<string>();
  return tabElements.map((tab, index) => {
    const panel = panelElements[index];
    if (panel === undefined) {
      throw new Error(`The TabPane panel at index ${index} is missing.`);
    }
    return snapshotTab(tab, panel, usedIds, index);
  });
}

function snapshotTab(
  tab: Element,
  panel: Element,
  usedIds: Set<string>,
  index: number,
): TabPaneTab {
  const label = tabLabel(tab, index);
  const id = uniqueTabId(tab.getAttribute("data-tab-id"), label, index, usedIds);
  tab.setAttribute("data-tab-id", id);
  panel.setAttribute("data-tab-id", id);
  return {
    id,
    label,
    content: [...panel.childNodes].map((node, childIndex) =>
      domNodeToReactNode(node, `${id}-${childIndex}`),
    ),
    closable: tab.querySelector("[data-close-tab]") !== null,
  };
}

function tabLabel(tab: Element, index: number): string {
  const label = tab.querySelector("span")?.textContent?.trim();
  if (label !== undefined && label !== "") {
    return label;
  }
  const clone = tab.cloneNode(true);
  if (clone instanceof Element) {
    clone.querySelectorAll("[data-close-tab]").forEach((button) => {
      button.remove();
    });
    const text = clone.textContent?.trim();
    if (text !== undefined && text !== "") {
      return text;
    }
  }
  return `Tab ${index + 1}`;
}

function uniqueTabId(
  requestedId: string | null,
  label: string,
  index: number,
  usedIds: Set<string>,
): string {
  const requested = requestedId?.trim();
  const slug = label
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
  const base = requested || slug || `tab-${index + 1}`;
  let id = base;
  let suffix = 2;
  while (usedIds.has(id)) {
    id = `${base}-${suffix}`;
    suffix += 1;
  }
  usedIds.add(id);
  return id;
}

function domNodeToReactNode(node: Node, key: string): ReactNode {
  if (node.nodeType === Node.TEXT_NODE) {
    return node.textContent;
  }
  if (!(node instanceof Element)) {
    return null;
  }

  const properties: Record<string, unknown> = { key };
  for (const attribute of node.attributes) {
    switch (attribute.name) {
      case "class":
        properties.className = attribute.value;
        break;
      case "for":
        properties.htmlFor = attribute.value;
        break;
      case "style":
        properties.style = reactStyle(attribute.value, node.ownerDocument);
        break;
      default:
        properties[attribute.name] = attribute.value;
        break;
    }
  }
  const children = [...node.childNodes].map((child, index) =>
    domNodeToReactNode(child, `${key}-${index}`),
  );
  return createElement(node.localName, properties, ...children);
}

function reactStyle(
  cssText: string,
  ownerDocument: Document,
): Record<string, string> {
  const declaration = ownerDocument.createElement("span").style;
  declaration.cssText = cssText;
  const style: Record<string, string> = {};
  for (const property of declaration) {
    style[reactStyleName(property)] = declaration.getPropertyValue(property);
  }
  return style;
}

function reactStyleName(property: string): string {
  if (property.startsWith("--")) {
    return property;
  }
  return property.replace(/^-ms-/, "ms-").replace(/-([a-z])/g, (_, letter) =>
    letter.toUpperCase(),
  );
}

function resolveInitialIndex(
  initialIndex: number | (() => number),
  tabCount: number,
): number {
  const index =
    typeof initialIndex === "function" ? initialIndex() : initialIndex;
  return Number.isInteger(index) && index >= 0 && index < tabCount ? index : 0;
}

function resolveInsertionIndex(
  location: number | null | undefined,
  tabCount: number,
): number {
  return typeof location === "number" &&
    Number.isInteger(location) &&
    location >= 0 &&
    location < tabCount
    ? location
    : tabCount;
}

function resolveTargetIndex(
  target: TabTarget,
  stableIds: readonly string[],
): number {
  if (typeof target === "number") {
    return target;
  }
  const id = target.getAttribute("data-tab-id");
  return id === null ? -1 : stableIds.indexOf(id);
}

function readFixtureId(): string {
  return typeof window.__MOOTOOLS_MIGRATION_FIXTURE_ID__ === "string"
    ? window.__MOOTOOLS_MIGRATION_FIXTURE_ID__
    : "default-tabs";
}

function requireHandle(handle: TabPaneHandle | null): TabPaneHandle {
  if (handle === null) {
    throw new Error("The React TabPane handle was not assigned synchronously.");
  }
  return handle;
}
