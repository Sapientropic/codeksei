import * as path from "node:path";

import { normalizeText } from "../contracts/text-normalization";
import {
  readManagedJsonStateFile,
  writeManagedJsonStateFile,
} from "../state/json-state";
import type { PulseFeedback, PulseRun, PulseTask } from "./contracts";

export interface PulseStateConfig {
  stateDir?: string;
}

export function resolvePulseDir(config: PulseStateConfig): string {
  const stateDir = normalizeText(config.stateDir);
  if (!stateDir) {
    throw new Error("缺少 stateDir，无法读写 Codeksei Pulse 状态");
  }
  return path.join(stateDir, "pulse");
}

export function readPulseRun(config: PulseStateConfig, date: string): PulseRun | null {
  return readManagedJsonStateFile<PulseRun | null>({
    fallback: null,
    filePath: resolvePulseRunPath(config, date),
    label: "pulse run",
  });
}

export function writePulseRun(config: PulseStateConfig, run: PulseRun): void {
  writeManagedJsonStateFile(resolvePulseRunPath(config, run.date), run);
}

export function readPulseFeedback(config: PulseStateConfig): PulseFeedback[] {
  return readManagedJsonStateFile<PulseFeedback[]>({
    fallback: [],
    filePath: path.join(resolvePulseDir(config), "feedback", "feedback.json"),
    label: "pulse feedback",
  });
}

export function appendPulseFeedback(config: PulseStateConfig, feedback: PulseFeedback): PulseFeedback[] {
  const next = [...readPulseFeedback(config), feedback].slice(-120);
  writeManagedJsonStateFile(path.join(resolvePulseDir(config), "feedback", "feedback.json"), next);
  return next;
}

export function readPulseTasks(config: PulseStateConfig): PulseTask[] {
  return readManagedJsonStateFile<PulseTask[]>({
    fallback: [],
    filePath: path.join(resolvePulseDir(config), "tasks", "tasks.json"),
    label: "pulse tasks",
  });
}

export function upsertPulseTask(config: PulseStateConfig, task: PulseTask): PulseTask[] {
  const current = readPulseTasks(config).filter((entry) => entry.cardId !== task.cardId);
  const next = [...current, task].slice(-80);
  writeManagedJsonStateFile(path.join(resolvePulseDir(config), "tasks", "tasks.json"), next);
  return next;
}

function resolvePulseRunPath(config: PulseStateConfig, date: string): string {
  return path.join(resolvePulseDir(config), "runs", `${normalizeText(date)}.json`);
}
