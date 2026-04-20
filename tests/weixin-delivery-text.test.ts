const test: typeof import("node:test") = require("node:test");
const assert: typeof import("node:assert/strict") = require("node:assert/strict");

const {
  chunkReplyText,
  chunkReplyTextForWeixin,
  collectStreamingBoundaries,
  normalizePlainTextForWeixin,
  packChunksForWeixinDelivery,
  trimOuterBlankLines,
}: typeof import("../src/adapters/channel/weixin/delivery-text") = require("../src/adapters/channel/weixin/delivery-text");

test("normalizePlainTextForWeixin collapses repeated blank paragraphs and CRLF", () => {
  assert.equal(
    normalizePlainTextForWeixin("\r\n\r\n第一段。\r\n\r\n\r\n第二段。\r\n"),
    "第一段。\n\n第二段。",
  );
});

test("trimOuterBlankLines removes leading and trailing blank lines without touching the middle", () => {
  assert.equal(trimOuterBlankLines("\n\n第一段。\n\n第二段。\n\n"), "第一段。\n\n第二段。");
});

test("collectStreamingBoundaries tracks Chinese punctuation, quotes, paragraph and list boundaries", () => {
  const text = "第一句。\"第二句？\"\n\n第三段。\n1. 列表项\n- 第二项";
  const boundaries = collectStreamingBoundaries(text);

  assert.deepEqual(
    boundaries.map((boundary) => text.slice(0, boundary)),
    [
      "第一句。\"",
      "第一句。\"第二句？\"\n\n",
      "第一句。\"第二句？\"\n\n第三段。\n",
      "第一句。\"第二句？\"\n\n第三段。\n1. 列表项\n",
    ],
  );
});

test("chunkReplyTextForWeixin keeps tiny semantic units together until the merge threshold", () => {
  assert.deepEqual(
    chunkReplyTextForWeixin("第一句。第二句。第三句。", 20),
    ["第一句。第二句。第三句。"],
  );
});

test("chunkReplyTextForWeixin still splits when the merge threshold is already met", () => {
  assert.deepEqual(
    chunkReplyTextForWeixin("第一句。第二句。第三句。", 4, 3800),
    ["第一句。", "第二句。", "第三句。"],
  );
});

test("chunkReplyTextForWeixin falls back to generic chunking for long units", () => {
  assert.deepEqual(
    chunkReplyTextForWeixin("abcdefghij", 4, 4),
    ["abcd", "efgh", "ij"],
  );
});

test("chunkReplyText prefers paragraph and sentence boundaries for oversized content", () => {
  assert.deepEqual(
    chunkReplyText("第一段。\n\n第二段。 第三段。", 8),
    ["第一段。", "第二段。 ", "第三段。"],
  );
});

test("packChunksForWeixinDelivery keeps semantic chunks and re-splits only oversized ones", () => {
  assert.deepEqual(
    packChunksForWeixinDelivery([
      "第一段。",
      "这是一个特别长的块，需要重新切分成更短的句子。",
    ], 10, 10),
    ["第一段。", "这是一个特别长的块，", "需要重新切分成更短的", "句子。"],
  );
});
