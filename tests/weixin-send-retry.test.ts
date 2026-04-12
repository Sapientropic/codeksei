// @ts-nocheck
const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("crypto");

const {
  packChunksForWeixinDelivery: packV2ChunksForWeixinDelivery,
  sendV2TextChunk,
} = require("../src/adapters/channel/weixin/index");
const {
  packChunksForWeixinDelivery: packLegacyChunksForWeixinDelivery,
  sendLegacyTextChunk,
} = require("../src/adapters/channel/weixin/legacy");

test("v2 chunk retries ambiguous ret=-2 once with the same client_id", async () => {
  const seenClientIds = [];
  let attempts = 0;
  let randomCounter = 0;
  const originalRandomUUID = crypto.randomUUID;
  crypto.randomUUID = () => {
    randomCounter += 1;
    return `uuid-${randomCounter}`;
  };

  try {
    await sendV2TextChunk({
      sendTextImpl: async (payload) => {
        attempts += 1;
        seenClientIds.push(payload.clientId);
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
  const seenClientIds = [];
  let attempts = 0;
  let randomCounter = 0;
  const originalRandomUUID = crypto.randomUUID;
  crypto.randomUUID = () => {
    randomCounter += 1;
    return `legacy-${randomCounter}`;
  };

  try {
    await sendLegacyTextChunk({
      sendMessageImpl: async (payload) => {
        attempts += 1;
        seenClientIds.push(payload.body.msg.client_id);
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
  const seenClientIds = [];
  let randomCounter = 0;
  const originalRandomUUID = crypto.randomUUID;
  crypto.randomUUID = () => {
    randomCounter += 1;
    return `uuid-${randomCounter}`;
  };

  try {
    let attempts = 0;
    await sendV2TextChunk({
      sendTextImpl: async (payload) => {
        attempts += 1;
        seenClientIds.push(payload.clientId);
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
  const seenClientIds = [];
  let randomCounter = 0;
  const originalRandomUUID = crypto.randomUUID;
  crypto.randomUUID = () => {
    randomCounter += 1;
    return `legacy-${randomCounter}`;
  };

  try {
    let attempts = 0;
    await sendLegacyTextChunk({
      sendMessageImpl: async (payload) => {
        attempts += 1;
        seenClientIds.push(payload.body.msg.client_id);
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
