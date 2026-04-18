const test: typeof import("node:test") = require("node:test");
const assert: typeof import("node:assert/strict") = require("node:assert/strict");

const {
  buildTimelineBrowserNotFoundMessage,
  listTimelineBrowserCandidates,
  listTimelineSystemBrowserCandidates,
  resolveTimelineBrowserExecutablePath,
} = require("../src/timeline/runtime/application/timeline/browser-paths");

test("timeline browser candidates keep configured path first and dedupe duplicates", () => {
  const candidates = listTimelineBrowserCandidates({
    configuredPath: "/custom/chrome",
    playwrightManagedPath: "/custom/chrome",
    platform: "linux",
  });

  assert.equal(candidates[0], "/custom/chrome");
  assert.equal(new Set(candidates).size, candidates.length);
});

test("timeline browser candidates cover darwin, win32, and linux system layouts", () => {
  assert.match(
    listTimelineSystemBrowserCandidates({ platform: "darwin", homeDir: "/Users/tester" }).join("\n"),
    /Google Chrome\.app/u,
  );
  assert.match(
    listTimelineSystemBrowserCandidates({
      platform: "win32",
      env: {
        LOCALAPPDATA: "C:\\Users\\tester\\AppData\\Local",
        PROGRAMFILES: "C:\\Program Files",
        "PROGRAMFILES(X86)": "C:\\Program Files (x86)",
      },
    }).join("\n"),
    /chrome\.exe/u,
  );
  assert.match(
    listTimelineSystemBrowserCandidates({ platform: "linux" }).join("\n"),
    /chromium|chrome/u,
  );
});

test("timeline browser resolver returns the first existing candidate and keeps a stable fallback error", () => {
  const resolved = resolveTimelineBrowserExecutablePath({
    configuredPath: "/configured/chrome",
    playwrightManagedPath: "/playwright/chrome",
    fileExists: (candidate: string) => candidate === "/playwright/chrome",
    platform: "linux",
  });
  assert.equal(resolved, "/playwright/chrome");
  assert.match(buildTimelineBrowserNotFoundMessage(), /CODEKSEI_SCREENSHOT_CHROME_PATH/u);
});

