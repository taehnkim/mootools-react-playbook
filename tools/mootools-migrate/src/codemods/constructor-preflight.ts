import { extname } from "node:path";

import ts from "typescript";

export type ConstructorLocation = {
  line: number;
  column: number;
};

export type ConstructorPreflight = {
  globalConstructors: ConstructorLocation[];
  shadowedConstructors: ConstructorLocation[];
};

export function preflightLegacyConstructors(options: {
  source: string;
  path: string;
  legacyGlobal: string;
}): ConstructorPreflight {
  const compilerOptions: ts.CompilerOptions = {
    allowJs: true,
    checkJs: false,
    noResolve: true,
    target: ts.ScriptTarget.Latest,
  };
  const sourceFile = ts.createSourceFile(
    options.path,
    options.source,
    ts.ScriptTarget.Latest,
    true,
    scriptKindForPath(options.path),
  );
  const host = ts.createCompilerHost(compilerOptions);
  const originalGetSourceFile = host.getSourceFile;
  host.getSourceFile = (fileName, languageVersion, onError, shouldCreate) => {
    if (fileName === options.path) {
      return sourceFile;
    }
    return originalGetSourceFile(
      fileName,
      languageVersion,
      onError,
      shouldCreate,
    );
  };
  host.fileExists = (fileName) =>
    fileName === options.path || ts.sys.fileExists(fileName);
  host.readFile = (fileName) =>
    fileName === options.path ? options.source : ts.sys.readFile(fileName);
  const program = ts.createProgram(
    [options.path],
    compilerOptions,
    host,
  );
  const checker = program.getTypeChecker();
  const globalConstructors: ConstructorLocation[] = [];
  const shadowedConstructors: ConstructorLocation[] = [];

  walk(sourceFile, (node) => {
    if (
      !ts.isNewExpression(node) ||
      !ts.isIdentifier(node.expression) ||
      node.expression.text !== options.legacyGlobal
    ) {
      return;
    }
    const position = sourceFile.getLineAndCharacterOfPosition(
      node.getStart(sourceFile),
    );
    const location = {
      line: position.line + 1,
      column: position.character + 1,
    };
    const symbol = checker.getSymbolAtLocation(node.expression);
    if (symbol === undefined) {
      globalConstructors.push(location);
    } else {
      shadowedConstructors.push(location);
    }
  });

  return { globalConstructors, shadowedConstructors };
}

function scriptKindForPath(path: string): ts.ScriptKind {
  switch (extname(path)) {
    case ".ts":
      return ts.ScriptKind.TS;
    case ".tsx":
      return ts.ScriptKind.TSX;
    case ".jsx":
      return ts.ScriptKind.JSX;
    default:
      return ts.ScriptKind.JS;
  }
}

export function moduleFromDefaultImportAnchor(options: {
  anchor: string;
  localName: string;
}): string {
  const sourceFile = ts.createSourceFile(
    "adapter-import-anchor.ts",
    options.anchor,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );
  const imports = sourceFile.statements.filter(ts.isImportDeclaration);
  const declaration = imports[0];
  if (
    imports.length !== 1 ||
    declaration === undefined ||
    declaration.importClause?.name?.text !== options.localName ||
    !ts.isStringLiteral(declaration.moduleSpecifier)
  ) {
    throw new Error(
      `Bootstrap import anchor must be one default ${options.localName} import.`,
    );
  }
  return declaration.moduleSpecifier.text;
}

export function localNameFromArrayAnchor(anchor: string): string {
  const sourceFile = ts.createSourceFile(
    "adapter-array-anchor.ts",
    `const values = [${anchor}];`,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );
  const statement = sourceFile.statements[0];
  if (
    statement === undefined ||
    !ts.isVariableStatement(statement)
  ) {
    throw new Error("Bootstrap array anchor is invalid.");
  }
  const initializer =
    statement.declarationList.declarations[0]?.initializer;
  const element =
    initializer !== undefined && ts.isArrayLiteralExpression(initializer)
      ? initializer.elements[0]
      : undefined;
  if (element === undefined || !ts.isIdentifier(element)) {
    throw new Error(
      "Bootstrap array anchor must contain one identifier.",
    );
  }
  return element.text;
}

function walk(node: ts.Node, visit: (node: ts.Node) => void): void {
  visit(node);
  node.forEachChild((child) => walk(child, visit));
}
