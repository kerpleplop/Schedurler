import type { IncomingMessage, ServerResponse } from "node:http";
import type { BookmarksStore } from "../storage/bookmarksStore";
import type { SchedulesStore } from "../storage/schedulesStore";
import type { BrowserSocketServer } from "../ws/browserSocketServer";

type Deps = {
  bookmarksStore: BookmarksStore;
  schedulesStore: SchedulesStore;
  browserSocketServer: BrowserSocketServer;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isValidUrl(value: string): boolean {
  try {
    new URL(value);
    return true;
  } catch {
    return false;
  }
}

async function readJsonBody(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  if (chunks.length === 0) return {};
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

function sendJson(response: ServerResponse, status: number, payload: unknown): void {
  response.statusCode = status;
  response.setHeader("content-type", "application/json; charset=utf-8");
  response.end(JSON.stringify(payload, null, 2));
}

export async function handleCreateBookmark(
  request: IncomingMessage,
  response: ServerResponse,
  deps: Deps
): Promise<void> {
  const body = await readJsonBody(request);

  if (!isRecord(body)) {
    sendJson(response, 400, { error: "Invalid request body" });
    return;
  }

  const { name, url, keywords } = body;

  if (typeof name !== "string" || name.trim() === "") {
    sendJson(response, 400, { error: "name is required" });
    return;
  }

  if (typeof url !== "string" || !isValidUrl(url)) {
    sendJson(response, 400, { error: "A valid url is required" });
    return;
  }

  if (!Array.isArray(keywords) || !keywords.every((k) => typeof k === "string")) {
    sendJson(response, 400, { error: "keywords must be an array of strings" });
    return;
  }

  const bookmark = await deps.bookmarksStore.create({
    name: name.trim(),
    url,
    keywords
  });

  const bookmarks = await deps.bookmarksStore.list();
  deps.browserSocketServer.broadcast({ type: "bookmarks_updated", bookmarks });

  sendJson(response, 201, { bookmark });
}

export async function handleUpdateBookmark(
  request: IncomingMessage,
  response: ServerResponse,
  id: string,
  deps: Deps
): Promise<void> {
  const body = await readJsonBody(request);

  if (!isRecord(body)) {
    sendJson(response, 400, { error: "Invalid request body" });
    return;
  }

  const patch: { name?: string; url?: string; keywords?: string[] } = {};

  if (body.name !== undefined) {
    if (typeof body.name !== "string" || (body.name as string).trim() === "") {
      sendJson(response, 400, { error: "name must be a non-empty string" });
      return;
    }
    patch.name = (body.name as string).trim();
  }

  if (body.url !== undefined) {
    if (typeof body.url !== "string" || !isValidUrl(body.url as string)) {
      sendJson(response, 400, { error: "A valid url is required" });
      return;
    }
    patch.url = body.url as string;
  }

  if (body.keywords !== undefined) {
    if (
      !Array.isArray(body.keywords) ||
      !(body.keywords as unknown[]).every((k) => typeof k === "string")
    ) {
      sendJson(response, 400, { error: "keywords must be an array of strings" });
      return;
    }
    patch.keywords = body.keywords as string[];
  }

  const bookmark = await deps.bookmarksStore.update(id, patch);

  if (!bookmark) {
    sendJson(response, 404, { error: "Not found" });
    return;
  }

  const bookmarks = await deps.bookmarksStore.list();
  deps.browserSocketServer.broadcast({ type: "bookmarks_updated", bookmarks });

  sendJson(response, 200, { bookmark });
}

export async function handleDeleteBookmark(
  response: ServerResponse,
  id: string,
  deps: Deps
): Promise<void> {
  // Cascade: remove events referencing this bookmark before deleting
  await deps.schedulesStore.removeEventsByBookmarkId(id);

  const removed = await deps.bookmarksStore.remove(id);

  if (!removed) {
    sendJson(response, 404, { error: "Not found" });
    return;
  }

  const [bookmarks, schedules] = await Promise.all([
    deps.bookmarksStore.list(),
    deps.schedulesStore.list()
  ]);

  deps.browserSocketServer.broadcast({ type: "bookmarks_updated", bookmarks });
  deps.browserSocketServer.broadcast({ type: "schedules_updated", schedules });

  sendJson(response, 200, { ok: true });
}
