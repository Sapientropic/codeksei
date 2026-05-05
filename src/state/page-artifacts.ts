import * as crypto from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";
import {
  chunkReplyText,
  normalizePlainTextForWeixin,
} from "../adapters/channel/weixin/delivery-text";
import {
  ensureParentDirectory,
  readManagedJsonStateFile,
  writeManagedJsonStateFile,
  writeManagedTextStateFile,
} from "./json-state";

export type PageArtifactSourceKind = "mcp_tool_result" | "weixin_reply";

export interface PageArtifact {
  id: string;
  sourceKind: PageArtifactSourceKind;
  sourceName: string;
  runtimeId: string;
  workspaceRoot: string;
  bindingKey: string;
  threadId: string;
  userId: string;
  contextToken: string;
  createdAt: string;
  expiresAt: string;
  pageChars: number;
  totalChars: number;
  totalPages: number;
  pages: string[];
  metadata: Record<string, unknown>;
}

export interface PageArtifactResourceListItem {
  uri: string;
  name: string;
  description: string;
  mimeType: "text/plain";
  size: number;
  annotations: {
    audience: ["assistant"];
    priority: number;
  };
  _meta: {
    artifactId: string;
    page: number;
    totalPages: number;
    sourceKind: PageArtifactSourceKind;
    sourceName: string;
    createdAt: string;
    expiresAt: string;
  };
}

export interface PageArtifactReadResult {
  artifact: PageArtifact;
  page: number;
  text: string;
  uri: string;
  previousUri: string;
  nextUri: string;
}

export interface ActivePagePointer {
  artifactId: string;
  page: number;
}

interface PageArtifactManifestEntry {
  id: string;
  sourceKind: PageArtifactSourceKind;
  sourceName: string;
  runtimeId: string;
  workspaceRoot: string;
  createdAt: string;
  expiresAt: string;
  totalChars: number;
  totalPages: number;
}

interface StoredActivePagePointer extends ActivePagePointer {
  updatedAt: string;
}

interface PageArtifactManifest {
  artifacts: Record<string, PageArtifactManifestEntry>;
  activePointersByBindingKey: Record<string, StoredActivePagePointer>;
}

export interface CreateTextArtifactArgs {
  sourceKind: PageArtifactSourceKind;
  sourceName: string;
  runtimeId: string;
  workspaceRoot: string;
  bindingKey?: string;
  threadId?: string;
  userId?: string;
  contextToken?: string;
  pageChars?: number;
  text: string;
  metadata?: Record<string, unknown>;
}

const MANIFEST_FILE = "manifest.json";
const DEFAULT_TTL_MS = 24 * 60 * 60 * 1000;
const DEFAULT_PAGE_CHARS = 12000;
const MAX_ARTIFACTS = 200;
const MAX_ARTIFACT_CHARS = 2 * 1024 * 1024;
const DEFAULT_RESOURCE_LIST_LIMIT = 25;
const MAX_RESOURCE_LIST_LIMIT = 100;
const ARTIFACT_ID_RE = /^[A-Za-z0-9_-]+$/u;

class PageArtifactStore {
  rootDir: string;
  now: () => Date;
  ttlMs: number;
  maxArtifacts: number;
  maxArtifactChars: number;
  sequence: number;

  constructor({
    rootDir,
    now = () => new Date(),
    ttlMs = DEFAULT_TTL_MS,
    maxArtifacts = MAX_ARTIFACTS,
    maxArtifactChars = MAX_ARTIFACT_CHARS,
  }: {
    rootDir: string;
    now?: () => Date;
    ttlMs?: number;
    maxArtifacts?: number;
    maxArtifactChars?: number;
  }) {
    this.rootDir = String(rootDir || "").trim();
    this.now = now;
    this.ttlMs = normalizePositiveInteger(ttlMs) || DEFAULT_TTL_MS;
    this.maxArtifacts = normalizePositiveInteger(maxArtifacts) || MAX_ARTIFACTS;
    this.maxArtifactChars = normalizePositiveInteger(maxArtifactChars) || MAX_ARTIFACT_CHARS;
    this.sequence = 0;
    fs.mkdirSync(this.rootDir, { recursive: true });
  }

  createTextArtifact(args: CreateTextArtifactArgs): PageArtifact {
    const normalizedText = normalizePlainTextForWeixin(args.text);
    if (normalizedText.length > this.maxArtifactChars) {
      throw new Error(
        `Codeksei page artifact exceeds maximum page artifact size (${normalizedText.length}/${this.maxArtifactChars} chars)`
      );
    }
    const pageChars = normalizePageChars(args.pageChars, DEFAULT_PAGE_CHARS);
    const pages = chunkReplyText(normalizedText, pageChars);
    if (!pages.length && normalizedText) {
      pages.push(normalizedText);
    }
    if (!pages.length) {
      pages.push("");
    }
    const createdAtDate = this.now();
    const createdAt = createdAtDate.toISOString();
    const expiresAt = new Date(createdAtDate.getTime() + this.ttlMs).toISOString();
    const id = this.createArtifactId(createdAtDate);
    const artifact: PageArtifact = {
      id,
      sourceKind: args.sourceKind,
      sourceName: normalizeString(args.sourceName) || args.sourceKind,
      runtimeId: normalizeString(args.runtimeId) || "unknown",
      workspaceRoot: normalizeWorkspaceRoot(args.workspaceRoot),
      bindingKey: normalizeString(args.bindingKey),
      threadId: normalizeString(args.threadId),
      userId: normalizeString(args.userId),
      contextToken: normalizeString(args.contextToken),
      createdAt,
      expiresAt,
      pageChars,
      totalChars: normalizedText.length,
      totalPages: pages.length,
      pages,
      metadata: isPlainRecord(args.metadata) ? { ...args.metadata } : {},
    };

    this.prune();
    writeManagedJsonStateFile(this.artifactPath(id), artifact);
    const manifest = this.readManifest();
    manifest.artifacts[id] = artifactToManifestEntry(artifact);
    this.writeManifest(this.pruneManifest(manifest));
    return artifact;
  }

  getArtifact(artifactId: unknown): PageArtifact | null {
    const id = normalizeArtifactId(artifactId);
    if (!id) {
      return null;
    }
    const artifact = readManagedJsonStateFile<PageArtifact | null>({
      filePath: this.artifactPath(id),
      fallback: null,
      label: "page artifact",
      validate: validatePageArtifact,
    });
    if (!artifact || isExpired(artifact, this.now())) {
      return null;
    }
    return artifact;
  }

  readTextResourcePage(uri: unknown): PageArtifactReadResult | null {
    const parsed = parsePageArtifactUri(uri);
    if (!parsed) {
      return null;
    }
    const artifact = this.getArtifact(parsed.artifactId);
    if (!artifact) {
      return null;
    }
    const page = parsed.page;
    if (page < 1 || page > artifact.totalPages) {
      return null;
    }
    return {
      artifact,
      page,
      text: artifact.pages[page - 1] || "",
      uri: buildPageArtifactUri(artifact.id, page),
      previousUri: page > 1 ? buildPageArtifactUri(artifact.id, page - 1) : "",
      nextUri: page < artifact.totalPages ? buildPageArtifactUri(artifact.id, page + 1) : "",
    };
  }

  readFullText(artifactId: unknown): string {
    const artifact = this.getArtifact(artifactId);
    return artifact ? artifact.pages.join("\n\n") : "";
  }

  writeFullTextFile(artifactId: unknown): string {
    const artifact = this.getArtifact(artifactId);
    if (!artifact) {
      return "";
    }
    const safeName = `${artifact.id}.txt`;
    const filePath = path.join(this.rootDir, safeName);
    writeManagedTextStateFile(filePath, artifact.pages.join("\n\n"));
    return filePath;
  }

  listResources({
    runtimeId,
    workspaceRoot,
    limit = DEFAULT_RESOURCE_LIST_LIMIT,
    cursor = "",
  }: {
    runtimeId: string;
    workspaceRoot: string;
    limit?: number;
    cursor?: string;
  }): { resources: PageArtifactResourceListItem[]; nextCursor: string } {
    const offset = decodeCursor(cursor);
    const pageLimit = clampInteger(limit, 1, MAX_RESOURCE_LIST_LIMIT, DEFAULT_RESOURCE_LIST_LIMIT);
    const normalizedRuntimeId = normalizeString(runtimeId) || "unknown";
    const normalizedWorkspaceRoot = normalizeWorkspaceRoot(workspaceRoot);
    const manifest = this.pruneManifest(this.readManifest());
    this.writeManifest(manifest);
    const entries = Object.values(manifest.artifacts)
      .filter((entry) => entry.runtimeId === normalizedRuntimeId)
      .filter((entry) => normalizeWorkspaceRoot(entry.workspaceRoot) === normalizedWorkspaceRoot)
      .sort((left, right) => compareEntriesByRecent(left, right));
    const pageEntries = entries.slice(offset, offset + pageLimit);
    const nextOffset = offset + pageEntries.length;
    return {
      resources: pageEntries.map((entry) => manifestEntryToResource(entry)),
      nextCursor: nextOffset < entries.length ? encodeCursor({ offset: nextOffset }) : "",
    };
  }

  activatePointer(bindingKey: unknown, artifactId: unknown, page: unknown): void {
    const key = normalizeString(bindingKey);
    const id = normalizeArtifactId(artifactId);
    if (!key || !id) {
      return;
    }
    const artifact = this.getArtifact(id);
    if (!artifact) {
      return;
    }
    const normalizedPage = clampInteger(page, 1, artifact.totalPages, 1);
    const manifest = this.readManifest();
    manifest.activePointersByBindingKey[key] = {
      artifactId: id,
      page: normalizedPage,
      updatedAt: this.now().toISOString(),
    };
    this.writeManifest(manifest);
  }

  getActivePointer(bindingKey: unknown): ActivePagePointer | null {
    const key = normalizeString(bindingKey);
    if (!key) {
      return null;
    }
    const manifest = this.readManifest();
    const pointer = manifest.activePointersByBindingKey[key];
    if (!pointer) {
      return null;
    }
    const artifact = this.getArtifact(pointer.artifactId);
    if (!artifact) {
      delete manifest.activePointersByBindingKey[key];
      this.writeManifest(manifest);
      return null;
    }
    const page = clampInteger(pointer.page, 1, artifact.totalPages, 1);
    return {
      artifactId: artifact.id,
      page,
    };
  }

  clearActivePointer(bindingKey: unknown): void {
    const key = normalizeString(bindingKey);
    if (!key) {
      return;
    }
    const manifest = this.readManifest();
    if (!(key in manifest.activePointersByBindingKey)) {
      return;
    }
    delete manifest.activePointersByBindingKey[key];
    this.writeManifest(manifest);
  }

  private createArtifactId(createdAt: Date): string {
    const sequence = this.sequence;
    this.sequence += 1;
    return [
      "pg",
      createdAt.getTime().toString(36),
      sequence.toString(36).padStart(4, "0"),
      crypto.randomUUID().replace(/-/gu, "").slice(0, 12),
    ].join("_");
  }

  private artifactPath(artifactId: string): string {
    return path.join(this.rootDir, `${artifactId}.json`);
  }

  private manifestPath(): string {
    return path.join(this.rootDir, MANIFEST_FILE);
  }

  private readManifest(): PageArtifactManifest {
    ensureParentDirectory(this.manifestPath());
    const manifest = readManagedJsonStateFile<PageArtifactManifest>({
      filePath: this.manifestPath(),
      fallback: createEmptyManifest(),
      label: "page artifact manifest",
      validate: validateManifest,
    });
    return normalizeManifest(manifest);
  }

  private writeManifest(manifest: PageArtifactManifest): void {
    writeManagedJsonStateFile(this.manifestPath(), normalizeManifest(manifest));
  }

  private prune(): void {
    this.writeManifest(this.pruneManifest(this.readManifest()));
  }

  private pruneManifest(manifest: PageArtifactManifest): PageArtifactManifest {
    const now = this.now();
    const next = normalizeManifest(manifest);
    for (const [id, entry] of Object.entries(next.artifacts)) {
      if (Date.parse(entry.expiresAt) <= now.getTime()) {
        delete next.artifacts[id];
        deleteArtifactFile(this.artifactPath(id));
      }
    }
    const ordered = Object.values(next.artifacts).sort((left, right) => compareEntriesByRecent(left, right));
    for (const entry of ordered.slice(this.maxArtifacts)) {
      delete next.artifacts[entry.id];
      deleteArtifactFile(this.artifactPath(entry.id));
    }
    for (const [key, pointer] of Object.entries(next.activePointersByBindingKey)) {
      if (!next.artifacts[pointer.artifactId]) {
        delete next.activePointersByBindingKey[key];
      }
    }
    return next;
  }
}

function buildPageArtifactUri(artifactId: unknown, page: unknown = 1): string {
  const id = normalizeArtifactId(artifactId);
  const normalizedPage = normalizePositiveInteger(page) || 1;
  return `codeksei://mcp/tool-result/${encodeURIComponent(id)}?page=${normalizedPage}`;
}

function parsePageArtifactUri(uri: unknown): { artifactId: string; page: number } | null {
  const normalized = normalizeString(uri);
  if (!normalized) {
    return null;
  }
  try {
    const parsed = new URL(normalized);
    if (parsed.protocol !== "codeksei:" || parsed.hostname !== "mcp") {
      return null;
    }
    const match = /^\/tool-result\/([^/]+)$/u.exec(parsed.pathname);
    if (!match) {
      return null;
    }
    const artifactId = normalizeArtifactId(decodeURIComponent(match[1] || ""));
    const page = normalizePositiveInteger(parsed.searchParams.get("page")) || 1;
    if (!artifactId || page < 1) {
      return null;
    }
    return { artifactId, page };
  } catch {
    return null;
  }
}

function formatWeixinPageMessage(result: Pick<PageArtifactReadResult, "artifact" | "page" | "text">): string {
  const page = result.page;
  const totalPages = result.artifact.totalPages;
  const header = page === 1
    ? `内容较长，先发第 1/${totalPages} 页`
    : `第 ${page}/${totalPages} 页`;
  return [
    header,
    result.text,
    `第 ${page}/${totalPages} 页 · /more 下一页 · /prev 上一页 · /page 3 跳页 · /full 全文 · /done 收起`,
  ].join("\n\n");
}

function formatMcpPageSummary(result: PageArtifactReadResult): string {
  const parts = [
    `Codeksei tool result is long; page ${result.page}/${result.artifact.totalPages} is inline below.`,
    result.text,
    `resource: ${result.uri}`,
  ];
  if (result.nextUri) {
    parts.push(`nextUri: ${result.nextUri}`);
  }
  return parts.join("\n\n");
}

function manifestEntryToResource(entry: PageArtifactManifestEntry): PageArtifactResourceListItem {
  return {
    uri: buildPageArtifactUri(entry.id, 1),
    name: `${entry.sourceName} page result`,
    description: `Codeksei ${entry.sourceKind} from ${entry.sourceName}, ${entry.totalPages} page(s).`,
    mimeType: "text/plain",
    size: entry.totalChars,
    annotations: {
      audience: ["assistant"],
      priority: 0.5,
    },
    _meta: {
      artifactId: entry.id,
      page: 1,
      totalPages: entry.totalPages,
      sourceKind: entry.sourceKind,
      sourceName: entry.sourceName,
      createdAt: entry.createdAt,
      expiresAt: entry.expiresAt,
    },
  };
}

function artifactToManifestEntry(artifact: PageArtifact): PageArtifactManifestEntry {
  return {
    id: artifact.id,
    sourceKind: artifact.sourceKind,
    sourceName: artifact.sourceName,
    runtimeId: artifact.runtimeId,
    workspaceRoot: artifact.workspaceRoot,
    createdAt: artifact.createdAt,
    expiresAt: artifact.expiresAt,
    totalChars: artifact.totalChars,
    totalPages: artifact.totalPages,
  };
}

function createEmptyManifest(): PageArtifactManifest {
  return {
    artifacts: {},
    activePointersByBindingKey: {},
  };
}

function normalizeManifest(value: PageArtifactManifest): PageArtifactManifest {
  const source: Record<string, unknown> = isPlainRecord(value) ? value : {};
  return {
    artifacts: normalizeRecordOfObjects(source.artifacts) as unknown as Record<string, PageArtifactManifestEntry>,
    activePointersByBindingKey: normalizeRecordOfObjects(source.activePointersByBindingKey) as unknown as Record<string, StoredActivePagePointer>,
  };
}

function validateManifest(value: unknown): true | string {
  if (!isPlainRecord(value)) {
    return "page artifact manifest must be an object";
  }
  if ("artifacts" in value && !isPlainRecord(value.artifacts)) {
    return "page artifact manifest artifacts must be an object";
  }
  if ("activePointersByBindingKey" in value && !isPlainRecord(value.activePointersByBindingKey)) {
    return "page artifact manifest active pointers must be an object";
  }
  return true;
}

function validatePageArtifact(value: unknown): true | string {
  if (!isPlainRecord(value)) {
    return "page artifact must be an object";
  }
  if (!normalizeArtifactId(value.id)) {
    return "page artifact id must be valid";
  }
  if (!Array.isArray(value.pages)) {
    return "page artifact pages must be an array";
  }
  return true;
}

function normalizeRecordOfObjects(value: unknown): Record<string, Record<string, unknown>> {
  if (!isPlainRecord(value)) {
    return {};
  }
  const next: Record<string, Record<string, unknown>> = {};
  for (const [key, entry] of Object.entries(value)) {
    if (isPlainRecord(entry)) {
      next[key] = entry;
    }
  }
  return next;
}

function compareEntriesByRecent(left: PageArtifactManifestEntry, right: PageArtifactManifestEntry): number {
  const rightTime = Date.parse(right.createdAt);
  const leftTime = Date.parse(left.createdAt);
  if (rightTime !== leftTime) {
    return rightTime - leftTime;
  }
  return right.id.localeCompare(left.id);
}

function encodeCursor(payload: { offset: number }): string {
  return Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
}

function decodeCursor(cursor: unknown): number {
  const normalized = normalizeString(cursor);
  if (!normalized) {
    return 0;
  }
  try {
    const parsed = JSON.parse(Buffer.from(normalized, "base64url").toString("utf8")) as unknown;
    if (!isPlainRecord(parsed)) {
      throw new Error("cursor payload must be an object");
    }
    const offset = Number(parsed.offset);
    if (!Number.isInteger(offset) || offset < 0) {
      throw new Error("cursor offset must be a non-negative integer");
    }
    return offset;
  } catch {
    throw new Error("Invalid resource cursor");
  }
}

function isExpired(artifact: PageArtifact, now: Date): boolean {
  return Date.parse(artifact.expiresAt) <= now.getTime();
}

function deleteArtifactFile(filePath: string): void {
  try {
    fs.rmSync(filePath, { force: true });
  } catch {
    // Artifact cleanup is best effort; read paths still validate manifest entries.
  }
}

function normalizeArtifactId(value: unknown): string {
  const normalized = normalizeString(value);
  return ARTIFACT_ID_RE.test(normalized) ? normalized : "";
}

function normalizePageChars(value: unknown, fallback: number): number {
  return clampInteger(value, 1, MAX_ARTIFACT_CHARS, fallback);
}

function clampInteger(value: unknown, min: number, max: number, fallback: number): number {
  const numeric = normalizePositiveInteger(value);
  if (!numeric) {
    return fallback;
  }
  return Math.min(max, Math.max(min, numeric));
}

function normalizePositiveInteger(value: unknown): number {
  const numeric = Number(value);
  return Number.isInteger(numeric) && numeric > 0 ? numeric : 0;
}

function normalizeWorkspaceRoot(value: unknown): string {
  return normalizeString(value).replace(/\\/gu, "/").replace(/\/+$/u, "");
}

function normalizeString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export {
  DEFAULT_PAGE_CHARS as DEFAULT_PAGE_ARTIFACT_PAGE_CHARS,
  DEFAULT_RESOURCE_LIST_LIMIT,
  DEFAULT_TTL_MS as DEFAULT_PAGE_ARTIFACT_TTL_MS,
  MAX_ARTIFACT_CHARS as MAX_PAGE_ARTIFACT_CHARS,
  PageArtifactStore,
  buildPageArtifactUri,
  formatMcpPageSummary,
  formatWeixinPageMessage,
  parsePageArtifactUri,
};
