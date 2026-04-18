import type { CliAudience } from "../contracts/cli-contract";
import { CliError, buildValidationError } from "./cli-contract";
import { normalizeText } from "./text-normalization";

type RemovedCommandReason = "removed_public_surface" | "schema_target_not_found";

interface RemovedCommandGuidanceEntry {
  hint: string;
  message: string;
  relatedCommands: readonly string[];
}

interface RemovedCommandGuidance {
  hint: string;
  message: string;
  relatedCommands: string[];
  requestedTarget: string;
}

// Keep this table deliberately small. It is only for command surfaces we have
// explicitly removed but still want agents and humans to recover from cleanly.
const REMOVED_COMMAND_GUIDANCE = Object.freeze<Record<string, RemovedCommandGuidanceEntry>>({
  "operator hermes sync-checkin": Object.freeze({
    message: "`operator hermes sync-checkin` 已移除，不再作为 hosted checkin 的 public/operator glue。",
    hint: "改走 `codeksei host seed-proactive --provider hermes`、`codeksei host claim-checkin --provider hermes`、`codeksei host settle-checkin --provider hermes`。",
    relatedCommands: Object.freeze([
      "codeksei host seed-proactive --provider hermes",
      "codeksei host claim-checkin --provider hermes",
      "codeksei host settle-checkin --provider hermes",
    ]),
  }),
  "system send": Object.freeze({
    message: "`system send` 已移除，不再暴露 public CLI。",
    hint: "如需走当前 public 路径：发文件用 `codeksei channel send-file --path /absolute/path/to/file`；hosted proactive 改走 `codeksei host seed-proactive --provider hermes`、`codeksei host claim-checkin --provider hermes`、`codeksei host settle-checkin --provider hermes`。这些是相关 public 路径，不是 `system send` 的一对一替代。",
    relatedCommands: Object.freeze([
      "codeksei channel send-file --path /absolute/path/to/file",
      "codeksei host seed-proactive --provider hermes",
      "codeksei host claim-checkin --provider hermes",
      "codeksei host settle-checkin --provider hermes",
    ]),
  }),
});

export function findRemovedCommandGuidance(targetTokens: readonly unknown[]): RemovedCommandGuidance | null {
  const matchedTarget = findRemovedCommandTarget(targetTokens);
  if (!matchedTarget) {
    return null;
  }
  const entry = REMOVED_COMMAND_GUIDANCE[matchedTarget];
  return entry ? {
    requestedTarget: matchedTarget,
    message: entry.message,
    hint: entry.hint,
    relatedCommands: [...entry.relatedCommands],
  } : null;
}

export function buildRemovedLiveCommandError(
  targetTokens: readonly unknown[],
  {
    code,
  }: {
    code: "unknown_command" | "validation_error";
  },
): CliError | null {
  const guidance = findRemovedCommandGuidance(targetTokens);
  if (!guidance) {
    return null;
  }
  const context = buildRemovedCommandContext(guidance, "removed_public_surface");
  if (code === "validation_error") {
    return buildValidationError(guidance.message, context, guidance.hint);
  }
  return new CliError({
    code: "unknown_command",
    context,
    exitCode: 3,
    hint: guidance.hint,
    message: guidance.message,
    retryable: false,
  });
}

export function buildSchemaTargetNotFoundError(
  audience: CliAudience,
  targetTokens: readonly unknown[],
): CliError {
  const guidance = findRemovedCommandGuidance(targetTokens);
  if (guidance) {
    return buildValidationError(
      guidance.message,
      buildRemovedCommandContext(guidance, "removed_public_surface"),
      guidance.hint,
    );
  }

  const requestedTarget = formatRequestedTarget(targetTokens);
  const discoveryCommand = audience === "operator"
    ? "codeksei operator schema"
    : "codeksei schema";
  return buildValidationError(
    `不支持的 schema target: ${requestedTarget}`,
    {
      audience,
      requestedTarget,
      reason: "schema_target_not_found",
    },
    `先运行 \`${discoveryCommand}\` 查看当前可用 target。`,
  );
}

function buildRemovedCommandContext(
  guidance: RemovedCommandGuidance,
  reason: RemovedCommandReason,
): Record<string, unknown> {
  return {
    requestedTarget: guidance.requestedTarget,
    reason,
    removed: true,
    relatedCommands: [...guidance.relatedCommands],
  };
}

function findRemovedCommandTarget(targetTokens: readonly unknown[]): string {
  const normalizedTokens = Array.isArray(targetTokens)
    ? targetTokens
      .map((value) => normalizeText(value).toLowerCase())
      .filter(Boolean)
    : [];

  for (let count = normalizedTokens.length; count > 0; count -= 1) {
    const candidate = normalizedTokens.slice(0, count).join(" ");
    if (candidate && candidate in REMOVED_COMMAND_GUIDANCE) {
      return candidate;
    }
  }
  return "";
}

function formatRequestedTarget(targetTokens: readonly unknown[]): string {
  const normalizedTokens = Array.isArray(targetTokens)
    ? targetTokens
      .map((value) => normalizeText(value).toLowerCase())
      .filter(Boolean)
    : [];
  return normalizedTokens.join(" ");
}
