import jscodeshift from "jscodeshift";

import {
  sourceLocation,
  type SourceTransformResult,
  type UnsupportedTransformReason,
} from "./contract.js";

export type UpdateBootstrapOptions = {
  source: string;
  path: string;
  adapterModule: string;
  adapterLocal: string;
  mainLocal: string;
  mainModule: string;
};

export function updateBootstrap(
  options: UpdateBootstrapOptions,
): SourceTransformResult {
  const j = jscodeshift.withParser("ts");
  let root: jscodeshift.Collection;
  try {
    root = j(options.source);
  } catch (error: unknown) {
    return {
      kind: "unsupported",
      source: options.source,
      statistics: { parseErrors: 1 },
      reasons: [
        {
          message: `Could not parse bootstrap: ${
            error instanceof Error ? error.message : String(error)
          }`,
          line: 1,
          column: 1,
        },
      ],
    };
  }
  const reasons: UnsupportedTransformReason[] = [];
  const imports = root.find(j.ImportDeclaration);
  const adapterImports = imports.filter(
    (path) => stringValue(path.node.source) === options.adapterModule,
  );
  const mainLocalImports = imports.filter((path) =>
    path.node.specifiers?.some(
      (specifier) =>
        j.ImportDefaultSpecifier.check(specifier) &&
        specifier.local?.name === options.mainLocal,
    ) ?? false,
  );
  const mainImports = mainLocalImports.filter(
    (path) => stringValue(path.node.source) === options.mainModule,
  );
  const conflictingAdapterImports = imports.filter(
    (path) =>
      stringValue(path.node.source) !== options.adapterModule &&
      (path.node.specifiers?.some(
        (specifier) =>
          specifier.local?.name === options.adapterLocal,
      ) ??
        false),
  );
  const conflictingAdapterVariables = root
    .find(j.VariableDeclarator)
    .filter((path) =>
      bindingContainsName(path.node.id, options.adapterLocal),
    );
  const conflictingAdapterFunctions = root.find(j.FunctionDeclaration, {
    id: { type: "Identifier", name: options.adapterLocal },
  });
  const conflictingAdapterClasses = root.find(j.ClassDeclaration, {
    id: { type: "Identifier", name: options.adapterLocal },
  });
  const scriptArrays = root.find(j.ArrayExpression).filter((path) =>
    path.node.elements.some(
      (element) =>
        element !== null &&
        j.Identifier.check(element) &&
        element.name === options.mainLocal,
    ),
  );
  const adapterArrayEntries = root
    .find(j.ArrayExpression)
    .find(j.Identifier, { name: options.adapterLocal });

  if (adapterImports.size() > 1) {
    reasons.push(
      reasonForNode(
        adapterImports.at(1).nodes()[0],
        "Duplicate adapter imports.",
      ),
    );
  }
  if (mainImports.size() === 0) {
    if (mainLocalImports.size() > 0) {
      reasons.push(
        reasonForNode(
          mainLocalImports.nodes()[0],
          `${options.mainLocal} import must reference ${options.mainModule}.`,
        ),
      );
    } else {
      reasons.push({
        message: `Missing ${options.mainLocal} import.`,
        line: 1,
        column: 1,
      });
    }
  } else if (mainImports.size() > 1) {
    reasons.push(
      reasonForNode(mainImports.at(1).nodes()[0], "Duplicate mainUrl imports."),
    );
  }
  if (scriptArrays.size() === 0) {
    reasons.push({
      message: `Missing ${options.mainLocal} script entry.`,
      line: 1,
      column: 1,
    });
  } else if (scriptArrays.size() > 1) {
    reasons.push(
      reasonForNode(
        scriptArrays.at(1).nodes()[0],
        "Ambiguous script arrays containing mainUrl.",
      ),
    );
  }
  const duplicateMainArray = scriptArrays
    .nodes()
    .find(
      (array) =>
        array.elements.filter(
          (element) =>
            element !== null &&
            j.Identifier.check(element) &&
            element.name === options.mainLocal,
        ).length > 1,
    );
  if (duplicateMainArray !== undefined) {
    reasons.push(
      reasonForNode(
        duplicateMainArray,
        `Duplicate ${options.mainLocal} script entries.`,
      ),
    );
  }
  if (adapterArrayEntries.size() > 1) {
    reasons.push(
      reasonForNode(
        adapterArrayEntries.at(1).nodes()[0],
        "Duplicate adapter script entries.",
      ),
    );
  }
  if (adapterImports.size() === 1) {
    const adapterImport = adapterImports.nodes()[0];
    const defaultLocal = adapterImport?.specifiers?.find((specifier) =>
      j.ImportDefaultSpecifier.check(specifier),
    )?.local?.name;
    if (defaultLocal !== options.adapterLocal) {
      reasons.push(
        reasonForNode(
          adapterImport,
          `Adapter import must use local name ${options.adapterLocal}.`,
        ),
      );
    }
  }
  const conflictingBindings = [
    ...conflictingAdapterImports.nodes(),
    ...conflictingAdapterVariables.nodes(),
    ...conflictingAdapterFunctions.nodes(),
    ...conflictingAdapterClasses.nodes(),
  ];
  if (conflictingBindings.length > 0) {
    reasons.push(
      reasonForNode(
        conflictingBindings[0],
        `Local name ${options.adapterLocal} is already in use.`,
      ),
    );
  }

  const targetArray = scriptArrays.nodes()[0];
  if (
    adapterArrayEntries.size() === 1 &&
    targetArray !== undefined &&
    !targetArray.elements.some(
      (element) =>
        element !== null &&
        j.Identifier.check(element) &&
        element.name === options.adapterLocal,
    )
  ) {
    reasons.push(
      reasonForNode(
        adapterArrayEntries.nodes()[0],
        "Adapter script entry is outside the main script array.",
      ),
    );
  }
  if (targetArray !== undefined && adapterArrayEntries.size() === 1) {
    const adapterIndex = targetArray.elements.findIndex(
      (element) =>
        element !== null &&
        j.Identifier.check(element) &&
        element.name === options.adapterLocal,
    );
    const mainIndex = targetArray.elements.findIndex(
      (element) =>
        element !== null &&
        j.Identifier.check(element) &&
        element.name === options.mainLocal,
    );
    if (adapterIndex !== mainIndex - 1) {
      reasons.push(
        reasonForNode(
          targetArray.elements[adapterIndex] ?? targetArray,
          `Adapter script entry must be immediately before ${options.mainLocal}.`,
        ),
      );
    }
  }

  const statistics = {
    adapterImports: adapterImports.size(),
    adapterEntries: adapterArrayEntries.size(),
    mainImports: mainImports.size(),
    mainArrays: scriptArrays.size(),
    insertedImports: 0,
    insertedEntries: 0,
    unsupported: reasons.length,
  };
  if (reasons.length > 0) {
    return {
      kind: "unsupported",
      source: options.source,
      statistics,
      reasons,
    };
  }

  let insertedImports = 0;
  let insertedEntries = 0;
  if (adapterImports.size() === 0) {
    const declaration = j.importDeclaration(
      [j.importDefaultSpecifier(j.identifier(options.adapterLocal))],
      j.literal(options.adapterModule),
    );
    mainImports.at(0).insertAfter(declaration);
    insertedImports = 1;
  }
  if (adapterArrayEntries.size() === 0 && targetArray !== undefined) {
    const mainIndex = targetArray.elements.findIndex(
      (element) =>
        element !== null &&
        j.Identifier.check(element) &&
        element.name === options.mainLocal,
    );
    scriptArrays.at(0).forEach((path) => {
      path
        .get("elements", mainIndex)
        .insertBefore(j.identifier(options.adapterLocal));
    });
    insertedEntries = 1;
  }
  if (insertedImports === 0 && insertedEntries === 0) {
    return {
      kind: "unchanged",
      source: options.source,
      statistics,
    };
  }

  return {
    kind: "changed",
    source: root.toSource({
      lineTerminator: lineTerminator(options.source),
      quote: quoteStyle(options.source),
      reuseWhitespace: true,
      trailingComma: true,
      wrapColumn: 1,
    }),
    statistics: {
      ...statistics,
      insertedImports,
      insertedEntries,
    },
  };
}

function stringValue(node: unknown): string | null {
  if (typeof node !== "object" || node === null) {
    return null;
  }
  const value = Reflect.get(node, "value");
  return typeof value === "string" ? value : null;
}

function bindingContainsName(node: unknown, name: string): boolean {
  if (typeof node !== "object" || node === null) {
    return false;
  }
  const type = Reflect.get(node, "type");
  if (type === "Identifier") {
    return Reflect.get(node, "name") === name;
  }
  if (type === "RestElement") {
    return bindingContainsName(Reflect.get(node, "argument"), name);
  }
  if (type === "AssignmentPattern") {
    return bindingContainsName(Reflect.get(node, "left"), name);
  }
  if (type === "ArrayPattern") {
    const elements = Reflect.get(node, "elements");
    return (
      Array.isArray(elements) &&
      elements.some((element) => bindingContainsName(element, name))
    );
  }
  if (type === "ObjectPattern") {
    const properties = Reflect.get(node, "properties");
    return (
      Array.isArray(properties) &&
      properties.some((property) => {
        if (typeof property !== "object" || property === null) {
          return false;
        }
        return bindingContainsName(
          Reflect.get(property, "value") ??
            Reflect.get(property, "argument"),
          name,
        );
      })
    );
  }
  return false;
}

function reasonForNode(
  node: { loc?: { start?: { line: number; column: number } | null } | null } | undefined,
  message: string,
): UnsupportedTransformReason {
  const location = sourceLocation(node?.loc);
  return { message, line: location.line, column: location.column };
}

function lineTerminator(source: string): string {
  return source.includes("\r\n") ? "\r\n" : "\n";
}

function quoteStyle(source: string): "single" | "double" {
  const singleImports = (source.match(/from\s+'[^']+'/g) ?? []).length;
  const doubleImports = (source.match(/from\s+"[^"]+"/g) ?? []).length;
  return singleImports > doubleImports ? "single" : "double";
}
