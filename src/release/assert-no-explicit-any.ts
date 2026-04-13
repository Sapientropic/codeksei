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

export function assertNoExplicitAny(): void {
  const inventory = readStructuralDebtInventory();
  const allowlist = readAllowlistEntries(inventory, "explicitAnyAllowlist");
  const violations: string[] = [];

  for (const absolutePath of walkRepoTsFiles()) {
    const sourceFile = parseTsFile(absolutePath);
    visit(sourceFile);

    function visit(node: ts.Node): void {
      if (node.kind === ts.SyntaxKind.AnyKeyword) {
        violations.push(formatLocation(sourceFile, node));
      }
      ts.forEachChild(node, visit);
    }
  }

  const { unexpected, staleAllowlist } = resolveGuardResult(violations, allowlist);
  if (unexpected.length || staleAllowlist.length) {
    throw new Error(buildGuardFailureMessage({
      title: "repo explicit any guard failed",
      unexpectedLabel: "Unexpected explicit any locations:",
      unexpected,
      staleAllowlist,
    }));
  }
}

export function main(): void {
  assertNoExplicitAny();
  console.log("[codeksei] explicit any guard passed");
}

if (require.main === module) {
  main();
}
