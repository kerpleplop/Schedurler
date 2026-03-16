export const BOOKMARKS_FILE_NAME = "bookmarks.json";
export const SCHEDULES_FILE_NAME = "schedules.json";
export const CONTROLLER_STATE_FILE_NAME = "controllerState.json";
export const SETTINGS_FILE_NAME = "settings.json";

export const DEFAULT_CONTROLLER_HOST = "127.0.0.1";
export const DEFAULT_CONTROLLER_PORT = 4312;
export const DEFAULT_CONTROLLER_WS_PATH = "/ws";

export const CLOCK_TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;

export const CONTROLLER_COMMAND_TYPES = [
  "open_url",
  "close_tab",
  "mute_tab",
  "unmute_tab",
  "get_status"
] as const;

export const EXTENSION_MESSAGE_TYPES = [
  "hello",
  "status",
  "tab_opened",
  "command_failed"
] as const;

