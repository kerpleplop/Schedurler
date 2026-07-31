import type { IncomingMessage, ServerResponse } from "node:http";
import { isClockTime, isScheduleEventRecurrence } from "@schedurler/shared";
import type { ControllerState, ScheduleEventRecurrence } from "@schedurler/shared";
import type { ControllerStateStore } from "../storage/controllerStateStore";
import type { SchedulesStore } from "../storage/schedulesStore";
import type { BrowserSocketServer } from "../ws/browserSocketServer";
import type { ScheduleRunner } from "../scheduler";

type Deps = {
  schedulesStore: SchedulesStore;
  controllerStateStore: ControllerStateStore;
  stateRef: { current: ControllerState };
  browserSocketServer: BrowserSocketServer;
  getExtensionConnectionCount: () => number;
  scheduleRunner?: ScheduleRunner | null;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
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

async function broadcastSchedules(deps: Deps): Promise<void> {
  const schedules = await deps.schedulesStore.list();
  deps.browserSocketServer.broadcast({ type: "schedules_updated", schedules });
}

export async function handleCreateSchedule(
  request: IncomingMessage,
  response: ServerResponse,
  deps: Deps
): Promise<void> {
  const body = await readJsonBody(request);

  if (!isRecord(body) || typeof body.name !== "string" || (body.name as string).trim() === "") {
    sendJson(response, 400, { error: "name is required" });
    return;
  }

  const schedule = await deps.schedulesStore.create({ name: (body.name as string).trim() });
  await broadcastSchedules(deps);
  sendJson(response, 201, { schedule });
}

export async function handleUpdateSchedule(
  request: IncomingMessage,
  response: ServerResponse,
  id: string,
  deps: Deps
): Promise<void> {
  const body = await readJsonBody(request);

  if (!isRecord(body) || typeof body.name !== "string" || (body.name as string).trim() === "") {
    sendJson(response, 400, { error: "name is required" });
    return;
  }

  const schedule = await deps.schedulesStore.update(id, { name: (body.name as string).trim() });

  if (!schedule) {
    sendJson(response, 404, { error: "Not found" });
    return;
  }

  await broadcastSchedules(deps);
  sendJson(response, 200, { schedule });
}

export async function handleDeleteSchedule(
  response: ServerResponse,
  id: string,
  deps: Deps
): Promise<void> {
  const removed = await deps.schedulesStore.remove(id);

  if (!removed) {
    sendJson(response, 404, { error: "Not found" });
    return;
  }

  if (deps.stateRef.current.activeScheduleId === id) {
    deps.stateRef.current = { ...deps.stateRef.current, activeScheduleId: null };
    await deps.controllerStateStore.save(deps.stateRef.current);
    deps.browserSocketServer.broadcast({
      type: "state_update",
      state: deps.stateRef.current,
      extensionConnections: deps.getExtensionConnectionCount()
    });
  }

  await broadcastSchedules(deps);
  sendJson(response, 200, { ok: true });
}

export async function handleDuplicateSchedule(
  response: ServerResponse,
  id: string,
  deps: Deps
): Promise<void> {
  const schedule = await deps.schedulesStore.duplicate(id);

  if (!schedule) {
    sendJson(response, 404, { error: "Not found" });
    return;
  }

  await broadcastSchedules(deps);
  sendJson(response, 201, { schedule });
}

export async function handleActivateSchedule(
  response: ServerResponse,
  id: string,
  deps: Deps
): Promise<void> {
  const schedules = await deps.schedulesStore.list();
  const exists = schedules.some((s) => s.id === id);

  if (!exists) {
    sendJson(response, 404, { error: "Not found" });
    return;
  }

  deps.stateRef.current = {
    ...deps.stateRef.current,
    activeScheduleId: id,
    scheduleEnabled: true,
    scheduleTabId: null
  };
  await deps.controllerStateStore.save(deps.stateRef.current);
  deps.browserSocketServer.broadcast({
    type: "state_update",
    state: deps.stateRef.current,
    extensionConnections: deps.getExtensionConnectionCount()
  });

  // Immediately open the most-recently-due bookmark in a new tab
  const active = schedules.find((s) => s.id === id);
  if (active) {
    await deps.scheduleRunner?.activateNow(active);
  }

  sendJson(response, 200, { ok: true });
}

export async function handleDeactivateSchedule(
  response: ServerResponse,
  id: string,
  deps: Deps
): Promise<void> {
  const schedules = await deps.schedulesStore.list();
  const exists = schedules.some((s) => s.id === id);

  if (!exists) {
    sendJson(response, 404, { error: "Not found" });
    return;
  }

  // Close the dedicated schedule tab before clearing state
  deps.scheduleRunner?.deactivateNow();

  deps.stateRef.current = {
    ...deps.stateRef.current,
    activeScheduleId: null,
    scheduleEnabled: false,
    scheduleTabId: null
  };
  await deps.controllerStateStore.save(deps.stateRef.current);
  deps.browserSocketServer.broadcast({
    type: "state_update",
    state: deps.stateRef.current,
    extensionConnections: deps.getExtensionConnectionCount()
  });
  sendJson(response, 200, { ok: true });
}

export async function handleAddEvent(
  request: IncomingMessage,
  response: ServerResponse,
  scheduleId: string,
  deps: Deps
): Promise<void> {
  const body = await readJsonBody(request);

  if (!isRecord(body)) {
    sendJson(response, 400, { error: "Invalid request body" });
    return;
  }

  const { time, bookmarkId, enabled, recurrence } = body;

  if (!isClockTime(time)) {
    sendJson(response, 400, { error: "time must be in HH:MM format (24-hour)" });
    return;
  }

  if (typeof bookmarkId !== "string" || bookmarkId === "") {
    sendJson(response, 400, { error: "bookmarkId is required" });
    return;
  }

  if (typeof enabled !== "boolean") {
    sendJson(response, 400, { error: "enabled must be a boolean" });
    return;
  }

  if (recurrence !== undefined && !isScheduleEventRecurrence(recurrence)) {
    sendJson(response, 400, { error: "recurrence is invalid" });
    return;
  }

  const schedule = await deps.schedulesStore.addEvent(scheduleId, {
    time,
    bookmarkId,
    enabled,
    ...(recurrence !== undefined ? { recurrence: recurrence as ScheduleEventRecurrence } : {})
  });

  if (!schedule) {
    sendJson(response, 404, { error: "Not found" });
    return;
  }

  await broadcastSchedules(deps);
  sendJson(response, 201, { schedule });
}

export async function handleUpdateEvent(
  request: IncomingMessage,
  response: ServerResponse,
  scheduleId: string,
  eventId: string,
  deps: Deps
): Promise<void> {
  const body = await readJsonBody(request);

  if (!isRecord(body)) {
    sendJson(response, 400, { error: "Invalid request body" });
    return;
  }

  const patch: {
    time?: string;
    bookmarkId?: string;
    enabled?: boolean;
    recurrence?: ScheduleEventRecurrence;
  } = {};

  if (body.time !== undefined) {
    if (!isClockTime(body.time)) {
      sendJson(response, 400, { error: "time must be in HH:MM format (24-hour)" });
      return;
    }
    patch.time = body.time as string;
  }

  if (body.bookmarkId !== undefined) {
    if (typeof body.bookmarkId !== "string" || body.bookmarkId === "") {
      sendJson(response, 400, { error: "bookmarkId must be a non-empty string" });
      return;
    }
    patch.bookmarkId = body.bookmarkId as string;
  }

  if (body.enabled !== undefined) {
    if (typeof body.enabled !== "boolean") {
      sendJson(response, 400, { error: "enabled must be a boolean" });
      return;
    }
    patch.enabled = body.enabled as boolean;
  }

  if (body.recurrence !== undefined) {
    if (!isScheduleEventRecurrence(body.recurrence)) {
      sendJson(response, 400, { error: "recurrence is invalid" });
      return;
    }
    patch.recurrence = body.recurrence;
  }

  const schedule = await deps.schedulesStore.updateEvent(scheduleId, eventId, patch);

  if (!schedule) {
    sendJson(response, 404, { error: "Not found" });
    return;
  }

  await broadcastSchedules(deps);
  sendJson(response, 200, { schedule });
}

export async function handleRemoveEvent(
  response: ServerResponse,
  scheduleId: string,
  eventId: string,
  deps: Deps
): Promise<void> {
  const schedule = await deps.schedulesStore.removeEvent(scheduleId, eventId);

  if (!schedule) {
    sendJson(response, 404, { error: "Not found" });
    return;
  }

  await broadcastSchedules(deps);
  sendJson(response, 200, { schedule });
}
