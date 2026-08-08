import { execFile } from "node:child_process";
import {
  access,
  mkdir,
  readFile,
  rename,
  unlink,
  writeFile,
} from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { promisify } from "node:util";

import ts from "typescript";

import type { ToolContext } from "../core/context.js";
import type { MigrationSpec } from "../contracts/schemas.js";
import { scriptKindForPath, walk } from "../analyze/source.js";

const execFileAsync = promisify(execFile);

export type PlannedEdit = {
  path: string;
  before: string | null;
  after: string;
};

export type AdapterCodemodResult =
  | {
      kind: "ready";
      edits: PlannedEdit[];
    }
  | {
      kind: "unsupported";
      reasons: string[];
    };

export async function planAdapterCodemod(options: {
  context: ToolContext;
  config: MigrationSpec;
}): Promise<AdapterCodemodResult> {
  const reasons: string[] = [];
  const edits: PlannedEdit[] = [];

  for (const path of options.config.adapter.callsiteFiles) {
    const absolutePath = resolve(options.context.projectRoot, path);
    const source = await readFile(absolutePath, "utf8");
    const replacement = replaceConstructors({
      source,
      path,
      legacyGlobal: options.config.legacyGlobal,
      adapterGlobal: options.config.adapter.globalName,
    });
    reasons.push(...replacement.reasons);
    if (replacement.source !== source) {
      edits.push({ path, before: source, after: replacement.source });
    }
  }

  const adapterPath = options.config.adapter.outputPath;
  const adapterSource = renderAdapter(options.config);
  const existingAdapter = await readOptional(
    resolve(options.context.projectRoot, adapterPath),
  );
  if (existingAdapter === null) {
    edits.push({ path: adapterPath, before: null, after: adapterSource });
  } else if (existingAdapter !== adapterSource) {
    reasons.push(`Existing adapter differs from generated output: ${adapterPath}`);
  }

  const bootstrapPath = options.config.adapter.bootstrapFile;
  const bootstrapSource = await readFile(
    resolve(options.context.projectRoot, bootstrapPath),
    "utf8",
  );
  const bootstrapResult = editBootstrap({
    source: bootstrapSource,
    config: options.config,
  });
  reasons.push(...bootstrapResult.reasons);
  if (bootstrapResult.source !== bootstrapSource) {
    edits.push({
      path: bootstrapPath,
      before: bootstrapSource,
      after: bootstrapResult.source,
    });
  }

  if (reasons.length > 0) {
    return { kind: "unsupported", reasons };
  }
  return { kind: "ready", edits };
}

export async function applyAdapterCodemod(options: {
  context: ToolContext;
  result: Extract<AdapterCodemodResult, { kind: "ready" }>;
}): Promise<void> {
  if (options.result.edits.length === 0) {
    return;
  }

  const paths = options.result.edits.map((edit) => edit.path);
  await requireCleanGitPaths(options.context.projectRoot, paths);
  await applyEditsAtomically(
    options.context.projectRoot,
    options.result.edits,
  );
}

export async function applyEditsAtomically(
  projectRoot: string,
  edits: PlannedEdit[],
): Promise<void> {
  const temporaryPaths: string[] = [];
  try {
    for (const edit of edits) {
      const absolutePath = resolve(projectRoot, edit.path);
      const temporaryPath = `${absolutePath}.migration-tools-tmp`;
      await mkdir(dirname(absolutePath), { recursive: true });
      await writeFile(temporaryPath, edit.after, "utf8");
      temporaryPaths.push(temporaryPath);
    }

    for (const edit of edits) {
      const absolutePath = resolve(projectRoot, edit.path);
      await rename(`${absolutePath}.migration-tools-tmp`, absolutePath);
    }
  } catch (error: unknown) {
    await restoreEdits(projectRoot, edits);
    for (const temporaryPath of temporaryPaths) {
      await unlink(temporaryPath).catch(() => undefined);
    }
    throw error;
  }
}

function replaceConstructors(options: {
  source: string;
  path: string;
  legacyGlobal: string;
  adapterGlobal: string;
}): { source: string; reasons: string[] } {
  const sourceFile = ts.createSourceFile(
    options.path,
    options.source,
    ts.ScriptTarget.Latest,
    true,
    scriptKindForPath(options.path),
  );
  const replacements: { start: number; end: number; value: string }[] = [];
  const reasons: string[] = [];

  walk(sourceFile, (node) => {
    if (
      !ts.isNewExpression(node) ||
      !ts.isIdentifier(node.expression) ||
      node.expression.text !== options.legacyGlobal
    ) {
      return;
    }
    const start = node.getStart(sourceFile);
    const end = node.expression.end;
    const prefix = options.source.slice(start, end);
    if (prefix !== `new ${options.legacyGlobal}`) {
      reasons.push(
        `${options.path}:${sourceFile.getLineAndCharacterOfPosition(start).line + 1} uses an unsupported constructor form.`,
      );
      return;
    }
    replacements.push({
      start,
      end,
      value: options.adapterGlobal,
    });
  });

  let source = options.source;
  for (const replacement of replacements.sort(
    (left, right) => right.start - left.start,
  )) {
    source =
      source.slice(0, replacement.start) +
      replacement.value +
      source.slice(replacement.end);
  }
  return { source, reasons };
}

function editBootstrap(options: {
  source: string;
  config: MigrationSpec;
}): { source: string; reasons: string[] } {
  const sourceFile = ts.createSourceFile(
    options.config.adapter.bootstrapFile,
    options.source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );
  const adapterModule = `${options.config.adapter.bootstrapImportPath}?url`;
  const importLine = `import mountAdapterUrl from "${adapterModule}";`;
  const reasons: string[] = [];
  const insertions: { position: number; value: string }[] = [];
  const adapterImports: ts.ImportDeclaration[] = [];
  for (const statement of sourceFile.statements) {
    if (
      ts.isImportDeclaration(statement) &&
      ts.isStringLiteral(statement.moduleSpecifier) &&
      statement.moduleSpecifier.text === adapterModule
    ) {
      adapterImports.push(statement);
    }
  }
  if (adapterImports.length > 1) {
    reasons.push("Bootstrap has more than one adapter import.");
  } else if (adapterImports.length === 1) {
    const adapterImport = adapterImports[0];
    if (
      adapterImport === undefined ||
      adapterImport.importClause?.name?.text !== "mountAdapterUrl"
    ) {
      reasons.push("Bootstrap adapter import has an unexpected local name.");
    }
  } else {
    const mainImports = sourceFile.statements.filter(
      (statement) =>
        ts.isImportDeclaration(statement) &&
        statement.importClause?.name?.text === "mainUrl",
    );
    const mainImport = mainImports[0];
    if (mainImports.length !== 1 || mainImport === undefined) {
      reasons.push(
        `Bootstrap import anchor must be one real import; found ${mainImports.length}.`,
      );
    } else {
      insertions.push({
        position: mainImport.end,
        value: `\n${importLine}`,
      });
    }
  }

  const scriptArrays: ts.ArrayLiteralExpression[] = [];
  walk(sourceFile, (node) => {
    if (
      ts.isArrayLiteralExpression(node) &&
      node.elements.some(
        (element) => ts.isIdentifier(element) && element.text === "mainUrl",
      )
    ) {
      scriptArrays.push(node);
    }
  });
  const scriptArray = scriptArrays[0];
  if (scriptArrays.length !== 1 || scriptArray === undefined) {
    reasons.push(
      `Bootstrap must have one script array containing mainUrl; found ${scriptArrays.length}.`,
    );
  } else if (
    !scriptArray.elements.some(
      (element) =>
        ts.isIdentifier(element) && element.text === "mountAdapterUrl",
    )
  ) {
    const mainElement = scriptArray.elements.find(
      (element) => ts.isIdentifier(element) && element.text === "mainUrl",
    );
    if (mainElement === undefined) {
      reasons.push("Bootstrap script array has no mainUrl element.");
    } else {
      insertions.push({
        position: mainElement.getStart(sourceFile),
        value: "mountAdapterUrl,\n  ",
      });
    }
  }

  let source = options.source;
  for (const insertion of insertions.sort(
    (left, right) => right.position - left.position,
  )) {
    source =
      source.slice(0, insertion.position) +
      insertion.value +
      source.slice(insertion.position);
  }

  return { source, reasons };
}

function renderAdapter(config: MigrationSpec): string {
  return `(function (global) {
  global[${JSON.stringify(config.adapter.globalName)}] = function (container, options, initialIndex) {
    var tableManager = global[${JSON.stringify(config.adapter.tableManagerGlobal)}];
    if (!tableManager) {
      return new global[${JSON.stringify(config.legacyGlobal)}](container, options, initialIndex);
    }
    var implementation = tableManager.get(${JSON.stringify(config.adapter.selectionKey)});
    if (implementation === ${JSON.stringify(config.adapter.legacyValue)}) {
      return new global[${JSON.stringify(config.legacyGlobal)}](container, options, initialIndex);
    }
    if (implementation === ${JSON.stringify(config.adapter.reactValue)}) {
      var reactMount = global[${JSON.stringify(config.adapter.reactMountGlobal)}];
      if (typeof reactMount !== "function") {
        throw new Error(${JSON.stringify(`React mount global ${config.adapter.reactMountGlobal} is not available.`)});
      }
      return reactMount(container, options, initialIndex);
    }
    throw new Error(${JSON.stringify(`Table manager returned an unsupported implementation for ${config.adapter.selectionKey}: `)} + String(implementation) + ".");
  };
})(window);
`;
}

async function requireCleanGitPaths(
  projectRoot: string,
  paths: string[],
): Promise<void> {
  try {
    const result = await execFileAsync(
      "git",
      ["status", "--porcelain", "--", ...paths],
      { cwd: projectRoot },
    );
    if (result.stdout.trim() !== "") {
      throw new Error(
        `Adapter codemod target files have existing changes:\n${result.stdout}`,
      );
    }
  } catch (error: unknown) {
    if (error instanceof Error && error.message.includes("existing changes")) {
      throw error;
    }
    throw new Error(
      "Adapter writes require a clean git repository.",
      { cause: error },
    );
  }
}

async function restoreEdits(
  projectRoot: string,
  edits: PlannedEdit[],
): Promise<void> {
  for (const edit of edits) {
    const absolutePath = resolve(projectRoot, edit.path);
    if (edit.before === null) {
      await unlink(absolutePath).catch(() => undefined);
    } else {
      await writeFile(absolutePath, edit.before, "utf8");
    }
  }
}

async function readOptional(path: string): Promise<string | null> {
  try {
    await access(path);
    return readFile(path, "utf8");
  } catch {
    return null;
  }
}

