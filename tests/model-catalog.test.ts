const test: typeof import("node:test") = require("node:test");
const assert: typeof import("node:assert/strict") = require("node:assert/strict");

const {
  extractModelCatalogFromListResponse,
  findReasoningEffortByQuery,
  findModelByQuery,
  normalizeModelCatalog,
  resolveEffectiveModelForEffort,
} = require("../src/adapters/runtime/codex/model-catalog");

test("model catalog extracts entries from result.data and dedupes by model name", () => {
  const catalog = extractModelCatalogFromListResponse({
    result: {
      data: [
        { id: "gpt-5", model: "gpt-5", display_name: "GPT-5", is_default: true },
        { id: "Gpt-5", model: " GPT-5 " },
        { id: "gpt-5-mini", model: "gpt-5-mini" },
      ],
    },
  });

  assert.deepEqual(catalog, [
    {
      id: "gpt-5",
      model: "gpt-5",
      displayName: "GPT-5",
      supportedReasoningEfforts: [],
      defaultReasoningEffort: "",
      isDefault: true,
    },
    {
      id: "gpt-5-mini",
      model: "gpt-5-mini",
      displayName: "",
      supportedReasoningEfforts: [],
      defaultReasoningEffort: "",
      isDefault: false,
    },
  ]);
});

test("model catalog normalizes reasoning effort entries from strings and objects", () => {
  const catalog = normalizeModelCatalog([{
    id: "gpt-5",
    model: "gpt-5",
    supported_reasoning_efforts: [
      "low",
      { reasoning_effort: "medium" },
      { reasoningEffort: " low " },
    ],
    default_reasoning_effort: "medium",
  }]);

  assert.deepEqual(catalog[0], {
    id: "gpt-5",
    model: "gpt-5",
    displayName: "",
    supportedReasoningEfforts: ["low", "medium"],
    defaultReasoningEffort: "medium",
    isDefault: false,
  });
});

test("findModelByQuery matches both model name and id, case-insensitively", () => {
  const models = normalizeModelCatalog([
    { id: "gpt-5.4", model: "gpt-5.4" },
    { id: "GPT-5.4-mini", model: "gpt-5.4-mini" },
  ]);

  assert.equal(findModelByQuery(models, "GPT-5.4")?.model, "gpt-5.4");
  assert.equal(findModelByQuery(models, "gpt-5.4-mini")?.id, "GPT-5.4-mini");
  assert.equal(findModelByQuery(models, "missing"), null);
});

test("resolveEffectiveModelForEffort prefers current model match and otherwise falls back to default", () => {
  const models = normalizeModelCatalog([
    { id: "gpt-5.4", model: "gpt-5.4", is_default: true },
    { id: "gpt-5.4-mini", model: "gpt-5.4-mini" },
  ]);

  assert.equal(resolveEffectiveModelForEffort(models, "GPT-5.4-mini")?.model, "gpt-5.4-mini");
  assert.equal(resolveEffectiveModelForEffort(models, "missing")?.model, "gpt-5.4");
});

test("findReasoningEffortByQuery matches supported efforts case-insensitively", () => {
  assert.equal(findReasoningEffortByQuery(["low", "medium", "high"], "HIGH"), "high");
  assert.equal(findReasoningEffortByQuery(["low", "medium"], "unknown"), "");
});
