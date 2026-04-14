const test: typeof import("node:test") = require("node:test");
const assert: typeof import("node:assert/strict") = require("node:assert/strict");

const {
  normalizeSessionState,
}: typeof import("../src/contracts/session-state") = require("../src/contracts/session-state");

test("session state contract normalizes legacy runtime params and drops polluted approval fields", () => {
  const normalized = normalizeSessionState({
    bindings: {
      " binding-a ": {
        workspaceId: "workspace-1",
        accountId: "acct-1",
        senderId: "user-1",
        activeWorkspaceRoot: "E:/repo/current",
        updatedAt: "not-a-date",
        threadIdByWorkspaceRoot: ["bad"],
        codexParamsByWorkspaceRoot: {
          "E:/repo/current": {
            model: "gpt-5.4",
            effort: 42,
          },
        },
        workspaceBootstrapThreadIdByWorkspaceRoot: {
          "E:/repo/current": 123,
        },
      },
    },
    approvalPromptStateByThreadId: {
      "thread-1": {
        requestId: 42,
        reason: " Need shell ",
        commandTokens: ["npm", "", "review:weekly", 99],
        promptedAt: "not-a-date",
      },
    },
    availableModelCatalog: {
      models: ["gpt-5.4"],
      updatedAt: "not-a-date",
    },
  });

  assert.deepEqual(normalized.bindings["binding-a"], {
    workspaceId: "workspace-1",
    accountId: "acct-1",
    senderId: "user-1",
    activeWorkspaceRoot: "E:/repo/current",
    updatedAt: "",
    threadIdByWorkspaceRoot: {},
    codexParamsByWorkspaceRoot: {
      "E:/repo/current": {
        model: "gpt-5.4",
        effort: 42,
      },
    },
    runtimeParamsByWorkspaceRoot: {
      "E:/repo/current": {
        model: "gpt-5.4",
        effort: "",
      },
    },
    workspaceBootstrapThreadIdByWorkspaceRoot: {
      "E:/repo/current": "",
    },
  });
  assert.deepEqual(normalized.approvalPromptStateByThreadId["thread-1"], {
    requestId: "42",
    reason: "Need shell",
    command: "",
    commandTokens: ["npm", "review:weekly"],
    signature: "",
    promptedAt: "",
  });
  assert.deepEqual(normalized.availableModelCatalog, {
    models: ["gpt-5.4"],
    updatedAt: "",
  });
});
