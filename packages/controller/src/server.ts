import { randomUUID } from "node:crypto";
import path from "node:path";
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
import type { LogEntry } from "./logBuffer";
import {
  handleCreateBookmark,
  handleUpdateBookmark,
  handleDeleteBookmark
} from "./api/bookmarks";
import {
  handleCreateSchedule,
  handleUpdateSchedule,
  handleDeleteSchedule,
  handleDuplicateSchedule,
  handleActivateSchedule,
  handleDeactivateSchedule,
  handleAddEvent,
  handleUpdateEvent,
  handleRemoveEvent
} from "./api/schedules";
import { handleGetState, handleSetScheduleEnabled } from "./api/state";
import { serveStatic } from "./api/serveStatic";
import type { BookmarksStore } from "./storage/bookmarksStore";
import type { ControllerStateStore } from "./storage/controllerStateStore";
import type { SchedulesStore } from "./storage/schedulesStore";
import type { ScheduleRunner } from "./scheduler";
import type { DevicesStore } from "./storage/devicesStore";
import type { TabRegistry } from "./tabRegistry";
import { handleGetTabs, handleCloseTab } from "./api/tabs";
import {
  handleListDevices,
  handleRenameDevice,
  handleForgetDevice
} from "./api/devices";
import { ControllerSocketServer } from "./ws/socketServer";
import { BrowserSocketServer } from "./ws/browserSocketServer";

const UI_ROOT = path.resolve(__dirname, "ui");
const BROWSER_WS_PATH = "/ws/ui";

export type ControllerServerOptions = {
  settings: ControllerSettings;
  wsPath: string;
  stateRef: { current: ControllerState };
  bookmarksStore: BookmarksStore;
  schedulesStore: SchedulesStore;
  devicesStore: DevicesStore;
  controllerStateStore: ControllerStateStore;
  scheduleRunnerRef: { current: ScheduleRunner | null };
  tabRegistry: TabRegistry;
  onExtensionMessage: (message: ExtensionToControllerMessage, deviceId: string) => Promise<void>;
  onExtensionClose: (deviceId: string) => void;
  getLogs: () => readonly LogEntry[];
};

export async function startControllerServer(
  options: ControllerServerOptions
): Promise<{
  httpServer: Server;
  socketServer: ControllerSocketServer;
  browserSocketServer: BrowserSocketServer;
}> {
  let socketServer: ControllerSocketServer;
  let browserSocketServer: BrowserSocketServer;

  const httpServer = createServer(async (request, response) => {
    try {
      await handleRequest(request, response, options, socketServer, browserSocketServer);
    } catch (error) {
      console.error("[schedurler] request failed", error);
      sendJson(response, 500, { error: "Internal server error" });
    }
  });

  socketServer = new ControllerSocketServer({
    onMessage: options.onExtensionMessage,
    onClose: options.onExtensionClose
  });

  browserSocketServer = new BrowserSocketServer();

  httpServer.on("upgrade", (request, socket, head) => {
    const pathname = new URL(request.url ?? "/", "http://controller.local").pathname;
    if (pathname === options.wsPath) {
      socketServer.handleUpgrade(request, socket, head);
    } else if (pathname === BROWSER_WS_PATH) {
      browserSocketServer.handleUpgrade(request, socket, head);
    } else {
      socket.destroy();
    }
  });

  await new Promise<void>((resolve) => {
    httpServer.listen(options.settings.port, options.settings.host, resolve);
  });

  return { httpServer, socketServer, browserSocketServer };
}

function matchPath(
  pattern: string,
  pathname: string
): Record<string, string> | null {
  const patternParts = pattern.split("/");
  const pathParts = pathname.split("/");

  if (patternParts.length !== pathParts.length) {
    return null;
  }

  const params: Record<string, string> = {};

  for (let i = 0; i < patternParts.length; i++) {
    const p = patternParts[i];
    const v = pathParts[i];

    if (p.startsWith(":")) {
      params[p.slice(1)] = v;
    } else if (p !== v) {
      return null;
    }
  }

  return params;
}

async function handleRequest(
  request: IncomingMessage,
  response: ServerResponse,
  options: ControllerServerOptions,
  socketServer: ControllerSocketServer,
  browserSocketServer: BrowserSocketServer
): Promise<void> {
  const method = request.method ?? "GET";
  const url = new URL(request.url ?? "/", "http://controller.local");
  const pathname = url.pathname;

  // Serve the web UI at root and /ui/*
  if (method === "GET" && pathname === "/") {
    await serveStatic(response, UI_ROOT, "index.html");
    return;
  }

  if (method === "GET" && pathname.startsWith("/ui/")) {
    const relative = pathname.slice("/ui/".length);
    await serveStatic(response, UI_ROOT, relative);
    return;
  }

  if (method === "GET" && pathname === "/api/logs") {
    sendJson(response, 200, { logs: options.getLogs() });
    return;
  }

  if (method === "GET" && pathname === "/health") {
    sendJson(response, 200, {
      ok: true,
      controllerId: options.stateRef.current.controllerId,
      extensionConnections: socketServer.getConnectionCount()
    });
    return;
  }

  // --- Bookmarks ---

  if (method === "GET" && pathname === "/api/bookmarks") {
    sendJson(response, 200, {
      bookmarks: await options.bookmarksStore.list()
    });
    return;
  }

  if (method === "POST" && pathname === "/api/bookmarks") {
    await handleCreateBookmark(request, response, {
      bookmarksStore: options.bookmarksStore,
      schedulesStore: options.schedulesStore,
      browserSocketServer
    });
    return;
  }

  {
    const params = matchPath("/api/bookmarks/:id", pathname);
    if (params) {
      if (method === "PATCH") {
        await handleUpdateBookmark(request, response, params.id, {
          bookmarksStore: options.bookmarksStore,
          schedulesStore: options.schedulesStore,
          browserSocketServer
        });
        return;
      }
      if (method === "DELETE") {
        await handleDeleteBookmark(response, params.id, {
          bookmarksStore: options.bookmarksStore,
          schedulesStore: options.schedulesStore,
          browserSocketServer
        });
        return;
      }
    }
  }

  // --- Devices ---

  const deviceDeps = {
    devicesStore: options.devicesStore,
    schedulesStore: options.schedulesStore,
    socketServer,
    tabRegistry: options.tabRegistry,
    browserSocketServer
  };

  if (method === "GET" && pathname === "/api/devices") {
    await handleListDevices(response, deviceDeps);
    return;
  }

  {
    const params = matchPath("/api/devices/:id", pathname);
    if (params) {
      if (method === "PATCH") {
        await handleRenameDevice(request, response, params.id, deviceDeps);
        return;
      }
      if (method === "DELETE") {
        await handleForgetDevice(response, params.id, deviceDeps);
        return;
      }
    }
  }

  // --- Schedules ---

  const scheduleDeps = {
    schedulesStore: options.schedulesStore,
    devicesStore: options.devicesStore,
    controllerStateStore: options.controllerStateStore,
    stateRef: options.stateRef,
    browserSocketServer,
    getExtensionConnectionCount: () => socketServer.getConnectionCount(),
    scheduleRunner: options.scheduleRunnerRef.current
  };

  if (method === "GET" && pathname === "/api/schedules") {
    sendJson(response, 200, {
      schedules: await options.schedulesStore.list()
    });
    return;
  }

  if (method === "POST" && pathname === "/api/schedules") {
    await handleCreateSchedule(request, response, scheduleDeps);
    return;
  }

  {
    const params = matchPath("/api/schedules/:id", pathname);
    if (params) {
      if (method === "PATCH") {
        await handleUpdateSchedule(request, response, params.id, scheduleDeps);
        return;
      }
      if (method === "DELETE") {
        await handleDeleteSchedule(response, params.id, scheduleDeps);
        return;
      }
    }
  }

  {
    const params = matchPath("/api/schedules/:id/duplicate", pathname);
    if (params && method === "POST") {
      await handleDuplicateSchedule(response, params.id, scheduleDeps);
      return;
    }
  }

  {
    const params = matchPath("/api/schedules/:id/activate", pathname);
    if (params && method === "POST") {
      await handleActivateSchedule(response, params.id, scheduleDeps);
      return;
    }
  }

  {
    const params = matchPath("/api/schedules/:id/deactivate", pathname);
    if (params && method === "POST") {
      await handleDeactivateSchedule(response, params.id, scheduleDeps);
      return;
    }
  }

  {
    const params = matchPath("/api/schedules/:id/events", pathname);
    if (params && method === "POST") {
      await handleAddEvent(request, response, params.id, scheduleDeps);
      return;
    }
  }

  {
    const params = matchPath("/api/schedules/:scheduleId/events/:eventId", pathname);
    if (params) {
      if (method === "PATCH") {
        await handleUpdateEvent(request, response, params.scheduleId, params.eventId, scheduleDeps);
        return;
      }
      if (method === "DELETE") {
        await handleRemoveEvent(response, params.scheduleId, params.eventId, scheduleDeps);
        return;
      }
    }
  }

  // --- Controller state ---

  if (method === "GET" && pathname === "/api/state") {
    handleGetState(response, {
      controllerStateStore: options.controllerStateStore,
      stateRef: options.stateRef,
      browserSocketServer,
      getExtensionConnectionCount: () => socketServer.getConnectionCount()
    });
    return;
  }

  if (method === "POST" && pathname === "/api/state/schedule-enabled") {
    await handleSetScheduleEnabled(request, response, {
      controllerStateStore: options.controllerStateStore,
      stateRef: options.stateRef,
      browserSocketServer,
      getExtensionConnectionCount: () => socketServer.getConnectionCount()
    });
    return;
  }

  // --- Commands ---

  if (method === "POST" && pathname === "/api/commands/open-url") {
    const body = await readJsonBody(request);
    const urlValue = isRecord(body) && typeof body.url === "string" ? body.url : null;
    const bookmarkId =
      isRecord(body) && typeof body.bookmarkId === "string"
        ? body.bookmarkId
        : null;
    const source = parseSource(body);
    const requestedDeviceIds =
      isRecord(body) && body.deviceIds !== undefined ? body.deviceIds : undefined;

    if (!urlValue || !isValidUrl(urlValue)) {
      sendJson(response, 400, { error: "A valid url is required" });
      return;
    }

    if (
      requestedDeviceIds !== undefined &&
      (!Array.isArray(requestedDeviceIds) ||
        !requestedDeviceIds.every((id) => typeof id === "string"))
    ) {
      sendJson(response, 400, { error: "deviceIds must be an array of device ids" });
      return;
    }

    // No deviceIds (or an empty list) means every connected device.
    const targetIds =
      requestedDeviceIds && requestedDeviceIds.length > 0
        ? (requestedDeviceIds as string[])
        : socketServer.getConnectedDeviceIds();

    const sentAt = new Date().toISOString();
    const deliveredTo: string[] = [];

    for (const deviceId of targetIds) {
      const command: OpenUrlCommand = {
        type: "open_url",
        commandId: randomUUID(),
        sentAt,
        url: urlValue,
        bookmarkId,
        source
      };

      if (socketServer.sendCommand(command, deviceId)) {
        deliveredTo.push(deviceId);
      }
    }

    if (deliveredTo.length === 0) {
      sendJson(response, 503, {
        error:
          requestedDeviceIds && requestedDeviceIds.length > 0
            ? "None of the selected devices are connected"
            : "No extension is connected"
      });
      return;
    }

    if (bookmarkId) {
      await options.bookmarksStore.recordOpen(bookmarkId, sentAt);
      const bookmarks = await options.bookmarksStore.list();
      browserSocketServer.broadcast({ type: "bookmarks_updated", bookmarks });
    }

    options.stateRef.current = {
      ...options.stateRef.current,
      currentBookmarkId: bookmarkId,
      activeTabAction: {
        bookmarkId,
        url: urlValue,
        startedAt: sentAt,
        source,
        status: "pending"
      }
    };

    await options.controllerStateStore.save(options.stateRef.current);

    browserSocketServer.broadcast({
      type: "state_update",
      state: options.stateRef.current,
      extensionConnections: socketServer.getConnectionCount()
    });

    sendJson(response, 202, { ok: true, deviceIds: deliveredTo });
    return;
  }

  // --- Tabs ---

  if (method === "GET" && pathname === "/api/tabs") {
    handleGetTabs(response, { tabRegistry: options.tabRegistry, socketServer });
    return;
  }

  {
    const params = matchPath("/api/devices/:deviceId/tabs/:tabId", pathname);
    if (params && method === "DELETE") {
      const tabId = parseInt(params.tabId, 10);
      if (isNaN(tabId)) {
        sendJson(response, 400, { error: "tabId must be a number" });
        return;
      }
      await handleCloseTab(response, params.deviceId, tabId, { socketServer });
      return;
    }
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
