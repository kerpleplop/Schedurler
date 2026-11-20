export type BookmarkStats = {
  openCount: number;
  lastOpenedAt: string | null;
};

// test comment 1: reviewable MCP smoke test
// test comment 3: revision-after-base-bump smoke test
export type Bookmark = {
  id: string;
  name: string;
  url: string;
  keywords: string[]; // test comment 2: reviewable MCP smoke test
  tags?: string[];
  stats?: BookmarkStats;
};

export type ScheduleEventRecurrence =
  | { type: "daily" }
  | { type: "weekdays" }
  | { type: "weekly"; daysOfWeek: number[] }
  | { type: "once"; date: string }; // test comment 3: reviewable MCP smoke test

/** A browser (one Firefox extension install) the controller can send tab actions to. */
export type Device = {
  id: string;
  name: string;
  browser: "firefox";
  lastSeenAt: string | null;
};

export type ScheduleEvent = {
  id: string;
  time: string;
  bookmarkId: string;
  enabled: boolean;
  /** Defaults to { type: "daily" } when omitted, for backward compatibility. */
  recurrence?: ScheduleEventRecurrence;
  /** Overrides the schedule's targets. Omitted or empty means "use the schedule's targets". */
  targetDeviceIds?: string[];
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
  /** Omitted or empty means every connected device. */
  targetDeviceIds?: string[];
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
  /** Dedicated schedule tab per device, keyed by device id. Tab ids are only unique within one browser. */
  scheduleTabIds: Record<string, number>;
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

