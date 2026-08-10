import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { analyzeComponent } from "../src/analyze/index.js";
import { MigrationSpecSchema } from "../src/contracts/schemas.js";

describe("component analyzer", () => {
  it("covers events, callers, DOM, APIs, effects, dependencies, markup, and CSS", async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), "component-analysis-"));
    await mkdir(join(projectRoot, "legacy"), { recursive: true });
    await mkdir(join(projectRoot, "src"), { recursive: true });
    await writeFile(
      join(projectRoot, "legacy/Widget.js"),
      `/*
---
requires:
  core/1.4:
  - Class
  - Element.Event
provides: Widget
...
*/
import helper from "./helper.js";
var Widget = new Class({
  options: {
    itemSelector: ".item",
    activeClass: "active"
  },
  initialize: function(container) {
    this.container = document.id(container);
    this.container.addEvent("click:relay(.item)", this.select.bind(this));
    this.timer = this.refresh.periodical(5000, this);
    this.container.store("widget", this);
    localStorage.setItem("widget", "ready");
    fetch("/api/items");
    window.widgetReady = true;
  },
  select: function() {
    this.container.getElements(this.options.itemSelector).addClass(this.options.activeClass);
    var eventName = "select";
    this.fireEvent(eventName, 1);
  },
  get: function() {
    return [];
  },
  show: function() {
    return this.get();
  }
});
`,
      "utf8",
    );
    await writeFile(
      join(projectRoot, "legacy/main.js"),
      `var widget = new Widget("widget");
var alias = widget;
alias.get();
widget.addEvent("select", function(index) {
  document.id("status").set("text", index);
});
function unrelated() {
  var widget = {destroy: function() {}};
  widget.destroy();
}
document.id("refresh").addEvent("click", function() {
  var child = new Element("span", {"class": "dynamic-item"});
  widget.select();
  fetch("/api/refresh");
});
window.WidgetSandbox = {widget: widget};
`,
      "utf8",
    );
    await writeFile(
      join(projectRoot, "legacy/index.html"),
      `<div id="widget">
  <button class="item" data-item-id="one" aria-label="Select one">One</button>
  <p id="status"></p>
</div>`,
      "utf8",
    );
    await writeFile(
      join(projectRoot, "legacy/widget.css"),
      `#widget .item { color: var(--widget-color); }
.other .item { color: blue; }`,
      "utf8",
    );
    await writeFile(
      join(projectRoot, "legacy/global.css"),
      `:root { --widget-color: red; }
button { font: inherit; }`,
      "utf8",
    );
    await writeFile(
      join(projectRoot, "legacy/bootstrap.js"),
      `import widgetUrl from "./Widget.js?url";
import mainUrl from "./main.js?url";
const scripts = ["https://cdn.example.com/mootools.js", widgetUrl, mainUrl];`,
      "utf8",
    );
    await writeFile(
      join(projectRoot, "src/Widget.tsx"),
      "export const Widget = () => null;\n",
      "utf8",
    );
    const config = MigrationSpecSchema.parse({
      schemaVersion: 1,
      id: "widget",
      legacyGlobal: "Widget",
      sourceFiles: ["legacy/Widget.js"],
      cssFiles: ["legacy/widget.css", "legacy/global.css"],
      markupFiles: [
        { path: "legacy/index.html", rootSelector: "#widget" },
      ],
      bootstrapFiles: ["legacy/bootstrap.js"],
      callsiteGlobs: ["legacy/main.js", "src/**/*.{ts,tsx}"],
      tests: {
        legacyFile: "legacy/Widget.legacy.test.ts",
        legacyDependencies: [],
        reactFile: "src/Widget.test.tsx",
        reactDependencies: [],
      },
      fixtureBridge: {
        windowValueKey: "__FIXTURE__",
        windowIdKey: "__FIXTURE_ID__",
        legacyStaticFixtureId: "default",
        reactAcknowledgementPath: ["ReactSandbox", "fixtureId"],
      },
      implementationBridge: {
        windowKey: "__WIDGET_IMPLEMENTATION__",
        legacyValue: "legacy-Widget",
        reactValue: "react-Widget",
      },
      legacy: {
        entryPath: "/legacy/",
        readyPath: ["WidgetSandbox", "widget"],
        eventNames: ["select"],
        proofFiles: ["legacy/Widget.js"],
      },
      react: {
        entryPath: "/",
        readySelector: "[data-component=\"widget\"]",
        handlePath: ["ReactSandbox", "widget"],
        componentPath: "src/Widget.tsx",
        proofFiles: ["src/Widget.tsx"],
      },
      viewport: { width: 1280, height: 900 },
      adapter: {
        globalName: "mountWidget",
        selectionKey: "Widget",
        legacyValue: "legacy-Widget",
        reactValue: "react-Widget",
        featureFlaggerGlobal: "featureFlagger",
        featureFlaggerImportPath: "./src/feature-flagger/mockFeatureFlagger",
        reactMountGlobal: "mountReactWidget",
        outputPath: "legacy/mount-widget.js",
        callsiteFiles: ["legacy/main.js"],
        bootstrapFile: "legacy/bootstrap.js",
        bootstrapImportPath: "./mount-widget.js",
        bootstrapImportLocal: "mountWidgetUrl",
      },
      fixtures: { default: {} },
      scenarios: [
        {
          id: "observe",
          fixture: "default",
          steps: [{ stepId: "observe", action: "observe" }],
          assertions: [
            {
              assertionId: "component-count",
              afterStepId: "observe",
              target: "component",
              kind: "count",
              matcher: "equals",
              expected: 1,
            },
            {
              assertionId: "component-image",
              afterStepId: "observe",
              target: "component",
              kind: "screenshot",
              matcher: "pixel-diff",
              name: "component",
              maxDiffRatio: 0,
            },
          ],
        },
      ],
      selectors: {
        component: { legacy: "#widget", react: "[data-widget]" },
      },
      decisions: [],
      acceptedDifferences: [],
      allowedLegacyUses: [],
    });

    const worksheet = await analyzeComponent({
      context: {
        projectRoot,
        toolsRoot: projectRoot,
      },
      config,
    });
    const summaries = worksheet.findings.map((finding) => finding.summary);

    expect(summaries).toEqual(
      expect.arrayContaining([
        expect.stringContaining("Registers listener click:relay(.item)"),
        "Delegated event uses selector .item.",
        "Fires eventName.",
        "Caller invokes widget.addEvent.",
        "Caller invokes alias.get.",
        "Caller invokes widget.select.",
        expect.stringContaining("Caller listener click invokes widget.select"),
        "Writes DOM through set.",
        "Calls network API through fetch.",
        "Uses timer operation periodical.",
        "Uses storage operation localStorage.setItem.",
        "Uses storage operation Element.store.",
        "Writes browser global window.widgetReady.",
        "Caller exposes the component through window.WidgetSandbox.",
        "Creates dynamic <span> element.",
        "DOM code uses hook .dynamic-item.",
        "Declares dependency core/1.4:Class.",
        "Declares provided MooTools module Widget.",
        "Uses static import ./Widget.js?url.",
        expect.stringContaining("Loads scripts in order"),
        "Markup contains <button.item> under #widget.",
        expect.stringContaining("CSS rule #widget .item"),
        expect.stringContaining("CSS rule button"),
        "Defines required CSS custom property --widget-color.",
      ]),
    );
    expect(summaries).not.toContain("Caller invokes widget.destroy.");
    expect(summaries).not.toContain("Reads DOM through get.");
    expect(
      summaries.some((summary) => summary.includes("CSS rule .other .item")),
    ).toBe(false);
    expect(
      worksheet.coverage.find((entry) => entry.category === "api-calls")
        ?.findingCount,
    ).toBeGreaterThan(0);
    expect(
      worksheet.coverage.find((entry) => entry.category === "events")
        ?.filesScanned,
    ).not.toContain("legacy/widget.css");
    expect(
      worksheet.coverage.find((entry) => entry.category === "css")
        ?.filesScanned,
    ).toEqual(["legacy/global.css", "legacy/widget.css"]);
    expect(
      worksheet.findings.find((finding) => finding.kind === "event")
        ?.decisionRequired,
    ).toBe(true);
    expect(
      worksheet.findings.find((finding) => finding.kind === "style")
        ?.decisionRequired,
    ).toBe(false);
    expect(
      worksheet.findings
        .filter((finding) => finding.kind === "global")
        .flatMap((finding) => finding.evidence)
        .map((evidence) => evidence.path),
    ).not.toContain("src/Widget.tsx");
  });
});
