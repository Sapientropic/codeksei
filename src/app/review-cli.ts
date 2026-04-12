const { getCommandArgsSchema } = require("../contracts/command-args");
const { parseCliArgs } = require("../core/cli-args");
const { buildTerminalLeafHelp } = require("../core/command-registry");
const { buildReview, writeReview } = require("../core/review");

async function runReviewCommand(config: any, kind: any, args: any[] = []) {
  const options = parseReviewArgs(args, kind);
  if (options.help) {
    console.log(buildTerminalLeafHelp(`review.${kind}`, { timezone: config?.timezone }));
    return;
  }
  if (options.stdout) {
    const review = await buildReview(config, kind, options);
    process.stdout.write(review.draft.periodTitle + "\n");
    process.stdout.write(review.draft.windowFacts.map((line: any) => `- ${line}`).join("\n") + "\n");
    return;
  }
  const result = await writeReview(config, kind, options);
  const action = result.changed ? "updated" : "noop";
  const semantic = result.semanticUsed ? " semantic=hybrid" : "";
  console.log(`review ${action}: ${result.filePath} [${kind}:${result.periodLabel}] diaries=${result.diaryCount}${semantic}`);
}

function parseReviewArgs(args: any, kind: any) {
  const options = parseCliArgs(args, getCommandArgsSchema("review"));

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
module.exports = {
  parseReviewArgs,
  runReviewCommand,
};

export {};
