import type { IncomingMessage, ServerResponse } from "node:http";
import type { ActiveTabActionSource } from "@schedurler/shared";
import { dispatchOpenUrlCommand } from "../controllerActions";
import { buildControllerSnapshot } from "./snapshot";
import { isRecord, readJsonBody, sendJson } from "./response";
import { handleStaticRequest } from "./static";
import type { ControllerRequestContext } from "./types";

const LOAD_BOOKMARK_PATH = /^\/api\/bookmarks\/([^/]+)\/load$/;

export async function handleControllerRequest(
  request: IncomingMessage,
  response: ServerResponse,
  context: ControllerRequestContext
): Promise<void> {
  const method = normalizeMethod(request.method);
  const url = new URL(request.url ?? "/", "http://controller.local");

  // The controller serves the first web UI slice same-origin so the browser app
  // can use controller-local HTTP shapes without adding CORS or shared UI DTOs.
  if (method === "GET" && (await handleStaticRequest(url.pathname, response))) {
    return;
  }

  if (method === "GET" && url.pathname === "/health") {
    sendJson(response, 200, {
      ok: true,
      controllerId: context.stateRef.current.controllerId,
      extensionConnections: context.socketServer.getConnectionCount()
    });
    return;
  }

  if (method === "GET" && url.pathname === "/api/state") {
    sendJson(response, 200, await buildControllerSnapshot(context));
    return;
  }

  if (method === "GET" && url.pathname === "/api/bookmarks") {
    sendJson(response, 200, {
      bookmarks: await context.bookmarksStore.list()
    });
    return;
  }

  if (method === "GET" && url.pathname === "/api/schedules") {
    sendJson(response, 200, {
      schedules: await context.schedulesStore.list()
    });
    return;
  }

  if (method === "POST" && url.pathname === "/api/commands/open-url") {
    await handleOpenUrlRequest(request, response, context);
    return;
  }

  const bookmarkId = getLoadBookmarkId(url.pathname);

  if (method === "POST" && bookmarkId) {
    await handleLoadBookmarkRequest(bookmarkId, response, context);
    return;
  }

  sendJson(response, 404, { error: "Not found" });
}

function normalizeMethod(method: string | undefined): string {
  if (method === "HEAD") {
    return "GET";
  }

  return method ?? "GET";
}

async function handleOpenUrlRequest(
  request: IncomingMessage,
  response: ServerResponse,
  context: ControllerRequestContext
): Promise<void> {
  let body: unknown;

  try {
    body = await readJsonBody(request);
  } catch {
    sendJson(response, 400, { error: "Invalid JSON body" });
    return;
  }

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

  const result = await dispatchOpenUrlCommand({
    url: urlValue,
    bookmarkId,
    source,
    stateRef: context.stateRef,
    controllerStateStore: context.controllerStateStore,
    socketServer: context.socketServer
  });

  if (result.deliveredTo === 0) {
    sendJson(response, 503, { error: "No extension is connected" });
    return;
  }

  sendJson(response, 202, {
    ok: true,
    commandId: result.commandId,
    deliveredTo: result.deliveredTo
  });
}

async function handleLoadBookmarkRequest(
  bookmarkId: string,
  response: ServerResponse,
  context: ControllerRequestContext
): Promise<void> {
  const bookmark = await context.bookmarksStore.getById(bookmarkId);

  if (!bookmark) {
    sendJson(response, 404, { error: "Bookmark not found" });
    return;
  }

  const result = await dispatchOpenUrlCommand({
    url: bookmark.url,
    bookmarkId: bookmark.id,
    source: "manual",
    stateRef: context.stateRef,
    controllerStateStore: context.controllerStateStore,
    socketServer: context.socketServer
  });

  if (result.deliveredTo === 0) {
    sendJson(response, 503, { error: "No extension is connected" });
    return;
  }

  sendJson(response, 202, {
    ok: true,
    commandId: result.commandId,
    deliveredTo: result.deliveredTo,
    bookmark: {
      id: bookmark.id,
      name: bookmark.name,
      url: bookmark.url
    }
  });
}

function getLoadBookmarkId(pathname: string): string | null {
  const match = pathname.match(LOAD_BOOKMARK_PATH);

  if (!match) {
    return null;
  }

  return decodeURIComponent(match[1]);
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
