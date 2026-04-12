const test: typeof import("node:test") = require("node:test");
const assert: typeof import("node:assert/strict") = require("node:assert/strict");

const {
  getUpdates,
  sendMessage,
}: typeof import("../src/adapters/channel/weixin/api") = require("../src/adapters/channel/weixin/api");

test("legacy weixin api getUpdates returns an empty success envelope when fetch aborts", async () => {
  const originalFetch = globalThis.fetch;

  globalThis.fetch = (async () => {
    const error = new Error("request aborted");
    error.name = "AbortError";
    throw error;
  }) as typeof globalThis.fetch;

  try {
    const response = await getUpdates({
      baseUrl: "http://wx.example.test",
      token: "token-1",
      get_updates_buf: "sync-1",
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

test("legacy weixin api sendMessage accepts string success codes and preserves request payload", async () => {
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
    const response = await sendMessage({
      baseUrl: "http://wx.example.test",
      token: "token-1",
      body: {
        msg: {
          to_user_id: "user-1",
          context_token: "ctx-1",
        },
      },
    });

    assert.equal(response.ret, "0");
    assert.equal(requests.length, 1);
    assert.match(requests[0].url, /ilink\/bot\/sendmessage$/u);

    const payload = JSON.parse(requests[0].body) as {
      msg?: {
        to_user_id?: string;
        context_token?: string;
      };
    };
    assert.equal(payload.msg?.to_user_id, "user-1");
    assert.equal(payload.msg?.context_token, "ctx-1");
  } finally {
    globalThis.fetch = originalFetch;
  }
});
