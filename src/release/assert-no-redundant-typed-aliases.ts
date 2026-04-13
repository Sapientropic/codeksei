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

const TYPED_ALIAS_PATTERN = /^typed[A-Z]/u;

export function assertNoRedundantTypedAliases(): void {
  const inventory = readStructuralDebtInventory();
  const allowlist = readAllowlistEntries(inventory, "redundantTypedAliasAllowlist");
  const violations: string[] = [];

  for (const absolutePath of walkRepoTsFiles()) {
    const sourceFile = parseTsFile(absolutePath);
    visit(sourceFile);

    function visit(node: ts.Node): void {
      if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && TYPED_ALIAS_PATTERN.test(node.name.text)) {
        violations.push(formatLocation(sourceFile, node));
      }
      ts.forEachChild(node, visit);
    }
  }

  const { unexpected, staleAllowlist } = resolveGuardResult(violations, allowlist);
  if (unexpected.length || staleAllowlist.length) {
    throw new Error(buildGuardFailureMessage({
      title: "repo typed alias guard failed",
      unexpectedLabel: "Unexpected typedXxx placeholder locals:",
      unexpected,
      staleAllowlist,
    }));
  }
}

export function main(): void {
  assertNoRedundantTypedAliases();
  console.log("[codeksei] typed alias guard passed");
}

if (require.main === module) {
  main();
}
