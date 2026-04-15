import * as fs from "node:fs";

import type { CommandExecutionResult } from "../contracts/cli-contract";
import { getCommandArgsSchema } from "../contracts/command-args";
import { parseCliArgs } from "../core/cli-args";
import { buildTerminalLeafHelp } from "../core/command-registry";
import { normalizeLineEndings } from "../core/text-normalization";
import { resolveRepoHermesSkillAssetPath } from "../host/recipes/hermes/skill";
import { renderHermesCompanionSkill } from "../host/renderers/hermes-skill";

interface HostRenderOptions {
  help: boolean;
  provider: string;
  target: string;
  validate: boolean;
}

export async function runHostRenderCommand(
  _config: unknown,
  args: string[] = [],
): Promise<CommandExecutionResult> {
  const options = parseCliArgs<HostRenderOptions>(args, getCommandArgsSchema("hostRender"));
  if (options.help) {
    return {
      data: null,
      text: buildTerminalLeafHelp("host.render"),
    };
  }

  if (options.provider !== "hermes" || options.target !== "skill") {
    return {
      ok: "partial",
      data: {
        provider: options.provider,
        target: options.target,
        supported: false,
      },
      text: `host render currently only supports --provider hermes --target skill`,
    };
  }

  const rendered = renderHermesCompanionSkill();
  const templatePath = resolveRepoHermesSkillAssetPath();
  const tracked = fs.existsSync(templatePath)
    ? fs.readFileSync(templatePath, "utf8")
    : "";
  const matchesTrackedTemplate = normalizeLineEndings(tracked) === normalizeLineEndings(rendered);
  return {
    ok: options.validate && !matchesTrackedTemplate ? "partial" : true,
    data: {
      provider: "hermes",
      target: "skill",
      rendered,
      templatePath,
      matchesTrackedTemplate,
    },
    text: rendered,
  };
}
