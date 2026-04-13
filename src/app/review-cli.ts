import { getCommandArgsSchema } from "../contracts/command-args";
import type { CommandExecutionResult } from "../contracts/cli-contract";
import { parseCliArgs } from "../core/cli-args";
import { runCliMutation } from "../core/cli-mutation";
import { buildTerminalLeafHelp } from "../core/command-registry";
import { buildReview, writeReview } from "../review/review";

type ReviewKind = "nightly" | "weekly" | "monthly";

interface ReviewOptions extends Record<string, unknown> {
  dryRun: boolean;
  help: boolean;
  idempotencyKey: string;
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
    return {
      data: null,
      text: buildTerminalLeafHelp(`review.${kind}`, { timezone: config?.timezone }),
    } satisfies CommandExecutionResult;
  }
  if (options.stdout) {
    const review = await buildReview(config, kind, options);
    return {
      data: {
        draft: review.draft,
        notePath: review.notePath,
        periodLabel: review.draft.periodLabel,
      },
      meta: {
        configSource: {
          reviewSchemaConfigFile: config.reviewSchemaConfigFile || "",
          workspaceRoot: config.workspaceRoot || "",
        },
        effectiveWorkspaceRoot: config.workspaceRoot || "",
      },
      text: `${review.draft.periodTitle}\n${review.draft.windowFacts.map((line) => `- ${line}`).join("\n")}\n`,
    };
  }
  const preview = await buildReview(config, kind, options);
  return runCliMutation<Record<string, unknown>>({
    commandKey: `review.${kind}`,
    config,
    configSource: {
      reviewSchemaConfigFile: config.reviewSchemaConfigFile || "",
      workspaceRoot: config.workspaceRoot || "",
    },
    dryRun: options.dryRun,
    dryRunResult: {
      data: {
        notePath: preview.notePath,
        periodLabel: preview.draft.periodLabel,
        reviewKind: kind,
      },
      text: [
        "review dry-run",
        `kind: ${kind}`,
        `file: ${preview.notePath}`,
        `period: ${preview.draft.periodLabel}`,
      ].join("\n"),
    },
    execute: async () => {
      const result = await writeReview(config, kind, options);
      const action = result.changed ? "updated" : "noop";
      const semantic = result.semanticUsed ? " semantic=hybrid" : "";
      return {
        data: {
          ...result,
          action,
          reviewKind: kind,
        },
        text: `review ${action}: ${result.filePath} [${kind}:${result.periodLabel}] diaries=${result.diaryCount}${semantic}`,
      };
    },
    idempotencyKey: options.idempotencyKey,
    request: {
      deterministic: options.deterministic,
      kind,
      model: options.model,
      period: {
        date: options.date,
        month: options.month,
        week: options.week,
      },
    },
    resolvedTargets: {
      filePath: preview.notePath,
      periodLabel: preview.draft.periodLabel,
      reviewKind: kind,
    },
    sideEffects: [
      {
        kind: "write_review",
        target: preview.notePath,
      },
    ],
  });
}

function parseReviewArgs(args: string[], kind: ReviewKind): ReviewOptions {
  const options = parseCliArgs<ReviewOptions>(args, getCommandArgsSchema("review"));

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
