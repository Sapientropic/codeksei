import type { CheckinScheduleState } from "../contracts/checkin-schedule-state";
import {
  checkinScheduleStateSchema,
  normalizeCheckinScheduleState,
  validateCheckinScheduleState,
} from "../contracts/checkin-schedule-state";
import {
  ensureParentDirectory,
  readManagedJsonStateFile,
  writeManagedJsonStateFile,
} from "./json-state";
import type { ZodType } from "zod";

export class CheckinScheduleStateStore {
  readonly filePath: string;

  constructor({ filePath }: { filePath: string }) {
    this.filePath = filePath;
    ensureParentDirectory(filePath);
  }

  clearState(): void {
    writeManagedJsonStateFile(this.filePath, null);
  }

  getState(): CheckinScheduleState | null {
    const value = readManagedJsonStateFile<CheckinScheduleState | null>({
      filePath: this.filePath,
      fallback: null,
      label: "checkin schedule state",
      schema: checkinScheduleStateSchema as ZodType<CheckinScheduleState>,
      validate: validateCheckinScheduleState,
    });
    return value ? normalizeCheckinScheduleState(value) : null;
  }

  setState(state: CheckinScheduleState): CheckinScheduleState {
    const normalized = normalizeCheckinScheduleState(state);
    writeManagedJsonStateFile(this.filePath, normalized);
    return normalized;
  }
}
