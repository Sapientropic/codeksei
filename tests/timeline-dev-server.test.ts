const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const {
  createTimelineDevWatcher,
  isWatchLimitError,
} = require("../src/timeline/runtime/application/timeline/dev-server");

test("isWatchLimitError recognizes native watch quota errors", () => {
  assert.equal(isWatchLimitError({ code: "EMFILE" }), true);
  assert.equal(isWatchLimitError({ code: "ENOSPC" }), true);
  assert.equal(isWatchLimitError({ code: "EACCES" }), false);
});

test("timeline dev watcher falls back to polling when fs.watch hits the watch limit", async () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "codeksei-timeline-dev-watch-limit-"));
  const filePath = path.join(tempRoot, "timeline-facts.json");
  fs.writeFileSync(filePath, '{"ok":true}\n', "utf8");

  const originalWatch = fs.watch;
  const originalWarn = console.warn;
  const warnings: string[] = [];
  let changeCount = 0;

  fs.watch = (() => {
    const error = new Error("watch limit") as Error & { code?: string };
    error.code = "EMFILE";
    throw error;
  }) as typeof fs.watch;
  console.warn = (...args: unknown[]) => {
    warnings.push(args.map((value) => String(value ?? "")).join(" "));
  };

  try {
    const watcher = createTimelineDevWatcher(filePath, () => {
      changeCount += 1;
    }, { pollIntervalMs: 25 });
    assert.ok(watcher);

    await delay(40);
    fs.writeFileSync(filePath, '{"ok":false}\n', "utf8");
    await waitFor(() => changeCount > 0);

    watcher.close();
    assert.match(warnings.join("\n"), /timeline dev watch fallback \(EMFILE\)/u);
  } finally {
    fs.watch = originalWatch;
    console.warn = originalWarn;
  }
});

test("timeline dev watcher falls back to polling when recursive watch is unavailable", async () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "codeksei-timeline-dev-recursive-"));
  const nestedDir = path.join(tempRoot, "timeline");
  const filePath = path.join(nestedDir, "dashboard.css");
  fs.mkdirSync(nestedDir, { recursive: true });
  fs.writeFileSync(filePath, "body {}\n", "utf8");

  const originalWatch = fs.watch;
  const originalWarn = console.warn;
  const warnings: string[] = [];
  let changeCount = 0;

  fs.watch = (() => {
    const error = new Error("recursive watch unavailable") as Error & { code?: string };
    error.code = "ERR_FEATURE_UNAVAILABLE_ON_PLATFORM";
    throw error;
  }) as typeof fs.watch;
  console.warn = (...args: unknown[]) => {
    warnings.push(args.map((value) => String(value ?? "")).join(" "));
  };

  try {
    const watcher = createTimelineDevWatcher(nestedDir, () => {
      changeCount += 1;
    }, { pollIntervalMs: 25 });
    assert.ok(watcher);

    await delay(40);
    fs.writeFileSync(filePath, "body { color: red; }\n", "utf8");
    await waitFor(() => changeCount > 0);

    watcher.close();
    assert.match(warnings.join("\n"), /timeline dev watch fallback \(ERR_FEATURE_UNAVAILABLE_ON_PLATFORM\)/u);
  } finally {
    fs.watch = originalWatch;
    console.warn = originalWarn;
  }
});

async function waitFor(
  predicate: () => boolean,
  {
    timeoutMs = 400,
    intervalMs = 25,
  }: { timeoutMs?: number; intervalMs?: number } = {},
): Promise<void> {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    if (predicate()) {
      return;
    }
    await delay(intervalMs);
  }
  assert.fail(`condition not met within ${timeoutMs}ms`);
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
