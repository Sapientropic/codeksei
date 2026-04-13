import * as fs from "node:fs";
import * as path from "node:path";
import { readForeignJsonDocument } from "../state/json-state";
import { asRecord, normalizeText, normalizeTimezone } from "./timezone-shared";

interface TimelineStateFiles {
  dir: string;
  stateFile: string;
  taxonomyFile: string;
  factsFile: string;
}

interface TimelineStateDocument extends Record<string, unknown> {
  timezone?: unknown;
  taxonomy?: unknown;
  facts?: unknown;
  proposals?: unknown;
}

interface TimelineStateSnapshot {
  paths: TimelineStateFiles;
  hasAnyFile: boolean;
  hasFacts: boolean;
  timezone: string;
  stateDoc: TimelineStateDocument | null;
  taxonomyDoc: TimelineStateDocument | null;
  factsDoc: TimelineStateDocument | null;
  taxonomy: Record<string, unknown>;
  facts: Record<string, unknown>;
  proposals: unknown[];
}

function readTimelineStateTimezone(timelineStateDir: string = ""): string {
  const snapshot = loadTimelineStateSnapshot(timelineStateDir);
  return snapshot.timezone;
}

function loadTimelineStateSnapshot(timelineStateDir: string = ""): TimelineStateSnapshot {
  const paths = resolveTimelineStateFiles(timelineStateDir);
  if (!paths.dir) {
    return {
      paths,
      hasAnyFile: false,
      hasFacts: false,
      timezone: "",
      stateDoc: null,
      taxonomyDoc: null,
      factsDoc: null,
      taxonomy: {},
      facts: {},
      proposals: [],
    };
  }

  const stateDoc = readJsonFile(paths.stateFile);
  const taxonomyDoc = readJsonFile(paths.taxonomyFile);
  const factsDoc = readJsonFile(paths.factsFile);
  const facts = readFacts(stateDoc, factsDoc);

  return {
    paths,
    hasAnyFile: Boolean(stateDoc || taxonomyDoc || factsDoc),
    hasFacts: Object.keys(facts).length > 0,
    timezone: normalizeTimezone(stateDoc?.timezone)
      || normalizeTimezone(taxonomyDoc?.timezone)
      || normalizeTimezone(factsDoc?.timezone),
    stateDoc,
    taxonomyDoc,
    factsDoc,
    taxonomy: readTaxonomy(stateDoc, taxonomyDoc),
    facts,
    proposals: readProposals(stateDoc, factsDoc),
  };
}

function resolveTimelineStateFiles(timelineStateDir: string = ""): TimelineStateFiles {
  const normalizedDir = normalizeText(timelineStateDir);
  if (!normalizedDir) {
    return {
      dir: "",
      stateFile: "",
      taxonomyFile: "",
      factsFile: "",
    };
  }

  const baseDir = path.resolve(normalizedDir);
  const nestedDir = path.join(baseDir, "timeline");
  // timeline-for-agent's canonical layout is <stateDir>/timeline/*.json. We
  // still detect legacy direct files for migration, but a fresh root should
  // default to the nested layout so bootstrap, state sync, and the runtime all
  // converge on the same paths.
  const candidates = [nestedDir, baseDir];
  const existingDir = candidates.find(hasAnyTimelineStateFile) || nestedDir;
  return buildTimelineStateFiles(existingDir);
}

function hasAnyTimelineStateFile(dirPath: unknown): boolean {
  const normalizedDir = normalizeText(dirPath);
  if (!normalizedDir) {
    return false;
  }
  const files = buildTimelineStateFiles(normalizedDir);
  return fs.existsSync(files.stateFile)
    || fs.existsSync(files.taxonomyFile)
    || fs.existsSync(files.factsFile);
}

function buildTimelineStateFiles(dirPath: string): TimelineStateFiles {
  return {
    dir: dirPath,
    stateFile: path.join(dirPath, "timeline-state.json"),
    taxonomyFile: path.join(dirPath, "timeline-taxonomy.json"),
    factsFile: path.join(dirPath, "timeline-facts.json"),
  };
}

function readTaxonomy(
  stateDoc: TimelineStateDocument | null,
  taxonomyDoc: TimelineStateDocument | null,
): Record<string, unknown> {
  const fromState = stateDoc?.taxonomy;
  if (fromState && typeof fromState === "object") {
    return asRecord(fromState);
  }
  const fromTaxonomy = taxonomyDoc?.taxonomy;
  return fromTaxonomy && typeof fromTaxonomy === "object" ? asRecord(fromTaxonomy) : {};
}

function readFacts(
  stateDoc: TimelineStateDocument | null,
  factsDoc: TimelineStateDocument | null,
): Record<string, unknown> {
  const fromState = stateDoc?.facts;
  if (fromState && typeof fromState === "object") {
    return asRecord(fromState);
  }
  const fromFacts = factsDoc?.facts;
  return fromFacts && typeof fromFacts === "object" ? asRecord(fromFacts) : {};
}

function readProposals(
  stateDoc: TimelineStateDocument | null,
  factsDoc: TimelineStateDocument | null,
): unknown[] {
  if (Array.isArray(stateDoc?.proposals)) {
    return stateDoc.proposals;
  }
  return Array.isArray(factsDoc?.proposals) ? factsDoc.proposals : [];
}

function readJsonFile(filePath: string): TimelineStateDocument | null {
  // Timeline state/taxonomy/facts are foreign documents produced by another
  // workflow. Parse them gently and let that workflow own recovery instead of
  // moving files aside as if codeksei fully owned their schema.
  return readForeignJsonDocument<Record<string, unknown> | null>(filePath, { fallback: null });
}

export {
  loadTimelineStateSnapshot,
  readTimelineStateTimezone,
  resolveTimelineStateFiles,
};

export type {
  TimelineStateDocument,
  TimelineStateFiles,
  TimelineStateSnapshot,
};
