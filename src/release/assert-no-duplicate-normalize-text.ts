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

const canonicalFile = "src/core/text-normalization.ts";

export function assertNoDuplicateNormalizeText(): void {
  const inventory = readStructuralDebtInventory();
  const allowlist = readAllowlistEntries(inventory, "duplicateNormalizeTextAllowlist");
  const allDefinitions: string[] = [];

  for (const absolutePath of walkRepoTsFiles()) {
    const sourceFile = parseTsFile(absolutePath);
    visit(sourceFile);

    function visit(node: ts.Node): void {
      if (isNormalizeTextDefinition(node)) {
        allDefinitions.push(formatLocation(sourceFile, node));
      }
      ts.forEachChild(node, visit);
    }
  }

  const canonicalDefinitions = allDefinitions.filter((entry) => entry.startsWith(`${canonicalFile}:`));
  if (canonicalDefinitions.length !== 1) {
    throw new Error([
      "repo normalizeText canonical helper guard failed",
      "",
      `Expected exactly one canonical normalizeText definition in ${canonicalFile}.`,
      ...canonicalDefinitions.map((entry) => `- ${entry}`),
    ].join("\n"));
  }

  const extras = allDefinitions.filter((entry) => !entry.startsWith(`${canonicalFile}:`));
  const { unexpected, staleAllowlist } = resolveGuardResult(extras, allowlist);
  if (unexpected.length || staleAllowlist.length) {
    throw new Error(buildGuardFailureMessage({
      title: "repo normalizeText duplication guard failed",
      unexpectedLabel: "Unexpected non-canonical normalizeText definitions:",
      unexpected,
      staleAllowlist,
    }));
  }
}

function isNormalizeTextDefinition(node: ts.Node): boolean {
  if (ts.isFunctionDeclaration(node)) {
    return node.name?.text === "normalizeText";
  }
  if (ts.isMethodDeclaration(node)) {
    return ts.isIdentifier(node.name) && node.name.text === "normalizeText";
  }
  if (ts.isPropertyAssignment(node)) {
    return ts.isIdentifier(node.name)
      && node.name.text === "normalizeText"
      && (ts.isArrowFunction(node.initializer) || ts.isFunctionExpression(node.initializer));
  }
  if (ts.isVariableDeclaration(node)) {
    const initializer = node.initializer;
    if (!ts.isIdentifier(node.name) || node.name.text !== "normalizeText" || !initializer) {
      return false;
    }
    return ts.isArrowFunction(initializer) || ts.isFunctionExpression(initializer);
  }
  return false;
}

export function main(): void {
  assertNoDuplicateNormalizeText();
  console.log("[codeksei] normalizeText duplication guard passed");
}

if (require.main === module) {
  main();
}
