const http: typeof import("node:http") = require("node:http");
const test: typeof import("node:test") = require("node:test");
const assert: typeof import("node:assert/strict") = require("node:assert/strict");

const {
  runOpenAICompatibleSemanticJson,
}: typeof import("../src/runtime/semantic-json-runtime") = require("../src/runtime/semantic-json-runtime");
const {
  resolveProactiveJudgmentHostAdapter,
}: typeof import("../src/proactive/semantic-host") = require("../src/proactive/semantic-host");
const {
  maybeGenerateProactiveObservation,
}: typeof import("../src/proactive/observation") = require("../src/proactive/observation");

test("openai-compatible semantic JSON runner posts chat completion requests", async (t) => {
  const requests: Array<{ authorization: string; body: Record<string, unknown> }> = [];
  const server = http.createServer((request, response) => {
    let body = "";
    request.on("data", (chunk) => {
      body += String(chunk);
    });
    request.on("end", () => {
      requests.push({
        authorization: String(request.headers.authorization || ""),
        body: JSON.parse(body),
      });
      response.setHeader("content-type", "application/json");
      response.end(JSON.stringify({
        choices: [
          {
            message: {
              content: "{\"ok\":true,\"source\":\"local\"}",
            },
          },
        ],
      }));
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => server.close());
  const address = server.address();
  assert.equal(typeof address, "object");
  const endpoint = `http://127.0.0.1:${address && typeof address === "object" ? address.port : 0}/v1`;

  const result = await runOpenAICompatibleSemanticJson({
    proactiveJudgmentApiKey: "secret",
    proactiveJudgmentEndpoint: endpoint,
  }, {
    label: "proactive test",
    model: "local-small",
    prompt: "Return JSON",
    requestExtraBody: {
      chat_template_kwargs: { enable_thinking: false },
      max_tokens: 384,
    },
    timeoutMs: 2500,
  });

  assert.deepEqual(result, { ok: true, source: "local" });
  assert.equal(requests.length, 1);
  assert.equal(requests[0]?.authorization, "Bearer secret");
  assert.equal(requests[0]?.body.model, "local-small");
  assert.deepEqual(requests[0]?.body.chat_template_kwargs, { enable_thinking: false });
  assert.equal(requests[0]?.body.max_tokens, 384);
  assert.equal(Array.isArray(requests[0]?.body.messages), true);
});

test("proactive judgment host resolver prefers openai-compatible endpoint in auto mode", () => {
  const adapter = resolveProactiveJudgmentHostAdapter({
    proactiveJudgmentEndpoint: "http://127.0.0.1:11434/v1",
    proactiveJudgmentHost: "auto",
    proactiveJudgmentMode: "hybrid",
  });

  assert.equal(adapter?.host, "local");
});

test("proactive judgment host resolver disables model calls in deterministic mode", () => {
  const adapter = resolveProactiveJudgmentHostAdapter({
    proactiveJudgmentEndpoint: "http://127.0.0.1:11434/v1",
    proactiveJudgmentHost: "deterministic",
    proactiveJudgmentMode: "hybrid",
  });

  assert.equal(adapter, null);
});

test("proactive observation openai-compatible request uses optional short-json extra body", async (t) => {
  const requests: Array<{ body: Record<string, unknown> }> = [];
  const server = http.createServer((request, response) => {
    let body = "";
    request.on("data", (chunk) => {
      body += String(chunk);
    });
    request.on("end", () => {
      requests.push({ body: JSON.parse(body) });
      response.setHeader("content-type", "application/json");
      response.end(JSON.stringify({
        choices: [
          {
            message: {
              content: JSON.stringify({
                confidence: 0.78,
                evidence: ["context says continue observation"],
                reentryCandidate: "继续 observation eval。",
                stateSignals: ["project_reentry"],
                surfaceRisk: "low",
                annoyanceRisk: "low",
                userEnergy: "medium",
              }),
            },
          },
        ],
      }));
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => server.close());
  const address = server.address();
  assert.equal(typeof address, "object");
  const endpoint = `http://127.0.0.1:${address && typeof address === "object" ? address.port : 0}/v1`;

  const result = await maybeGenerateProactiveObservation({
    proactiveObservationEndpoint: endpoint,
    proactiveObservationHost: "local",
    proactiveObservationMinConfidence: 0.55,
    proactiveObservationMode: "hybrid",
    proactiveObservationModel: "gemma-4-E2B-it",
    proactiveObservationTimeoutMs: 2500,
  }, {
    checkin: {
      lastCompletionAt: "",
      lastCompletionResult: "",
      nextWakeAt: "",
      pendingHandoffExists: false,
    },
    contextBriefing: {
      followupContext: "",
      stale: false,
      staleReasons: [],
    },
    now: "2026-04-21T08:00:00.000Z",
    recentOutcomes: [],
    stateCard: {
      activeThread: "Codeksei observation",
      currentLikelyState: "Testing optional extra body.",
      doNotDo: ["Do not expose internals."],
      easiestReentryStep: "Run eval.",
      likelyBlocker: "",
      sourceThickness: "strong",
      toneHint: "short",
    },
    target: {
      senderId: "wx-user",
      targetKey: "wx-user::/workspace",
      workspaceRoot: "/workspace",
    },
    timezone: "Asia/Shanghai",
  }, {
    write: false,
  });

  assert.equal(result.data?.usable, true);
  assert.equal(requests[0]?.body.max_tokens, 512);
  assert.deepEqual(requests[0]?.body.chat_template_kwargs, { enable_thinking: false });
});
