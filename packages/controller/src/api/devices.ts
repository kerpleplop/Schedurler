import type { IncomingMessage, ServerResponse } from "node:http";
import type { Device } from "@schedurler/shared";
import type { DevicesStore } from "../storage/devicesStore";
import type { SchedulesStore } from "../storage/schedulesStore";
import type { TabRegistry } from "../tabRegistry";
import type { BrowserSocketServer } from "../ws/browserSocketServer";
import type { ControllerSocketServer } from "../ws/socketServer";

const MAX_DEVICE_NAME_LENGTH = 60;

/** Browser-facing view of a device: the stored record plus live connection info. */
export type DeviceView = Device & {
  online: boolean;
  tabCount: number;
};

type Deps = {
  devicesStore: DevicesStore;
  schedulesStore: SchedulesStore;
  socketServer: ControllerSocketServer;
  tabRegistry: TabRegistry;
  browserSocketServer: BrowserSocketServer;
};

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

export async function listDeviceViews(
  deps: Pick<Deps, "devicesStore" | "socketServer" | "tabRegistry">
): Promise<DeviceView[]> {
  const devices = await deps.devicesStore.list();
  return devices.map((device) => ({
    ...device,
    online: deps.socketServer.isDeviceConnected(device.id),
    tabCount: deps.tabRegistry.countForDevice(device.id)
  }));
}

export async function broadcastDevices(
  deps: Pick<Deps, "devicesStore" | "socketServer" | "tabRegistry" | "browserSocketServer">
): Promise<void> {
  deps.browserSocketServer.broadcast({
    type: "devices_updated",
    devices: await listDeviceViews(deps)
  });
}

export async function handleListDevices(response: ServerResponse, deps: Deps): Promise<void> {
  sendJson(response, 200, { devices: await listDeviceViews(deps) });
}

export async function handleRenameDevice(
  request: IncomingMessage,
  response: ServerResponse,
  id: string,
  deps: Deps
): Promise<void> {
  const body = await readJsonBody(request);
  const name =
    typeof body === "object" && body !== null && typeof (body as { name?: unknown }).name === "string"
      ? ((body as { name: string }).name).trim()
      : "";

  if (name === "" || name.length > MAX_DEVICE_NAME_LENGTH) {
    sendJson(response, 400, {
      error: `name is required and must be at most ${MAX_DEVICE_NAME_LENGTH} characters`
    });
    return;
  }

  const device = await deps.devicesStore.rename(id, name);

  if (!device) {
    sendJson(response, 404, { error: "Not found" });
    return;
  }

  await broadcastDevices(deps);
  sendJson(response, 200, { device });
}

/** Forget a device. Refused while it is connected or still referenced by a schedule. */
export async function handleForgetDevice(
  response: ServerResponse,
  id: string,
  deps: Deps
): Promise<void> {
  const devices = await deps.devicesStore.list();

  if (!devices.some((d) => d.id === id)) {
    sendJson(response, 404, { error: "Not found" });
    return;
  }

  if (deps.socketServer.isDeviceConnected(id)) {
    sendJson(response, 409, { error: "Device is connected and cannot be forgotten" });
    return;
  }

  // Dropping the id from target lists would silently widen those schedules to every device.
  const schedules = await deps.schedulesStore.list();
  const inUse = schedules.some(
    (s) =>
      s.targetDeviceIds?.includes(id) || s.events.some((e) => e.targetDeviceIds?.includes(id))
  );

  if (inUse) {
    sendJson(response, 409, { error: "Device is targeted by a schedule; remove it from targets first" });
    return;
  }

  await deps.devicesStore.remove(id);
  await broadcastDevices(deps);
  sendJson(response, 200, { ok: true });
}
