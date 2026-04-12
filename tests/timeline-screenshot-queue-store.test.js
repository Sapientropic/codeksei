const fs = require("fs");
const os = require("os");
const path = require("path");
const test = require("node:test");
const assert = require("node:assert/strict");

const { TimelineScreenshotQueueStore } = require("../src/state/timeline-screenshot-queue-store");

function createStore() {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "codeksei-timeline-screenshot-queue-"));
  return {
    filePath: path.join(tempRoot, "timeline-screenshot-queue.json"),
    store: new TimelineScreenshotQueueStore({
      filePath: path.join(tempRoot, "timeline-screenshot-queue.json"),
    }),
  };
}

test("TimelineScreenshotQueueStore accepts schema-repaired legacy jobs on load without quarantine", () => {
  const { filePath } = createStore();
  fs.writeFileSync(filePath, JSON.stringify({
    retained: true,
    jobs: [
      {
        id: "shot-1",
        accountId: "acct-1",
        senderId: "user-1",
        outputFile: "C:/tmp/shot.png",
        args: ["--selector", "timeline", ""],
        createdAt: "2026-04-12T00:00:00.000Z",
      },
    ],
  }, null, 2), "utf8");

  const reloaded = new TimelineScreenshotQueueStore({ filePath });

  assert.equal(reloaded.hasPendingForAccount("acct-1"), true);
  assert.equal(fs.existsSync(filePath), true);
  assert.deepEqual(reloaded.drainForAccount("acct-1"), [{
    id: "shot-1",
    accountId: "acct-1",
    senderId: "user-1",
    outputFile: "C:/tmp/shot.png",
    args: ["--selector", "timeline"],
    createdAt: "2026-04-12T00:00:00.000Z",
  }]);
});

test("TimelineScreenshotQueueStore quarantines schema-invalid managed state on load", () => {
  const { filePath } = createStore();
  fs.writeFileSync(filePath, JSON.stringify({
    jobs: [
      {
        id: "bad",
        accountId: "acct-1",
        senderId: [],
        outputFile: "C:/tmp/shot.png",
      },
    ],
  }, null, 2), "utf8");

  const reloaded = new TimelineScreenshotQueueStore({ filePath });

  assert.equal(reloaded.hasPendingForAccount("acct-1"), false);
  assert.equal(fs.existsSync(filePath), false);
  assert.equal(
    fs.readdirSync(path.dirname(filePath)).some((entry) => /^timeline-screenshot-queue\.corrupt-.*\.json$/.test(entry)),
    true
  );
});
