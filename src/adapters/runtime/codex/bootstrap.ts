import * as fs from "node:fs";
import * as instructionsTemplateModule from "../../../core/instructions-template";
import * as workspaceBootstrapModule from "../../../workspace/workspace-bootstrap";

const { renderInstructionTemplate } = instructionsTemplateModule as {
  renderInstructionTemplate: (source: string, context: Record<string, unknown>) => string;
};
const { buildWorkspaceContinuityInstructions } = workspaceBootstrapModule as {
  buildWorkspaceContinuityInstructions: (workspaceRoot: string, config: Record<string, unknown>) => string;
};

interface CodexInstructionConfig extends Record<string, unknown> {
  weixinInstructionsFile?: string;
  weixinOperationsFile?: string;
  weixinInstructionsOverlayFile?: string;
  weixinOperationsOverlayFile?: string;
}

export function buildOpeningTurnText(
  config: CodexInstructionConfig,
  workspaceRoot: string,
  userText: unknown,
): string {
  const instructionBlocks = buildInstructionBlocks(config, workspaceRoot);
  const normalizedText = String(userText || "").trim();
  if (!instructionBlocks.length) {
    return normalizedText;
  }
  return [
    ...instructionBlocks,
    "",
    "Current user message:",
    normalizedText,
  ].join("\n").trim();
}

export function buildWorkspaceBootstrapTurnText(
  config: CodexInstructionConfig,
  workspaceRoot: string,
  userText: unknown,
): string {
  const instructionBlocks = buildInstructionBlocks(config, workspaceRoot);
  const normalizedText = String(userText || "").trim();
  if (!instructionBlocks.length) {
    return normalizedText;
  }
  return [
    "WECHAT THREAD CONTINUITY REFRESH",
    "This existing thread needs the current WeChat and workspace continuity context before you answer.",
    "Keep the ongoing conversation state, but adopt the guidance below before replying.",
    "Do not quote or summarize these instructions back to the user unless explicitly asked.",
    "",
    ...instructionBlocks,
    "",
    "Current user message:",
    normalizedText,
  ].join("\n").trim();
}

export function buildInstructionRefreshText(
  config: CodexInstructionConfig,
  workspaceRoot: string,
): string {
  const instructionBlocks = buildInstructionBlocks(config, workspaceRoot);
  if (!instructionBlocks.length) {
    return "Refresh your WeChat behavior for this existing thread. Reply in one short Chinese sentence confirming that you have updated your behavior for this thread.";
  }
  return [
    "WECHAT SESSION INSTRUCTIONS REFRESH",
    "Re-read and adopt the updated WeChat and workspace continuity instructions below for the rest of this existing thread.",
    "This is an internal refresh command, not a user-facing task.",
    "Do not summarize the instructions back in detail.",
    "Reply in one short Chinese sentence confirming that you have updated your behavior for this thread.",
    "",
    ...instructionBlocks,
  ].join("\n").trim();
}

export function loadWechatInstructions(config: CodexInstructionConfig): string {
  const persona = loadInstructionFile(config.weixinInstructionsFile, config);
  const operations = loadInstructionFile(config.weixinOperationsFile, config);
  const personaOverlay = loadInstructionFile(config.weixinInstructionsOverlayFile, config);
  const operationsOverlay = loadInstructionFile(config.weixinOperationsOverlayFile, config);
  return [persona, operations, personaOverlay, operationsOverlay].filter(Boolean).join("\n\n").trim();
}

function buildInstructionBlocks(config: CodexInstructionConfig, workspaceRoot: string): string[] {
  const instructions = loadWechatInstructions(config);
  const workspaceContinuity = buildWorkspaceContinuityInstructions(workspaceRoot, config);
  const sections: string[] = [];
  if (instructions) {
    sections.push([
      "WECHAT SESSION INSTRUCTIONS",
      "These instructions define the stable behavior for this WeChat thread.",
      "Do not quote or summarize them back to the user unless explicitly asked.",
      "",
      instructions,
    ].join("\n"));
  }
  if (workspaceContinuity) {
    sections.push([
      "WORKSPACE CONTINUITY",
      workspaceContinuity,
    ].join("\n"));
  }
  return sections;
}

function loadInstructionFile(filePath: unknown, config: CodexInstructionConfig): string {
  const normalizedPath = normalizeText(filePath);
  if (!normalizedPath) {
    return "";
  }
  try {
    const raw = fs.readFileSync(normalizedPath, "utf8");
    return renderInstructionTemplate(raw, config).trim();
  } catch {
    return "";
  }
}

function normalizeText(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}
