import { normalizeText } from "../../../core/text-normalization";
import * as fs from "node:fs";
import * as path from "node:path";
import { renderInstructionTemplate } from "../../../core/instructions-template";
import { buildWorkspaceContinuityInstructions } from "../../../workspace/workspace-bootstrap";
import { normalizeCompanionProfileLanguage } from "../../../companion-memory/profile-signal-contracts";
import { resolveCompanionProfileSignals } from "../../../companion-memory/profile-signals";


interface CodexInstructionConfig {
  allowedUserIds?: unknown;
  codekseiHome?: unknown;
  durableNoteSchemaConfigFile?: unknown;
  senderId?: unknown;
  stateDir?: unknown;
  userGender?: unknown;
  userLanguage?: unknown;
  userName?: unknown;
  weixinInstructionsFile?: string;
  weixinOperationsFile?: string;
  weixinInstructionsOverlayFile?: string;
  weixinOperationsOverlayFile?: string;
  workspaceBootstrapConfigFile?: unknown;
  workspaceRoot?: unknown;
}

export function buildOpeningTurnText(
  config: CodexInstructionConfig,
  workspaceRoot: string,
  userText: unknown,
  senderId: unknown = "",
): string {
  const instructionBlocks = buildInstructionBlocks({ ...config, senderId }, workspaceRoot);
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
  senderId: unknown = "",
): string {
  const instructionBlocks = buildInstructionBlocks({ ...config, senderId }, workspaceRoot);
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
  senderId: unknown = "",
): string {
  const instructionBlocks = buildInstructionBlocks({ ...config, senderId }, workspaceRoot);
  const language = resolvePreferredInstructionLanguage(config, senderId);
  const confirmationLine = language === "en"
    ? "Reply in one short English sentence confirming that you have updated your behavior for this thread."
    : "Reply in one short Chinese sentence confirming that you have updated your behavior for this thread.";
  if (!instructionBlocks.length) {
    return `Refresh your WeChat behavior for this existing thread. ${confirmationLine}`;
  }
  return [
    "WECHAT SESSION INSTRUCTIONS REFRESH",
    "Re-read and adopt the updated WeChat and workspace continuity instructions below for the rest of this existing thread.",
    "This is an internal refresh command, not a user-facing task.",
    "Do not summarize the instructions back in detail.",
    confirmationLine,
    "",
    ...instructionBlocks,
  ].join("\n").trim();
}

export function loadWechatInstructions(config: CodexInstructionConfig): string {
  const language = resolvePreferredInstructionLanguage(config, config.senderId);
  const persona = loadInstructionFile(config.weixinInstructionsFile, config, language);
  const operations = loadInstructionFile(config.weixinOperationsFile, config, language);
  const personaOverlay = loadInstructionFile(config.weixinInstructionsOverlayFile, config, language);
  const operationsOverlay = loadInstructionFile(config.weixinOperationsOverlayFile, config, language);
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

function loadInstructionFile(
  filePath: unknown,
  config: CodexInstructionConfig,
  language: "zh-CN" | "en",
): string {
  const normalizedPath = resolveLanguageAwareInstructionPath(filePath, language);
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

function resolvePreferredInstructionLanguage(
  config: CodexInstructionConfig,
  senderId: unknown = "",
): "zh-CN" | "en" {
  const normalizedSenderId = normalizeText(senderId);
  const signals = resolveCompanionProfileSignals({
    ...config,
    senderId: normalizedSenderId || config.senderId,
  }, normalizedSenderId);
  return normalizeCompanionProfileLanguage(
    signals.preferredLanguage || config.userLanguage,
  ) || "zh-CN";
}

function resolveLanguageAwareInstructionPath(
  filePath: unknown,
  language: "zh-CN" | "en",
): string {
  const normalizedPath = normalizeText(filePath);
  if (!normalizedPath || language !== "en" || /\.en\.md$/iu.test(normalizedPath)) {
    return normalizedPath;
  }
  const extension = path.extname(normalizedPath);
  if (extension.toLowerCase() !== ".md") {
    return normalizedPath;
  }
  const englishVariant = normalizedPath.replace(/\.md$/iu, ".en.md");
  return fs.existsSync(englishVariant) ? englishVariant : normalizedPath;
}

