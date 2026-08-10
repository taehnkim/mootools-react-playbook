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
const featureFlaggerFactory = "createMockFeatureFlagger";
const featureFlaggerLocal = "migrationFeatureFlagger";

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
    scriptKindForPath(options.config.adapter.bootstrapFile),
  );
  const adapterModule = `${options.config.adapter.bootstrapImportPath}?url`;
  const adapterImportLocal = options.config.adapter.bootstrapImportLocal;
  const reasons: string[] = [];
  const insertions: { position: number; value: string }[] = [];
  const imports = sourceFile.statements.filter(ts.isImportDeclaration);
  const adapterImports = imports.filter(
    (statement) =>
      ts.isStringLiteral(statement.moduleSpecifier) &&
      statement.moduleSpecifier.text === adapterModule,
  );
  let insertAdapterImport = false;
  if (adapterImports.length > 1) {
    reasons.push("Bootstrap has more than one adapter import.");
  } else if (adapterImports.length === 1) {
    const adapterImport = adapterImports[0];
    if (
      adapterImport === undefined ||
      adapterImport.importClause?.name?.text !== adapterImportLocal
    ) {
      reasons.push("Bootstrap adapter import has an unexpected local name.");
    }
  } else {
    insertAdapterImport = true;
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
        ts.isIdentifier(element) && element.text === adapterImportLocal,
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
        value: `${adapterImportLocal},\n  `,
      });
    }
  }

  const targetScriptArray = scriptArrays[0];
  const featureFlaggerPlan = planFeatureFlaggerSetup({
    source: options.source,
    sourceFile,
    config: options.config,
    setupAnchor:
      targetScriptArray === undefined
        ? undefined
        : containingStatement(sourceFile, targetScriptArray),
  });
  reasons.push(...featureFlaggerPlan.reasons);
  insertions.push(...featureFlaggerPlan.insertions);

  const importLines: string[] = [];
  if (insertAdapterImport) {
    importLines.push(
      `import ${adapterImportLocal} from "${adapterModule}";`,
    );
  }
  if (featureFlaggerPlan.insertImport) {
    importLines.push(
      `import { ${featureFlaggerFactory} } from "${options.config.adapter.featureFlaggerImportPath}";`,
    );
  }
  if (importLines.length > 0) {
    const mainImports = imports.filter(
      (statement) => statement.importClause?.name?.text === "mainUrl",
    );
    const mainImport = mainImports[0];
    if (mainImports.length !== 1 || mainImport === undefined) {
      reasons.push(
        `Bootstrap import anchor must be one real import; found ${mainImports.length}.`,
      );
    } else {
      insertions.push({
        position: mainImport.end,
        value: `${lineBreak(options.source)}${importLines.join(lineBreak(options.source))}`,
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

function planFeatureFlaggerSetup(options: {
  source: string;
  sourceFile: ts.SourceFile;
  config: MigrationSpec;
  setupAnchor: ts.Statement | undefined;
}): {
  reasons: string[];
  insertImport: boolean;
  insertions: { position: number; value: string }[];
} {
  const reasons: string[] = [];
  const insertions: { position: number; value: string }[] = [];
  const imports = options.sourceFile.statements.filter(
    (statement): statement is ts.ImportDeclaration =>
      ts.isImportDeclaration(statement) &&
      ts.isStringLiteral(statement.moduleSpecifier) &&
      statement.moduleSpecifier.text ===
        options.config.adapter.featureFlaggerImportPath,
  );
  const declarations: ts.VariableDeclaration[] = [];
  const setCalls: ts.CallExpression[] = [];
  const assignments: ts.CallExpression[] = [];

  walk(options.sourceFile, (node) => {
    if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.name.text === featureFlaggerLocal
    ) {
      declarations.push(node);
    }
    if (
      ts.isCallExpression(node) &&
      isMethodCall(node, featureFlaggerLocal, "set")
    ) {
      setCalls.push(node);
    }
    if (
      ts.isCallExpression(node) &&
      isFeatureFlaggerAssignment(
        node,
        options.config.adapter.featureFlaggerGlobal,
      )
    ) {
      assignments.push(node);
    }
  });

  const setupExists =
    imports.length > 0 ||
    declarations.length > 0 ||
    setCalls.length > 0 ||
    assignments.length > 0;
  if (!setupExists) {
    if (options.setupAnchor === undefined) {
      reasons.push("Bootstrap feature flagger needs a script-array anchor.");
      return { reasons, insertImport: true, insertions };
    }
    const newline = lineBreak(options.source);
    insertions.push({
      position: options.setupAnchor.getStart(options.sourceFile),
      value: [
        `const ${featureFlaggerLocal} = ${featureFlaggerFactory}();`,
        featureFlagSetStatement(options.config),
        `Object.assign(window, { ${JSON.stringify(options.config.adapter.featureFlaggerGlobal)}: ${featureFlaggerLocal} });`,
        "",
      ].join(newline),
    });
    return { reasons, insertImport: true, insertions };
  }

  if (
    imports.length !== 1 ||
    imports[0] === undefined ||
    !hasNamedImport(imports[0], featureFlaggerFactory)
  ) {
    reasons.push("Bootstrap feature flagger import is missing or unsupported.");
  }
  if (
    declarations.length !== 1 ||
    declarations[0] === undefined ||
    !isFeatureFlaggerDeclaration(declarations[0])
  ) {
    reasons.push(
      "Bootstrap feature flagger declaration is missing or unsupported.",
    );
  }
  if (assignments.length !== 1 || assignments[0] === undefined) {
    reasons.push("Bootstrap feature flagger global is missing or unsupported.");
  }

  const componentCalls = setCalls.filter(
    (call) =>
      call.arguments[0] !== undefined &&
      ts.isStringLiteralLike(call.arguments[0]) &&
      call.arguments[0].text === options.config.adapter.selectionKey,
  );
  if (componentCalls.length > 1) {
    reasons.push("Bootstrap has more than one feature flag for the component.");
  } else if (
    componentCalls[0] !== undefined &&
    compact(componentCalls[0].getText(options.sourceFile)) !==
      compact(featureFlagSetCall(options.config))
  ) {
    reasons.push("Bootstrap component feature flag has unexpected values.");
  } else if (
    componentCalls.length === 0 &&
    assignments.length === 1 &&
    assignments[0]?.parent !== undefined
  ) {
    insertions.push({
      position: assignments[0].parent.getStart(options.sourceFile),
      value: `${featureFlagSetStatement(options.config)}${lineBreak(options.source)}`,
    });
  }

  return { reasons, insertImport: false, insertions };
}

function isMethodCall(
  call: ts.CallExpression,
  owner: string,
  method: string,
): boolean {
  return (
    ts.isPropertyAccessExpression(call.expression) &&
    ts.isIdentifier(call.expression.expression) &&
    call.expression.expression.text === owner &&
    call.expression.name.text === method
  );
}

function isFeatureFlaggerAssignment(
  call: ts.CallExpression,
  globalName: string,
): boolean {
  if (
    !ts.isPropertyAccessExpression(call.expression) ||
    !ts.isIdentifier(call.expression.expression) ||
    call.expression.expression.text !== "Object" ||
    call.expression.name.text !== "assign" ||
    call.arguments[0] === undefined ||
    !ts.isIdentifier(call.arguments[0]) ||
    call.arguments[0].text !== "window" ||
    call.arguments[1] === undefined ||
    !ts.isObjectLiteralExpression(call.arguments[1])
  ) {
    return false;
  }
  return call.arguments[1].properties.some(
    (property) =>
      ts.isPropertyAssignment(property) &&
      propertyName(property.name) === globalName &&
      ts.isIdentifier(property.initializer) &&
      property.initializer.text === featureFlaggerLocal,
  );
}

function propertyName(name: ts.PropertyName): string | null {
  if (ts.isIdentifier(name) || ts.isStringLiteralLike(name)) {
    return name.text;
  }
  return null;
}

function hasNamedImport(
  declaration: ts.ImportDeclaration,
  name: string,
): boolean {
  const bindings = declaration.importClause?.namedBindings;
  return (
    bindings !== undefined &&
    ts.isNamedImports(bindings) &&
    bindings.elements.some(
      (element) =>
        element.propertyName === undefined && element.name.text === name,
    )
  );
}

function isFeatureFlaggerDeclaration(
  declaration: ts.VariableDeclaration,
): boolean {
  return (
    declaration.initializer !== undefined &&
    ts.isCallExpression(declaration.initializer) &&
    ts.isIdentifier(declaration.initializer.expression) &&
    declaration.initializer.expression.text === featureFlaggerFactory &&
    declaration.initializer.arguments.length === 0
  );
}

function featureFlagSetStatement(config: MigrationSpec): string {
  return `${featureFlagSetCall(config)};`;
}

function featureFlagSetCall(config: MigrationSpec): string {
  const bridge = config.implementationBridge;
  return `${featureFlaggerLocal}.set(${JSON.stringify(config.adapter.selectionKey)}, Reflect.get(window, ${JSON.stringify(bridge.windowKey)}) === ${JSON.stringify(bridge.reactValue)} ? ${JSON.stringify(config.adapter.reactValue)} : ${JSON.stringify(config.adapter.legacyValue)})`;
}

function containingStatement(
  sourceFile: ts.SourceFile,
  node: ts.Node,
): ts.Statement | undefined {
  return sourceFile.statements.find(
    (statement) => statement.pos <= node.pos && statement.end >= node.end,
  );
}

function compact(source: string): string {
  return source.replace(/\s+/g, "");
}

function lineBreak(source: string): "\r\n" | "\n" {
  return source.includes("\r\n") ? "\r\n" : "\n";
}

function renderAdapter(config: MigrationSpec): string {
  return `(function (global) {
  global[${JSON.stringify(config.adapter.globalName)}] = function (container, options, initialIndex) {
    var featureFlagger = global[${JSON.stringify(config.adapter.featureFlaggerGlobal)}];
    if (!featureFlagger) {
      return new global[${JSON.stringify(config.legacyGlobal)}](container, options, initialIndex);
    }
    var implementation = featureFlagger.get(${JSON.stringify(config.adapter.selectionKey)});
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
    throw new Error(${JSON.stringify(`Feature flagger returned an unsupported implementation for ${config.adapter.selectionKey}: `)} + String(implementation) + ".");
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

