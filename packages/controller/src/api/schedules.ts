import type { IncomingMessage, ServerResponse } from "node:http";
import { isClockTime, isScheduleEventRecurrence, isStringArray } from "@schedurler/shared";
import type { ControllerState, ScheduleEventRecurrence } from "@schedurler/shared";
import type { ControllerStateStore } from "../storage/controllerStateStore";
import type { DevicesStore } from "../storage/devicesStore";
import type { SchedulesStore } from "../storage/schedulesStore";
import type { BrowserSocketServer } from "../ws/browserSocketServer";
import type { ScheduleRunner } from "../scheduler";

type Deps = {
  schedulesStore: SchedulesStore;
  devicesStore: DevicesStore;
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

/** Validate a targetDeviceIds field: an array of ids of devices the controller knows. Empty means "no override". */
async function parseTargetDeviceIds(
  value: unknown,
  deps: Deps
): Promise<{ ids: string[] } | { error: string }> {
  if (!isStringArray(value)) {
    return { error: "targetDeviceIds must be an array of device ids" };
  }

  const known = new Set((await deps.devicesStore.list()).map((d) => d.id));
  const unknown = value.find((id) => !known.has(id));

  if (unknown !== undefined) {
    return { error: `Unknown device: ${unknown}` };
  }

  return { ids: Array.from(new Set(value)) };
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

  if (!isRecord(body)) {
    sendJson(response, 400, { error: "Invalid request body" });
    return;
  }

  const patch: { name?: string; targetDeviceIds?: string[] } = {};

  if (body.name !== undefined) {
    if (typeof body.name !== "string" || body.name.trim() === "") {
      sendJson(response, 400, { error: "name must be a non-empty string" });
      return;
    }
    patch.name = body.name.trim();
  }

  if (body.targetDeviceIds !== undefined) {
    const parsed = await parseTargetDeviceIds(body.targetDeviceIds, deps);
    if ("error" in parsed) {
      sendJson(response, 400, { error: parsed.error });
      return;
    }
    patch.targetDeviceIds = parsed.ids;
  }

  if (patch.name === undefined && patch.targetDeviceIds === undefined) {
    sendJson(response, 400, { error: "name or targetDeviceIds is required" });
    return;
  }

  const schedule = await deps.schedulesStore.update(id, patch);

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
    scheduleTabIds: {}
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
    scheduleTabIds: {}
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

  const { time, bookmarkId, enabled, recurrence, targetDeviceIds } = body;

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

  let targetIds: string[] | undefined;
  if (targetDeviceIds !== undefined) {
    const parsed = await parseTargetDeviceIds(targetDeviceIds, deps);
    if ("error" in parsed) {
      sendJson(response, 400, { error: parsed.error });
      return;
    }
    targetIds = parsed.ids;
  }

  const schedule = await deps.schedulesStore.addEvent(scheduleId, {
    time,
    bookmarkId,
    enabled,
    ...(recurrence !== undefined ? { recurrence: recurrence as ScheduleEventRecurrence } : {}),
    ...(targetIds !== undefined ? { targetDeviceIds: targetIds } : {})
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
    targetDeviceIds?: string[];
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

  if (body.targetDeviceIds !== undefined) {
    const parsed = await parseTargetDeviceIds(body.targetDeviceIds, deps);
    if ("error" in parsed) {
      sendJson(response, 400, { error: parsed.error });
      return;
    }
    patch.targetDeviceIds = parsed.ids;
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
