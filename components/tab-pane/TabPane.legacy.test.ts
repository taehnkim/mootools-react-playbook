import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { JSDOM } from "jsdom";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

let dom: JSDOM;
let tabPane: object;

beforeEach(async () => {
  dom = new JSDOM(
    `<!doctype html>
      <div id="tabs">
        <ul>
          <li class="tab">Hello</li>
          <li class="tab">Behavior</li>
          <li class="tab">Notes</li>
        </ul>
        <section class="content">Hello panel</section>
        <section class="content">Behavior panel</section>
        <section class="content">Notes panel</section>
      </div>`,
    {
      runScripts: "outside-only",
      url: "http://localhost/",
    },
  );
  await evaluateScript("vendor/mootools-core-1.4.2.js");
  await evaluateScript("components/tab-pane/TabPane.js");
  await evaluateScript("components/tab-pane/TabPane.Extra.js");

  const constructor = Reflect.get(dom.window, "TabPane");
  if (typeof constructor !== "function") {
    throw new Error("TabPane browser global was not created.");
  }
  tabPane = Reflect.construct(constructor, ["tabs"]);
});

afterEach(() => {
  dom.window.close();
});

describe("legacy TabPane", () => {
  it("selects the first tab on initialization", () => {
    expect(tab(0).classList.contains("active")).toBe(true);
    expect(panel(0).style.display).toBe("block");
    expect(panel(1).style.display).toBe("none");
  });

  it("selects another tab through delegated click handling", () => {
    tab(1).dispatchEvent(
      new dom.window.MouseEvent("click", { bubbles: true }),
    );

    expect(tab(1).classList.contains("active")).toBe(true);
    expect(panel(1).style.display).toBe("block");
    expect(panel(0).style.display).toBe("none");
  });

  it("emits add and change when a new tab opens", () => {
    const events: string[] = [];
    call("addEvent", "add", (index: number) => events.push(`add:${index}`));
    call("addEvent", "change", (index: number) =>
      events.push(`change:${index}`),
    );
    const newTab = dom.window.document.createElement("li");
    newTab.className = "tab";
    newTab.textContent = "Added";
    const newPanel = dom.window.document.createElement("section");
    newPanel.className = "content";
    newPanel.textContent = "Added panel";

    call("add", newTab, newPanel, null, true);

    expect(events).toEqual(["add:3", "change:3"]);
    expect(newTab.classList.contains("active")).toBe(true);
    expect(newPanel.style.display).toBe("block");
  });

  it("records the existing non-active close selection behavior", () => {
    const changes: number[] = [];
    call("addEvent", "change", (index: number) => changes.push(index));
    call("show", 1);

    call("close", 0);

    expect(tab(1).textContent).toBe("Notes");
    expect(tab(1).classList.contains("active")).toBe(true);
    expect(changes).toEqual([1, 1]);
  });
});

async function evaluateScript(path: string): Promise<void> {
  const source = await readFile(resolve(process.cwd(), path), "utf8");
  dom.window.eval(source);
}

function call(name: string, ...args: unknown[]): unknown {
  const value = Reflect.get(tabPane, name);
  if (typeof value !== "function") {
    throw new Error(`TabPane method was not found: ${name}`);
  }
  return Reflect.apply(value, tabPane, args);
}

function tab(index: number): HTMLElement {
  const element = dom.window.document.querySelectorAll<HTMLElement>(".tab")[index];
  if (element === undefined) {
    throw new Error(`Tab does not exist at index ${index}.`);
  }
  return element;
}

function panel(index: number): HTMLElement {
  const element =
    dom.window.document.querySelectorAll<HTMLElement>(".content")[index];
  if (element === undefined) {
    throw new Error(`Panel does not exist at index ${index}.`);
  }
  return element;
}
