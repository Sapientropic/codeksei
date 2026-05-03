const test: typeof import("node:test") = require("node:test");
const assert: typeof import("node:assert/strict") = require("node:assert/strict");

const {
  evaluateProdAuditGate,
  isVisDataUuidV4OnlyUsage,
}: typeof import("../src/release/run-prod-audit-gate") = require("../src/release/run-prod-audit-gate");

type AuditReport = Parameters<typeof evaluateProdAuditGate>[0];
type InstalledState = Parameters<typeof evaluateProdAuditGate>[1];

test("prod audit gate allows only the current vis timeline uuid exception", () => {
  const result = evaluateProdAuditGate(buildAllowedAuditReport(), buildAllowedInstalledState());

  assert.deepEqual(result.blockingFindings, []);
  assert.equal(result.ignoredFindings.length, 1);
  assert.match(result.ignoredFindings[0] || "", /GHSA-w5hq-g745-h8pq/u);
});

test("prod audit gate fails when any additional vulnerability appears", () => {
  const report = buildAllowedAuditReport();
  const vulnerabilities = report.vulnerabilities || {};
  vulnerabilities.ws = {
    name: "ws",
    severity: "high",
    isDirect: true,
    via: [
      {
        source: 123,
        name: "ws",
        title: "unexpected ws issue",
        url: "https://example.test/ws",
        severity: "high",
        range: "<9.0.0",
      },
    ],
    effects: [],
    range: "<9.0.0",
    nodes: ["node_modules/ws"],
    fixAvailable: false,
  };
  report.vulnerabilities = vulnerabilities;

  const vulnerabilityTotals = report.metadata?.vulnerabilities;
  assert.ok(vulnerabilityTotals);
  vulnerabilityTotals.high = 1;
  vulnerabilityTotals.total = 4;

  const result = evaluateProdAuditGate(report, buildAllowedInstalledState());

  assert.equal(result.blockingFindings.length > 0, true);
  assert.match(result.blockingFindings.join("\n"), /ws/u);
});

test("prod audit gate fails when the ignored chain no longer matches the reviewed package state", () => {
  const result = evaluateProdAuditGate(buildAllowedAuditReport(), {
    ...buildAllowedInstalledState(),
    visDataVersion: "8.0.4",
  });

  assert.equal(result.blockingFindings.length > 0, true);
  assert.match(result.blockingFindings.join("\n"), /vis-data version/u);
});

test("prod audit gate fails when vis-data no longer looks like v4-only uuid usage", () => {
  const result = evaluateProdAuditGate(buildAllowedAuditReport(), {
    ...buildAllowedInstalledState(),
    visDataSource: "import { v6 as uuid6 } from \"uuid\";\nitem[idProp] = uuid6();\n",
  });

  assert.equal(result.blockingFindings.length > 0, true);
  assert.match(result.blockingFindings.join("\n"), /vis-data uuid usage/u);
});

test("vis-data uuid usage check only accepts v4 import plus call sites", () => {
  assert.equal(isVisDataUuidV4OnlyUsage("import { v4 as uuid4 } from \"uuid\";\nitem[idProp] = uuid4();\n"), true);
  assert.equal(isVisDataUuidV4OnlyUsage("import { v4, v5 } from \"uuid\";\nitem[idProp] = v4();\n"), false);
  assert.equal(isVisDataUuidV4OnlyUsage("const uuid = require(\"uuid\");\nitem[idProp] = uuid.v4();\n"), false);
});

function buildAllowedAuditReport(): AuditReport {
  return {
    auditReportVersion: 2,
    vulnerabilities: {
      uuid: {
        name: "uuid",
        severity: "moderate",
        isDirect: false,
        via: [
          {
            source: 1116970,
            name: "uuid",
            dependency: "uuid",
            title: "uuid: Missing buffer bounds check in v3/v5/v6 when buf is provided",
            url: "https://github.com/advisories/GHSA-w5hq-g745-h8pq",
            severity: "moderate",
            cwe: ["CWE-787", "CWE-1285"],
            cvss: {
              score: 0,
              vectorString: null,
            },
            range: "<14.0.0",
          },
        ],
        effects: ["vis-data", "vis-timeline"],
        range: "<14.0.0",
        nodes: ["node_modules/uuid"],
        fixAvailable: {
          name: "vis-timeline",
          version: "7.2.1",
          isSemVerMajor: true,
        },
      },
      "vis-data": {
        name: "vis-data",
        severity: "moderate",
        isDirect: false,
        via: ["uuid"],
        effects: ["vis-timeline"],
        range: ">=6.5.0",
        nodes: ["node_modules/vis-data"],
        fixAvailable: {
          name: "vis-timeline",
          version: "7.2.1",
          isSemVerMajor: true,
        },
      },
      "vis-timeline": {
        name: "vis-timeline",
        severity: "moderate",
        isDirect: true,
        via: ["uuid", "vis-data"],
        effects: [],
        range: ">=7.3.0",
        nodes: ["node_modules/vis-timeline"],
        fixAvailable: {
          name: "vis-timeline",
          version: "7.2.1",
          isSemVerMajor: true,
        },
      },
    },
    metadata: {
      vulnerabilities: {
        info: 0,
        low: 0,
        moderate: 3,
        high: 0,
        critical: 0,
        total: 3,
      },
      dependencies: {
        prod: 90,
        dev: 36,
        optional: 53,
        peer: 16,
        peerOptional: 0,
        total: 167,
      },
    },
  };
}

function buildAllowedInstalledState(): InstalledState {
  return {
    uuidVersion: "13.0.0",
    visDataVersion: "8.0.3",
    visTimelineVersion: "8.5.0",
    visDataSource: "import { v4 as uuid4 } from \"uuid\";\nitem[idProp] = uuid4();\n",
  };
}
