import { randomUUID } from "node:crypto";
import type {
  ActiveTabActionSource,
  ControllerState,
  OpenUrlCommand
} from "@schedurler/shared";
import type { ControllerStateStore } from "./storage/controllerStateStore";
import type { ControllerSocketServer } from "./ws/socketServer";

export type DispatchOpenUrlCommandOptions = {
  url: string;
  bookmarkId: string | null;
  source: ActiveTabActionSource;
  stateRef: { current: ControllerState };
  controllerStateStore: ControllerStateStore;
  socketServer: ControllerSocketServer;
};

export type DispatchOpenUrlCommandResult = {
  commandId: string;
  deliveredTo: number;
  sentAt: string;
};

export async function dispatchOpenUrlCommand(
  options: DispatchOpenUrlCommandOptions
): Promise<DispatchOpenUrlCommandResult> {
  const command: OpenUrlCommand = {
    type: "open_url",
    commandId: randomUUID(),
    sentAt: new Date().toISOString(),
    url: options.url,
    bookmarkId: options.bookmarkId,
    source: options.source
  };

  // Manual and API-triggered loads fan out to every connected extension so one
  // controller action can affect multiple Firefox instances on the trusted LAN.
  const deliveredTo = options.socketServer.broadcastCommand(command);

  if (deliveredTo === 0) {
    return {
      commandId: command.commandId,
      deliveredTo,
      sentAt: command.sentAt
    };
  }

  options.stateRef.current = {
    ...options.stateRef.current,
    currentBookmarkId: options.bookmarkId,
    activeTabAction: {
      bookmarkId: options.bookmarkId,
      url: options.url,
      startedAt: command.sentAt,
      source: options.source,
      // Controller state tracks the latest controller-issued action, not per-
      // extension completion. Extension messages may later move this to
      // completed or failed as results arrive.
      status: "pending"
    }
  };

  await options.controllerStateStore.save(options.stateRef.current);

  return {
    commandId: command.commandId,
    deliveredTo,
    sentAt: command.sentAt
  };
}
