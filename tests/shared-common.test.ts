const fs: typeof import("node:fs") = require("node:fs");
const os: typeof import("node:os") = require("node:os");
const path: typeof import("node:path") = require("node:path");
const test: typeof import("node:test") = require("node:test");
const assert: typeof import("node:assert/strict") = require("node:assert/strict");
const {
  spawnDetachedCommand,
  stopManagedProcess,
}: typeof import("../src/shared/shared-common") = require("../src/shared/shared-common");

test("spawnDetachedCommand closes the parent log fds after a successful detached spawn", () => {
  const closed: number[] = [];
  let nextFd = 41;
  let unrefCalled = false;

  const pid = spawnDetachedCommand("node", ["./dist/src/index.js"], { logFile: "shared.log" }, {
    buildSpawnInvocation(command: string, args: string[]) {
      return { command, args };
    },
    closeFd(fd: number) {
      closed.push(fd);
    },
    openLogFile() {
      const fd = nextFd;
      nextFd += 1;
      return fd;
    },
    spawn(command: string, args: string[], options: Record<string, unknown> & { stdio: [string, number, number] }) {
      assert.equal(command, "node");
      assert.deepEqual(args, ["./dist/src/index.js"]);
      assert.deepEqual(options.stdio, ["ignore", 41, 42]);
      return {
        pid: 1234,
        unref() {
          unrefCalled = true;
        },
      };
    },
  });

  assert.equal(pid, 1234);
  assert.equal(unrefCalled, true);
  assert.deepEqual(closed, [41, 42]);
});

test("spawnDetachedCommand closes the parent log fds when spawn throws", () => {
  const closed: number[] = [];
  let nextFd = 51;

  assert.throws(
    () => spawnDetachedCommand("node", ["./dist/src/index.js"], { logFile: "shared.log" }, {
      buildSpawnInvocation(command: string, args: string[]) {
        return { command, args };
      },
      closeFd(fd: number) {
        closed.push(fd);
      },
      openLogFile() {
        const fd = nextFd;
        nextFd += 1;
        return fd;
      },
      spawn(_command: string, _args: string[], _options: { stdio: [string, number, number] } & Record<string, unknown>) {
        throw new Error("spawn boom");
      },
    }),
    /spawn boom/,
  );

  assert.deepEqual(closed, [51, 52]);
});

test("stopManagedProcess refuses to kill an unexpected pidfile target", async () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "codeksei-shared-stop-"));
  const pidFile = path.join(tempRoot, "shared.pid");
  fs.writeFileSync(pidFile, `${process.pid}\n`, "utf8");

  const result = await stopManagedProcess(pidFile, {
    expectedSubstrings: ["definitely-not-this-command-line"],
    label: "shared process",
  });

  assert.equal(result.status, "unexpected_command");
  assert.equal(result.pid, process.pid);
  assert.equal(fs.existsSync(pidFile), true);
});

test("resolveBoundThread prefers exact workspace binding and falls back to newest active binding", () => {
  const exact = loadResolveBoundThread({
    bindings: [
      {
        accountId: "acct-1",
        activeWorkspaceRoot: "E:/repo/other",
        threadIdByWorkspaceRoot: {
          "E:/repo/current": "thread-current",
          "E:/repo/other": "thread-other",
        },
        updatedAt: "2026-04-12T09:00:00.000Z",
      },
    ],
    latestAccountBySavedAt: {
      "acct-1": "2026-04-12T10:00:00.000Z",
    },
  });

  try {
    assert.deepEqual(exact.resolveBoundThread("E:/repo/current"), {
      threadId: "thread-current",
      workspaceRoot: "E:/repo/current",
    });
  } finally {
    exact.restore();
  }

  const fallback = loadResolveBoundThread({
    bindings: [
      {
        accountId: "acct-1",
        activeWorkspaceRoot: "E:/repo/stale",
        threadIdByWorkspaceRoot: {
          "E:/repo/stale": "thread-stale",
        },
        updatedAt: "2026-04-10T09:00:00.000Z",
      },
      {
        accountId: "acct-1",
        activeWorkspaceRoot: "E:/repo/active",
        threadIdByWorkspaceRoot: {
          "E:/repo/active": "thread-active",
        },
        updatedAt: "2026-04-12T09:00:00.000Z",
      },
    ],
    latestAccountBySavedAt: {
      "acct-1": "2026-04-12T10:00:00.000Z",
    },
  });

  try {
    assert.deepEqual(fallback.resolveBoundThread("E:/repo/missing"), {
      threadId: "thread-active",
      workspaceRoot: "E:/repo/active",
    });
  } finally {
    fallback.restore();
  }
});

function loadResolveBoundThread({
  bindings,
  latestAccountBySavedAt,
}: {
  bindings: Array<Record<string, unknown>>;
  latestAccountBySavedAt: Record<string, string>;
}): {
  resolveBoundThread: typeof import("../src/shared/shared-thread-binding").resolveBoundThread;
  restore: () => void;
} {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "codeksei-shared-thread-"));
  const accountsDir = path.join(tempRoot, "accounts");
  fs.mkdirSync(accountsDir, { recursive: true });
  for (const accountId of Object.keys(latestAccountBySavedAt)) {
    fs.writeFileSync(path.join(accountsDir, `${accountId}.json`), "{}", "utf8");
  }

  const previousStateDir = process.env.CODEKSEI_STATE_DIR;
  const previousSessionsFile = process.env.SESSIONS_FILE;
  process.env.CODEKSEI_STATE_DIR = tempRoot;
  process.env.SESSIONS_FILE = path.join(tempRoot, "sessions.json");

  const sharedThreadBindingPath = require.resolve("../src/shared/shared-thread-binding");
  const sharedProcessPath = require.resolve("../src/shared/shared-process");
  const sessionStorePath = require.resolve("../src/adapters/runtime/codex/session-store");
  const accountStorePath = require.resolve("../src/adapters/channel/weixin/account-store");

  const originals = new Map<string, NodeJS.Module | undefined>();
  originals.set(sharedThreadBindingPath, require.cache[sharedThreadBindingPath]);
  originals.set(sharedProcessPath, require.cache[sharedProcessPath]);
  originals.set(sessionStorePath, require.cache[sessionStorePath]);
  originals.set(accountStorePath, require.cache[accountStorePath]);

  require.cache[sessionStorePath] = {
    id: sessionStorePath,
    filename: sessionStorePath,
    loaded: true,
    exports: {
      SessionStore: class SessionStoreStub {
        listBindings() {
          return bindings;
        }
      },
    },
  } as NodeJS.Module;
  require.cache[accountStorePath] = {
    id: accountStorePath,
    filename: accountStorePath,
    loaded: true,
    exports: {
      loadWeixinAccount(_config: Record<string, unknown>, accountId: string) {
        return {
          accountId,
          savedAt: latestAccountBySavedAt[accountId] || "",
        };
      },
    },
  } as NodeJS.Module;
  delete require.cache[sharedThreadBindingPath];
  delete require.cache[sharedProcessPath];

  const { resolveBoundThread }: typeof import("../src/shared/shared-thread-binding") = require(sharedThreadBindingPath);

  return {
    resolveBoundThread,
    restore() {
      if (previousStateDir === undefined) {
        delete process.env.CODEKSEI_STATE_DIR;
      } else {
        process.env.CODEKSEI_STATE_DIR = previousStateDir;
      }
      if (previousSessionsFile === undefined) {
        delete process.env.SESSIONS_FILE;
      } else {
        process.env.SESSIONS_FILE = previousSessionsFile;
      }

      for (const [modulePath, original] of originals.entries()) {
        if (original) {
          require.cache[modulePath] = original;
        } else {
          delete require.cache[modulePath];
        }
      }
    },
  };
}
