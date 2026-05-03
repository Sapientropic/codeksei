const fs: typeof import("node:fs") = require("node:fs");
const os: typeof import("node:os") = require("node:os");
const path: typeof import("node:path") = require("node:path");
const test: typeof import("node:test") = require("node:test");
const assert: typeof import("node:assert/strict") = require("node:assert/strict");

const {
  ingestWhereaboutsEvent,
} = require("../src/whereabouts/ingest.ts");
const {
  listRecentWhereaboutsMoves,
  listRecentWhereaboutsStays,
  readWhereaboutsEvents,
  readWhereaboutsSnapshot,
  readWhereaboutsSummary,
} = require("../src/whereabouts/query.ts");

function createWhereaboutsFixture(prefix: string) {
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
      {
        id: "work",
        kind: "work",
        label: "公司",
        latitude: 31.2222,
        longitude: 121.4581,
        radiusMeters: 220,
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
      whereaboutsToken: "test-token",
    },
    stateDir,
    whereaboutsDir,
  };
}

test("whereabouts ingest keeps local-only raw events and builds named-place summary", async () => {
  const fixture = createWhereaboutsFixture("codeksei-whereabouts-core-");
  await ingestWhereaboutsEvent(fixture.config, {
    occurredAt: "2026-05-03T08:00:00.000Z",
    device: {
      deviceId: "iphone-main",
      platform: "ios",
      model: "iPhone 16",
    },
    location: {
      latitude: 31.23041,
      longitude: 121.47369,
      accuracyMeters: 18,
    },
    battery: {
      level: 0.18,
      charging: false,
      state: "unplugged",
    },
    motion: {
      state: "stationary",
    },
    context: {
      trigger: "shortcut",
      source: "ios-shortcuts",
      note: "刚到家。",
    },
    extras: {
      wifiSsid: "home-net",
    },
  });

  const events = readWhereaboutsEvents(fixture.config);
  const snapshot = readWhereaboutsSnapshot(fixture.config, {
    now: "2026-05-03T08:05:00.000Z",
  });
  const summary = readWhereaboutsSummary(fixture.config, {
    now: "2026-05-03T08:05:00.000Z",
  });
  const stays = listRecentWhereaboutsStays(fixture.config);
  const moves = listRecentWhereaboutsMoves(fixture.config);

  assert.equal(events.length, 1);
  assert.equal(events[0]?.device.deviceId, "iphone-main");
  assert.equal(snapshot.currentPlace?.kind, "home");
  assert.equal(snapshot.currentPlace?.label, "家");
  assert.equal(snapshot.battery?.isLow, true);
  assert.equal(snapshot.motion?.state, "stationary");
  assert.equal(snapshot.lastContext?.trigger, "shortcut");
  assert.equal(summary.locationSummary, "在家");
  assert.match(summary.batterySummary, /低电/u);
  assert.equal(stays.length, 1);
  assert.equal(stays[0]?.place?.kind, "home");
  assert.equal(moves.length, 0);
});

test("whereabouts ingest prunes expired events and materializes move history", async () => {
  const fixture = createWhereaboutsFixture("codeksei-whereabouts-retention-");
  const eventsFile = path.join(fixture.whereaboutsDir, "events.jsonl");
  fs.writeFileSync(eventsFile, [
    JSON.stringify({
      kind: "whereabouts_event",
      version: 1,
      occurredAt: "2026-03-01T08:00:00.000Z",
      recordedAt: "2026-03-01T08:00:00.000Z",
      device: { deviceId: "iphone-main" },
      location: { latitude: 31.2304, longitude: 121.4737, accuracyMeters: 25 },
      battery: { level: 0.5, charging: false, state: "unplugged", isLow: false },
      motion: { state: "stationary" },
      context: { trigger: "old" },
      extras: {},
      derived: {
        place: { id: "home", kind: "home", label: "家" },
        locationSummary: "在家",
      },
    }),
  ].join("\n"), "utf8");

  await ingestWhereaboutsEvent(fixture.config, {
    occurredAt: "2026-05-03T09:00:00.000Z",
    device: { deviceId: "iphone-main", platform: "ios" },
    location: { latitude: 31.2304, longitude: 121.4737, accuracyMeters: 16 },
    battery: { level: 0.72, charging: true, state: "charging" },
    motion: { state: "stationary" },
    context: { trigger: "first" },
    extras: {},
  });
  await ingestWhereaboutsEvent(fixture.config, {
    occurredAt: "2026-05-03T10:00:00.000Z",
    device: { deviceId: "iphone-main", platform: "ios" },
    location: { latitude: 31.22221, longitude: 121.45812, accuracyMeters: 14 },
    battery: { level: 0.63, charging: false, state: "unplugged" },
    motion: { state: "walking" },
    context: { trigger: "commute" },
    extras: {},
  });

  const events = readWhereaboutsEvents(fixture.config);
  const stays = listRecentWhereaboutsStays(fixture.config);
  const moves = listRecentWhereaboutsMoves(fixture.config);
  const summary = readWhereaboutsSummary(fixture.config, {
    now: "2026-05-03T10:05:00.000Z",
  });

  assert.equal(events.length, 2);
  assert.equal(events.some((entry: { context?: { trigger?: string } }) => entry.context?.trigger === "old"), false);
  assert.equal(stays.length, 2);
  assert.equal(stays[0]?.place?.kind, "home");
  assert.equal(stays[1]?.place?.kind, "work");
  assert.equal(moves.length, 1);
  assert.equal(moves[0]?.fromPlace?.kind, "home");
  assert.equal(moves[0]?.toPlace?.kind, "work");
  assert.equal(summary.locationSummary, "在公司");
  assert.match(summary.mobilitySummary, /刚移动过/u);
});

test("whereabouts summary falls back to generic labels and marks stale data", async () => {
  const fixture = createWhereaboutsFixture("codeksei-whereabouts-stale-");
  await ingestWhereaboutsEvent(fixture.config, {
    occurredAt: "2026-05-03T08:00:00.000Z",
    device: { deviceId: "iphone-main", platform: "ios" },
    location: { latitude: 31.2501, longitude: 121.5002, accuracyMeters: 30 },
    battery: { level: 0.46, charging: false, state: "unplugged" },
    motion: { state: "moving_vehicle" },
    context: { trigger: "manual" },
    extras: {},
  });

  const snapshot = readWhereaboutsSnapshot(fixture.config, {
    now: "2026-05-03T12:30:00.000Z",
  });
  const summary = readWhereaboutsSummary(fixture.config, {
    now: "2026-05-03T12:30:00.000Z",
  });

  assert.equal(snapshot.currentPlace, null);
  assert.equal(snapshot.isStale, true);
  assert.equal(summary.locationSummary, "在外");
  assert.match(summary.freshnessSummary, /过旧/u);
});
