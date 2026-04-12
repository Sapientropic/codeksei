const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");

const { sendWeixinMediaFile } = require("../src/adapters/channel/weixin/media-send");

test("image upload falls back to generic file delivery when image upload_param is missing", async () => {
  const tempFile = path.join(os.tmpdir(), `codeksei-media-fallback-${Date.now()}.png`);
  await fs.writeFile(tempFile, Buffer.from("fake-png"));

  const uploadMediaTypes = [];
  const sentItems = [];
  const originalFetch = global.fetch;
  global.fetch = async () => ({
    status: 200,
    headers: {
      get(name) {
        return String(name || "").toLowerCase() === "x-encrypted-param" ? "download-param" : null;
      },
    },
    async text() {
      return "";
    },
  });

  try {
    const result = await sendWeixinMediaFile({
      filePath: tempFile,
      to: "user-1",
      contextToken: "ctx-1",
      baseUrl: "http://localhost",
      token: "token",
      cdnBaseUrl: "http://cdn.example.com",
      apiVariant: "v2",
      mediaApiOverride: {
        async getUploadUrlImpl(params) {
          uploadMediaTypes.push(params.media_type);
          if (params.media_type === 1) {
            return { ret: 0 };
          }
          return { ret: 0, upload_param: "upload-ok" };
        },
        async sendMessageImpl(payload) {
          sentItems.push(payload.body.msg.item_list[0]);
          return { ok: true };
        },
      },
    });

    assert.deepEqual(uploadMediaTypes, [1, 3]);
    assert.equal(sentItems.length, 1);
    assert.equal(sentItems[0].type, 4);
    assert.equal(sentItems[0].file_item.file_name, path.basename(tempFile));
    assert.equal(result.kind, "file");
    assert.equal(result.fallbackFrom, "image");
  } finally {
    global.fetch = originalFetch;
    await fs.unlink(tempFile).catch(() => {});
  }
});

test("media upload falls back to alternate media api when primary stack still has no upload_param", async () => {
  const tempFile = path.join(os.tmpdir(), `codeksei-media-api-fallback-${Date.now()}.png`);
  await fs.writeFile(tempFile, Buffer.from("fake-png"));

  const primaryMediaTypes = [];
  const fallbackMediaTypes = [];
  const sentItems = [];
  const originalFetch = global.fetch;
  global.fetch = async () => ({
    status: 200,
    headers: {
      get(name) {
        return String(name || "").toLowerCase() === "x-encrypted-param" ? "download-param" : null;
      },
    },
    async text() {
      return "";
    },
  });

  try {
    const result = await sendWeixinMediaFile({
      filePath: tempFile,
      to: "user-2",
      contextToken: "ctx-2",
      baseUrl: "http://localhost",
      token: "token",
      cdnBaseUrl: "http://cdn.example.com",
      apiVariant: "v2",
      mediaApiOverride: {
        async getUploadUrlImpl(params) {
          primaryMediaTypes.push(params.media_type);
          return { ret: 0 };
        },
        async sendMessageImpl() {
          throw new Error("primary send should not be used");
        },
      },
      mediaApiFallbackOverride: {
        async getUploadUrlImpl(params) {
          fallbackMediaTypes.push(params.media_type);
          return { ret: 0, upload_param: "legacy-upload-ok" };
        },
        async sendMessageImpl(payload) {
          sentItems.push(payload.body.msg.item_list[0]);
          return { ok: true };
        },
      },
    });

    assert.deepEqual(primaryMediaTypes, [1, 3]);
    assert.deepEqual(fallbackMediaTypes, [3]);
    assert.equal(sentItems.length, 1);
    assert.equal(sentItems[0].type, 4);
    assert.equal(result.kind, "file");
    assert.equal(result.fallbackFrom, "image");
    assert.equal(result.uploadStrategy, "fallback");
  } finally {
    global.fetch = originalFetch;
    await fs.unlink(tempFile).catch(() => {});
  }
});
