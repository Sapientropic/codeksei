import * as fs from "node:fs";
import * as path from "node:path";

import type {
  TimelineDay,
  TimelineEvent,
  TimelineEventInput,
  TimelineEventNode,
  TimelineEventNodeInput,
  TimelineProposal,
  TimelineReplaceDayInput,
  TimelineSource,
  TimelineSourceInput,
  TimelineState,
  TimelineStatus,
  TimelineStorePaths,
  TimelineTaxonomy,
} from "../../contracts";
import { createDefaultTaxonomy } from "./default-taxonomy";

const CATEGORY_THEME_COLORS: Record<string, string> = {
  life: "var(--cat-life)",
  work: "var(--cat-work)",
  study: "var(--cat-study)",
  exercise: "var(--cat-exercise)",
  entertainment: "var(--cat-entertainment)",
  health: "var(--cat-health)",
  social: "var(--cat-social)",
  care: "var(--cat-care)",
  travel: "var(--cat-travel)",
  rest: "var(--cat-rest)",
};

type TimelineCategoryLookup = {
  categoryId: string;
  label: string;
  color: string;
};

type TimelineMergeDayInternalInput = Omit<TimelineReplaceDayInput, "status"> & {
  dropEventIds?: string[];
  status?: string;
};

class TimelineStore {
  readonly stateFilePath: string;
  readonly taxonomyFilePath: string;
  readonly factsFilePath: string;
  readonly legacyFilePath: string;
  private state: TimelineState;

  constructor({
    stateFilePath = "",
    taxonomyFilePath,
    factsFilePath,
    legacyFilePath = "",
  }: TimelineStorePaths) {
    this.stateFilePath = stateFilePath;
    this.taxonomyFilePath = taxonomyFilePath;
    this.factsFilePath = factsFilePath;
    this.legacyFilePath = legacyFilePath;
    this.state = createEmptyTimelineState();
    this.ensureParentDirectory();
    this.load();
  }

  private ensureParentDirectory(): void {
    if (this.stateFilePath) {
      fs.mkdirSync(path.dirname(this.stateFilePath), { recursive: true });
    }
    fs.mkdirSync(path.dirname(this.taxonomyFilePath), { recursive: true });
    fs.mkdirSync(path.dirname(this.factsFilePath), { recursive: true });
  }

  private load(): void {
    const stateSnapshot = this.stateFilePath ? readJsonFile(this.stateFilePath) : null;
    if (stateSnapshot) {
      this.state = normalizeTimelineState(stateSnapshot);
      return;
    }

    const taxonomy = readJsonFile(this.taxonomyFilePath);
    const facts = readJsonFile(this.factsFilePath);
    if (taxonomy || facts) {
      this.state = normalizeSeparatedTimelineState({ taxonomy, facts });
      this.save();
      return;
    }

    const legacy = this.legacyFilePath ? readJsonFile(this.legacyFilePath) : null;
    if (legacy) {
      this.state = normalizeTimelineState(legacy);
      this.save();
      return;
    }

    this.state = createEmptyTimelineState();
  }

  save(): void {
    if (this.stateFilePath) {
      writeJsonFileAtomic(this.stateFilePath, {
        version: this.state.version,
        timezone: this.state.timezone,
        taxonomy: this.state.taxonomy,
        facts: this.state.facts,
        proposals: this.state.proposals,
      });
    }
    writeJsonFileAtomic(this.taxonomyFilePath, {
      version: this.state.version,
      timezone: this.state.timezone,
      taxonomy: this.state.taxonomy,
    });
    writeJsonFileAtomic(this.factsFilePath, {
      version: this.state.version,
      timezone: this.state.timezone,
      facts: this.state.facts,
      proposals: this.state.proposals,
    });
  }

  getState(): TimelineState {
    return JSON.parse(JSON.stringify(this.state)) as TimelineState;
  }

  getDay(date: string): TimelineDay | null {
    return this.state.facts[String(date || "").trim()] || null;
  }

  upsertEventNodes(
    nodes: unknown,
    { date = "", sourceMessageIds = [] }: { date?: string; sourceMessageIds?: string[] } = {},
  ): void {
    const existingIds = new Set(this.state.taxonomy.eventNodes.map((node) => node.id));
    for (const candidate of Array.isArray(nodes) ? nodes : []) {
      const normalized = normalizeEventNode(candidate);
      if (!normalized || existingIds.has(normalized.id)) {
        continue;
      }
      existingIds.add(normalized.id);
      this.state.taxonomy.eventNodes.push(normalized);
      this.state.proposals.push({
        id: `proposal:${normalized.id}`,
        date: date || "",
        proposedNodeId: normalized.id,
        label: normalized.label,
        parentId: normalized.parentId,
        sourceMessageIds: Array.isArray(sourceMessageIds) ? [...sourceMessageIds] : [],
        createdAt: new Date().toISOString(),
      });
    }
  }

  replaceDay({
    date,
    status = "draft",
    source = null,
    events = [],
    newEventNodes = [],
  }: TimelineReplaceDayInput): TimelineDay | null {
    const normalizedDate = String(date || "").trim();
    if (!normalizedDate) {
      throw new Error("timeline day requires a date");
    }
    this.upsertEventNodes(newEventNodes, {
      date: normalizedDate,
      sourceMessageIds: collectSourceMessageIds(events),
    });

    const normalizedEvents = normalizeDayEvents(events, this.state.taxonomy, { strict: true });
    validateDayEvents(normalizedDate, normalizedEvents, this.state.timezone);
    if (!normalizedEvents.length) {
      delete this.state.facts[normalizedDate];
      this.save();
      return null;
    }

    this.state.facts[normalizedDate] = {
      status: status === "final" ? "final" : "draft",
      updatedAt: new Date().toISOString(),
      source: normalizeSource(source),
      events: normalizedEvents,
    };
    this.save();
    return this.state.facts[normalizedDate] || null;
  }

  mergeDay({
    date,
    status = "" as string,
    source = null,
    events = [],
    newEventNodes = [],
    dropEventIds = [],
  }: TimelineMergeDayInternalInput): TimelineDay | null {
    const normalizedDate = String(date || "").trim();
    if (!normalizedDate) {
      throw new Error("timeline day requires a date");
    }
    this.upsertEventNodes(newEventNodes, {
      date: normalizedDate,
      sourceMessageIds: collectSourceMessageIds(events),
    });

    const currentDay: TimelineDay = this.state.facts[normalizedDate] || {
      status: "draft",
      updatedAt: "",
      source: null,
      events: [],
    };
    const mergedEvents = new Map<string, TimelineEvent>();
    for (const currentEvent of currentDay.events) {
      mergedEvents.set(currentEvent.id, currentEvent);
    }

    const normalizedIncomingEvents = normalizeDayEvents(events, this.state.taxonomy, { strict: true });
    validateDayEvents(normalizedDate, normalizedIncomingEvents, this.state.timezone);
    for (const event of normalizedIncomingEvents) {
      mergedEvents.set(event.id, event);
    }

    for (const eventId of Array.isArray(dropEventIds) ? dropEventIds : []) {
      mergedEvents.delete(String(eventId || "").trim());
    }

    const nextEvents = [...mergedEvents.values()].sort((left, right) => {
      const delta = Date.parse(left.startAt) - Date.parse(right.startAt);
      return delta !== 0 ? delta : left.id.localeCompare(right.id);
    });

    if (!nextEvents.length) {
      delete this.state.facts[normalizedDate];
      this.save();
      return null;
    }

    this.state.facts[normalizedDate] = {
      status: status === "final" ? "final" : (status === "draft" ? "draft" : currentDay.status || "draft"),
      updatedAt: new Date().toISOString(),
      source: normalizeSource(source) || currentDay.source || null,
      events: nextEvents,
    };
    this.save();
    return this.state.facts[normalizedDate] || null;
  }

  finalizeDay(date: string): TimelineDay | null {
    const normalizedDate = String(date || "").trim();
    if (!normalizedDate || !this.state.facts[normalizedDate]) {
      return null;
    }
    this.state.facts[normalizedDate].status = "final";
    this.state.facts[normalizedDate].updatedAt = new Date().toISOString();
    this.save();
    return this.state.facts[normalizedDate] || null;
  }
}

function createEmptyTimelineState(): TimelineState {
  return {
    version: 1,
    timezone: "Asia/Shanghai",
    taxonomy: createDefaultTaxonomy(),
    facts: {},
    proposals: [],
  };
}

function normalizeTimelineState(raw: unknown): TimelineState {
  const empty = createEmptyTimelineState();
  const rawRecord = asRecord(raw);
  const taxonomyRecord = asRecord(rawRecord?.taxonomy) || empty.taxonomy;
  return {
    version: 1,
    timezone: typeof rawRecord?.timezone === "string" && rawRecord.timezone.trim()
      ? rawRecord.timezone.trim()
      : "Asia/Shanghai",
    taxonomy: {
      categories: Array.isArray(taxonomyRecord.categories)
        ? taxonomyRecord.categories.map(normalizeCategory).filter((value): value is NonNullable<typeof value> => value !== null)
        : empty.taxonomy.categories,
      eventNodes: Array.isArray(taxonomyRecord.eventNodes)
        ? taxonomyRecord.eventNodes.map(normalizeEventNode).filter((value): value is NonNullable<typeof value> => value !== null)
        : empty.taxonomy.eventNodes,
    },
    facts: normalizeFacts(rawRecord?.facts),
    proposals: Array.isArray(rawRecord?.proposals)
      ? rawRecord.proposals.map(normalizeProposal).filter((value): value is NonNullable<typeof value> => value !== null)
      : [],
  };
}

function normalizeSeparatedTimelineState({
  taxonomy,
  facts,
}: {
  taxonomy?: unknown;
  facts?: unknown;
}): TimelineState {
  const taxonomyRecord = asRecord(taxonomy);
  const factsRecord = asRecord(facts);
  return normalizeTimelineState({
    version: 1,
    timezone: String(taxonomyRecord?.timezone || factsRecord?.timezone || "Asia/Shanghai"),
    taxonomy: taxonomyRecord?.taxonomy || {},
    facts: factsRecord?.facts || {},
    proposals: factsRecord?.proposals || [],
  });
}

function normalizeFacts(rawFacts: unknown): Record<string, TimelineDay> {
  const output: Record<string, TimelineDay> = {};
  const factsRecord = asRecord(rawFacts);
  if (!factsRecord) {
    return output;
  }
  for (const [date, value] of Object.entries(factsRecord)) {
    const normalizedDate = String(date || "").trim();
    const dayRecord = asRecord(value);
    if (!normalizedDate || !dayRecord) {
      continue;
    }
    output[normalizedDate] = {
      status: dayRecord.status === "final" ? "final" : "draft",
      updatedAt: typeof dayRecord.updatedAt === "string" ? dayRecord.updatedAt : "",
      source: normalizeSource(dayRecord.source),
      events: normalizeDayEvents(dayRecord.events, null),
    };
  }
  return output;
}

function normalizeCategory(category: unknown): { id: string; label: string; color: string; children: Array<{ id: string; label: string }> } | null {
  const categoryRecord = asRecord(category);
  if (!categoryRecord) {
    return null;
  }
  const id = String(categoryRecord.id || "").trim();
  const label = String(categoryRecord.label || "").trim();
  if (!id || !label) {
    return null;
  }
  return {
    id,
    label,
    color: buildCategoryThemeColor(id),
    children: Array.isArray(categoryRecord.children)
      ? categoryRecord.children
        .map((child) => {
          const childRecord = asRecord(child);
          const childId = String(childRecord?.id || "").trim();
          const childLabel = String(childRecord?.label || "").trim();
          return childId && childLabel ? { id: childId, label: childLabel } : null;
        })
        .filter((value): value is { id: string; label: string } => value !== null)
      : [],
  };
}

function normalizeEventNode(node: unknown): TimelineEventNode | null {
  const nodeRecord = asRecord(node);
  if (!nodeRecord) {
    return null;
  }
  const id = String(nodeRecord.id || "").trim();
  const label = String(nodeRecord.label || "").trim();
  const parentId = String(nodeRecord.parentId || "").trim();
  if (!id || !label || !parentId) {
    return null;
  }
  return {
    id,
    label,
    aliases: Array.isArray(nodeRecord.aliases)
      ? nodeRecord.aliases.map((alias) => String(alias || "").trim()).filter(Boolean)
      : [],
    parentId,
    status: nodeRecord.status === "provisional" ? "provisional" : "official",
  };
}

function normalizeProposal(proposal: unknown): TimelineProposal | null {
  const proposalRecord = asRecord(proposal);
  if (!proposalRecord) {
    return null;
  }
  const id = String(proposalRecord.id || "").trim();
  const proposedNodeId = String(proposalRecord.proposedNodeId || "").trim();
  const label = String(proposalRecord.label || "").trim();
  const parentId = String(proposalRecord.parentId || "").trim();
  if (!id || !proposedNodeId || !label || !parentId) {
    return null;
  }
  return {
    id,
    date: String(proposalRecord.date || "").trim(),
    proposedNodeId,
    label,
    parentId,
    sourceMessageIds: Array.isArray(proposalRecord.sourceMessageIds)
      ? proposalRecord.sourceMessageIds.map((value) => String(value || "").trim()).filter(Boolean)
      : [],
    createdAt: typeof proposalRecord.createdAt === "string" ? proposalRecord.createdAt : "",
  };
}

function normalizeDayEvents(
  events: unknown,
  taxonomy: TimelineTaxonomy | null,
  options: { strict?: boolean } = {},
): TimelineEvent[] {
  const categoryMap = buildCategoryMap(taxonomy);
  const nodeMap = buildEventNodeMap(taxonomy);
  const strict = Boolean(options.strict);
  if (!Array.isArray(events)) {
    return [];
  }
  return events.flatMap((event, index) => {
    const result = normalizeEvent(event, index, categoryMap, nodeMap);
    if (result.value) {
      return [result.value];
    }
    if (strict) {
      throw new Error(`timeline 事件无效，第 ${index + 1} 条：${result.error}`);
    }
    return [];
  });
}

function normalizeEvent(
  event: unknown,
  index: number,
  categoryMap: Map<string, TimelineCategoryLookup>,
  nodeMap: Map<string, TimelineEventNode>,
): { value: TimelineEvent | null; error: string } {
  const eventRecord = asRecord(event);
  if (!eventRecord) {
    return { value: null, error: "事件必须是对象" };
  }
  const startAt = normalizeIso(eventRecord.startAt);
  const endAt = normalizeIso(eventRecord.endAt);
  if (!startAt || !endAt || Date.parse(endAt) <= Date.parse(startAt)) {
    return { value: null, error: "startAt/endAt 缺失或时间范围无效" };
  }
  const eventNodeId = String(eventRecord.eventNodeId || "").trim();
  const eventNode = eventNodeId ? nodeMap.get(eventNodeId) || null : null;
  const subcategoryId = String(eventRecord.subcategoryId || eventNode?.parentId || "").trim();
  const categoryId = String(eventRecord.categoryId || deriveCategoryId(subcategoryId, categoryMap) || "").trim();
  if (!subcategoryId || !categoryId) {
    return {
      value: null,
      error: "必须提供 eventNodeId，或至少提供可推导分类的 subcategoryId/categoryId",
    };
  }
  const title = String(eventRecord.title || eventNode?.label || "").trim();
  if (!title) {
    return { value: null, error: "title 缺失，且 eventNodeId 也无法回填标题" };
  }
  return {
    value: {
      id: normalizeEventId(eventRecord, index, title, eventNodeId, startAt),
      startAt,
      endAt,
      title,
      note: String(eventRecord.note || eventRecord.remark || "").trim(),
      categoryId,
      subcategoryId,
      eventNodeId,
      tags: Array.isArray(eventRecord.tags)
        ? eventRecord.tags.map((tag) => String(tag || "").trim()).filter(Boolean)
        : [],
      confidence: normalizeConfidence(eventRecord.confidence),
      sourceMessageIds: Array.isArray(eventRecord.sourceMessageIds)
        ? eventRecord.sourceMessageIds.map((value) => String(value || "").trim()).filter(Boolean)
        : [],
    },
    error: "",
  };
}

function buildCategoryMap(taxonomy: TimelineTaxonomy | null): Map<string, TimelineCategoryLookup> {
  const map = new Map<string, TimelineCategoryLookup>();
  if (!taxonomy?.categories?.length) {
    return map;
  }
  for (const category of taxonomy.categories) {
    map.set(category.id, { categoryId: category.id, label: category.label, color: category.color });
    for (const child of Array.isArray(category.children) ? category.children : []) {
      map.set(child.id, { categoryId: category.id, label: child.label, color: category.color });
    }
  }
  return map;
}

function buildEventNodeMap(taxonomy: TimelineTaxonomy | null): Map<string, TimelineEventNode> {
  const map = new Map<string, TimelineEventNode>();
  if (!taxonomy?.eventNodes?.length) {
    return map;
  }
  for (const node of taxonomy.eventNodes) {
    map.set(node.id, node);
  }
  return map;
}

function deriveCategoryId(subcategoryId: string, categoryMap: Map<string, TimelineCategoryLookup>): string {
  if (!subcategoryId || !categoryMap.size) {
    return "";
  }
  return categoryMap.get(subcategoryId)?.categoryId || "";
}

function normalizeSource(source: unknown): TimelineSource | null {
  const sourceRecord = asRecord(source);
  if (!sourceRecord) {
    return null;
  }
  return {
    threadId: String(sourceRecord.threadId || "").trim(),
    workspaceRoot: String(sourceRecord.workspaceRoot || "").trim(),
    transcriptMessageCount: Number.isFinite(Number(sourceRecord.transcriptMessageCount))
      ? Number(sourceRecord.transcriptMessageCount)
      : 0,
  };
}

function buildCategoryThemeColor(categoryId: string): string {
  return CATEGORY_THEME_COLORS[String(categoryId || "").trim()] || "var(--cat-life)";
}

function normalizeIso(value: unknown): string {
  const raw = String(value || "").trim();
  if (!raw) {
    return "";
  }
  const parsed = Date.parse(raw);
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : "";
}

function normalizeConfidence(value: unknown): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return 0.5;
  }
  return Math.max(0, Math.min(1, parsed));
}

function validateDayEvents(date: string, events: TimelineEvent[], timezone: string): void {
  const normalizedDate = String(date || "").trim();
  const resolvedTimezone = String(timezone || "").trim() || "Asia/Shanghai";
  for (const event of Array.isArray(events) ? events : []) {
    const startDate = formatDateInTimezone(event.startAt, resolvedTimezone);
    const endDate = formatDateInTimezone(event.endAt, resolvedTimezone);
    if (startDate !== normalizedDate || endDate !== normalizedDate) {
      throw new Error(
        `timeline 事件不能跨天，必须落在 ${normalizedDate} 当天内: ${event.title} (${event.startAt} ~ ${event.endAt})`,
      );
    }
  }
}

function formatDateInTimezone(value: string, timezone: string): string {
  try {
    return new Intl.DateTimeFormat("en-CA", {
      timeZone: timezone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(Date.parse(value));
  } catch {
    return "";
  }
}

function collectSourceMessageIds(events: unknown): string[] {
  const ids = new Set<string>();
  for (const event of Array.isArray(events) ? events : []) {
    const eventRecord = asRecord(event);
    for (const messageId of Array.isArray(eventRecord?.sourceMessageIds) ? eventRecord.sourceMessageIds : []) {
      const normalized = String(messageId || "").trim();
      if (normalized) {
        ids.add(normalized);
      }
    }
  }
  return [...ids];
}

function readJsonFile(filePath: string): unknown | null {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8")) as unknown;
  } catch {
    return null;
  }
}

function writeJsonFileAtomic(filePath: string, value: unknown): void {
  const directory = path.dirname(filePath);
  const tempFilePath = path.join(directory, `.${path.basename(filePath)}.${process.pid}.${Date.now()}.tmp`);

  try {
    fs.writeFileSync(tempFilePath, JSON.stringify(value, null, 2));
    fs.renameSync(tempFilePath, filePath);
  } catch (error) {
    try {
      fs.unlinkSync(tempFilePath);
    } catch {
      // Ignore cleanup failures for missing or already-moved temp files.
    }
    throw error;
  }
}

function normalizeEventId(
  event: Record<string, unknown>,
  index: number,
  title: string,
  eventNodeId: string,
  startAt: string,
): string {
  const explicit = String(event.id || "").trim();
  if (explicit) {
    return explicit;
  }
  const key = slugify(eventNodeId || title || `fact_${index + 1}`);
  const timeKey = startAt.replace(/[:.]/g, "-");
  return `fact:${key}:${timeKey}`;
}

function slugify(value: unknown): string {
  const raw = String(value || "").trim().toLowerCase();
  if (!raw) {
    return "event";
  }
  return raw
    .replace(/[^a-z0-9\u4e00-\u9fa5]+/gi, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80) || "event";
}

function asRecord(value: unknown): Record<string, any> | null {
  return value && typeof value === "object" ? (value as Record<string, any>) : null;
}

export {
  TimelineStore,
};
