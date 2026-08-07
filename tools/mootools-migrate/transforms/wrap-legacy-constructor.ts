import { extname } from "node:path";

import jscodeshift from "jscodeshift";

import {
  sourceLocation,
  type SourceTransformResult,
  type UnsupportedTransformReason,
} from "./contract.js";

export type WrapLegacyConstructorOptions = {
  source: string;
  path: string;
  legacyGlobal: string;
  adapterGlobal: string;
  globalConstructors: readonly {
    line: number;
    column: number;
  }[];
};

export function wrapLegacyConstructor(
  options: WrapLegacyConstructorOptions,
): SourceTransformResult {
  const j = jscodeshift.withParser(parserForPath(options.path));
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
          message: `Could not parse caller: ${
            error instanceof Error ? error.message : String(error)
          }`,
          line: 1,
          column: 1,
        },
      ],
    };
  }
  const reasons: UnsupportedTransformReason[] = [];
  let transformed = 0;
  let shadowed = 0;
  let transformedMultiline = false;
  const globalConstructors = new Set(
    options.globalConstructors.map(
      (location) => `${location.line}:${location.column}`,
    ),
  );
  const alreadyTransformed = root
    .find(j.CallExpression, {
      callee: {
        type: "Identifier",
        name: options.adapterGlobal,
      },
    })
    .size();

  root.find(j.NewExpression).forEach((path) => {
    const callee = path.node.callee;
    if (
      j.Identifier.check(callee) &&
      callee.name === options.legacyGlobal
    ) {
      const location = sourceLocation(path.node.loc);
      if (!globalConstructors.has(`${location.line}:${location.column}`)) {
        shadowed += 1;
        return;
      }
      transformedMultiline ||=
        path.node.loc?.start.line !== path.node.loc?.end.line;
      const replacement = j.callExpression(
        j.identifier(options.adapterGlobal),
        path.node.arguments,
      );
      if (path.node.comments !== undefined) {
        replacement.comments = path.node.comments;
      }
      if (callee.comments !== undefined) {
        replacement.callee.comments = callee.comments;
      }
      j(path).replaceWith(replacement);
      transformed += 1;
      return;
    }

    if (containsLegacyReference(j, callee, options.legacyGlobal)) {
      const location = sourceLocation(path.node.loc);
      reasons.push({
        message: `Unsupported computed constructor for ${options.legacyGlobal}.`,
        line: location.line,
        column: location.column,
      });
    }
  });

  const statistics = {
    transformed,
    alreadyTransformed,
    shadowed,
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
  if (transformed === 0) {
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
      reuseWhitespace: true,
      trailingComma: true,
      wrapColumn: transformedMultiline ? 1 : 80,
    }),
    statistics,
  };
}

function containsLegacyReference(
  j: jscodeshift.JSCodeshift,
  node: jscodeshift.NewExpression["callee"],
  legacyGlobal: string,
): boolean {
  return (
    j(node)
      .find(j.Identifier, {
        name: legacyGlobal,
      })
      .size() > 0 ||
    (j.MemberExpression.check(node) &&
      node.computed === true &&
      ((j.Literal.check(node.property) &&
        node.property.value === legacyGlobal) ||
        (j.StringLiteral.check(node.property) &&
          node.property.value === legacyGlobal)))
  );
}

function lineTerminator(source: string): string {
  return source.includes("\r\n") ? "\r\n" : "\n";
}

function parserForPath(path: string): "babel" | "ts" | "tsx" {
  switch (extname(path)) {
    case ".ts":
      return "ts";
    case ".tsx":
      return "tsx";
    default:
      return "babel";
  }
}
