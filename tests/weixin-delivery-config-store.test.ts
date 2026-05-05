const fs: typeof import("node:fs") = require("node:fs");
const os: typeof import("node:os") = require("node:os");
const path: typeof import("node:path") = require("node:path");
const test: typeof import("node:test") = require("node:test");
const assert: typeof import("node:assert/strict") = require("node:assert/strict");

const { WeixinDeliveryConfigStore }: typeof import("../src/state/weixin-delivery-config-store") = require("../src/state/weixin-delivery-config-store");
const {
  resolveWeixinDeliveryConfig,
}: typeof import("../src/state/weixin-delivery-config") = require("../src/state/weixin-delivery-config");

function createTempDeliveryFile() {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "codeksei-weixin-delivery-config-"));
  return {
    tempRoot,
    filePath: path.join(tempRoot, "weixin-delivery-config.json"),
  };
}

test("WeixinDeliveryConfigStore persists and reloads reply delivery config", () => {
  const { filePath } = createTempDeliveryFile();
  const store = new WeixinDeliveryConfigStore({ filePath });

  store.setConfig({ replyMode: "settled", minChunkChars: 120, pageMode: "auto", pageChars: 900 });

  const reloaded = new WeixinDeliveryConfigStore({ filePath }).getConfig();
  assert.ok(reloaded);
  assert.equal(reloaded.replyMode, "settled");
  assert.equal(reloaded.minChunkChars, 120);
  assert.equal(reloaded.pageMode, "auto");
  assert.equal(reloaded.pageChars, 900);
  assert.match(reloaded.updatedAt || "", /^\d{4}-\d{2}-\d{2}T/u);
});

test("resolveWeixinDeliveryConfig prefers stored config over env and default", () => {
  const { filePath } = createTempDeliveryFile();
  new WeixinDeliveryConfigStore({ filePath }).setConfig({
    replyMode: "settled",
    minChunkChars: 160,
    pageMode: "off",
    pageChars: 1000,
  });

  const resolved = resolveWeixinDeliveryConfig({
    filePath,
    defaultReplyMode: "stream",
    env: {
      CODEKSEI_WEIXIN_REPLY_MODE: "stream",
      CODEKSEI_WEIXIN_MIN_CHUNK_CHARS: "40",
      CODEKSEI_WEIXIN_PAGE_MODE: "auto",
      CODEKSEI_WEIXIN_PAGE_CHARS: "1800",
    },
  });

  assert.equal(resolved.replyMode, "settled");
  assert.equal(resolved.replyModeSource, "stored");
  assert.equal(resolved.minChunkChars, 160);
  assert.equal(resolved.minChunkCharsSource, "stored");
  assert.equal(resolved.pageMode, "off");
  assert.equal(resolved.pageModeSource, "stored");
  assert.equal(resolved.pageChars, 1000);
  assert.equal(resolved.pageCharsSource, "stored");
});

test("resolveWeixinDeliveryConfig falls back to env and default independently", () => {
  const { filePath } = createTempDeliveryFile();

  const resolved = resolveWeixinDeliveryConfig({
    filePath,
    defaultReplyMode: "settled",
    env: {
      CODEKSEI_WEIXIN_MIN_CHUNK_CHARS: "64",
      CODEKSEI_WEIXIN_PAGE_CHARS: "1500",
    },
  });

  assert.equal(resolved.replyMode, "settled");
  assert.equal(resolved.replyModeSource, "default");
  assert.equal(resolved.minChunkChars, 64);
  assert.equal(resolved.minChunkCharsSource, "env");
  assert.equal(resolved.pageMode, "auto");
  assert.equal(resolved.pageModeSource, "default");
  assert.equal(resolved.pageChars, 1500);
  assert.equal(resolved.pageCharsSource, "env");
});

test("WeixinDeliveryConfigStore quarantines schema-invalid config", () => {
  const { filePath, tempRoot } = createTempDeliveryFile();
  fs.writeFileSync(filePath, JSON.stringify({ replyMode: "bad" }, null, 2), "utf8");

  const store = new WeixinDeliveryConfigStore({ filePath });

  assert.equal(store.getConfig(), null);
  assert.equal(fs.existsSync(filePath), false);
  assert.equal(
    fs.readdirSync(tempRoot).some((entry) => /^weixin-delivery-config\.corrupt-.*\.json$/u.test(entry)),
    true,
  );
});
