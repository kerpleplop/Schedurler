import type { ActiveTabActionSource } from "./types";
import {
  CONTROLLER_COMMAND_TYPES,
  EXTENSION_MESSAGE_TYPES
} from "./constraints";

export type ControllerCommandType = (typeof CONTROLLER_COMMAND_TYPES)[number];
export type ExtensionMessageType = (typeof EXTENSION_MESSAGE_TYPES)[number];

export type ControllerCommandBase = {
  type: ControllerCommandType;
  commandId: string;
  sentAt: string;
  bookmarkId?: string | null;
};

export type OpenUrlCommand = ControllerCommandBase & {
  type: "open_url";
  url: string;
  source: ActiveTabActionSource;
};

export type CloseTabCommand = ControllerCommandBase & {
  type: "close_tab";
  tabId?: number;
};

export type MuteTabCommand = ControllerCommandBase & {
  type: "mute_tab";
  tabId?: number;
};

export type UnmuteTabCommand = ControllerCommandBase & {
  type: "unmute_tab";
  tabId?: number;
};

export type GetStatusCommand = ControllerCommandBase & {
  type: "get_status";
};

export type ControllerToExtensionMessage =
  | OpenUrlCommand
  | CloseTabCommand
  | MuteTabCommand
  | UnmuteTabCommand
  | GetStatusCommand;

export type ExtensionHello = {
  type: "hello";
  extensionId: string;
  browser: "firefox";
  connectedAt: string;
  version?: string;
};

export type ExtensionStatus = {
  type: "status";
  status: "ready" | "busy" | "error";
  observedAt: string;
  activeTabId?: number | null;
  activeUrl?: string | null;
  message?: string;
};

export type TabOpenedEvent = {
  type: "tab_opened";
  commandId: string;
  bookmarkId?: string | null;
  tabId: number;
  url: string;
  observedAt: string;
};

export type CommandFailedEvent = {
  type: "command_failed";
  commandId: string;
  commandType: ControllerCommandType;
  bookmarkId?: string | null;
  errorMessage: string;
  observedAt: string;
};

export type ExtensionToControllerMessage =
  | ExtensionHello
  | ExtensionStatus
  | TabOpenedEvent
  | CommandFailedEvent;

