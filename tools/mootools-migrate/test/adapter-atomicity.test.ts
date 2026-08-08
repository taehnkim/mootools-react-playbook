import {
  access,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { applyEditsAtomically } from "../src/codemods/adapter.js";

describe("adapter atomicity", () => {
  it("rolls back earlier writes when a later rename fails", async () => {
    const projectRoot = await mkdtemp(
      join(process.cwd(), ".adapter-atomicity-"),
    );
    await mkdir(join(projectRoot, "blocked"));
    await writeFile(join(projectRoot, "first.js"), "original\n");
    await writeFile(join(projectRoot, "blocked/keep.txt"), "tracked\n");

    await expect(
      applyEditsAtomically(projectRoot, [
        {
          path: "first.js",
          before: "original\n",
          after: "changed\n",
        },
        {
          path: "blocked",
          before: null,
          after: "cannot replace a directory\n",
        },
      ]),
    ).rejects.toThrow();

    expect(await readFile(join(projectRoot, "first.js"), "utf8")).toBe(
      "original\n",
    );
    await expect(
      access(join(projectRoot, "first.js.migration-tools-tmp")),
    ).rejects.toThrow();
    await rm(projectRoot, { recursive: true, force: true });
  });
});
