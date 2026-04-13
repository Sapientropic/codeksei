#!/usr/bin/env node

import * as ts from "typescript";
import {
  buildGuardFailureMessage,
  formatLocation,
  parseTsFile,
  readAllowlistEntries,
  readStructuralDebtInventory,
  resolveGuardResult,
  walkRepoTsFiles,
} from "./structural-debt-guard";

export function assertNoEmptyCatch(): void {
  const inventory = readStructuralDebtInventory();
  const allowlist = readAllowlistEntries(inventory, "emptyCatchAllowlist");
  const violations: string[] = [];

  for (const absolutePath of walkRepoTsFiles()) {
    const sourceFile = parseTsFile(absolutePath);
    visit(sourceFile);

    function visit(node: ts.Node): void {
      if (
        ts.isCallExpression(node)
        && ts.isPropertyAccessExpression(node.expression)
        && node.expression.name.text === "catch"
        && node.arguments.length === 1
      ) {
        const handler = node.arguments[0];
        if (!handler) {
          ts.forEachChild(node, visit);
          return;
        }
        if (
          (ts.isArrowFunction(handler) || ts.isFunctionExpression(handler))
          && handler.parameters.length === 0
          && ts.isBlock(handler.body)
          && handler.body.statements.length === 0
        ) {
          violations.push(formatLocation(sourceFile, node));
        }
      }
      ts.forEachChild(node, visit);
    }
  }

  const { unexpected, staleAllowlist } = resolveGuardResult(violations, allowlist);
  if (unexpected.length || staleAllowlist.length) {
    throw new Error(buildGuardFailureMessage({
      title: "repo empty catch guard failed",
      unexpectedLabel: "Unexpected bare .catch(() => {}) call sites:",
      unexpected,
      staleAllowlist,
    }));
  }
}

export function main(): void {
  assertNoEmptyCatch();
  console.log("[codeksei] empty catch guard passed");
}

if (require.main === module) {
  main();
}
