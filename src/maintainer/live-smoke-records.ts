import * as fs from "node:fs";
import * as path from "node:path";

type SmokeKind = "approval" | "attach" | "reply";
type ReplyMode = "both" | "settled" | "stream";
type SmokeResult = "failed" | "passed";

export interface LiveSmokeRecordInput {
  checkpoints?: string[];
  commit?: string;
  evidenceSummary?: string;
  kind: SmokeKind;
  mode?: ReplyMode | "";
  notes?: string;
  operator?: string;
  recordedAt?: string;
  result: SmokeResult;
}

export interface LiveSmokeRecord {
  archiveFileName: string;
  checkpoints: string[];
  commit: string;
  evidenceSummary: string;
  kind: SmokeKind;
  mode: ReplyMode | "";
  notes: string;
  operator: string;
  recordedAt: string;
  result: SmokeResult;
}

interface LiveSmokeSummaryOptions {
  historyFiles: string[];
  latest: LiveSmokeRecord | null;
}

const LIVE_SMOKE_SUMMARY_PATH = path.join("docs", "maintainer", "live-smoke.md");
const LIVE_SMOKE_ARCHIVE_DIR = path.join("docs", "maintainer", "live-smoke", "archive");
const LIVE_SMOKE_ARCHIVE_README = path.join(LIVE_SMOKE_ARCHIVE_DIR, "README.md");

export function ensureLiveSmokeDocs(rootDir: string): void {
  const archiveDir = path.join(rootDir, LIVE_SMOKE_ARCHIVE_DIR);
  fs.mkdirSync(archiveDir, { recursive: true });
  const archiveReadmePath = path.join(rootDir, LIVE_SMOKE_ARCHIVE_README);
  if (!fs.existsSync(archiveReadmePath)) {
    fs.writeFileSync(archiveReadmePath, buildArchiveReadme(), "utf8");
  }
  const summaryPath = path.join(rootDir, LIVE_SMOKE_SUMMARY_PATH);
  if (!fs.existsSync(summaryPath)) {
    fs.writeFileSync(summaryPath, renderLiveSmokeSummary({ latest: null, historyFiles: [] }), "utf8");
  }
}

export function writeLiveSmokeRecord(
  rootDir: string,
  input: LiveSmokeRecordInput,
): { archivePath: string; record: LiveSmokeRecord; summaryPath: string } {
  ensureLiveSmokeDocs(rootDir);

  const record = normalizeLiveSmokeRecord(input);
  const archivePath = path.join(rootDir, LIVE_SMOKE_ARCHIVE_DIR, record.archiveFileName);
  fs.writeFileSync(archivePath, renderLiveSmokeArchive(record), "utf8");

  const historyFiles = listLiveSmokeHistoryFiles(rootDir);
  const summaryPath = path.join(rootDir, LIVE_SMOKE_SUMMARY_PATH);
  fs.writeFileSync(summaryPath, renderLiveSmokeSummary({ latest: record, historyFiles }), "utf8");

  return {
    archivePath,
    record,
    summaryPath,
  };
}

export function listLiveSmokeHistoryFiles(rootDir: string): string[] {
  const archiveDir = path.join(rootDir, LIVE_SMOKE_ARCHIVE_DIR);
  if (!fs.existsSync(archiveDir)) {
    return [];
  }
  return fs.readdirSync(archiveDir)
    .filter((entry) => entry.endsWith(".md") && entry !== "README.md")
    .sort()
    .reverse();
}

export function renderLiveSmokeSummary({ latest, historyFiles }: LiveSmokeSummaryOptions): string {
  const lines = [
    "# Maintainer Live Smoke",
    "",
    "这里是 maintainer assisted live smoke 的稳定结果入口。",
    "",
    "它只记录真实 WeChat / shared-session 环境下的 recorded run。",
    "`check` / `verify` 的仓内自动化证明仍留在代码与测试层，不在这里冒充 live 环境结论。",
  ];

  if (!latest) {
    lines.push(
      "",
      "## 当前状态",
      "",
      "尚无 recorded live smoke 证据。",
      "这表示仓内自动化和真实环境证明还没有在同一入口上持续收口；当前不能据此宣称真实 WeChat / shared-session 现场稳定。",
      "",
      "补证方式：",
      "",
      "- `npm run smoke:shared:real:attach -- --record`",
      "- `npm run smoke:shared:real:reply -- --mode stream|settled|both --record`",
      "- `npm run smoke:shared:real:approval -- --record`",
      "",
      `历史归档目录见：[archive README](./live-smoke/archive/README.md)`,
    );
    return `${lines.join("\n")}\n`;
  }

  lines.push(
    "",
    "## 最新记录",
    "",
    `- 记录时间：\`${latest.recordedAt}\``,
    `- 结果：\`${latest.result}\``,
    `- 类型：\`${latest.kind}\`${latest.mode ? `（mode=\`${latest.mode}\`）` : ""}`,
    `- Commit：\`${latest.commit}\``,
    `- 证据摘要：${latest.evidenceSummary}`,
  );
  if (latest.operator) {
    lines.push(`- Maintainer：${latest.operator}`);
  }
  if (latest.notes) {
    lines.push(`- 备注：${latest.notes}`);
  }
  if (latest.checkpoints.length) {
    lines.push(`- Checkpoints：${latest.checkpoints.map((item) => `\`${item}\``).join("、")}`);
  }
  lines.push(`- 归档：[\`${latest.archiveFileName}\`](./live-smoke/archive/${latest.archiveFileName})`);

  lines.push(
    "",
    "## 历史",
    "",
  );
  if (!historyFiles.length) {
    lines.push("- 当前只有这一条 recorded run。");
  } else {
    for (const fileName of historyFiles) {
      lines.push(`- [\`${fileName}\`](./live-smoke/archive/${fileName})`);
    }
  }

  return `${lines.join("\n")}\n`;
}

function renderLiveSmokeArchive(record: LiveSmokeRecord): string {
  const lines = [
    "# Live Smoke Record",
    "",
    `- 记录时间：\`${record.recordedAt}\``,
    `- 结果：\`${record.result}\``,
    `- 类型：\`${record.kind}\`${record.mode ? `（mode=\`${record.mode}\`）` : ""}`,
    `- Commit：\`${record.commit}\``,
    `- 命令：\`${buildSmokeCommand(record.kind, record.mode)}\``,
    `- 证据摘要：${record.evidenceSummary}`,
  ];

  if (record.operator) {
    lines.push(`- Maintainer：${record.operator}`);
  }
  if (record.notes) {
    lines.push(`- 备注：${record.notes}`);
  }
  if (record.checkpoints.length) {
    lines.push(`- Checkpoints：${record.checkpoints.map((item) => `\`${item}\``).join("、")}`);
  }

  return `${lines.join("\n")}\n`;
}

function normalizeLiveSmokeRecord(input: LiveSmokeRecordInput): LiveSmokeRecord {
  const kind = input.kind;
  const mode = kind === "reply" ? normalizeReplyMode(input.mode) : "";
  const result = input.result === "failed" ? "failed" : "passed";
  const recordedAt = normalizeIsoTimestamp(input.recordedAt) || new Date().toISOString();
  const checkpoints = Array.isArray(input.checkpoints)
    ? input.checkpoints
      .map((item) => normalizeCheckpoint(item))
      .filter(Boolean)
    : [];
  const archiveFileName = buildArchiveFileName(recordedAt, kind, mode, result);

  return {
    archiveFileName,
    checkpoints,
    commit: normalizeCommit(input.commit),
    evidenceSummary: sanitizeSmokeText(input.evidenceSummary) || "无额外证据摘要。",
    kind,
    mode,
    notes: sanitizeSmokeText(input.notes),
    operator: sanitizeSmokeText(input.operator),
    recordedAt,
    result,
  };
}

function buildArchiveFileName(
  recordedAt: string,
  kind: SmokeKind,
  mode: ReplyMode | "",
  result: SmokeResult,
): string {
  const timestamp = recordedAt
    .replace(/[:]/g, "-")
    .replace(/\.\d{3}Z$/, "Z");
  return [timestamp, kind, mode, result].filter(Boolean).join("-") + ".md";
}

function buildSmokeCommand(kind: SmokeKind, mode: ReplyMode | ""): string {
  if (kind === "reply") {
    return `npm run smoke:shared:real:reply -- --mode ${mode || "both"} --record`;
  }
  return `npm run smoke:shared:real:${kind} -- --record`;
}

function buildArchiveReadme(): string {
  return [
    "# Live Smoke Archive",
    "",
    "这里存放每次 recorded maintainer live smoke 的归档记录。",
    "summary 入口统一看 [`../../live-smoke.md`](../../live-smoke.md)。",
  ].join("\n") + "\n";
}

function normalizeReplyMode(value: unknown): ReplyMode | "" {
  const normalized = typeof value === "string" ? value.trim().toLowerCase() : "";
  return normalized === "stream" || normalized === "settled" || normalized === "both"
    ? normalized
    : "";
}

function normalizeCommit(value: unknown): string {
  const normalized = typeof value === "string" ? value.trim() : "";
  return normalized || "unknown";
}

function normalizeCheckpoint(value: unknown): string {
  const normalized = typeof value === "string" ? value.trim() : "";
  if (!normalized) {
    return "";
  }
  return normalized.replace(/\s+/g, " ");
}

function normalizeIsoTimestamp(value: unknown): string {
  const normalized = typeof value === "string" ? value.trim() : "";
  if (!normalized) {
    return "";
  }
  const parsed = Date.parse(normalized);
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : "";
}

export function sanitizeSmokeText(value: unknown): string {
  const normalized = typeof value === "string"
    ? value.replace(/\r\n/g, "\n").trim()
    : "";
  if (!normalized) {
    return "";
  }
  return normalized
    .replace(/\bhttps?:\/\/\S+/giu, "[url]")
    .replace(/\b[A-Za-z]:[\\/][^\s]+/gu, "[path]")
    .replace(/(^|[\s(])\/(?:[^/\s]+\/)+[^\s)]*/gu, "$1[path]")
    .replace(/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/giu, "[id]")
    .replace(/\s+/g, " ")
    .trim();
}

export {
  LIVE_SMOKE_ARCHIVE_DIR,
  LIVE_SMOKE_ARCHIVE_README,
  LIVE_SMOKE_SUMMARY_PATH,
};
