import { getCommandArgsSchema } from "../contracts/command-args";
import { parseCliArgs } from "../core/cli-args";
import { buildTerminalLeafHelp } from "../core/command-registry";
import { buildReview, writeReview } from "../review/review";

type ReviewKind = "nightly" | "weekly" | "monthly";

interface ReviewOptions extends Record<string, unknown> {
  help: boolean;
  stdout: boolean;
  deterministic: boolean;
  date: string;
  week: string;
  month: string;
  model: string;
}

async function runReviewCommand(config: Record<string, unknown>, kind: ReviewKind, args: string[] = []) {
  const options = parseReviewArgs(args, kind);
  if (options.help) {
    console.log(buildTerminalLeafHelp(`review.${kind}`, { timezone: config?.timezone }));
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

function parseReviewArgs(args: string[], kind: ReviewKind): ReviewOptions {
  const options = parseCliArgs(args, getCommandArgsSchema("review")) as unknown as ReviewOptions;

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

export {
  parseReviewArgs,
  runReviewCommand,
};
