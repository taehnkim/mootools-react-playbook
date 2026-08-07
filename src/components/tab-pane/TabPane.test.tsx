import { createRef } from "react";
import { act, cleanup, render } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  TabPane,
  type TabPaneHandle,
  type TabPaneTab,
} from "./TabPane";

const TABS: readonly TabPaneTab[] = [
  {
    id: "hello",
    label: "Hello",
    content: <p>Hello content</p>,
    closable: true,
  },
  {
    id: "behavior",
    label: "Behavior",
    content: <p>Behavior content</p>,
    closable: true,
  },
  {
    id: "notes",
    label: "Notes",
    content: <p>Notes content</p>,
    closable: true,
  },
];

afterEach(() => cleanup());

describe("TabPane", () => {
  it("selects tabs with click and arrow keys", async () => {
    const user = userEvent.setup();
    const view = render(
      <TabPane
        initialSelectedId="hello"
        initialTabs={TABS}
        onMinimumTabClose={() => undefined}
      />,
    );
    const behaviorTab = view.getByRole("tab", { name: /Behavior/ });

    await user.click(behaviorTab);
    expect(behaviorTab.getAttribute("aria-selected")).toBe("true");

    behaviorTab.focus();
    await user.keyboard("{ArrowRight}");
    expect(
      view.getByRole("tab", { name: /Notes/ }).getAttribute("aria-selected"),
    ).toBe("true");
  });

  it("keeps the stable selection when another tab closes", () => {
    const ref = createRef<TabPaneHandle>();
    const view = render(
      <TabPane
        initialSelectedId="behavior"
        initialTabs={TABS}
        onMinimumTabClose={() => undefined}
        ref={ref}
      />,
    );
    const events: string[] = [];
    const handle = requireHandle(ref.current);
    handle.addEvent("close", (index) => events.push(`close:${index}`));
    handle.addEvent("change", (index) => events.push(`change:${index}`));

    act(() => handle.close(0));

    expect(events).toEqual(["close:0", "change:0"]);
    expect(view.getAllByRole("tab")).toHaveLength(2);
    expect(view.queryByRole("tab", { name: /Hello/ })).toBeNull();
    expect(
      view.getByRole("tab", { name: /Behavior/ }).getAttribute("aria-selected"),
    ).toBe("true");
  });

  it("adds and selects a tab through the compatibility handle", () => {
    const ref = createRef<TabPaneHandle>();
    const view = render(
      <TabPane
        initialSelectedId="hello"
        initialTabs={TABS}
        onMinimumTabClose={() => undefined}
        ref={ref}
      />,
    );
    const handle = requireHandle(ref.current);
    const events: string[] = [];
    handle.addEvent("add", (index) => events.push(`add:${index}`));
    handle.addEvent("change", (index) => events.push(`change:${index}`));

    act(() =>
      handle.add(
        {
          id: "new-tab",
          label: "New tab",
          content: <p>New content</p>,
          closable: true,
        },
        true,
      ),
    );

    expect(
      view.getByRole("tab", { name: /New tab/ }).getAttribute("aria-selected"),
    ).toBe("true");
    expect(events).toEqual(["add:3", "change:3"]);
  });

  it("rejects closing the final tab", () => {
    const ref = createRef<TabPaneHandle>();
    const rejected = vi.fn();
    const firstTab = TABS[0];
    if (firstTab === undefined) {
      throw new Error("Test fixture has no first tab.");
    }
    render(
      <TabPane
        initialSelectedId="hello"
        initialTabs={[firstTab]}
        onMinimumTabClose={rejected}
        ref={ref}
      />,
    );

    act(() => requireHandle(ref.current).close(0));

    expect(rejected).toHaveBeenCalledOnce();
  });
});

function requireHandle(handle: TabPaneHandle | null): TabPaneHandle {
  if (handle === null) {
    throw new Error("TabPane handle was not assigned.");
  }
  return handle;
}
