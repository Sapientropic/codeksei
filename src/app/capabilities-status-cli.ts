import { getCommandArgsSchema } from "../contracts/command-args";
import type { CommandExecutionResult } from "../contracts/cli-contract";
import { parseCliArgs } from "../core/cli-args";
import { buildTerminalLeafHelp } from "../core/command-registry";
import { buildCapabilityStatusReport, type CapabilityStatusConfig } from "../capabilities/status";

interface CapabilitiesStatusOptions {
  help: boolean;
  provider: string;
  user: string;
  workspace: string;
}

export async function runCapabilitiesStatusCommand(
  config: CapabilityStatusConfig,
  args: string[] = [],
): Promise<CommandExecutionResult> {
  const options = parseCliArgs<CapabilitiesStatusOptions>(args, getCommandArgsSchema("capabilitiesStatus"));
  if (options.help) {
    return {
      data: null,
      text: buildTerminalLeafHelp("capabilities.status"),
    };
  }
  const report = buildCapabilityStatusReport(config, options);
  return {
    data: report,
    text: renderCapabilityStatusText(report),
  };
}

function renderCapabilityStatusText(report: ReturnType<typeof buildCapabilityStatusReport>): string {
  const lines = [
    `Codeksei capabilities status (${report.host.provider}/${report.host.profile})`,
    `available ${report.summary.available}/${report.summary.total}, blocked ${report.summary.blocked}, degraded ${report.summary.degraded}, unknown ${report.summary.unknown}`,
    "",
  ];
  for (const item of report.capabilities) {
    lines.push([
      `- ${item.id}`,
      item.status,
      item.mutability,
      item.safetyTier,
      item.hostSupportTier,
      item.reasons.length ? `reason: ${item.reasons.join("; ")}` : "reason: ready",
    ].join(" | "));
  }
  return lines.join("\n");
}
