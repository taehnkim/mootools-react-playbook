import { describe, expect, it } from "vitest";

import { createMockTableManager } from "./mockTableManager";

describe("mockTableManager", () => {
  it("returns the injected legacy implementation", () => {
    const manager = createMockTableManager("legacy-TabPane");

    expect(manager.get("TabPane")).toBe("legacy-TabPane");
  });

  it("returns the injected React implementation", () => {
    const manager = createMockTableManager("react-TabPane");

    expect(manager.get("TabPane")).toBe("react-TabPane");
  });

  it("defaults missing injected state to the legacy implementation", () => {
    const manager = createMockTableManager();

    expect(manager.get("TabPane")).toBe("legacy-TabPane");
  });

  it("defaults an unknown injected value to the legacy implementation", () => {
    const manager = createMockTableManager("unknown-TabPane");

    expect(manager.get("TabPane")).toBe("legacy-TabPane");
  });

  it("returns no implementation for unrelated selection keys", () => {
    const manager = createMockTableManager("react-TabPane");

    expect(manager.get("BrandBox")).toBeUndefined();
  });
});
