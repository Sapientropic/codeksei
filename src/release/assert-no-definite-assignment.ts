#!/usr/bin/env node

import * as path from "node:path";
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

export function assertNoDefiniteAssignment(): void {
  const inventory = readStructuralDebtInventory();
  const allowlist = readAllowlistEntries(inventory, "definiteAssignmentAllowlist");
  const violations: string[] = [];

  for (const absolutePath of walkRepoTsFiles().filter((entry) => entry.includes(`${pathSeparator()}src${pathSeparator()}`))) {
    const sourceFile = parseTsFile(absolutePath);
    visit(sourceFile);

    function visit(node: ts.Node): void {
      if (ts.isPropertyDeclaration(node) && node.exclamationToken) {
        violations.push(formatLocation(sourceFile, node));
      }
      ts.forEachChild(node, visit);
    }
  }

  const { unexpected, staleAllowlist } = resolveGuardResult(violations, allowlist);
  if (unexpected.length || staleAllowlist.length) {
    throw new Error(buildGuardFailureMessage({
      title: "repo definite assignment guard failed",
      unexpectedLabel: "Unexpected definite-assignment property fields:",
      unexpected,
      staleAllowlist,
    }));
  }
}

function pathSeparator(): string {
  return path.sep;
}

export function main(): void {
  assertNoDefiniteAssignment();
  console.log("[codeksei] definite assignment guard passed");
}

if (require.main === module) {
  main();
}
