import { getCommandArgsSchema } from "../contracts/command-args";
import type { CommandExecutionResult } from "../contracts/cli-contract";
import { bestEffortRememberCompanionMemory } from "../companion-memory/remember";
import { parseCliArgs } from "../core/cli-args";
import { runCliMutation } from "../core/cli-mutation";
import { buildTerminalLeafHelp } from "../core/command-registry";
import type {
  IdentityAndTimeConfig,
  RuntimeHostConfig,
  SchemaAndTemplateConfig,
  WorkspacePathsConfig,
} from "../core/config-slices";
import { buildReview, writeReview } from "../review/review";
import type { ReviewDraft } from "../review/review-types";

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

type ReviewConfig = Partial<
  Pick<WorkspacePathsConfig, "cliIdempotencyLedgerFile" | "diaryDir" | "workspaceRoot">
  & Pick<IdentityAndTimeConfig, "timezone">
  & Pick<RuntimeHostConfig, "hermesCommand" | "runtimeCommand" | "runtimeEndpoint">
  & Pick<SchemaAndTemplateConfig, "reviewSchemaConfigFile" | "reviewSemanticHost" | "reviewSemanticMode" | "reviewSemanticModel" | "reviewSemanticTimeoutMs">
  & {
    reviewSemanticGenerator?: unknown;
  }
>;

async function runReviewCommand(config: ReviewConfig, kind: ReviewKind, args: string[] = []) {
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
      const memorySummary = buildReviewMemorySummary(preview.draft);
      if (memorySummary) {
        await bestEffortRememberCompanionMemory(config, {
          options: {
            periodLabel: preview.draft.periodLabel,
            reviewKind: kind,
          },
          source: "review_summary",
          text: memorySummary,
        });
      }
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

function buildReviewMemorySummary(draft: ReviewDraft): string {
  const lines = [
    ...(draft.insights.progress?.length ? [`当前更稳定的推进：${draft.insights.progress.slice(0, 3).join("；")}`] : []),
    ...(draft.insights.friction?.length ? [`反复出现的摩擦：${draft.insights.friction.slice(0, 3).join("；")}`] : []),
    ...(draft.insights.signals?.length ? [`值得带走的信号：${draft.insights.signals.slice(0, 3).join("；")}`] : []),
    ...(draft.insights.carryForward?.length ? [`下一步：${draft.insights.carryForward.slice(0, 3).join("；")}`] : []),
  ];
  return lines.join("\n").trim();
}
