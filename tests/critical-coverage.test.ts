const test: typeof import("node:test") = require("node:test");
const assert: typeof import("node:assert/strict") = require("node:assert/strict");

const {
  parseNodeCoverageReport,
  resolveExpectedCriticalCoverageFiles,
  resolveCriticalCoverageViolations,
}: typeof import("../src/release/run-critical-coverage") = require("../src/release/run-critical-coverage");

const COVERAGE_FIXTURE = [
  "ℹ start of coverage report",
  "ℹ ----------------------------------------------------------------",
  "ℹ file                            | line % | branch % | funcs % | uncovered lines",
  "ℹ ----------------------------------------------------------------",
  "ℹ src                             |        |          |         | ",
  "ℹ  runtime                        |        |          |         | ",
  "ℹ   stream-delivery               |        |          |         | ",
  "ℹ    turn-finalize.ts             |  64.84 |    70.59 |   80.00 | 37-76",
  "ℹ    delta-merge.ts               |  91.00 |    81.00 |   90.00 | ",
  "ℹ  core                           |        |          |         | ",
  "ℹ   config.ts                     | 100.00 |    80.00 |  100.00 | ",
  "ℹ ----------------------------------------------------------------",
  "ℹ all files                       |  91.24 |    78.16 |   89.74 | ",
  "ℹ ----------------------------------------------------------------",
  "ℹ end of coverage report",
].join("\n");

test("critical coverage parser reconstructs nested file paths", () => {
  const rows = parseNodeCoverageReport(COVERAGE_FIXTURE);

  assert.deepEqual(rows.map((row) => row.filePath), [
    "src/runtime/stream-delivery/turn-finalize.ts",
    "src/runtime/stream-delivery/delta-merge.ts",
    "src/core/config.ts",
  ]);
  assert.equal(rows[0]?.linePercent, 64.84);
  assert.equal(rows[0]?.branchPercent, 70.59);
  assert.equal(rows[0]?.functionPercent, 80);
});

test("critical coverage parser accepts TAP diagnostic coverage rows from CI", () => {
  const tapFixture = COVERAGE_FIXTURE.replace(/^ℹ/gmu, "#");
  const rows = parseNodeCoverageReport(tapFixture);

  assert.deepEqual(rows.map((row) => row.filePath), [
    "src/runtime/stream-delivery/turn-finalize.ts",
    "src/runtime/stream-delivery/delta-merge.ts",
    "src/core/config.ts",
  ]);
});

test("critical coverage violations name the file and metric that missed the gate", () => {
  const rows = parseNodeCoverageReport(COVERAGE_FIXTURE);
  const violations = resolveCriticalCoverageViolations(rows, {
    branchPercent: 75,
    functionPercent: 85,
    linePercent: 88,
  });

  assert.deepEqual(violations, [
    "src/runtime/stream-delivery/turn-finalize.ts line coverage 64.84 < 88",
    "src/runtime/stream-delivery/turn-finalize.ts branch coverage 70.59 < 75",
    "src/runtime/stream-delivery/turn-finalize.ts function coverage 80 < 85",
  ]);
});

test("critical coverage gate fails when an expected file is missing from the report", () => {
  const rows = parseNodeCoverageReport(COVERAGE_FIXTURE);
  const violations = resolveCriticalCoverageViolations(rows, {
    branchPercent: 0,
    functionPercent: 0,
    linePercent: 0,
  }, [
    "src/core/config.ts",
    "src/runtime/stream-delivery/missing-owner.ts",
  ]);

  assert.deepEqual(violations, [
    "src/runtime/stream-delivery/missing-owner.ts coverage row missing",
  ]);
});

test("critical coverage expected files include the stream-delivery owner leaves", () => {
  const expectedFiles = resolveExpectedCriticalCoverageFiles();

  assert.ok(expectedFiles.includes("src/runtime/stream-delivery.ts"));
  assert.ok(expectedFiles.includes("src/runtime/stream-delivery/turn-finalize.ts"));
  assert.ok(expectedFiles.includes("src/runtime/stream-delivery/delta-merge.ts"));
});
