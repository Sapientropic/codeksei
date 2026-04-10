const test = require("node:test");
const assert = require("node:assert/strict");

const {
  buildJsonHeaders,
  getStableWechatUin,
} = require("../src/adapters/channel/weixin/protocol");

test("weixin protocol headers reuse one stable X-WECHAT-UIN per process", () => {
  const first = buildJsonHeaders({ body: "{}", token: "token-1" });
  const second = buildJsonHeaders({ body: "{\"ok\":true}", token: "token-2" });

  assert.equal(first["X-WECHAT-UIN"], second["X-WECHAT-UIN"]);
  assert.equal(first["X-WECHAT-UIN"], getStableWechatUin());
});
