const http: typeof import("node:http") = require("node:http");
const test: typeof import("node:test") = require("node:test");
const assert: typeof import("node:assert/strict") = require("node:assert/strict");

const {
  runOpenAICompatibleSemanticJson,
}: typeof import("../src/runtime/semantic-json-runtime") = require("../src/runtime/semantic-json-runtime");
const {
  resolveProactiveJudgmentHostAdapter,
}: typeof import("../src/proactive/semantic-host") = require("../src/proactive/semantic-host");

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
    timeoutMs: 2500,
  });

  assert.deepEqual(result, { ok: true, source: "local" });
  assert.equal(requests.length, 1);
  assert.equal(requests[0]?.authorization, "Bearer secret");
  assert.equal(requests[0]?.body.model, "local-small");
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
