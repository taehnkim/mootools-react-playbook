import { execFile } from "node:child_process";
import { promisify } from "node:util";

import { describe, expect, it } from "vitest";

const execFileAsync = promisify(execFile);

describe("public CLI", () => {
  it("exposes exactly analyze, baseline, adapter, and verify", async () => {
    const result = await execFileAsync(
      process.execPath,
      ["dist/cli.js", "--help"],
      { cwd: process.cwd() },
    );
    const commands = [
      ...result.stdout.matchAll(
        /^  ([a-z-]+)(?: \[options\])? <component>/gm,
      ),
    ]
      .map((match) => match[1])
      .sort();

    expect(commands).toEqual(["adapter", "analyze", "baseline", "verify"]);
  });
});
