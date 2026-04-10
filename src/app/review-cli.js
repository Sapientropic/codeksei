const { buildReview, writeReview } = require("../core/review");

async function runReviewCommand(config, kind, args = process.argv.slice(4)) {
  const options = parseReviewArgs(args, kind);
  if (options.help) {
    printReviewHelp(kind);
    return;
  }
  if (options.stdout) {
    const review = await buildReview(config, kind, options);
    process.stdout.write(review.draft.periodTitle + "\n");
    process.stdout.write(review.draft.windowFacts.map((line) => `- ${line}`).join("\n") + "\n");
    return;
  }
  const result = await writeReview(config, kind, options);
  const action = result.changed ? "updated" : "noop";
  const semantic = result.semanticUsed ? " semantic=hybrid" : "";
  console.log(`review ${action}: ${result.filePath} [${kind}:${result.periodLabel}] diaries=${result.diaryCount}${semantic}`);
}

function parseReviewArgs(args, kind) {
  const options = {
    help: false,
    stdout: false,
    deterministic: false,
    date: "",
    week: "",
    month: "",
    model: "",
  };
  for (let index = 0; index < args.length; index += 1) {
    const arg = String(args[index] || "").trim();
    if (!arg) {
      continue;
    }
    if (arg === "--help" || arg === "-h") {
      options.help = true;
      continue;
    }
    if (arg === "--stdout") {
      options.stdout = true;
      continue;
    }
    if (arg === "--deterministic") {
      options.deterministic = true;
      continue;
    }
    if (!arg.startsWith("--")) {
      throw new Error(`未知参数: ${arg}`);
    }
    const value = String(args[index + 1] || "");
    if (!value || value.startsWith("--")) {
      throw new Error(`参数缺少值: ${arg}`);
    }
    if (arg === "--date") {
      options.date = value;
    } else if (arg === "--week") {
      options.week = value;
    } else if (arg === "--month") {
      options.month = value;
    } else if (arg === "--model") {
      options.model = value;
    } else {
      throw new Error(`未知参数: ${arg}`);
    }
    index += 1;
  }

  if (kind === "weekly" && options.month) {
    throw new Error("review:weekly 不支持 --month");
  }
  if (kind === "monthly" && options.week) {
    throw new Error("review:monthly 不支持 --week");
  }
  if (kind === "nightly" && (options.week || options.month)) {
    throw new Error("review:nightly 只支持 --date");
  }

  return options;
}

function printReviewHelp(kind) {
  const nightly = [
    "用法: npm run review:nightly -- [--date YYYY-MM-DD] [--stdout] [--deterministic] [--model <id>]",
    "",
    "说明：",
    "  从当前 diary 真相源生成一份 Cyberboss 睡前收口。",
    "  默认按 Asia/Shanghai 的当前日期推断今天，并给周/月复盘提供更轻的日级原料。",
    "  默认走 hybrid：脚本保骨架，Codex 负责结构化语义提炼；失败时自动回退。",
    "",
    "示例：",
    "  npm run review:nightly",
    "  npm run review:nightly -- --date 2026-04-10",
  ].join("\n");

  const weekly = [
    "用法: npm run review:weekly -- [--week YYYY-Www] [--date YYYY-MM-DD] [--stdout] [--deterministic] [--model <id>]",
    "",
    "说明：",
    "  从当前 diary 真相源生成一份 Cyberboss 生活助理周复盘。",
    "  默认按 Asia/Shanghai 的当前日期推断本周（周一到周日）。",
    "  默认走 hybrid：脚本保骨架，Codex 负责结构化语义提炼；失败时自动回退。",
    "",
    "示例：",
    "  npm run review:weekly",
    "  npm run review:weekly -- --week 2026-W15",
    "  npm run review:weekly -- --date 2026-04-11",
  ].join("\n");

  const monthly = [
    "用法: npm run review:monthly -- [--month YYYY-MM] [--date YYYY-MM-DD] [--stdout] [--deterministic] [--model <id>]",
    "",
    "说明：",
    "  从当前 diary 真相源生成一份 Cyberboss 生活助理月复盘。",
    "  默认按 Asia/Shanghai 的当前日期推断本月。",
    "  默认走 hybrid：脚本保骨架，Codex 负责结构化语义提炼；失败时自动回退。",
    "",
    "示例：",
    "  npm run review:monthly",
    "  npm run review:monthly -- --month 2026-04",
    "  npm run review:monthly -- --date 2026-04-11",
  ].join("\n");

  if (kind === "nightly") {
    console.log(nightly);
    return;
  }
  console.log(kind === "weekly" ? weekly : monthly);
}

module.exports = {
  parseReviewArgs,
  runReviewCommand,
};
