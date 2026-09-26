import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";

import { TabPane, type TabPaneTab } from "./TabPane";

type TabPaneEvent = "add" | "change" | "close";
type TabTarget = number | Element;

export type TabPaneHandle = {
  add(
    tab: Element,
    content: Element,
    location?: number | null,
    showNow?: boolean,
  ): void;
  addEvent(name: TabPaneEvent, listener: (index: number) => void): void;
  close(what: TabTarget): void;
  show(what: TabTarget): void;
};

export function mountReactTabPane(
  container: Element,
  options?: unknown,
  initialIndex?: number | (() => number),
): TabPaneHandle {
  if (options !== undefined && options !== null) {
    throw new Error("React TabPane does not support legacy options.");
  }

  const tabElements = [...container.querySelectorAll(".tab")];
  const panelElements = [...container.querySelectorAll(".content")];
  if (tabElements.length !== panelElements.length) {
    throw new Error("React TabPane needs one .content panel for each .tab.");
  }
  let tabs: TabPaneTab[] = [];
  tabElements.forEach((tab, index) => {
    tabs.push(readTab(tab, panelElements[index]!, tabs));
  });
  let selectedId: string | null = null;
  const listeners = {
    add: new Set<(index: number) => void>(),
    change: new Set<(index: number) => void>(),
    close: new Set<(index: number) => void>(),
  };

  container.replaceChildren();
  const root = createRoot(container);

  const render = () => {
    flushSync(() => {
      root.render(
        <TabPane
          onSelect={(index) => handle.show(index)}
          selectedId={selectedId}
          tabs={tabs}
        />,
      );
    });
  };
  const fire = (name: TabPaneEvent, index: number) => {
    for (const listener of listeners[name]) {
      listener.call(handle, index);
    }
  };
  const indexOf = (what: TabTarget) => {
    if (typeof what === "number") {
      return what;
    }
    const id =
      what.getAttribute("data-tab-id") ?? what.getAttribute("data-panel-id");
    return tabs.findIndex((tab) => tab.id === id);
  };

  const handle: TabPaneHandle = {
    add(tab, content, location, showNow) {
      const index =
        typeof location === "number" && tabs[location] !== undefined
          ? location
          : tabs.length;
      tabs = [
        ...tabs.slice(0, index),
        readTab(tab, content, tabs),
        ...tabs.slice(index),
      ];
      render();
      fire("add", index);
      if (showNow) {
        handle.show(index);
      }
    },
    addEvent(name, listener) {
      listeners[name].add(listener);
    },
    close(what) {
      const index = indexOf(what);
      if (tabs[index] === undefined) {
        return;
      }
      const selected = tabs.findIndex((tab) => tab.id === selectedId);
      const count = tabs.length;
      tabs = tabs.filter((_, tabIndex) => tabIndex !== index);
      render();
      fire("close", index);
      handle.show(Math.min(count - 2, Math.max(0, selected)));
    },
    show(what) {
      const index = indexOf(what);
      const tab = tabs[index];
      if (tab === undefined) {
        return;
      }
      selectedId = tab.id;
      render();
      fire("change", index);
    },
  };

  render();
  handle.show(
    typeof initialIndex === "function" ? initialIndex() : initialIndex || 0,
  );

  // The browser proof runner reads this handle and fixture acknowledgement.
  Object.assign(window, {
    ReactSandbox: {
      fixtureId: Reflect.get(window, "__MOOTOOLS_MIGRATION_FIXTURE_ID__"),
      tabPane: handle,
    },
  });
  return handle;
}

function readTab(
  tab: Element,
  panel: Element,
  existingTabs: TabPaneTab[],
): TabPaneTab {
  const closeButton = tab.querySelector("[data-close-tab]");
  const label = normalizeText(
    [...tab.childNodes]
      .filter((node) => node !== closeButton)
      .map((node) => node.textContent)
      .join(""),
  );
  const heading = panel.querySelector("h3");
  const body = panel.querySelector("p");
  if (heading === null || body === null) {
    throw new Error("React TabPane panels need an h3 heading and a p body.");
  }

  const baseId =
    label
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "") || "tab";
  let id = baseId;
  for (let suffix = 2; existingTabs.some((item) => item.id === id); suffix++) {
    id = `${baseId}-${suffix}`;
  }

  return {
    id,
    label,
    heading: normalizeText(heading.textContent),
    body: normalizeText(body.textContent),
    closable: closeButton !== null,
  };
}

function normalizeText(value: string | null): string {
  return (value ?? "").replace(/\s+/g, " ").trim();
}
