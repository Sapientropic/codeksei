#!/usr/bin/env node

import * as fs from "node:fs";

import { resolveRepoHostkitAssetPath, renderRepoHostkitDocument } from "../host/renderers/hostkit";

function normalizeLineEndings(value: string): string {
  return value.replace(/\r\n/gu, "\n");
}

export function assertHostkitSync(): void {
  const hostkitPath = resolveRepoHostkitAssetPath();
  const tracked = fs.existsSync(hostkitPath)
    ? fs.readFileSync(hostkitPath, "utf8")
    : "";
  const rendered = renderRepoHostkitDocument();
  if (normalizeLineEndings(tracked) === normalizeLineEndings(rendered)) {
    return;
  }
  throw new Error([
    "repo hostkit sync guard failed",
    "",
    `Tracked asset is out of sync: ${hostkitPath}`,
    "Run `npm run sync:hostkit` to refresh CODEKSEI_HOSTKIT.json from the hosted-first renderer truth.",
  ].join("\n"));
}

export function main(): void {
  assertHostkitSync();
  console.log("[codeksei] hostkit sync guard passed");
}

if (require.main === module) {
  main();
}
