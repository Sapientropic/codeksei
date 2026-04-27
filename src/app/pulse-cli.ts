import { getCommandArgsSchema } from "../contracts/command-args";
import type { CommandExecutionResult } from "../contracts/cli-contract";
import { parseCliArgs } from "../core/cli-args";
import { buildTerminalLeafHelp } from "../core/command-registry";
import {
  generatePulseRun,
  readOrGeneratePulseRun,
  recordPulseFeedback,
  type PulseConfig,
} from "../pulse/generate";
import type { PulseRun } from "../pulse/contracts";

interface PulseTodayOptions {
  date: string;
  focus: string;
  help: boolean;
  user: string;
  workspace: string;
}

interface PulseFeedbackCliOptions {
  card: string;
  help: boolean;
  kind: string;
  text: string;
  topic: string;
}

export async function runPulseCommand(
  config: PulseConfig,
  args: string[] = [],
): Promise<CommandExecutionResult> {
  const command = normalizePulseSubcommand(args[0]);
  const leafArgs = args.slice(1);
  if (command === "feedback") {
    const options = parseCliArgs<PulseFeedbackCliOptions>(leafArgs, getCommandArgsSchema("pulseFeedback"));
    if (options.help) {
      return { data: null, text: buildTerminalLeafHelp("pulse.feedback") };
    }
    const data = recordPulseFeedback(config, {
      cardId: options.card,
      kind: options.kind,
      text: options.text,
      topic: options.topic,
    });
    return {
      data,
      text: `pulse feedback recorded: ${data.feedback.kind} ${data.feedback.topic}`,
    };
  }
  const schemaKey = command === "today" ? "pulseToday" : "pulseGenerate";
  const options = parseCliArgs<PulseTodayOptions>(leafArgs, getCommandArgsSchema(schemaKey));
  if (options.help) {
    return { data: null, text: buildTerminalLeafHelp(command === "today" ? "pulse.today" : "pulse.generate") };
  }
  const data = command === "today"
    ? readOrGeneratePulseRun(config, options)
    : generatePulseRun(config, options);
  return {
    data,
    text: renderPulseRunText(data),
  };
}

function renderPulseRunText(run: PulseRun): string {
  const lines = [
    `Codeksei Pulse ${run.date}`,
    run.headline,
    "",
  ];
  for (const [index, card] of run.cards.entries()) {
    lines.push(`${index + 1}. ${card.title}`);
    lines.push(`   why: ${card.why}`);
    lines.push(`   next: ${card.suggestedPrompt}`);
  }
  return lines.join("\n");
}

function normalizePulseSubcommand(value: unknown): "feedback" | "generate" | "today" {
  const normalized = String(value || "").trim().toLowerCase();
  if (normalized === "feedback" || normalized === "generate" || normalized === "today") {
    return normalized;
  }
  return "today";
}
