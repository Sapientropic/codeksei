const test: typeof import("node:test") = require("node:test");
const assert: typeof import("node:assert/strict") = require("node:assert/strict");

const {
  evaluateProdAuditGate,
}: typeof import("../src/release/run-prod-audit-gate") = require("../src/release/run-prod-audit-gate");

type AuditReport = Parameters<typeof evaluateProdAuditGate>[0];

test("prod audit gate passes only when npm audit reports zero production vulnerabilities", () => {
  const result = evaluateProdAuditGate({
    auditReportVersion: 2,
    vulnerabilities: {},
    metadata: {
      vulnerabilities: {
        info: 0,
        low: 0,
        moderate: 0,
        high: 0,
        critical: 0,
        total: 0,
      },
    },
  });

  assert.deepEqual(result.blockingFindings, []);
  assert.deepEqual(result.ignoredFindings, []);
});

test("prod audit gate fails closed for any production vulnerability", () => {
  const result = evaluateProdAuditGate(buildHonoAuditReport());

  assert.equal(result.ignoredFindings.length, 0);
  assert.equal(result.blockingFindings.length > 0, true);
  assert.match(result.blockingFindings.join("\n"), /hono/u);
  assert.match(result.blockingFindings.join("\n"), /GHSA-qp7p-654g-cw7p/u);
});

test("prod audit gate treats vulnerability metadata totals without entries as blocking", () => {
  const result = evaluateProdAuditGate({
    auditReportVersion: 2,
    vulnerabilities: {},
    metadata: {
      vulnerabilities: {
        info: 0,
        low: 0,
        moderate: 1,
        high: 0,
        critical: 0,
        total: 1,
      },
    },
  });

  assert.equal(result.blockingFindings.length > 0, true);
  assert.match(result.blockingFindings.join("\n"), /metadata reports 1 production vulnerabilities/u);
});

test("prod audit gate fails closed when vulnerable audit output uses an unexpected report version", () => {
  const report = buildHonoAuditReport();
  report.auditReportVersion = 3;

  const result = evaluateProdAuditGate(report);

  assert.equal(result.blockingFindings.length > 0, true);
  assert.match(result.blockingFindings.join("\n"), /unexpected npm audit report version 3/u);
});

function buildHonoAuditReport(): AuditReport {
  return {
    auditReportVersion: 2,
    vulnerabilities: {
      hono: {
        name: "hono",
        severity: "moderate",
        isDirect: false,
        via: [
          {
            source: 123,
            name: "hono",
            dependency: "hono",
            title: "CSS Declaration Injection via Style Object Values in JSX SSR",
            url: "https://github.com/advisories/GHSA-qp7p-654g-cw7p",
            severity: "moderate",
            range: "<4.12.18",
          },
        ],
        effects: [],
        range: "<4.12.18",
        nodes: ["node_modules/hono"],
        fixAvailable: true,
      },
    },
    metadata: {
      vulnerabilities: {
        info: 0,
        low: 0,
        moderate: 1,
        high: 0,
        critical: 0,
        total: 1,
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
