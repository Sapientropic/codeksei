const test: typeof import("node:test") = require("node:test");
const assert: typeof import("node:assert/strict") = require("node:assert/strict");

const {
  getUpdatesV2,
  sendTextV2,
}: typeof import("../src/adapters/channel/weixin/api-v2") = require("../src/adapters/channel/weixin/api-v2");

test("weixin api-v2 getUpdates returns an empty success envelope when fetch aborts", async () => {
  const originalFetch = globalThis.fetch;

  globalThis.fetch = (async () => {
    const error = new Error("request aborted");
    error.name = "AbortError";
    throw error;
  }) as typeof globalThis.fetch;

  try {
    const response = await getUpdatesV2({
      baseUrl: "http://wx.example.test",
      token: "token-1",
      getUpdatesBuf: "sync-1",
    });

    assert.deepEqual(response, {
      ret: 0,
      msgs: [],
      get_updates_buf: "sync-1",
    });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("weixin api-v2 sendText accepts string success codes and preserves request payload", async () => {
  const originalFetch = globalThis.fetch;
  const requests: Array<{ url: string; body: string }> = [];

  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    requests.push({
      url: String(input),
      body: String(init?.body || ""),
    });
    return {
      ok: true,
      status: 200,
      async text() {
        return JSON.stringify({ ret: "0", errcode: "0" });
      },
    } as Response;
  }) as typeof globalThis.fetch;

  try {
    const response = await sendTextV2({
      baseUrl: "http://wx.example.test",
      token: "token-1",
      toUserId: "user-1",
      text: "hello",
      contextToken: "ctx-1",
      clientId: "client-1",
      routeTag: "route-1",
      clientVersion: "1.2.3",
    });

    assert.equal(response.ret, "0");
    assert.equal(requests.length, 1);
    const firstRequest = requests[0];
    assert.ok(firstRequest);
    assert.match(firstRequest.url, /ilink\/bot\/sendmessage$/u);

    const payload = JSON.parse(firstRequest.body) as {
      msg?: {
        to_user_id?: string;
        client_id?: string;
        context_token?: string;
        item_list?: Array<{ text_item?: { text?: string } }>;
      };
    };
    assert.equal(payload.msg?.to_user_id, "user-1");
    assert.equal(payload.msg?.client_id, "client-1");
    assert.equal(payload.msg?.context_token, "ctx-1");
    assert.equal(payload.msg?.item_list?.[0]?.text_item?.text, "hello");
  } finally {
    globalThis.fetch = originalFetch;
  }
});
