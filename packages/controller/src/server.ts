import {
  createServer,
  type Server,
  type ServerResponse
} from "node:http";
import {
  type ControllerSettings,
  type ControllerState,
  type ExtensionToControllerMessage
} from "@schedurler/shared";
import type { BookmarksStore } from "./storage/bookmarksStore";
import type { ControllerStateStore } from "./storage/controllerStateStore";
import type { SchedulesStore } from "./storage/schedulesStore";
import { handleControllerRequest } from "./http/router";
import { ControllerSocketServer } from "./ws/socketServer";

export type ControllerServerOptions = {
  settings: ControllerSettings;
  wsPath: string;
  stateRef: { current: ControllerState };
  bookmarksStore: BookmarksStore;
  schedulesStore: SchedulesStore;
  controllerStateStore: ControllerStateStore;
  onExtensionMessage: (message: ExtensionToControllerMessage) => Promise<void>;
};

export async function startControllerServer(
  options: ControllerServerOptions
): Promise<{ httpServer: Server; socketServer: ControllerSocketServer }> {
  const httpServer = createServer(async (request, response) => {
    try {
      await handleControllerRequest(request, response, {
        settings: options.settings,
        wsPath: options.wsPath,
        stateRef: options.stateRef,
        bookmarksStore: options.bookmarksStore,
        schedulesStore: options.schedulesStore,
        controllerStateStore: options.controllerStateStore,
        socketServer
      });
    } catch (error) {
      console.error("[schedurler] request failed", error);
      sendJson(response, 500, { error: "Internal server error" });
    }
  });

  const socketServer = new ControllerSocketServer({
    server: httpServer,
    path: options.wsPath,
    onMessage: options.onExtensionMessage
  });

  await new Promise<void>((resolve) => {
    httpServer.listen(options.settings.port, options.settings.host, resolve);
  });

  return { httpServer, socketServer };
}

function sendJson(response: ServerResponse, statusCode: number, payload: unknown): void {
  response.statusCode = statusCode;
  response.setHeader("content-type", "application/json; charset=utf-8");
  response.end(JSON.stringify(payload, null, 2));
}
