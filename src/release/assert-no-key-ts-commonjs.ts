#!/usr/bin/env node

const fs = require("fs");
const path = require("path");

const rootDir = path.resolve(__dirname, "..", "..", "..");
const TARGET_FILES = [
  "src/core/app.ts",
  "src/core/runtime-turn-lifecycle.ts",
  "src/core/runtime-watchdog-lifecycle.ts",
  "src/core/backstage-task-lifecycle.ts",
  "src/adapters/runtime/codex/index.ts",
  "src/adapters/runtime/codex/session-store.ts",
  "src/adapters/channel/weixin/index.ts",
];
const COMMONJS_PATTERN = /\brequire\s*\(|\bmodule\.exports\b|\bexports\./u;

function assertNoKeyTsCommonJs({
  files = TARGET_FILES,
  cwd = rootDir,
}: any = {}) {
  const violations: string[] = [];
  for (const relativePath of files) {
    const absolutePath = path.resolve(cwd, relativePath);
    if (!fs.existsSync(absolutePath)) {
      throw new Error(`guard target missing: ${relativePath}`);
    }
    const source = fs.readFileSync(absolutePath, "utf8");
    const lines = source.split(/\r?\n/u);
    lines.forEach((line: any, index: any) => {
      if (!COMMONJS_PATTERN.test(line)) {
        return;
      }
      violations.push(`${relativePath}:${index + 1}: ${line.trim()}`);
    });
  }

  if (violations.length) {
    throw new Error(`key TypeScript boundary files must stay on import/export syntax:\n${violations.join("\n")}`);
  }
}

function main() {
  assertNoKeyTsCommonJs();
  console.log(`[codeksei] key TS import/export guard passed (${TARGET_FILES.length} files)`);
}

if (require.main === module) {
  main();
}

module.exports = {
  assertNoKeyTsCommonJs,
  main,
  TARGET_FILES,
};

export {};
