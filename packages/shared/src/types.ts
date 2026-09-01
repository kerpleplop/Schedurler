// test comment 1: reviewable MCP smoke test
export type Bookmark = {
  id: string;
  name: string;
  url: string;
  keywords: string[]; // test comment 2: reviewable MCP smoke test
  tags?: string[];
};

export type ScheduleEventRecurrence =
  | { type: "daily" }
  | { type: "weekdays" }
  | { type: "weekly"; daysOfWeek: number[] }
  | { type: "once"; date: string }; // test comment 3: reviewable MCP smoke test

export type ScheduleEvent = {
  id: string;
  time: string;
  bookmarkId: string;
  enabled: boolean;
  /** Defaults to { type: "daily" } when omitted, for backward compatibility. */
  recurrence?: ScheduleEventRecurrence;
};

export type ScheduleStats = {
  runCount: number;
  lastFiredAt: string | null;
  lastBookmarkId: string | null;
};

export type Schedule = {
  id: string;
  name: string;
  events: ScheduleEvent[];
  stats?: ScheduleStats;
};

export type ActiveTabActionSource = "manual" | "schedule" | "system";
export type ActiveTabActionStatus = "idle" | "pending" | "completed" | "failed";

export type ActiveTabAction = {
  bookmarkId: string | null;
  url: string | null;
  startedAt: string | null;
  source: ActiveTabActionSource;
  status: ActiveTabActionStatus;
  errorMessage?: string;
};

export type ControllerState = {
  controllerId: string;
  activeScheduleId: string | null;
  scheduleEnabled: boolean;
  currentBookmarkId: string | null;
  activeTabAction: ActiveTabAction;
  scheduleTabId: number | null;
};

export type ControllerSettings = {
  sharedDataDir: string;
  localDataDir: string;
  host: string;
  port: number;
};

export type TabEntry = {
  tabId: number;
  url: string;
  title?: string;
  favIconUrl?: string;
};

