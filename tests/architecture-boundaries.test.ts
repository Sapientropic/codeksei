const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const assert = require("node:assert/strict");

const repoRoot = path.join(__dirname, "..");
const srcRoot = path.join(repoRoot, "src");
const allowlist: Array<{ from: string; to: string }> = [
  {
    from: "src/workspace/default-targets.ts",
    to: "src/adapters/channel/weixin/context-token-store.ts",
  },
];
const rules: Array<{
  sourcePrefix: string;
  forbiddenPrefixes: string[];
  reason: string;
}> = [
  {
    sourcePrefix: "src/review/",
    forbiddenPrefixes: ["src/app/"],
    reason: "review should not depend on app CLI wiring",
  },
  {
    sourcePrefix: "src/notes/",
    forbiddenPrefixes: ["src/adapters/"],
    reason: "notes should stay above adapter details",
  },
  {
    sourcePrefix: "src/state/",
    forbiddenPrefixes: ["src/app/"],
    reason: "state stores should not depend on app CLI layer",
  },
  {
    sourcePrefix: "src/core/",
    forbiddenPrefixes: ["src/review/", "src/notes/"],
    reason: "core should remain orchestration shell, not absorb review/notes logic",
  },
  {
    sourcePrefix: "src/runtime/",
    forbiddenPrefixes: ["src/review/", "src/notes/", "src/app/"],
    reason: "runtime should stay below domain logic and above app CLI wiring",
  },
  {
    sourcePrefix: "src/shared/",
    forbiddenPrefixes: ["src/app/", "src/review/", "src/notes/"],
    reason: "shared helpers should not absorb app or domain workflow logic",
  },
  {
    sourcePrefix: "src/workspace/",
    forbiddenPrefixes: ["src/runtime/", "src/adapters/", "src/app/", "src/review/", "src/notes/"],
    reason: "workspace continuity should stay below runtime/app wiring and outside domain logic",
  },
  {
    sourcePrefix: "src/adapters/",
    forbiddenPrefixes: ["src/app/", "src/review/", "src/notes/"],
    reason: "adapters should not depend on app CLI or domain workflow implementations",
  },
];

test("architecture boundaries keep review notes state and core decoupled", () => {
  const files = collectSourceFiles(srcRoot);
  const violations = [];

  for (const filePath of files) {
    const relativeFile = toRepoRelative(filePath);
    for (const rule of rules) {
      if (!relativeFile.startsWith(rule.sourcePrefix)) {
        continue;
      }
      for (const dependency of collectRelativeDependencies(filePath)) {
        if (!rule.forbiddenPrefixes.some((prefix) => dependency.startsWith(prefix))) {
          continue;
        }
        const allowlisted = allowlist.some((entry) => (
          entry.from === relativeFile
          && entry.to === dependency
        ));
        if (allowlisted) {
          continue;
        }
        violations.push(`${relativeFile} -> ${dependency} (${rule.reason})`);
      }
    }
  }

  assert.deepEqual(violations, []);
});

function collectSourceFiles(rootPath: string): string[] {
  const files: string[] = [];
  const stack: string[] = [rootPath];
  while (stack.length) {
    const current = stack.pop();
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const entryPath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        stack.push(entryPath);
        continue;
      }
      if (/\.(ts|js)$/u.test(entry.name)) {
        files.push(entryPath);
      }
    }
  }
  return files;
}

function collectRelativeDependencies(filePath: string): string[] {
  const source = fs.readFileSync(filePath, "utf8");
  const matches = [
    ...source.matchAll(/from\s+["'](.+?)["']/gu),
    ...source.matchAll(/require\(\s*["'](.+?)["']\s*\)/gu),
  ];
  const dependencies: string[] = [];
  for (const match of matches) {
    const specifier = match[1];
    if (!specifier.startsWith(".")) {
      continue;
    }
    dependencies.push(resolveRepoImport(filePath, specifier));
  }
  return dependencies.filter(Boolean);
}

function resolveRepoImport(fromFile: string, specifier: string): string {
  const basePath = path.resolve(path.dirname(fromFile), specifier);
  const candidates = [
    basePath,
    `${basePath}.ts`,
    `${basePath}.js`,
    path.join(basePath, "index.ts"),
    path.join(basePath, "index.js"),
  ];
  const resolved = candidates.find((candidate) => fs.existsSync(candidate)) || basePath;
  return toRepoRelative(resolved);
}

function toRepoRelative(targetPath: string): string {
  return path.relative(repoRoot, targetPath).replace(/\\/g, "/");
}
