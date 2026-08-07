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

import type { ToolContext } from "../core/context.js";
import type { ComponentConfig } from "../contracts/schemas.js";
import {
  localNameFromArrayAnchor,
  moduleFromDefaultImportAnchor,
  preflightLegacyConstructors,
} from "./constructor-preflight.js";
import { wrapLegacyConstructor } from "../../transforms/wrap-legacy-constructor.js";
import { updateBootstrap } from "../../transforms/update-bootstrap.js";
import type {
  SourceTransformResult,
  TransformStatistics,
} from "../../transforms/contract.js";

const execFileAsync = promisify(execFile);

export type PlannedEdit = {
  path: string;
  before: string | null;
  after: string;
};

export type TransformFileReport = {
  path: string;
  transform: "adapter-file" | "update-bootstrap" | "wrap-legacy-constructor";
  result: "changed" | "unchanged" | "unsupported";
  statistics: TransformStatistics;
};

export type AdapterCodemodResult =
  | {
      kind: "ready";
      edits: PlannedEdit[];
      reports: TransformFileReport[];
    }
  | {
      kind: "unsupported";
      reasons: string[];
      reports: TransformFileReport[];
    };

export type AdapterFileOperations = {
  mkdir: typeof mkdir;
  writeFile: typeof writeFile;
  rename: typeof rename;
  unlink: typeof unlink;
};

export async function planAdapterCodemod(options: {
  context: ToolContext;
  config: ComponentConfig;
}): Promise<AdapterCodemodResult> {
  const reasons: string[] = [];
  const edits: PlannedEdit[] = [];
  const reports: TransformFileReport[] = [];

  for (const path of options.config.adapter.callsiteFiles) {
    const absolutePath = resolve(options.context.projectRoot, path);
    const source = await readFile(absolutePath, "utf8");
    const preflight = preflightLegacyConstructors({
      source,
      path,
      legacyGlobal: options.config.legacyGlobal,
    });
    const result = wrapLegacyConstructor({
      source,
      path,
      legacyGlobal: options.config.legacyGlobal,
      adapterGlobal: options.config.adapter.globalName,
      globalConstructors: preflight.globalConstructors,
    });
    reports.push(transformReport(path, "wrap-legacy-constructor", result));
    if (result.kind === "unsupported") {
      reasons.push(
        ...result.reasons.map(
          (reason) =>
            `${path}:${reason.line}:${reason.column} ${reason.message}`,
        ),
      );
    } else if (result.kind === "changed") {
      edits.push({ path, before: source, after: result.source });
    }
  }

  const adapterPath = options.config.adapter.outputPath;
  const adapterSource = renderAdapter(options.config);
  const existingAdapter = await readOptional(
    resolve(options.context.projectRoot, adapterPath),
  );
  if (existingAdapter === null) {
    edits.push({ path: adapterPath, before: null, after: adapterSource });
    reports.push({
      path: adapterPath,
      transform: "adapter-file",
      result: "changed",
      statistics: { created: 1 },
    });
  } else if (existingAdapter !== adapterSource) {
    reasons.push(`Existing adapter differs from generated output: ${adapterPath}`);
    reports.push({
      path: adapterPath,
      transform: "adapter-file",
      result: "unsupported",
      statistics: { conflicts: 1 },
    });
  } else {
    reports.push({
      path: adapterPath,
      transform: "adapter-file",
      result: "unchanged",
      statistics: { existing: 1 },
    });
  }

  const bootstrapPath = options.config.adapter.bootstrapFile;
  const bootstrapSource = await readFile(
    resolve(options.context.projectRoot, bootstrapPath),
    "utf8",
  );
  const mainLocal = localNameFromArrayAnchor(
    options.config.adapter.bootstrapArrayAnchor,
  );
  const bootstrapResult = updateBootstrap({
    source: bootstrapSource,
    path: bootstrapPath,
    adapterModule: `${options.config.adapter.bootstrapImportPath}?url`,
    adapterLocal: "mountAdapterUrl",
    mainLocal,
    mainModule: moduleFromDefaultImportAnchor({
      anchor: options.config.adapter.bootstrapImportAnchor,
      localName: mainLocal,
    }),
  });
  reports.push(
    transformReport(bootstrapPath, "update-bootstrap", bootstrapResult),
  );
  if (bootstrapResult.kind === "unsupported") {
    reasons.push(
      ...bootstrapResult.reasons.map(
        (reason) =>
          `${bootstrapPath}:${reason.line}:${reason.column} ${reason.message}`,
      ),
    );
  } else if (bootstrapResult.kind === "changed") {
    edits.push({
      path: bootstrapPath,
      before: bootstrapSource,
      after: bootstrapResult.source,
    });
  }

  if (reasons.length > 0) {
    return { kind: "unsupported", reasons, reports };
  }
  return { kind: "ready", edits, reports };
}

export async function applyAdapterCodemod(options: {
  context: ToolContext;
  result: Extract<AdapterCodemodResult, { kind: "ready" }>;
  allowUnsafeWrite: boolean;
  fileOperations?: Partial<AdapterFileOperations>;
}): Promise<void> {
  if (options.result.edits.length === 0) {
    return;
  }

  const paths = options.result.edits.map((edit) => edit.path);
  if (!options.allowUnsafeWrite) {
    await requireCleanGitPaths(options.context.projectRoot, paths);
  }
  const fileOperations: AdapterFileOperations = {
    mkdir,
    writeFile,
    rename,
    unlink,
    ...options.fileOperations,
  };

  const temporaryPaths: string[] = [];
  try {
    for (const edit of options.result.edits) {
      const absolutePath = resolve(options.context.projectRoot, edit.path);
      const temporaryPath = `${absolutePath}.migration-tools-tmp`;
      await fileOperations.mkdir(dirname(absolutePath), { recursive: true });
      await fileOperations.writeFile(temporaryPath, edit.after, "utf8");
      temporaryPaths.push(temporaryPath);
    }

    for (const edit of options.result.edits) {
      const absolutePath = resolve(options.context.projectRoot, edit.path);
      await fileOperations.rename(
        `${absolutePath}.migration-tools-tmp`,
        absolutePath,
      );
    }
  } catch (error: unknown) {
    await restoreEdits(
      options.context.projectRoot,
      options.result.edits,
      fileOperations,
    );
    for (const temporaryPath of temporaryPaths) {
      await fileOperations.unlink(temporaryPath).catch(() => undefined);
    }
    throw error;
  }
}

function transformReport(
  path: string,
  transform: TransformFileReport["transform"],
  result: SourceTransformResult,
): TransformFileReport {
  return {
    path,
    transform,
    result: result.kind,
    statistics: result.statistics,
  };
}

function renderAdapter(config: ComponentConfig): string {
  return `(function (global) {
  global.${config.adapter.globalName} = function (container, options, showNow) {
    return new global.${config.legacyGlobal}(container, options, showNow);
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
      "Adapter writes require a clean git repository. Use --allow-unsafe-write only in a disposable sandbox.",
      { cause: error },
    );
  }
}

async function restoreEdits(
  projectRoot: string,
  edits: PlannedEdit[],
  fileOperations: AdapterFileOperations,
): Promise<void> {
  for (const edit of edits) {
    const absolutePath = resolve(projectRoot, edit.path);
    if (edit.before === null) {
      await fileOperations.unlink(absolutePath).catch(() => undefined);
    } else {
      await fileOperations.writeFile(absolutePath, edit.before, "utf8");
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

