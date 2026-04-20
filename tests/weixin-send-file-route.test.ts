const test: typeof import("node:test") = require("node:test");
const assert: typeof import("node:assert/strict") = require("node:assert/strict");
const fs: typeof import("node:fs") = require("node:fs");
const os: typeof import("node:os") = require("node:os");
const path: typeof import("node:path") = require("node:path");

const runtimePaths = require("./helpers/runtime-paths.ts") as {
  repoRoot: string;
  resolveRepoRuntimeModule: (relativePath: string) => string;
  resolveRepoRuntimePath: (relativePath: string) => string;
};
const {
  repoRoot,
  resolveRepoRuntimeModule,
  resolveRepoRuntimePath,
} = runtimePaths;
import type { SendWeixinMediaFileArgs } from "../src/adapters/channel/weixin/media-types";
import type { SendTextV2Args } from "../src/adapters/channel/weixin/api-v2";
const { WeixinDeliveryConfigStore }: typeof import("../src/state/weixin-delivery-config-store") = require("../src/state/weixin-delivery-config-store");
const adapterModulePath = resolveRepoRuntimePath("src/adapters/channel/weixin/index.ts");
const deliveryModulePath = resolveRepoRuntimePath("src/adapters/channel/weixin/delivery.ts");

function resolveRepoModule(relativePath: string): string {
  return resolveRepoRuntimeModule(relativePath);
}

function stubModule(
  relativePath: string,
  moduleExports: unknown,
  originals: Map<string, NodeJS.Module | undefined>,
): void {
  const resolved = resolveRepoModule(relativePath);
  originals.set(resolved, require.cache[resolved]);
  require.cache[resolved] = {
    id: resolved,
    filename: resolved,
    loaded: true,
    exports: moduleExports,
  } as NodeJS.Module;
}

function restoreModules(originals: Map<string, NodeJS.Module | undefined>): void {
  for (const [resolved, original] of originals.entries()) {
    if (original) {
      require.cache[resolved] = original;
    } else {
      delete require.cache[resolved];
    }
  }
}

test("official weixin adapter keeps v2 as the primary file-delivery stack", async () => {
  const originals = new Map<string, NodeJS.Module | undefined>();
  let capturedArgs: SendWeixinMediaFileArgs | null = null;

  try {
    stubModule("src/adapters/channel/weixin/account-store.ts", {
      listWeixinAccounts() {
        return [];
      },
      resolveSelectedAccount() {
        return {
          accountId: "acct-1",
          baseUrl: "http://wx.example.test",
          token: "token-1",
          routeTag: "route-1",
        };
      },
    }, originals);
    stubModule("src/adapters/channel/weixin/context-token-store.ts", {
      loadPersistedContextTokens() {
        return {};
      },
      persistContextToken(_config: unknown, _accountId: unknown, userId: string, contextToken: string) {
        return { [userId]: contextToken };
      },
    }, originals);
    stubModule("src/adapters/channel/weixin/login-v2.ts", {
      async runV2LoginFlow() {},
    }, originals);
    stubModule("src/adapters/channel/weixin/api-v2.ts", {
      async getConfigV2() {
        return null;
      },
      async getUpdatesV2() {
        return { msgs: [], get_updates_buf: "" };
      },
      async sendTextV2() {},
      async sendTypingV2() {},
    }, originals);
    stubModule("src/adapters/channel/weixin/message-utils-v2.ts", {
      createInboundFilter() {
        return {
          normalize(message: unknown) {
            return message;
          },
        };
      },
    }, originals);
    stubModule("src/adapters/channel/weixin/media-send.ts", {
      async sendWeixinMediaFile(args: SendWeixinMediaFileArgs) {
        capturedArgs = args;
        return { kind: "file", fileName: "timeline.png" };
      },
    }, originals);
    stubModule("src/adapters/channel/weixin/sync-buffer-store.ts", {
      loadSyncBuffer() {
        return "";
      },
      saveSyncBuffer() {},
    }, originals);

    originals.set(adapterModulePath, require.cache[adapterModulePath]);
    delete require.cache[adapterModulePath];
    const { createWeixinChannelAdapter }: typeof import("../src/adapters/channel/weixin/index") = require(adapterModulePath);

    const adapter = createWeixinChannelAdapter({
      stateDir: path.join(repoRoot, ".tmp-weixin-route"),
      weixinCdnBaseUrl: "http://cdn.example.test",
      weixinProtocolClientVersion: "9.9.9",
    });

    const result = await adapter.sendFile({
      userId: "user-1",
      filePath: "C:\\temp\\timeline.png",
      contextToken: "ctx-1",
    });

    assert.equal(result.kind, "file");
    assert.deepEqual(capturedArgs, {
      filePath: "C:\\temp\\timeline.png",
      to: "user-1",
      contextToken: "ctx-1",
      baseUrl: "http://wx.example.test",
      token: "token-1",
      cdnBaseUrl: "http://cdn.example.test",
      apiVariant: "v2",
      routeTag: "route-1",
      clientVersion: "9.9.9",
    });
  } finally {
    delete require.cache[adapterModulePath];
    restoreModules(originals);
  }
});

test("official weixin adapter applies the configured delivery merge threshold", async () => {
  const originals = new Map<string, NodeJS.Module | undefined>();
  const sentTexts: string[] = [];
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "codeksei-weixin-delivery-route-"));
  const deliveryConfigFile = path.join(tempRoot, "weixin-delivery-config.json");
  new WeixinDeliveryConfigStore({ filePath: deliveryConfigFile }).setConfig({ minChunkChars: 4 });

  try {
    stubModule("src/adapters/channel/weixin/account-store.ts", {
      listWeixinAccounts() {
        return [];
      },
      resolveSelectedAccount() {
        return {
          accountId: "acct-1",
          baseUrl: "http://wx.example.test",
          token: "token-1",
        };
      },
    }, originals);
    stubModule("src/adapters/channel/weixin/context-token-store.ts", {
      loadPersistedContextTokens() {
        return {};
      },
      persistContextToken(_config: unknown, _accountId: unknown, userId: string, contextToken: string) {
        return { [userId]: contextToken };
      },
    }, originals);
    stubModule("src/adapters/channel/weixin/login-v2.ts", {
      async runV2LoginFlow() {},
    }, originals);
    stubModule("src/adapters/channel/weixin/api-v2.ts", {
      async getConfigV2() {
        return null;
      },
      async getUpdatesV2() {
        return { msgs: [], get_updates_buf: "" };
      },
      async sendTextV2(args: SendTextV2Args) {
        sentTexts.push(String(args.text || ""));
        return { ret: 0 };
      },
      async sendTypingV2() {},
    }, originals);
    stubModule("src/adapters/channel/weixin/message-utils-v2.ts", {
      createInboundFilter() {
        return {
          normalize(message: unknown) {
            return message;
          },
        };
      },
    }, originals);
    stubModule("src/adapters/channel/weixin/media-send.ts", {
      async sendWeixinMediaFile() {
        return { kind: "file", fileName: "unused.png" };
      },
    }, originals);
    stubModule("src/adapters/channel/weixin/sync-buffer-store.ts", {
      loadSyncBuffer() {
        return "";
      },
      saveSyncBuffer() {},
    }, originals);

    originals.set(adapterModulePath, require.cache[adapterModulePath]);
    originals.set(deliveryModulePath, require.cache[deliveryModulePath]);
    delete require.cache[adapterModulePath];
    delete require.cache[deliveryModulePath];
    const { createWeixinChannelAdapter }: typeof import("../src/adapters/channel/weixin/index") = require(adapterModulePath);

    const adapter = createWeixinChannelAdapter({
      stateDir: tempRoot,
      weixinDeliveryConfigFile: deliveryConfigFile,
    });

    await adapter.sendText({
      userId: "user-1",
      text: "第一句。第二句。",
      contextToken: "ctx-1",
    });

    assert.deepEqual(sentTexts, ["第一句。", "第二句。"]);
  } finally {
    delete require.cache[adapterModulePath];
    delete require.cache[deliveryModulePath];
    restoreModules(originals);
  }
});
