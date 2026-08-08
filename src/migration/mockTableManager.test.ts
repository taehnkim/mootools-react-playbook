import { beforeEach, describe, expect, it } from "vitest";

import { mockTableManager } from "./mockTableManager";

beforeEach(() => {
  window.history.replaceState(null, "", "/");
});

describe("mockTableManager", () => {
  it("uses the legacy branch by default", () => {
    expect(mockTableManager.isEnabled("react-tab-pane")).toBe(false);
  });

  it("enables the React TabPane branch from the URL query", () => {
    window.history.replaceState(null, "", "/?tab-pane=react");

    expect(mockTableManager.isEnabled("react-tab-pane")).toBe(true);
  });

  it("keeps unknown flag and query values on the legacy branch", () => {
    window.history.replaceState(null, "", "/?tab-pane=unknown");
    expect(mockTableManager.isEnabled("react-tab-pane")).toBe(false);

    window.history.replaceState(null, "", "/?tab-pane=react");
    expect(mockTableManager.isEnabled("unknown-flag")).toBe(false);
  });
});
