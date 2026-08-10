import { describe, expect, it } from "vitest";

import { createMockFeatureFlagger } from "./mockFeatureFlagger";

describe("mockFeatureFlagger", () => {
  it("returns a configured feature value", () => {
    const featureFlagger = createMockFeatureFlagger({
      TabPane: "legacy-TabPane",
    });

    expect(featureFlagger.get("TabPane")).toBe("legacy-TabPane");
  });

  it("supports more than one feature", () => {
    const featureFlagger = createMockFeatureFlagger({
      BrandBox: "react-BrandBox",
      TabPane: "react-TabPane",
    });

    expect(featureFlagger.get("BrandBox")).toBe("react-BrandBox");
    expect(featureFlagger.get("TabPane")).toBe("react-TabPane");
  });

  it("returns no value for an unconfigured feature", () => {
    const featureFlagger = createMockFeatureFlagger({});

    expect(featureFlagger.get("TabPane")).toBeUndefined();
  });

  it("adds a feature after creation", () => {
    const featureFlagger = createMockFeatureFlagger();

    featureFlagger.set("TabPane", "react-TabPane");

    expect(featureFlagger.get("TabPane")).toBe("react-TabPane");
  });
});
