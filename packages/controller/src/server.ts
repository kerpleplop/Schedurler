import {
  createServer,
  type Server
} from "node:http";
import {
  type ControllerSettings,
  type ControllerState,
  type ExtensionToControllerMessage
} from "@schedurler/shared";
import type { BookmarksStore } from "./storage/bookmarksStore";
import type { ControllerStateStore } from "./storage/controllerStateStore";
import type { SchedulesStore } from "./storage/schedulesStore";
import { sendJson } from "./http/response";
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

  await listenServer(httpServer, options.settings.port, options.settings.host);

  return { httpServer, socketServer };
}

function listenServer(server: Server, port: number, host: string): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const handleError = (error: Error) => {
      server.off("error", handleError);
      reject(error);
    };

    server.once("error", handleError);
    server.listen(port, host, () => {
      server.off("error", handleError);
      resolve();
    });
  });
}
