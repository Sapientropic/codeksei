const test: typeof import("node:test") = require("node:test");
const assert: typeof import("node:assert/strict") = require("node:assert/strict");

const {
  appendDeltaFragment,
  computeVisibleDeliveryDelta,
  mergeAuthoritativeItemText,
} = require("../src/runtime/stream-delivery/delta-merge");

test("delta merge appends overlapping fragments without duplicating prefixes", () => {
  assert.deepEqual(
    mergeAuthoritativeItemText("先给你一个开头。", "一个开头。\n\n再补完整结论。", {
      fragmentKind: "delta",
      completed: false,
    }),
    {
      text: "先给你一个开头。\n\n再补完整结论。",
      relation: "append",
    }
  );
});

test("snapshot merge rewrites the authoritative block instead of concatenating duplicates", () => {
  assert.deepEqual(
    mergeAuthoritativeItemText("先给你一个开头。", "先给你一个开头。\n\n再补完整结论。", {
      fragmentKind: "snapshot",
      completed: false,
    }),
    {
      text: "先给你一个开头。\n\n再补完整结论。",
      relation: "replace",
    }
  );
});

test("delta merge keeps English token boundaries readable", () => {
  assert.equal(appendDeltaFragment("I", "'m"), "I'm");
  assert.equal(appendDeltaFragment("I'm", " switching"), "I'm switching");
  assert.equal(appendDeltaFragment("state-", "of"), "state-of");
  assert.equal(appendDeltaFragment("done)", " Next"), "done) Next");
});

test("visible delta detects semantic extension and rewrite without extension separately", () => {
  assert.deepEqual(
    computeVisibleDeliveryDelta("先说。", "先说完整。"),
    {
      delta: "完整。",
      relation: "semantic_extend",
      deliveredVisibleBefore: "先说。",
      deliveredVisibleAfter: "先说完整。",
    }
  );

  assert.deepEqual(
    computeVisibleDeliveryDelta(
      "这一段还在等工具结果，\n\n【系统提示】\n这一轮回复没有正常收尾。",
      "这一段还在等工具结果，现在结果已经回来，可以继续给你完整结论。"
    ),
    {
      delta: "",
      relation: "rewrite_without_extension",
      deliveredVisibleBefore: "这一段还在等工具结果，\n\n【系统提示】\n这一轮回复没有正常收尾。",
      deliveredVisibleAfter: "这一段还在等工具结果，\n\n【系统提示】\n这一轮回复没有正常收尾。",
    }
  );
});
