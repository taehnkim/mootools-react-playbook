import { createHash } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

import type { ZodType } from "zod";

import type { JsonValue } from "./schemas.js";

export async function readJson<T>(
  path: string,
  schema: ZodType<T>,
): Promise<T> {
  const source = await readFile(path, "utf8");
  return schema.parse(JSON.parse(source));
}

export async function writeJson(path: string, value: JsonValue): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const temporaryPath = `${path}.tmp`;
  await writeFile(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  await rename(temporaryPath, path);
}

export function sha256(value: string | Uint8Array): string {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

export function canonicalJson(value: JsonValue): string {
  return JSON.stringify(sortJson(value));
}

export function hashJson(value: JsonValue): string {
  return sha256(canonicalJson(value));
}

function sortJson(value: JsonValue): JsonValue {
  if (Array.isArray(value)) {
    return value.map(sortJson);
  }

  if (value === null || typeof value !== "object") {
    return value;
  }

  const result: { [key: string]: JsonValue } = {};
  for (const key of Object.keys(value).sort()) {
    const child = value[key];
    if (child !== undefined) {
      result[key] = sortJson(child);
    }
  }
  return result;
}
