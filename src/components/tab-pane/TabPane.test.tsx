import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { mountReactTabPane, type TabPaneHandle } from "./mountTabPane";

let container: HTMLElement;
let tabPane: TabPaneHandle;

beforeEach(() => {
  document.body.innerHTML = `
    <div id="tabs">
      <ul class="tabs">
        ${["Hello", "Behavior", "Notes"]
          .map(
            (label) => `
              <li class="tab">
                <span>${label}</span>
                <button class="tab-close" data-close-tab type="button">×</button>
              </li>`,
          )
          .join("")}
      </ul>
      ${["Hello", "Behavior", "Notes"]
        .map(
          (label) => `
            <section class="content">
              <h3>${label} heading</h3>
              <p>${label} panel</p>
            </section>`,
        )
        .join("")}
    </div>`;
  container = document.getElementById("tabs")!;
  tabPane = mountReactTabPane(container);
});

afterEach(() => {
  document.body.innerHTML = "";
});

describe("React TabPane", () => {
  it("renders the server tabs and selects the first tab", () => {
    expect(tabs().map((tab) => tab.dataset.tabId)).toEqual([
      "hello",
      "behavior",
      "notes",
    ]);
    expect(tab(0).classList.contains("active")).toBe(true);
    expect(tab(0).getAttribute("aria-selected")).toBe("true");
    expect(panel(0).style.display).toBe("block");
    expect(panel(1).style.display).toBe("none");
    expect(panel(0).querySelector("p")?.textContent).toBe("Hello panel");
    expect(
      tab(0).querySelector("[data-close-tab]")?.getAttribute("aria-label"),
    ).toBe("Close Hello tab");
  });

  it("selects another tab when it is clicked", () => {
    const changes = record("change");

    tab(1).click();

    expect(changes).toEqual(["change:1"]);
    expect(tab(1).classList.contains("active")).toBe(true);
    expect(panel(1).style.display).toBe("block");
    expect(panel(0).style.display).toBe("none");
  });

  it("emits add and change when a new tab opens", () => {
    const events = record("add", "change");
    const newTab = document.createElement("li");
    newTab.innerHTML = "<span>Agent tab</span><button data-close-tab>×</button>";
    const newPanel = document.createElement("section");
    newPanel.innerHTML = "<h3>Agent tab</h3><p>Added panel</p>";

    tabPane.add(newTab, newPanel, null, true);

    expect(events).toEqual(["add:3", "change:3"]);
    expect(tab(3).dataset.tabId).toBe("agent-tab");
    expect(tab(3).classList.contains("active")).toBe(true);
    expect(panel(3).style.display).toBe("block");
    expect(newTab.isConnected).toBe(false);
  });

  it("keeps a panel added at a location hidden until it is shown", () => {
    const newTab = document.createElement("li");
    newTab.innerHTML = "<span>Hello</span>";
    const newPanel = document.createElement("section");
    newPanel.innerHTML = "<h3>Second hello</h3><p>Inserted panel</p>";

    tabPane.add(newTab, newPanel, 1);

    expect(tab(1).dataset.tabId).toBe("hello-2");
    expect(tab(1).querySelector("[data-close-tab]")).toBeNull();
    expect(panel(1).style.display).toBe("none");
    expect(tab(0).classList.contains("active")).toBe(true);
  });

  it("records the existing non-active close selection behavior", () => {
    const events = record("change", "close");
    tabPane.show(1);

    tabPane.close(0);

    expect(tab(1).textContent).toContain("Notes");
    expect(tab(1).classList.contains("active")).toBe(true);
    expect(events).toEqual(["change:1", "close:0", "change:1"]);
  });

  it("selects the tab before a container listener closes it", () => {
    const events = record("change", "close");
    container.addEventListener("click", (event) => {
      const button =
        event.target instanceof Element
          ? event.target.closest("[data-close-tab]")
          : null;
      if (button !== null) {
        tabPane.close(button.closest(".tab")!);
      }
    });

    tab(1).querySelector<HTMLElement>("[data-close-tab]")!.click();

    expect(events).toEqual(["change:1", "close:1", "change:1"]);
    expect(tabs().map((item) => item.dataset.tabId)).toEqual([
      "hello",
      "notes",
    ]);
    expect(tab(1).classList.contains("active")).toBe(true);
  });

  it("rejects legacy options it does not support", () => {
    expect(() =>
      mountReactTabPane(document.createElement("div"), { activeClass: "on" }),
    ).toThrow("React TabPane does not support legacy options.");
  });
});

function record(...names: ("add" | "change" | "close")[]): string[] {
  const events: string[] = [];
  for (const name of names) {
    tabPane.addEvent(name, (index) => events.push(`${name}:${index}`));
  }
  return events;
}

function tabs(): HTMLElement[] {
  return [...container.querySelectorAll<HTMLElement>('[role="tab"]')];
}

function tab(index: number): HTMLElement {
  return tabs()[index]!;
}

function panel(index: number): HTMLElement {
  return container.querySelectorAll<HTMLElement>('[role="tabpanel"]')[index]!;
}
