const test: typeof import("node:test") = require("node:test");
const assert: typeof import("node:assert/strict") = require("node:assert/strict");
const fs: typeof import("node:fs/promises") = require("node:fs/promises");
const os: typeof import("node:os") = require("node:os");
const path: typeof import("node:path") = require("node:path");

const { sendWeixinMediaFile }: typeof import("../src/adapters/channel/weixin/media-send") = require("../src/adapters/channel/weixin/media-send");
const { ignoreCleanupError }: typeof import("../src/core/error-handling") = require("../src/core/error-handling");

test("image upload falls back to generic file delivery when image upload_param is missing", async () => {
  const tempFile = path.join(os.tmpdir(), `codeksei-media-fallback-${Date.now()}.png`);
  await fs.writeFile(tempFile, Buffer.from("fake-png"));

  const uploadMediaTypes: number[] = [];
  const sentItems: Array<Record<string, unknown>> = [];
  const originalFetch = global.fetch;
  global.fetch = (async () => ({
    status: 200,
    headers: {
      get(name: string) {
        return String(name || "").toLowerCase() === "x-encrypted-param" ? "download-param" : null;
      },
    },
    async text() {
      return "";
    },
  }) as Response) as typeof fetch;

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
        async getUploadUrlImpl(params: Record<string, unknown>) {
          uploadMediaTypes.push(Number(params.media_type));
          if (params.media_type === 1) {
            return { ret: 0 };
          }
          return { ret: 0, upload_param: "upload-ok" };
        },
        async sendMessageImpl(payload: Record<string, unknown>) {
          const item = (payload as { body?: { msg?: { item_list?: Record<string, unknown>[] } } }).body?.msg?.item_list?.[0];
          if (item) {
            sentItems.push(item);
          }
          return { ok: true };
        },
      },
    });

    assert.deepEqual(uploadMediaTypes, [1, 3]);
    assert.equal(sentItems.length, 1);
    const sentItem = sentItems[0] as { type?: number; file_item?: { file_name?: string } };
    assert.equal(sentItem.type, 4);
    assert.equal(sentItem.file_item?.file_name, path.basename(tempFile));
    assert.equal(result.kind, "file");
    assert.equal(result.fallbackFrom, "image");
  } finally {
    global.fetch = originalFetch;
    await ignoreCleanupError(fs.unlink(tempFile), {
      label: "media send full-url temp file cleanup",
      reason: "the temp file may already be removed by the test or platform cleanup",
    });
  }
});

test("media upload accepts upload_full_url from getUploadUrl responses", async () => {
  const tempFile = path.join(os.tmpdir(), `codeksei-media-full-url-${Date.now()}.png`);
  await fs.writeFile(tempFile, Buffer.from("fake-png"));

  const uploadMediaTypes: number[] = [];
  const sentItems: Array<Record<string, unknown>> = [];
  let uploadedUrl = "";
  const originalFetch = global.fetch;
  global.fetch = (async (input: RequestInfo | URL) => {
    uploadedUrl = String(input);
    return {
      status: 200,
      headers: {
        get(name: string) {
          return String(name || "").toLowerCase() === "x-encrypted-param" ? "download-param" : null;
        },
      },
      async text() {
        return "";
      },
    } as Response;
  }) as typeof fetch;

  try {
    const result = await sendWeixinMediaFile({
      filePath: tempFile,
      to: "user-3",
      contextToken: "ctx-3",
      baseUrl: "http://localhost",
      token: "token",
      cdnBaseUrl: "http://cdn.example.com",
      apiVariant: "legacy",
      mediaApiOverride: {
        async getUploadUrlImpl(params: Record<string, unknown>) {
          uploadMediaTypes.push(Number(params.media_type));
          return {
            ret: 0,
            upload_full_url: "http://cdn.example.com/upload?encrypted_query_param=upload-ok&filekey=file-1&taskid=task-1",
          };
        },
        async sendMessageImpl(payload: Record<string, unknown>) {
          const item = (payload as { body?: { msg?: { item_list?: Record<string, unknown>[] } } }).body?.msg?.item_list?.[0];
          if (item) {
            sentItems.push(item);
          }
          return { ok: true };
        },
      },
    });

    assert.deepEqual(uploadMediaTypes, [1]);
    assert.match(uploadedUrl, /taskid=task-1/u);
    assert.equal(sentItems.length, 1);
    const sentItem = sentItems[0] as { type?: number };
    assert.equal(sentItem.type, 2);
    assert.equal(result.kind, "image");
  } finally {
    global.fetch = originalFetch;
    await ignoreCleanupError(fs.unlink(tempFile), {
      label: "media send temp file cleanup",
      reason: "the temp file may already be removed by the test or platform cleanup",
    });
  }
});

test("media upload falls back to alternate media api when primary stack still has no upload_param", async () => {
  const tempFile = path.join(os.tmpdir(), `codeksei-media-api-fallback-${Date.now()}.png`);
  await fs.writeFile(tempFile, Buffer.from("fake-png"));

  const primaryMediaTypes: number[] = [];
  const fallbackMediaTypes: number[] = [];
  const sentItems: Array<Record<string, unknown>> = [];
  const originalFetch = global.fetch;
  global.fetch = (async () => ({
    status: 200,
    headers: {
      get(name: string) {
        return String(name || "").toLowerCase() === "x-encrypted-param" ? "download-param" : null;
      },
    },
    async text() {
      return "";
    },
  }) as Response) as typeof fetch;

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
        async getUploadUrlImpl(params: Record<string, unknown>) {
          primaryMediaTypes.push(Number(params.media_type));
          return { ret: 0 };
        },
        async sendMessageImpl() {
          throw new Error("primary send should not be used");
        },
      },
      mediaApiFallbackOverride: {
        async getUploadUrlImpl(params: Record<string, unknown>) {
          fallbackMediaTypes.push(Number(params.media_type));
          return { ret: 0, upload_param: "legacy-upload-ok" };
        },
        async sendMessageImpl(payload: Record<string, unknown>) {
          const item = (payload as { body?: { msg?: { item_list?: Record<string, unknown>[] } } }).body?.msg?.item_list?.[0];
          if (item) {
            sentItems.push(item);
          }
          return { ok: true };
        },
      },
    });

    assert.deepEqual(primaryMediaTypes, [1, 3]);
    assert.deepEqual(fallbackMediaTypes, [3]);
    assert.equal(sentItems.length, 1);
    const sentItem = sentItems[0] as { type?: number };
    assert.equal(sentItem.type, 4);
    assert.equal(result.kind, "file");
    assert.equal(result.fallbackFrom, "image");
    assert.equal(result.uploadStrategy, "fallback");
  } finally {
    global.fetch = originalFetch;
    await ignoreCleanupError(fs.unlink(tempFile), {
      label: "media send fallback temp file cleanup",
      reason: "the temp file may already be removed by the test or platform cleanup",
    });
  }
});
