const fs: typeof import("node:fs") = require("node:fs");
const os: typeof import("node:os") = require("node:os");
const path: typeof import("node:path") = require("node:path");
const test: typeof import("node:test") = require("node:test");
const assert: typeof import("node:assert/strict") = require("node:assert/strict");

const {
  LIVE_SMOKE_SUMMARY_PATH,
  ensureLiveSmokeDocs,
  sanitizeSmokeText,
  writeLiveSmokeRecord,
} = require("../dist/src/maintainer/live-smoke-records.js");

test("live smoke summary starts with no recorded evidence", () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "codeksei-live-smoke-"));
  ensureLiveSmokeDocs(tempRoot);

  const summary = fs.readFileSync(path.join(tempRoot, LIVE_SMOKE_SUMMARY_PATH), "utf8");
  assert.match(summary, /尚无 recorded live smoke 证据/u);
  assert.match(summary, /不能据此宣称真实 WeChat \/ shared-session 现场稳定/u);
});

test("recorded live smoke rewrites summary and keeps archive output sanitized", () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "codeksei-live-smoke-record-"));
  const { archivePath, summaryPath } = writeLiveSmokeRecord(tempRoot, {
    checkpoints: ["reply.prepare:stream", "reply.ok:stream"],
    commit: "abc1234",
    evidenceSummary: "Observed delivered hash: 123abc",
    kind: "reply",
    mode: "stream",
    notes: "see E:\\secret\\logs\\shared.log and https://example.com/live",
    operator: "maintainer [run 123e4567-e89b-12d3-a456-426614174000]",
    recordedAt: "2026-04-13T07:10:00Z",
    result: "passed",
  });

  const archive = fs.readFileSync(archivePath, "utf8");
  const summary = fs.readFileSync(summaryPath, "utf8");

  assert.doesNotMatch(archive, /E:\\secret\\logs\\shared\.log/u);
  assert.doesNotMatch(archive, /https:\/\/example\.com\/live/u);
  assert.doesNotMatch(archive, /123e4567-e89b-12d3-a456-426614174000/u);
  assert.match(archive, /\[path\]/u);
  assert.match(archive, /\[url\]/u);
  assert.match(summary, /最新记录/u);
  assert.match(summary, /abc1234/u);
  assert.match(summary, /reply/u);
  assert.match(summary, /stream/u);
});

test("sanitizeSmokeText redacts obvious paths, urls, and uuids", () => {
  assert.equal(
    sanitizeSmokeText("path=E:\\repo\\foo url=https://example.com id=123e4567-e89b-12d3-a456-426614174000"),
    "path=[path] url=[url] id=[id]"
  );
});
