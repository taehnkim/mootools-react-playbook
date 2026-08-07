import { readFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";

import { preflightLegacyConstructors } from "../src/codemods/constructor-preflight.js";
import { updateBootstrap } from "../transforms/update-bootstrap.js";
import { wrapLegacyConstructor } from "../transforms/wrap-legacy-constructor.js";

describe("wrap legacy constructor transform", () => {
  it("preserves comments and multiline arguments from the fixture", async () => {
    const input = await fixture("wrap-legacy-constructor.input.js");
    const expected = await fixture("wrap-legacy-constructor.output.js");

    const result = wrap(input);

    expect(result.kind).toBe("changed");
    expect(result.source).toBe(expected);
    expect(result.statistics.transformed).toBe(1);
  });

  it("replaces multiple constructor calls", () => {
    const result = wrap(
      "var first = new TabPane(one);\nvar second = new TabPane(two, options);\n",
    );

    expect(result.kind).toBe("changed");
    expect(result.source).toContain("mountTabPane(one)");
    expect(result.source).toContain("mountTabPane(two, options)");
    expect(result.statistics.transformed).toBe(2);
  });

  it("returns unchanged for an existing adapter call", () => {
    const source = "var pane = mountTabPane(container);\n";
    const result = wrap(source);

    expect(result).toMatchObject({
      kind: "unchanged",
      source,
      statistics: { alreadyTransformed: 1, transformed: 0 },
    });
  });

  it("does not transform imported or parameter-shadowed symbols", () => {
    const imported = wrap(
      'import TabPane from "./react-tab-pane";\nvar pane = new TabPane(container);\n',
    );
    const parameter = wrap(
      "function create(TabPane) { return new TabPane(container); }\n",
    );

    expect(imported.kind).toBe("unchanged");
    expect(imported.statistics.shadowed).toBe(1);
    expect(parameter.kind).toBe("unchanged");
    expect(parameter.statistics.shadowed).toBe(1);
  });

  it("transforms a global call outside a later shadowing block", () => {
    const result = wrap(`
var globalPane = new TabPane(root);
{
  let TabPane = ReactTabPane;
  var localPane = new TabPane(localRoot);
}
`);

    expect(result.kind).toBe("changed");
    expect(result.source).toContain("mountTabPane(root)");
    expect(result.source).toContain("new TabPane(localRoot)");
    expect(result.statistics).toMatchObject({
      transformed: 1,
      shadowed: 1,
    });
  });

  it("supports a TypeScript caller file", () => {
    const result = wrap(
      "const pane: unknown = new TabPane(root);\n",
      "main.ts",
    );

    expect(result.kind).toBe("changed");
    expect(result.source).toContain(
      "const pane: unknown = mountTabPane(root);",
    );
  });

  it("rejects a computed legacy constructor", () => {
    const source = 'var pane = new window["TabPane"](container);\n';
    const result = wrap(source);

    expect(result.kind).toBe("unsupported");
    expect(result.source).toBe(source);
    if (result.kind !== "unsupported") {
      throw new Error("Computed constructor was not rejected.");
    }
    expect(result.reasons[0]).toMatchObject({
      line: 1,
      column: 12,
    });
  });

  it("preserves CRLF line endings", () => {
    const result = wrap(
      "var pane = new TabPane(\r\n  container\r\n);\r\n",
    );

    expect(result.kind).toBe("changed");
    expect(result.source).toContain("\r\n");
    expect(result.source.replaceAll("\r\n", "")).not.toContain("\n");
  });
});

describe("update bootstrap transform", () => {
  it("matches the bootstrap fixture", async () => {
    const input = await fixture("update-bootstrap.input.ts");
    const expected = await fixture("update-bootstrap.output.ts");

    const result = bootstrap(input);

    expect(result.kind).toBe("changed");
    expect(result.source).toBe(expected);
  });

  it("is idempotent when import and entry exist", async () => {
    const source = await fixture("update-bootstrap.output.ts");
    const result = bootstrap(source);

    expect(result).toMatchObject({
      kind: "unchanged",
      source,
    });
  });

  it("rejects duplicate adapter imports", () => {
    const result = bootstrap(`
import mainUrl from "./main.js?url";
import mountAdapterUrl from "./adapters/mount-tab-pane.js?url";
import mountAdapterUrlAgain from "./adapters/mount-tab-pane.js?url";
const scripts = [mountAdapterUrl, mainUrl];
`);

    expect(result.kind).toBe("unsupported");
    if (result.kind !== "unsupported") {
      throw new Error("Duplicate imports were not rejected.");
    }
    expect(result.reasons[0]?.message).toBe("Duplicate adapter imports.");
  });

  it("rejects duplicate adapter script entries", () => {
    const result = bootstrap(`
import mainUrl from "./main.js?url";
import mountAdapterUrl from "./adapters/mount-tab-pane.js?url";
const scripts = [mountAdapterUrl, mountAdapterUrl, mainUrl];
`);

    expect(result.kind).toBe("unsupported");
    if (result.kind !== "unsupported") {
      throw new Error("Duplicate script entries were not rejected.");
    }
    expect(result.reasons.map((reason) => reason.message)).toContain(
      "Duplicate adapter script entries.",
    );
  });

  it("rejects duplicate main script entries", () => {
    const result = bootstrap(`
import mainUrl from "./main.js?url";
const scripts = [mainUrl, mainUrl];
`);

    expect(result.kind).toBe("unsupported");
    if (result.kind !== "unsupported") {
      throw new Error("Duplicate main entries were not rejected.");
    }
    expect(result.reasons.map((reason) => reason.message)).toContain(
      "Duplicate mainUrl script entries.",
    );
  });

  it("rejects a conflicting adapter local name", () => {
    const result = bootstrap(`
import mainUrl from "./main.js?url";
import mountAdapterUrl from "./other.js?url";
const scripts = [mainUrl];
`);

    expect(result.kind).toBe("unsupported");
    if (result.kind !== "unsupported") {
      throw new Error("Conflicting adapter local was not rejected.");
    }
    expect(result.reasons.map((reason) => reason.message)).toContain(
      "Local name mountAdapterUrl is already in use.",
    );
  });

  it("rejects a destructured adapter local name", () => {
    const result = bootstrap(`
import mainUrl from "./main.js?url";
const { mountAdapterUrl } = helpers;
const scripts = [mainUrl];
`);

    expect(result.kind).toBe("unsupported");
    if (result.kind !== "unsupported") {
      throw new Error("Destructured adapter local was not rejected.");
    }
    expect(result.reasons.map((reason) => reason.message)).toContain(
      "Local name mountAdapterUrl is already in use.",
    );
  });

  it("rejects the wrong main import source", () => {
    const result = bootstrap(`
import mainUrl from "./wrong.js?url";
const scripts = [mainUrl];
`);

    expect(result.kind).toBe("unsupported");
    if (result.kind !== "unsupported") {
      throw new Error("Wrong main import source was not rejected.");
    }
    expect(result.reasons.map((reason) => reason.message)).toContain(
      "mainUrl import must reference ./main.js?url.",
    );
  });

  it("rejects an existing adapter entry after mainUrl", () => {
    const result = bootstrap(`
import mainUrl from "./main.js?url";
import mountAdapterUrl from "./adapters/mount-tab-pane.js?url";
const scripts = [mainUrl, mountAdapterUrl];
`);

    expect(result.kind).toBe("unsupported");
    if (result.kind !== "unsupported") {
      throw new Error("Wrong adapter order was not rejected.");
    }
    expect(result.reasons.map((reason) => reason.message)).toContain(
      "Adapter script entry must be immediately before mainUrl.",
    );
  });

  it("rejects a missing mainUrl", () => {
    const result = bootstrap(
      'import otherUrl from "./other.js?url";\nconst scripts = [otherUrl];\n',
    );

    expect(result.kind).toBe("unsupported");
    if (result.kind !== "unsupported") {
      throw new Error("Missing mainUrl was not rejected.");
    }
    expect(result.reasons.map((reason) => reason.message)).toEqual(
      expect.arrayContaining([
        "Missing mainUrl import.",
        "Missing mainUrl script entry.",
      ]),
    );
  });

  it("rejects ambiguous main script arrays", () => {
    const result = bootstrap(`
import mainUrl from "./main.js?url";
const first = [mainUrl];
const second = [mainUrl];
`);

    expect(result.kind).toBe("unsupported");
    if (result.kind !== "unsupported") {
      throw new Error("Ambiguous arrays were not rejected.");
    }
    expect(result.reasons.map((reason) => reason.message)).toContain(
      "Ambiguous script arrays containing mainUrl.",
    );
  });
});

function wrap(source: string, path = "main.js") {
  const preflight = preflightLegacyConstructors({
    source,
    path,
    legacyGlobal: "TabPane",
  });
  return wrapLegacyConstructor({
    source,
    path,
    legacyGlobal: "TabPane",
    adapterGlobal: "mountTabPane",
    globalConstructors: preflight.globalConstructors,
  });
}

function bootstrap(source: string) {
  return updateBootstrap({
    source,
    path: "bootstrap.ts",
    adapterModule: "./adapters/mount-tab-pane.js?url",
    adapterLocal: "mountAdapterUrl",
    mainLocal: "mainUrl",
    mainModule: "./main.js?url",
  });
}

async function fixture(name: string): Promise<string> {
  return readFile(
    new URL(`../transforms/__testfixtures__/${name}`, import.meta.url),
    "utf8",
  );
}
