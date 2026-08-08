import { act } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { mountReactTabPane } from "./mountTabPane";

afterEach(() => {
  document.body.replaceChildren();
  delete window.ReactSandbox;
  delete window.__MOOTOOLS_MIGRATION_FIXTURE_ID__;
});

describe("mountReactTabPane", () => {
  it("returns after one existing container owns the initial React tree", () => {
    const fixture = createFixture();
    window.__MOOTOOLS_MIGRATION_FIXTURE_ID__ = "mount-fixture";

    const handle = mountReactTabPane(fixture.container, undefined, 1);

    expect(Object.keys(handle).sort()).toEqual([
      "add",
      "addEvent",
      "close",
      "removeEvent",
      "show",
    ]);
    expect(
      document.querySelectorAll('[data-migration-component="tab-pane"]'),
    ).toHaveLength(1);
    expect(fixture.container.querySelector("#tab-pane")).toBeNull();
    expect(
      fixture.container.querySelector(
        '[data-panel-id="behavior"] > h3 > em',
      )?.textContent,
    ).toBe("Behavior heading");
    expect(
      fixture.container
        .querySelector('[data-tab-id="behavior"]')
        ?.getAttribute("aria-selected"),
    ).toBe("true");
    expect(
      fixture.container.querySelector<HTMLElement>(
        '[data-panel-id="behavior"]',
      )?.style.display,
    ).toBe("block");
    expect(window.ReactSandbox?.fixtureId).toBe("mount-fixture");
    expect(window.ReactSandbox?.tabPane).toBeDefined();
  });

  it("keeps element targets and event order stable across direct handle calls", () => {
    const fixture = createFixture();
    const handle = mountReactTabPane(fixture.container, {}, 0);
    const events: string[] = [];
    const removedListener = vi.fn();
    handle.addEvent("add", (index) => events.push(`add:${index}`));
    handle.addEvent("change", (index) => events.push(`change:${index}`));
    handle.addEvent("close", (index) => events.push(`close:${index}`));

    const addedTab = document.createElement("li");
    addedTab.className = "tab";
    addedTab.innerHTML =
      '<span>Added tab</span><button data-close-tab type="button">×</button>';
    const addedPanel = document.createElement("section");
    addedPanel.className = "content";
    addedPanel.innerHTML = "<h3>Added heading</h3><p>Added panel</p>";

    handle.add(addedTab, addedPanel, 1, true);
    expect(events).toEqual(["add:1", "change:1"]);
    expect(
      fixture.container
        .querySelector('[data-tab-id="added-tab"]')
        ?.getAttribute("aria-selected"),
    ).toBe("true");

    handle.show(requireElement(fixture.panels, 1));
    expect(events.at(-1)).toBe("change:2");

    const reactHandle = requireReactHandle();
    act(() => reactHandle.close(0));
    handle.show(requireElement(fixture.tabs, 2));
    expect(
      fixture.container
        .querySelector('[data-tab-id="notes"]')
        ?.getAttribute("aria-selected"),
    ).toBe("true");

    handle.addEvent("change", removedListener);
    handle.removeEvent("change", removedListener);
    handle.show(addedTab);
    expect(removedListener).not.toHaveBeenCalled();

    handle.close(addedPanel);
    const eventCount = events.length;
    handle.close(addedPanel);
    handle.close(addedPanel);

    expect(events).toEqual([
      "add:1",
      "change:1",
      "change:2",
      "close:0",
      "change:1",
      "change:2",
      "change:0",
      "close:0",
      "change:0",
    ]);
    expect(events).toHaveLength(eventCount);
    expect(
      fixture.container.querySelector('[data-tab-id="added-tab"]'),
    ).toBeNull();
  });
});

function createFixture(): {
  container: HTMLElement;
  tabs: Element[];
  panels: Element[];
} {
  const container = document.createElement("div");
  container.id = "tab-pane";
  container.innerHTML = `
    <ul class="tabs">
      <li class="tab"><span>Hello</span><button data-close-tab>×</button></li>
      <li class="tab"><span>Behavior</span><button data-close-tab>×</button></li>
      <li class="tab"><span>Notes</span><button data-close-tab>×</button></li>
    </ul>
    <section class="content"><h3>Hello heading</h3><p>Hello panel</p></section>
    <section class="content"><h3><em>Behavior heading</em></h3><p>Behavior panel</p></section>
    <section class="content"><h3>Notes heading</h3><p>Notes panel</p></section>
  `;
  document.body.append(container);
  return {
    container,
    tabs: [...container.querySelectorAll(".tab")],
    panels: [...container.querySelectorAll(".content")],
  };
}

function requireReactHandle(): NonNullable<
  Window["ReactSandbox"]
>["tabPane"] {
  const handle = window.ReactSandbox?.tabPane;
  if (handle === undefined) {
    throw new Error("The ReactSandbox TabPane handle is missing.");
  }
  return handle;
}

function requireElement(elements: readonly Element[], index: number): Element {
  const element = elements[index];
  if (element === undefined) {
    throw new Error(`The fixture element at index ${index} is missing.`);
  }
  return element;
}
