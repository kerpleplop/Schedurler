import { randomUUID } from "node:crypto";
import {
  createServer,
  type IncomingMessage,
  type Server,
  type ServerResponse
} from "node:http";
import {
  type ActiveTabActionSource,
  type ControllerSettings,
  type ControllerState,
  type ExtensionToControllerMessage,
  type OpenUrlCommand
} from "@schedurler/shared";
import type { BookmarksStore } from "./storage/bookmarksStore";
import type { ControllerStateStore } from "./storage/controllerStateStore";
import type { SchedulesStore } from "./storage/schedulesStore";
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
  let socketServer: ControllerSocketServer;

  const httpServer = createServer(async (request, response) => {
    try {
      await handleRequest(request, response, options, socketServer);
    } catch (error) {
      console.error("[schedurler] request failed", error);
      sendJson(response, 500, { error: "Internal server error" });
    }
  });

  socketServer = new ControllerSocketServer({
    server: httpServer,
    path: options.wsPath,
    onMessage: options.onExtensionMessage
  });

  await new Promise<void>((resolve) => {
    httpServer.listen(options.settings.port, options.settings.host, resolve);
  });

  return { httpServer, socketServer };
}

async function handleRequest(
  request: IncomingMessage,
  response: ServerResponse,
  options: ControllerServerOptions,
  socketServer: ControllerSocketServer
): Promise<void> {
  const method = request.method ?? "GET";
  const url = new URL(request.url ?? "/", "http://controller.local");

  if (method === "GET" && url.pathname === "/") {
    sendJson(response, 200, {
      name: "Schedurler controller",
      websocketPath: options.wsPath
    });
    return;
  }

  if (method === "GET" && url.pathname === "/health") {
    sendJson(response, 200, {
      ok: true,
      controllerId: options.stateRef.current.controllerId,
      extensionConnections: socketServer.getConnectionCount()
    });
    return;
  }

  if (method === "GET" && url.pathname === "/api/bookmarks") {
    sendJson(response, 200, {
      bookmarks: await options.bookmarksStore.list()
    });
    return;
  }

  if (method === "GET" && url.pathname === "/api/schedules") {
    sendJson(response, 200, {
      schedules: await options.schedulesStore.list()
    });
    return;
  }

  if (method === "POST" && url.pathname === "/api/commands/open-url") {
    const body = await readJsonBody(request);
    const urlValue = isRecord(body) && typeof body.url === "string" ? body.url : null;
    const bookmarkId =
      isRecord(body) && typeof body.bookmarkId === "string"
        ? body.bookmarkId
        : null;
    const source = parseSource(body);

    if (!urlValue || !isValidUrl(urlValue)) {
      sendJson(response, 400, { error: "A valid url is required" });
      return;
    }

    const command: OpenUrlCommand = {
      type: "open_url",
      commandId: randomUUID(),
      sentAt: new Date().toISOString(),
      url: urlValue,
      bookmarkId,
      source
    };

    const wasSent = socketServer.sendCommand(command);

    if (!wasSent) {
      sendJson(response, 503, { error: "No extension is connected" });
      return;
    }

    options.stateRef.current = {
      ...options.stateRef.current,
      currentBookmarkId: bookmarkId,
      activeTabAction: {
        bookmarkId,
        url: urlValue,
        startedAt: command.sentAt,
        source,
        status: "pending"
      }
    };

    await options.controllerStateStore.save(options.stateRef.current);

    sendJson(response, 202, { ok: true, commandId: command.commandId });
    return;
  }

  sendJson(response, 404, { error: "Not found" });
}

async function readJsonBody(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];

  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }

  if (chunks.length === 0) {
    return {};
  }

  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

function sendJson(
  response: ServerResponse,
  statusCode: number,
  payload: unknown
): void {
  response.statusCode = statusCode;
  response.setHeader("content-type", "application/json; charset=utf-8");
  response.end(JSON.stringify(payload, null, 2));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function parseSource(value: unknown): ActiveTabActionSource {
  if (isRecord(value) && value.source === "schedule") {
    return "schedule";
  }

  if (isRecord(value) && value.source === "system") {
    return "system";
  }

  return "manual";
}

function isValidUrl(value: string): boolean {
  try {
    new URL(value);
    return true;
  } catch {
    return false;
  }
}

