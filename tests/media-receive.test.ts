const test: typeof import("node:test") = require("node:test");
const assert: typeof import("node:assert/strict") = require("node:assert/strict");
const crypto: typeof import("node:crypto") = require("node:crypto");
const fs: typeof import("node:fs") = require("node:fs");
const os: typeof import("node:os") = require("node:os");
const path: typeof import("node:path") = require("node:path");

const {
  persistIncomingWeixinAttachments,
} = require("../src/adapters/channel/weixin/media-receive");

function createTempStateDir(prefix: string): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function createResponse(body: Buffer, {
  contentType = "application/octet-stream",
  contentLength,
  ok = true,
  status = 200,
}: {
  contentType?: string;
  contentLength?: string;
  ok?: boolean;
  status?: number;
} = {}): Response {
  return {
    ok,
    status,
    headers: {
      get(name: string) {
        const normalizedName = String(name || "").toLowerCase();
        if (normalizedName === "content-type") {
          return contentType;
        }
        if (normalizedName === "content-length") {
          return contentLength ?? null;
        }
        return null;
      },
    },
    async arrayBuffer() {
      return body.buffer.slice(body.byteOffset, body.byteOffset + body.byteLength);
    },
  } as Response;
}

function encryptAesEcb(plaintext: Buffer, key: Buffer): Buffer {
  const cipher = crypto.createCipheriv("aes-128-ecb", key, null);
  cipher.setAutoPadding(true);
  return Buffer.concat([cipher.update(plaintext), cipher.final()]);
}

test("persistIncomingWeixinAttachments falls back from direct urls to CDN download candidates", async () => {
  const stateDir = createTempStateDir("codeksei-media-receive-fallback-");
  const calls: string[] = [];
  const originalFetch = global.fetch;
  global.fetch = (async (input: RequestInfo | URL) => {
    const url = String(input);
    calls.push(url);
    if (url.includes("bad.example.com")) {
      return createResponse(Buffer.from("bad"), { ok: false, status: 500 });
    }
    return createResponse(Buffer.from("downloaded from cdn"), { contentType: "text/plain" });
  }) as typeof fetch;

  try {
    const result = await persistIncomingWeixinAttachments({
      attachments: [{
        kind: "file",
        fileName: "notes",
        directUrls: ["https://bad.example.com/file.bin"],
        mediaRef: {
          encryptQueryParam: "cipher-token",
          fileKey: "file-1",
        },
      }],
      stateDir,
      cdnBaseUrl: "https://cdn.example.com/c2c",
      messageId: "msg-1",
      receivedAt: "2026-04-14T10:00:00+08:00",
      workspaceRoot: "E:/repo/current",
    });

    assert.equal(result.failed.length, 0);
    assert.equal(result.saved.length, 1);
    assert.deepEqual(calls, [
      "https://bad.example.com/file.bin",
      "https://cdn.example.com/c2c/download?encrypted_query_param=cipher-token",
    ]);
    assert.match(result.saved[0].fileName, /^notes\.txt$/u);
    assert.match(result.saved[0].relativePath, /^inbox\/2026-04-14\//u);
    assert.equal(fs.readFileSync(result.saved[0].absolutePath, "utf8"), "downloaded from cdn");
  } finally {
    global.fetch = originalFetch;
  }
});

test("persistIncomingWeixinAttachments rejects non HTTP direct urls without calling fetch", async () => {
  const stateDir = createTempStateDir("codeksei-media-receive-url-");
  const calls: string[] = [];
  const originalFetch = global.fetch;
  global.fetch = (async (input: RequestInfo | URL) => {
    calls.push(String(input));
    return createResponse(Buffer.from("should not download"));
  }) as typeof fetch;

  try {
    const result = await persistIncomingWeixinAttachments({
      attachments: [{
        kind: "file",
        fileName: "local-secret.txt",
        directUrls: ["file:///C:/Users/example/secret.txt"],
      }],
      stateDir,
      cdnBaseUrl: "",
      messageId: "msg-url",
      receivedAt: "2026-04-14T10:30:00+08:00",
      workspaceRoot: "E:/repo/current",
    });

    assert.equal(result.saved.length, 0);
    assert.equal(result.failed.length, 1);
    assert.deepEqual(calls, []);
    assert.match(result.failed[0].reason, /unsupported download URL protocol: file:/u);
  } finally {
    global.fetch = originalFetch;
  }
});

test("persistIncomingWeixinAttachments rejects oversized responses before reading the body", async () => {
  const stateDir = createTempStateDir("codeksei-media-receive-size-");
  let bodyWasRead = false;
  const originalFetch = global.fetch;
  global.fetch = (async () => ({
    ok: true,
    status: 200,
    headers: {
      get(name: string) {
        if (String(name || "").toLowerCase() === "content-length") {
          return String(26 * 1024 * 1024);
        }
        return null;
      },
    },
    async arrayBuffer() {
      bodyWasRead = true;
      return Buffer.from("too large").buffer;
    },
  } as Response)) as typeof fetch;

  try {
    const result = await persistIncomingWeixinAttachments({
      attachments: [{
        kind: "file",
        fileName: "huge.bin",
        directUrls: ["https://cdn.example.com/huge.bin"],
      }],
      stateDir,
      cdnBaseUrl: "https://cdn.example.com",
      messageId: "msg-size",
      receivedAt: "2026-04-14T10:45:00+08:00",
      workspaceRoot: "E:/repo/current",
    });

    assert.equal(result.saved.length, 0);
    assert.equal(result.failed.length, 1);
    assert.equal(bodyWasRead, false);
    assert.match(result.failed[0].reason, /attachment download exceeds 25 MB limit/u);
  } finally {
    global.fetch = originalFetch;
  }
});

test("persistIncomingWeixinAttachments cancels chunked responses that exceed the download limit", async () => {
  const stateDir = createTempStateDir("codeksei-media-receive-stream-size-");
  let streamWasCanceled = false;
  const originalFetch = global.fetch;
  global.fetch = (async () => ({
    ok: true,
    status: 200,
    headers: {
      get() {
        return null;
      },
    },
    body: new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array(26 * 1024 * 1024));
      },
      cancel() {
        streamWasCanceled = true;
      },
    }),
  } as unknown as Response)) as typeof fetch;

  try {
    const result = await persistIncomingWeixinAttachments({
      attachments: [{
        kind: "file",
        fileName: "chunked.bin",
        directUrls: ["https://cdn.example.com/chunked.bin"],
      }],
      stateDir,
      cdnBaseUrl: "https://cdn.example.com",
      messageId: "msg-stream-size",
      receivedAt: "2026-04-14T10:47:00+08:00",
      workspaceRoot: "E:/repo/current",
    });

    assert.equal(result.saved.length, 0);
    assert.equal(result.failed.length, 1);
    assert.equal(streamWasCanceled, true);
    assert.match(result.failed[0].reason, /attachment download exceeds 25 MB limit/u);
  } finally {
    global.fetch = originalFetch;
  }
});

test("persistIncomingWeixinAttachments downloads from a valid CDN reference without direct urls", async () => {
  const stateDir = createTempStateDir("codeksei-media-receive-cdn-");
  const calls: string[] = [];
  const originalFetch = global.fetch;
  global.fetch = (async (input: RequestInfo | URL) => {
    calls.push(String(input));
    return createResponse(Buffer.from("cdn only"), { contentType: "text/plain" });
  }) as typeof fetch;

  try {
    const result = await persistIncomingWeixinAttachments({
      attachments: [{
        kind: "file",
        fileName: "cdn-note",
        mediaRef: {
          encryptQueryParam: "cdn-token",
        },
      }],
      stateDir,
      cdnBaseUrl: "https://cdn.example.com/c2c/",
      messageId: "msg-cdn",
      receivedAt: "2026-04-14T10:50:00+08:00",
      workspaceRoot: "E:/repo/current",
    });

    assert.equal(result.failed.length, 0);
    assert.equal(result.saved.length, 1);
    assert.deepEqual(calls, [
      "https://cdn.example.com/c2c/download?encrypted_query_param=cdn-token",
    ]);
    assert.equal(fs.readFileSync(result.saved[0].absolutePath, "utf8"), "cdn only");
  } finally {
    global.fetch = originalFetch;
  }
});

test("persistIncomingWeixinAttachments decrypts AES payloads from base64 key variants", async () => {
  const stateDir = createTempStateDir("codeksei-media-receive-aes-");
  const plaintext = Buffer.from("hello attachment");
  const key = Buffer.from("0123456789abcdef", "utf8");
  const ciphertext = encryptAesEcb(plaintext, key);
  const originalFetch = global.fetch;
  global.fetch = (async () => createResponse(ciphertext, { contentType: "text/plain" })) as typeof fetch;

  try {
    const result = await persistIncomingWeixinAttachments({
      attachments: [{
        kind: "file",
        fileName: "hello",
        directUrls: ["https://cdn.example.com/file.enc"],
        mediaRef: {
          encryptType: 1,
          aesKey: key.toString("base64"),
        },
      }],
      stateDir,
      cdnBaseUrl: "https://cdn.example.com",
      messageId: "msg-2",
      receivedAt: "2026-04-14T11:00:00+08:00",
      workspaceRoot: "E:/repo/current",
    });

    assert.equal(result.failed.length, 0);
    assert.equal(result.saved.length, 1);
    assert.equal(fs.readFileSync(result.saved[0].absolutePath, "utf8"), "hello attachment");
    assert.equal(result.saved[0].fileName, "hello.txt");
  } finally {
    global.fetch = originalFetch;
  }
});

test("persistIncomingWeixinAttachments keeps plain media when decrypt fails but the payload signature is already recognizable", async () => {
  const stateDir = createTempStateDir("codeksei-media-receive-plain-");
  const pngBytes = Buffer.from([
    0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A,
    0x00, 0x00, 0x00, 0x0D, 0x49, 0x48, 0x44, 0x52,
    0x00, 0x00, 0x00,
  ]);
  const originalFetch = global.fetch;
  global.fetch = (async () => createResponse(pngBytes, { contentType: "application/octet-stream" })) as typeof fetch;

  try {
    const result = await persistIncomingWeixinAttachments({
      attachments: [{
        kind: "image",
        fileName: "proof",
        directUrls: ["https://cdn.example.com/proof.bin"],
        mediaRef: {
          encryptType: 1,
          aesKey: "plainfallbackkey",
        },
      }],
      stateDir,
      cdnBaseUrl: "https://cdn.example.com",
      messageId: "msg-3",
      receivedAt: "2026-04-14T12:00:00+08:00",
      workspaceRoot: "E:/repo/current",
    });

    assert.equal(result.failed.length, 0);
    assert.equal(result.saved.length, 1);
    assert.equal(result.saved[0].fileName, "proof.png");
    assert.deepEqual(fs.readFileSync(result.saved[0].absolutePath), pngBytes);
  } finally {
    global.fetch = originalFetch;
  }
});

test("persistIncomingWeixinAttachments allocates unique file names and normalizes failure reasons", async () => {
  const stateDir = createTempStateDir("codeksei-media-receive-names-");
  const originalFetch = global.fetch;
  global.fetch = (async () => createResponse(Buffer.from("report"), { contentType: "text/plain" })) as typeof fetch;

  try {
    const result = await persistIncomingWeixinAttachments({
      attachments: [
        {
          kind: "file",
          fileName: "report.txt",
          directUrls: ["https://cdn.example.com/report-1.txt"],
        },
        {
          kind: "file",
          fileName: "report.txt",
          directUrls: ["https://cdn.example.com/report-2.txt"],
        },
        {
          kind: "image",
          fileName: "missing.png",
        },
      ],
      stateDir,
      cdnBaseUrl: "https://cdn.example.com",
      messageId: "msg-4",
      receivedAt: "2026-04-14T13:00:00+08:00",
      workspaceRoot: "E:/repo/current",
    });

    assert.deepEqual(result.saved.map((entry: { fileName: string }) => entry.fileName), [
      "report.txt",
      "report-2.txt",
    ]);
    assert.equal(result.failed.length, 1);
    assert.equal(result.failed[0].kind, "image");
    assert.equal(result.failed[0].sourceFileName, "missing.png");
    assert.match(result.failed[0].reason, /supported download reference/u);
  } finally {
    global.fetch = originalFetch;
  }
});
