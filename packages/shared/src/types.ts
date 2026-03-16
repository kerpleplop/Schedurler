export type Bookmark = {
  id: string;
  name: string;
  url: string;
  keywords: string[];
};

export type ScheduleEvent = {
  id: string;
  time: string;
  bookmarkId: string;
  enabled: boolean;
};

export type Schedule = {
  id: string;
  name: string;
  events: ScheduleEvent[];
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
};

export type ControllerSettings = {
  sharedDataDir: string;
  localDataDir: string;
  host: string;
  port: number;
};

