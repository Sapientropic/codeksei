const test = require("node:test");
const assert = require("node:assert/strict");

const {
  isBriefStreamingProgressText,
  sanitizeReplyText,
} = require("../src/core/stream-delivery/visible-text");

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
