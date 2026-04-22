const test: typeof import("node:test") = require("node:test");
const assert: typeof import("node:assert/strict") = require("node:assert/strict");

const {
  buildVisibleItemDedupKey,
  isBriefStreamingProgressText,
  markdownToPlainText,
  rememberVisiblePart,
  sanitizeReplyText,
  shouldStreamImmediately,
  trimOuterBlankLines,
} = require("../src/runtime/stream-delivery/visible-text");

test("visible text sanitizer suppresses the SILENT sentinel", () => {
  assert.deepEqual(
    sanitizeReplyText(
      { provider: "system" },
      "SILENT"
    ),
    {
      suppress: true,
      text: "",
    }
  );
});

test("visible text sanitizer collapses repeated weixin blocks instead of echoing them twice", () => {
  const first = "第一段很长的确认说明。".repeat(12);
  const second = "第二段也很长，而且内容和上面不同。".repeat(12);
  const repeated = `${first}\n\n${second}\n\n${first}\n\n${second}`;

  assert.deepEqual(
    sanitizeReplyText({ provider: "weixin" }, repeated),
    {
      suppress: false,
      text: `${first}\n\n${second}`,
    }
  );
});

test("brief progress detector accepts short natural language but rejects list and code payloads", () => {
  assert.equal(isBriefStreamingProgressText("我先去抓日志。"), true);
  assert.equal(isBriefStreamingProgressText("先列两点：\n1. 第一处怀疑点\n2. 第二处怀疑点"), false);
  assert.equal(isBriefStreamingProgressText("```js\nconsole.log('still thinking')\n```"), false);
});

test("markdown plain text handles links, images, tables, and unfinished fences", () => {
  const plain = markdownToPlainText([
    "# 标题",
    "",
    "![alt](image.png)",
    "[链接](https://example.com) and `code`",
    "| A | B |",
    "|---|---|",
    "| 1 | 2 |",
    "```ts",
    "const value = 1;",
  ].join("\n"));

  assert.match(plain, /^标题/u);
  assert.doesNotMatch(plain, /image\.png/u);
  assert.match(plain, /链接 and code/u);
  assert.match(plain, /1  2/u);
  assert.match(plain, /ts:\n    const value = 1;/u);
  assert.equal(trimOuterBlankLines("\n\n  内容\n\n"), "  内容");
  assert.equal(buildVisibleItemDedupKey("**粗体**"), "粗体");
});

test("visible sanitizer distinguishes system suppression from user-visible sentinel cleanup", () => {
  assert.deepEqual(
    sanitizeReplyText({ provider: "system" }, "{\"codeksei_action\":\"silent\"}\nSILENT"),
    { suppress: true, text: "" },
  );
  assert.deepEqual(
    sanitizeReplyText({ provider: "weixin" }, "第一行 SILENT\n第二行"),
    { suppress: false, text: "第一行\n第二行" },
  );
});

test("stream immediacy and visible part memory cover non-streaming branches", () => {
  assert.equal(shouldStreamImmediately(null), false);
  assert.equal(shouldStreamImmediately({ itemId: "__watchdog__", text: "tail", phase: "final" }), false);
  assert.equal(shouldStreamImmediately({ itemId: "final", text: "最终句。", phase: "final" }), true);
  assert.equal(shouldStreamImmediately({ itemId: "long", text: "很长".repeat(80), phase: "commentary" }), false);
  assert.equal(shouldStreamImmediately({ itemId: "other", text: "短句。", phase: "unknown" }), true);

  const parts: string[] = [];
  const seen = new Set<string>();
  rememberVisiblePart(parts, seen, "**同一句**");
  rememberVisiblePart(parts, seen, "同一句");
  rememberVisiblePart(parts, seen, "另一句");
  assert.deepEqual(parts, ["**同一句**", "另一句"]);
});
