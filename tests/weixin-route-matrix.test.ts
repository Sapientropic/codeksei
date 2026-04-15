const test: typeof import("node:test") = require("node:test");
const assert: typeof import("node:assert/strict") = require("node:assert/strict");

const {
  describeWeixinAdapterVariant,
  getWeixinRouteRule,
  isWeixinMediaGapError,
  listWeixinRouteRules,
  WEIXIN_MEDIA_GAP_DIAGNOSTIC,
}: typeof import("../src/adapters/channel/weixin/route-matrix") = require("../src/adapters/channel/weixin/route-matrix");

test("v2 adapter exposes a dual-stack public variant and keeps file delivery on legacy", () => {
  assert.equal(describeWeixinAdapterVariant("v2"), "dual:v2-text+legacy-media");
  assert.equal(getWeixinRouteRule("sendText", "v2").stack, "v2");
  assert.equal(getWeixinRouteRule("sendTyping", "v2").stack, "v2");
  assert.equal(getWeixinRouteRule("sendFile", "v2").stack, "legacy");
  assert.match(getWeixinRouteRule("sendFile", "v2").reason, /legacy media API/u);
});

test("legacy adapter route matrix stays single-stack", () => {
  const rules = listWeixinRouteRules("legacy");
  assert.equal(rules.every((rule) => rule.stack === "legacy"), true);
});

test("weixin media gap diagnostic matches current upload-param failures", () => {
  assert.equal(
    isWeixinMediaGapError(new Error("getUploadUrl returned neither upload_full_url nor upload_param")),
    true,
  );
  assert.equal(
    isWeixinMediaGapError(new Error("getUploadUrl returned no upload_param")),
    true,
  );
  assert.equal(isWeixinMediaGapError(new Error("network timeout")), false);
  assert.equal(WEIXIN_MEDIA_GAP_DIAGNOSTIC.issueUrl, "https://github.com/Sapientropic/codeksei/issues/4");
  assert.match(WEIXIN_MEDIA_GAP_DIAGNOSTIC.summary, /legacy media stack/u);
});
