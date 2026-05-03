const fs: typeof import("node:fs") = require("node:fs");
const os: typeof import("node:os") = require("node:os");
const path: typeof import("node:path") = require("node:path");
const test: typeof import("node:test") = require("node:test");
const assert: typeof import("node:assert/strict") = require("node:assert/strict");

const {
  createWhereaboutsHttpServer,
  listenWhereaboutsHttpServer,
} = require("../src/whereabouts/http-server.ts");
const {
  readWhereaboutsSummary,
} = require("../src/whereabouts/query.ts");

function createWhereaboutsHttpFixture(prefix: string) {
  const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  const whereaboutsDir = path.join(stateDir, "whereabouts");
  const placesFile = path.join(whereaboutsDir, "places.json");
  fs.mkdirSync(whereaboutsDir, { recursive: true });
  fs.writeFileSync(placesFile, JSON.stringify({
    version: 1,
    places: [
      {
        id: "home",
        kind: "home",
        label: "家",
        latitude: 31.2304,
        longitude: 121.4737,
        radiusMeters: 250,
      },
    ],
  }, null, 2), "utf8");
  return {
    config: {
      stateDir,
      timezone: "Asia/Shanghai",
      whereaboutsHost: "127.0.0.1",
      whereaboutsPort: 4318,
      whereaboutsRetentionDays: 30,
      whereaboutsPlacesFile: placesFile,
      whereaboutsToken: "secret-token",
    },
  };
}

test("whereabouts http server exposes healthz and rejects missing bearer token", async () => {
  const fixture = createWhereaboutsHttpFixture("codeksei-whereabouts-http-auth-");
  const server = createWhereaboutsHttpServer(fixture.config);
  const started = await listenWhereaboutsHttpServer(server, { host: "127.0.0.1", port: 0 });

  try {
    const health = await fetch(`${started.baseUrl}/healthz`);
    const unauthorized = await fetch(`${started.baseUrl}/whereabouts/ingest`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({}),
    });

    assert.equal(health.status, 200);
    assert.equal((await health.json()).ok, true);
    assert.equal(unauthorized.status, 401);
    assert.match(String((await unauthorized.json()).error || ""), /bearer token/u);
  } finally {
    await started.close();
  }
});

test("whereabouts http server validates payloads before ingest", async () => {
  const fixture = createWhereaboutsHttpFixture("codeksei-whereabouts-http-validate-");
  const server = createWhereaboutsHttpServer(fixture.config);
  const started = await listenWhereaboutsHttpServer(server, { host: "127.0.0.1", port: 0 });

  try {
    const response = await fetch(`${started.baseUrl}/whereabouts/ingest`, {
      method: "POST",
      headers: {
        authorization: "Bearer secret-token",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        occurredAt: "bad-timestamp",
        device: {},
        location: {},
      }),
    });

    assert.equal(response.status, 400);
    assert.match(String((await response.json()).error || ""), /occurredAt|device|location/u);
  } finally {
    await started.close();
  }
});

test("whereabouts http server ingests local payloads and updates summary", async () => {
  const fixture = createWhereaboutsHttpFixture("codeksei-whereabouts-http-ingest-");
  const server = createWhereaboutsHttpServer(fixture.config);
  const started = await listenWhereaboutsHttpServer(server, { host: "127.0.0.1", port: 0 });

  try {
    const response = await fetch(`${started.baseUrl}/whereabouts/ingest`, {
      method: "POST",
      headers: {
        authorization: "Bearer secret-token",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        occurredAt: "2026-05-03T08:00:00.000Z",
        device: {
          deviceId: "iphone-main",
          platform: "ios",
        },
        location: {
          latitude: 31.23041,
          longitude: 121.47369,
          accuracyMeters: 15,
        },
        battery: {
          level: 0.19,
          charging: false,
          state: "unplugged",
        },
        motion: {
          state: "stationary",
        },
        context: {
          trigger: "shortcut",
          source: "ios-shortcuts",
        },
        extras: {
          focusMode: "deep-work",
        },
      }),
    });
    const data = await response.json();
    const summary = readWhereaboutsSummary(fixture.config, {
      now: "2026-05-03T08:05:00.000Z",
    });

    assert.equal(response.status, 202);
    assert.equal(data.ok, true);
    assert.equal(data.snapshot.currentPlace.kind, "home");
    assert.equal(summary.locationSummary, "在家");
    assert.match(summary.batterySummary, /低电/u);
  } finally {
    await started.close();
  }
});

test("whereabouts http server rejects non-json payloads before ingest", async () => {
  const fixture = createWhereaboutsHttpFixture("codeksei-whereabouts-http-content-type-");
  const server = createWhereaboutsHttpServer(fixture.config);
  const started = await listenWhereaboutsHttpServer(server, { host: "127.0.0.1", port: 0 });

  try {
    const response = await fetch(`${started.baseUrl}/whereabouts/ingest`, {
      method: "POST",
      headers: {
        authorization: "Bearer secret-token",
        "content-type": "text/plain",
      },
      body: "not-json",
    });

    assert.equal(response.status, 415);
    assert.match(String((await response.json()).error || ""), /application\/json/u);
  } finally {
    await started.close();
  }
});

test("whereabouts http server rejects oversized payloads before parsing", async () => {
  const fixture = createWhereaboutsHttpFixture("codeksei-whereabouts-http-too-large-");
  const server = createWhereaboutsHttpServer(fixture.config);
  const started = await listenWhereaboutsHttpServer(server, { host: "127.0.0.1", port: 0 });

  try {
    const response = await fetch(`${started.baseUrl}/whereabouts/ingest`, {
      method: "POST",
      headers: {
        authorization: "Bearer secret-token",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        occurredAt: "2026-05-03T08:00:00.000Z",
        device: {
          deviceId: "iphone-main",
          platform: "ios",
        },
        location: {
          latitude: 31.23041,
          longitude: 121.47369,
          accuracyMeters: 15,
        },
        context: {
          note: "x".repeat(70_000),
          trigger: "shortcut",
        },
      }),
    });

    assert.equal(response.status, 413);
    assert.match(String((await response.json()).error || ""), /too large|过大/u);
  } finally {
    await started.close();
  }
});
