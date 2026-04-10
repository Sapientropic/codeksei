const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("crypto");

const { sendV2TextChunk } = require("../src/adapters/channel/weixin/index");
const { sendLegacyTextChunk } = require("../src/adapters/channel/weixin/legacy");

test("v2 chunk retry keeps the same client_id across attempts", async () => {
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

  assert.deepEqual(seenClientIds, ["cb-uuid-1", "cb-uuid-1", "cb-uuid-1"]);
});

test("legacy chunk retry keeps the same client_id across attempts", async () => {
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

  assert.deepEqual(seenClientIds, ["legacy-1", "legacy-1", "legacy-1"]);
});
