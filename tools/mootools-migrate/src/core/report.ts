import { JsonValueSchema } from "../contracts/schemas.js";

export function writeResult(value: unknown): void {
  const json = JsonValueSchema.parse(value);
  process.stdout.write(`${JSON.stringify(json, null, 2)}\n`);
}

export function writeMessage(value: string): void {
  process.stdout.write(`${value}\n`);
}

export function writeFailure(error: unknown): void {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`${message}\n`);
}
