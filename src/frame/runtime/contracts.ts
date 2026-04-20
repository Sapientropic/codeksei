export type FrameCheckinStatus = "due" | "in_progress" | "scheduled";
export type FrameReminderPriority = "minor" | "primary";

export interface FrameTimelineSlot {
  id: string;
  start: string;
  end: string;
  title: string;
  category: string;
  color: string;
  state: "confirmed" | "current" | "future" | "provisional";
}

export interface FrameDiaryFragment {
  id: string;
  text: string;
  time: string;
}

export interface FrameReminder {
  id: string;
  text: string;
  due: string;
  priority: FrameReminderPriority;
}

export interface FrameProjectLine {
  id: string;
  name: string;
  stopped: string;
  next: string;
  action: string;
}

export interface FrameCheckin {
  status: FrameCheckinStatus;
  triggerId?: string;
  scheduledAt?: string;
}

export interface FrameState {
  now: string;
  timezone: string;
  timeline: {
    slots: FrameTimelineSlot[];
  };
  diary: {
    fragments: FrameDiaryFragment[];
    todaySummary: string;
  };
  reminders: FrameReminder[];
  projects: FrameProjectLine[];
  checkIn: FrameCheckin;
  character: {
    greeting: string;
  };
  freshness: {
    updatedAt: string;
    stale: boolean;
    warnings: string[];
  };
}
