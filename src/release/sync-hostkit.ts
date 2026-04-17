#!/usr/bin/env node

import * as fs from "node:fs";

import { resolveRepoHostkitAssetPath, renderRepoHostkitDocument } from "../host/renderers/hostkit";

export function syncHostkit(): string {
  const hostkitPath = resolveRepoHostkitAssetPath();
  fs.writeFileSync(hostkitPath, renderRepoHostkitDocument(), "utf8");
  return hostkitPath;
}

export function main(): void {
  const hostkitPath = syncHostkit();
  console.log(`[codeksei] synced hostkit asset: ${hostkitPath}`);
}

if (require.main === module) {
  main();
}
