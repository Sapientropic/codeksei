const test: typeof import("node:test") = require("node:test");
const assert: typeof import("node:assert/strict") = require("node:assert/strict");

const {
  describeWeixinAdapterVariant,
  getWeixinRouteRule,
  isWeixinMediaGapError,
  listWeixinRouteRules,
  WEIXIN_MEDIA_GAP_DIAGNOSTIC,
}: typeof import("../src/adapters/channel/weixin/route-matrix") = require("../src/adapters/channel/weixin/route-matrix");

test("weixin public contract stays on a single v2 adapter and keeps legacy only as internal media fallback", () => {
  assert.equal(describeWeixinAdapterVariant("v2"), "v2");
  assert.equal(getWeixinRouteRule("sendText", "v2").stack, "v2");
  assert.equal(getWeixinRouteRule("sendTyping", "v2").stack, "v2");
  assert.equal(getWeixinRouteRule("sendFile", "v2").stack, "v2");
  assert.equal(getWeixinRouteRule("sendFile", "v2").automaticFallbackTo, "legacy");
  assert.match(getWeixinRouteRule("sendFile", "v2").reason, /legacy media API/u);
});

test("route matrix exposes exactly one official stack per operation", () => {
  const rules = listWeixinRouteRules("v2");
  assert.equal(rules.every((rule) => rule.stack === "v2"), true);
  assert.equal(rules.find((rule) => rule.operation === "sendFile")?.automaticFallbackTo, "legacy");
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
  assert.match(WEIXIN_MEDIA_GAP_DIAGNOSTIC.summary, /official v2 adapter/u);
});
