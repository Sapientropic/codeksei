const test: typeof import("node:test") = require("node:test");
const assert: typeof import("node:assert/strict") = require("node:assert/strict");
const crypto: typeof import("node:crypto") = require("node:crypto");

const {
  packChunksForWeixinDelivery: packV2ChunksForWeixinDelivery,
  sendV2TextChunk,
}: typeof import("../src/adapters/channel/weixin/index") = require("../src/adapters/channel/weixin/index");
const legacyModule = require("../src/adapters/channel/weixin/legacy") as {
  packChunksForWeixinDelivery: (chunks: string[], maxMessages?: number, maxChunkChars?: number) => string[];
  sendLegacyTextChunk: (args: {
    sendMessageImpl?: (args: Record<string, unknown>) => Promise<unknown>;
    baseUrl: string;
    token: string;
    toUserId: string;
    text: string;
    contextToken: string;
    clientId?: string;
    trace?: Record<string, unknown> | null;
  }) => Promise<unknown>;
};
const {
  packChunksForWeixinDelivery: packLegacyChunksForWeixinDelivery,
  sendLegacyTextChunk,
} = legacyModule;

function readLegacyClientId(payload: Record<string, unknown>): string {
  return String((payload.body as { msg?: { client_id?: unknown } }).msg?.client_id || "");
}

test("v2 chunk retries ambiguous ret=-2 once with the same client_id", async () => {
  const seenClientIds: string[] = [];
  let attempts = 0;
  let randomCounter = 0;
  const originalRandomUUID = crypto.randomUUID;
  crypto.randomUUID = (() => {
    randomCounter += 1;
    return `uuid-${randomCounter}`;
  }) as typeof crypto.randomUUID;

  try {
    await sendV2TextChunk({
      sendTextImpl: async (payload: Record<string, unknown>) => {
        attempts += 1;
        seenClientIds.push(String(payload.clientId || ""));
        if (attempts === 1) {
          throw new Error("sendMessage ret=-2 errcode= errmsg=");
        }
        return { ok: true };
      },
      baseUrl: "http://localhost",
      token: "token",
      toUserId: "user-1",
      text: "hello",
      contextToken: "ctx-1",
    });
  } finally {
    crypto.randomUUID = originalRandomUUID;
  }

  assert.deepEqual(seenClientIds, ["cb-uuid-1", "cb-uuid-1"]);
});

test("legacy chunk retries ambiguous ret=-2 once with the same client_id", async () => {
  const seenClientIds: string[] = [];
  let attempts = 0;
  let randomCounter = 0;
  const originalRandomUUID = crypto.randomUUID;
  crypto.randomUUID = (() => {
    randomCounter += 1;
    return `legacy-${randomCounter}`;
  }) as typeof crypto.randomUUID;

  try {
    await sendLegacyTextChunk({
      sendMessageImpl: async (payload: Record<string, unknown>) => {
        attempts += 1;
        seenClientIds.push(readLegacyClientId(payload));
        if (attempts === 1) {
          throw new Error("sendMessage ret=-2 errcode= errmsg=");
        }
        return { ok: true };
      },
      baseUrl: "http://localhost",
      token: "token",
      toUserId: "user-1",
      text: "hello",
      contextToken: "ctx-1",
    });
  } finally {
    crypto.randomUUID = originalRandomUUID;
  }

  assert.deepEqual(seenClientIds, ["legacy-1", "legacy-1"]);
});

test("v2 chunk retry keeps the same client_id across network retries", async () => {
  const seenClientIds: string[] = [];
  let randomCounter = 0;
  const originalRandomUUID = crypto.randomUUID;
  crypto.randomUUID = (() => {
    randomCounter += 1;
    return `uuid-${randomCounter}`;
  }) as typeof crypto.randomUUID;

  try {
    let attempts = 0;
    await sendV2TextChunk({
      sendTextImpl: async (payload: Record<string, unknown>) => {
        attempts += 1;
        seenClientIds.push(String(payload.clientId || ""));
        if (attempts < 3) {
          throw new Error("fetch failed");
        }
        return { ok: true };
      },
      baseUrl: "http://localhost",
      token: "token",
      toUserId: "user-1",
      text: "hello",
      contextToken: "ctx-1",
    });
  } finally {
    crypto.randomUUID = originalRandomUUID;
  }

  assert.deepEqual(seenClientIds, ["cb-uuid-1", "cb-uuid-1", "cb-uuid-1"]);
});

test("legacy chunk retry keeps the same client_id across network retries", async () => {
  const seenClientIds: string[] = [];
  let randomCounter = 0;
  const originalRandomUUID = crypto.randomUUID;
  crypto.randomUUID = (() => {
    randomCounter += 1;
    return `legacy-${randomCounter}`;
  }) as typeof crypto.randomUUID;

  try {
    let attempts = 0;
    await sendLegacyTextChunk({
      sendMessageImpl: async (payload: Record<string, unknown>) => {
        attempts += 1;
        seenClientIds.push(readLegacyClientId(payload));
        if (attempts < 3) {
          throw new Error("fetch failed");
        }
        return { ok: true };
      },
      baseUrl: "http://localhost",
      token: "token",
      toUserId: "user-1",
      text: "hello",
      contextToken: "ctx-1",
    });
  } finally {
    crypto.randomUUID = originalRandomUUID;
  }

  assert.deepEqual(seenClientIds, ["legacy-1", "legacy-1", "legacy-1"]);
});

test("v2 delivery packing preserves semantic chunk boundaries and paragraphs", () => {
  const chunks = [
    "第一段。",
    "第二段。\n\n还有一个空行。",
    "第三段。",
  ];
  const packed = packV2ChunksForWeixinDelivery(chunks, 10, 200);

  assert.deepEqual(packed, chunks);
  assert.ok(packed[1].includes("\n\n"));
});

test("legacy delivery packing preserves semantic chunk boundaries and paragraphs", () => {
  const chunks = [
    "第一段。",
    "第二段。\n\n还有一个空行。",
    "第三段。",
  ];
  const packed = packLegacyChunksForWeixinDelivery(chunks, 10, 200);

  assert.deepEqual(packed, chunks);
  assert.ok(packed[1].includes("\n\n"));
});
