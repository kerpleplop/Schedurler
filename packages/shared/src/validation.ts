import {
  CLOCK_TIME_PATTERN,
  CONTROLLER_COMMAND_TYPES,
  DATE_PATTERN,
  EXTENSION_MESSAGE_TYPES
} from "./constraints";
import type {
  ControllerToExtensionMessage,
  ExtensionToControllerMessage
} from "./protocol";
import type {
  ActiveTabAction,
  Bookmark,
  ControllerSettings,
  ControllerState,
  Schedule,
  ScheduleEvent,
  ScheduleEventRecurrence,
  ScheduleStats
} from "./types";

type UnknownRecord = Record<string, unknown>;

export function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === "object" && value !== null;
}

export function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

export function isClockTime(value: unknown): value is string {
  return typeof value === "string" && CLOCK_TIME_PATTERN.test(value);
}

export function isDateString(value: unknown): value is string {
  return typeof value === "string" && DATE_PATTERN.test(value);
}

export function isDaysOfWeek(value: unknown): value is number[] {
  return (
    Array.isArray(value) &&
    value.length > 0 &&
    value.every((day) => Number.isInteger(day) && day >= 0 && day <= 6)
  );
}

export function isScheduleEventRecurrence(
  value: unknown
): value is ScheduleEventRecurrence {
  if (!isRecord(value)) {
    return false;
  }

  switch (value.type) {
    case "daily":
    case "weekdays":
      return true;
    case "weekly":
      return isDaysOfWeek(value.daysOfWeek);
    case "once":
      return isDateString(value.date);
    default:
      return false;
  }
}

export function isBookmark(value: unknown): value is Bookmark {
  if (!isRecord(value)) {
    return false;
  }

  return (
    typeof value.id === "string" &&
    typeof value.name === "string" &&
    typeof value.url === "string" &&
    isStringArray(value.keywords) &&
    (value.tags === undefined || isStringArray(value.tags))
  );
}

export function isScheduleEvent(value: unknown): value is ScheduleEvent {
  if (!isRecord(value)) {
    return false;
  }

  return (
    typeof value.id === "string" &&
    isClockTime(value.time) &&
    typeof value.bookmarkId === "string" &&
    typeof value.enabled === "boolean" &&
    (value.recurrence === undefined || isScheduleEventRecurrence(value.recurrence))
  );
}

export function isScheduleStats(value: unknown): value is ScheduleStats {
  if (!isRecord(value)) {
    return false;
  }

  return (
    typeof value.runCount === "number" &&
    (value.lastFiredAt === null || typeof value.lastFiredAt === "string") &&
    (value.lastBookmarkId === null || typeof value.lastBookmarkId === "string")
  );
}

export function isSchedule(value: unknown): value is Schedule {
  if (!isRecord(value) || !Array.isArray(value.events)) {
    return false;
  }

  return (
    typeof value.id === "string" &&
    typeof value.name === "string" &&
    value.events.every(isScheduleEvent) &&
    (value.stats === undefined || isScheduleStats(value.stats))
  );
}

export function isActiveTabAction(value: unknown): value is ActiveTabAction {
  if (!isRecord(value)) {
    return false;
  }

  const hasValidBookmarkId =
    value.bookmarkId === null || typeof value.bookmarkId === "string";
  const hasValidUrl = value.url === null || typeof value.url === "string";
  const hasValidStartedAt =
    value.startedAt === null || typeof value.startedAt === "string";
  const hasValidSource =
    value.source === "manual" ||
    value.source === "schedule" ||
    value.source === "system";
  const hasValidStatus =
    value.status === "idle" ||
    value.status === "pending" ||
    value.status === "completed" ||
    value.status === "failed";
  const hasValidError =
    value.errorMessage === undefined || typeof value.errorMessage === "string";

  return (
    hasValidBookmarkId &&
    hasValidUrl &&
    hasValidStartedAt &&
    hasValidSource &&
    hasValidStatus &&
    hasValidError
  );
}

export function isControllerState(value: unknown): value is ControllerState {
  if (!isRecord(value)) {
    return false;
  }

  const hasValidScheduleTabId =
    value.scheduleTabId === undefined ||
    value.scheduleTabId === null ||
    Number.isInteger(value.scheduleTabId);

  return (
    typeof value.controllerId === "string" &&
    (value.activeScheduleId === null ||
      typeof value.activeScheduleId === "string") &&
    typeof value.scheduleEnabled === "boolean" &&
    (value.currentBookmarkId === null ||
      typeof value.currentBookmarkId === "string") &&
    isActiveTabAction(value.activeTabAction) &&
    hasValidScheduleTabId
  );
}

export function isControllerSettings(
  value: unknown
): value is ControllerSettings {
  if (!isRecord(value)) {
    return false;
  }

  return (
    typeof value.sharedDataDir === "string" &&
    typeof value.localDataDir === "string" &&
    typeof value.host === "string" &&
    typeof value.port === "number"
  );
}

export function isControllerToExtensionMessage(
  value: unknown
): value is ControllerToExtensionMessage {
  if (!isRecord(value) || typeof value.type !== "string") {
    return false;
  }

  if (
    !CONTROLLER_COMMAND_TYPES.includes(
      value.type as (typeof CONTROLLER_COMMAND_TYPES)[number]
    )
  ) {
    return false;
  }

  if (typeof value.commandId !== "string" || typeof value.sentAt !== "string") {
    return false;
  }

  if (value.bookmarkId !== undefined && value.bookmarkId !== null && typeof value.bookmarkId !== "string") {
    return false;
  }

  switch (value.type) {
    case "open_url":
      return (
        typeof value.url === "string" &&
        (value.source === "manual" ||
          value.source === "schedule" ||
          value.source === "system") &&
        (value.tabId === undefined || Number.isInteger(value.tabId))
      );
    case "close_tab":
    case "mute_tab":
    case "unmute_tab":
      return value.tabId === undefined || Number.isInteger(value.tabId);
    case "get_status":
    case "get_tabs":
      return true;
    default:
      return false;
  }
}

export function isExtensionToControllerMessage(
  value: unknown
): value is ExtensionToControllerMessage {
  if (!isRecord(value) || typeof value.type !== "string") {
    return false;
  }

  if (
    !EXTENSION_MESSAGE_TYPES.includes(
      value.type as (typeof EXTENSION_MESSAGE_TYPES)[number]
    )
  ) {
    return false;
  }

  switch (value.type) {
    case "hello":
      return (
        typeof value.extensionId === "string" &&
        value.browser === "firefox" &&
        typeof value.connectedAt === "string" &&
        (value.version === undefined || typeof value.version === "string")
      );
    case "status":
      return (
        (value.status === "ready" ||
          value.status === "busy" ||
          value.status === "error") &&
        typeof value.observedAt === "string" &&
        (value.activeTabId === undefined ||
          value.activeTabId === null ||
          Number.isInteger(value.activeTabId)) &&
        (value.activeUrl === undefined ||
          value.activeUrl === null ||
          typeof value.activeUrl === "string") &&
        (value.message === undefined || typeof value.message === "string")
      );
    case "tab_opened":
      return (
        typeof value.commandId === "string" &&
        (value.bookmarkId === undefined ||
          value.bookmarkId === null ||
          typeof value.bookmarkId === "string") &&
        Number.isInteger(value.tabId) &&
        typeof value.url === "string" &&
        typeof value.observedAt === "string"
      );
    case "command_failed":
      return (
        typeof value.commandId === "string" &&
        typeof value.commandType === "string" &&
        CONTROLLER_COMMAND_TYPES.includes(
          value.commandType as (typeof CONTROLLER_COMMAND_TYPES)[number]
        ) &&
        (value.bookmarkId === undefined ||
          value.bookmarkId === null ||
          typeof value.bookmarkId === "string") &&
        typeof value.errorMessage === "string" &&
        typeof value.observedAt === "string"
      );
    case "tab_closed":
      return (
        Number.isInteger(value.tabId) &&
        typeof value.observedAt === "string"
      );
    case "tabs_state":
      return (
        Array.isArray(value.tabs) &&
        typeof value.observedAt === "string" &&
        value.tabs.every(
          (t: unknown) =>
            isRecord(t) &&
            Number.isInteger(t.tabId) &&
            typeof t.url === "string" &&
            (t.title === undefined || typeof t.title === "string") &&
            (t.favIconUrl === undefined || typeof t.favIconUrl === "string")
        )
      );
    default:
      return false;
  }
}

