const test: typeof import("node:test") = require("node:test");
const assert: typeof import("node:assert/strict") = require("node:assert/strict");

const {
  appendDeltaFragment,
  appendStreamingText,
  buildComparisonMap,
  comparisonIndexToRawIndex,
  computeVisibleDeliveryDelta,
  mergeCompletedItemText,
  mergeAuthoritativeItemText,
  normalizeFragmentKind,
  normalizeStreamingSnapshotSemanticText,
  normalizeVisibleStreamingText,
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

test("fragment and snapshot normalization handle empty, equivalent, and contained snapshots", () => {
  assert.equal(normalizeFragmentKind(" snapshot "), "snapshot");
  assert.equal(normalizeFragmentKind("completed_snapshot"), "completed_snapshot");
  assert.equal(normalizeFragmentKind("other"), "");
  assert.equal(normalizeVisibleStreamingText(" **Hello**   world "), "Hello world");
  assert.equal(normalizeStreamingSnapshotSemanticText("Hello, world!"), "Hello world");

  assert.deepEqual(
    mergeAuthoritativeItemText("", "第一句。", { fragmentKind: "snapshot" }),
    { text: "第一句。", relation: "replace" },
  );
  assert.deepEqual(
    mergeAuthoritativeItemText("第一句。", "", { fragmentKind: "snapshot" }),
    { text: "第一句。", relation: "keep" },
  );
  assert.deepEqual(
    mergeAuthoritativeItemText("第一句。", "第一句", { fragmentKind: "snapshot" }),
    { text: "第一句。", relation: "keep" },
  );
  assert.deepEqual(
    mergeAuthoritativeItemText("第一句。第二句。", "第二句。", { fragmentKind: "completed_snapshot" }),
    { text: "第二句。", relation: "replace" },
  );
});

test("streaming append and completed snapshots cover overlap, keep, and fallback paths", () => {
  assert.equal(appendStreamingText("", "第一句。"), "第一句。");
  assert.equal(appendStreamingText("第一句。", ""), "第一句。");
  assert.equal(appendStreamingText("第一句。", "一句。"), "第一句。");
  assert.equal(appendStreamingText("第一", "第一句。"), "第一句。");
  assert.equal(appendStreamingText("第一句", "句。第二句。"), "第一句。第二句。");
  assert.equal(appendStreamingText("第一句。", "第二句。"), "第一句。第二句。");

  assert.equal(mergeCompletedItemText("", "最终句。"), "最终句。");
  assert.equal(mergeCompletedItemText("草稿句。", ""), "草稿句。");
  assert.equal(mergeCompletedItemText("最终 **句**。", "最终 句。"), "最终 句。");
  assert.equal(mergeCompletedItemText("第一句。", "第二句。"), "第一句。第二句。");
});

test("visible delta handles empty, equivalent, normalized extension, and raw comparison mapping", () => {
  assert.deepEqual(
    computeVisibleDeliveryDelta("已经发送。", ""),
    {
      delta: "",
      relation: "keep",
      deliveredVisibleBefore: "已经发送。",
      deliveredVisibleAfter: "已经发送。",
    },
  );
  assert.deepEqual(
    computeVisibleDeliveryDelta("", "初始发送。"),
    {
      delta: "初始发送。",
      relation: "initial",
      deliveredVisibleBefore: "",
      deliveredVisibleAfter: "初始发送。",
    },
  );
  assert.deepEqual(
    computeVisibleDeliveryDelta("Hello   world", "Hello world"),
    {
      delta: "",
      relation: "equivalent",
      deliveredVisibleBefore: "Hello   world",
      deliveredVisibleAfter: "Hello   world",
    },
  );
  assert.equal(computeVisibleDeliveryDelta("Hello world", "Hello   world again").relation, "normalized_extend");

  const punctuationMap = buildComparisonMap("A, B C", { stripPunctuation: true });
  assert.equal(punctuationMap.comparison, "A B C");
  assert.equal(comparisonIndexToRawIndex(null, 3), 0);
  assert.equal(comparisonIndexToRawIndex(punctuationMap, 999), punctuationMap.raw.length);
});
