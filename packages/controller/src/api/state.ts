import type { IncomingMessage, ServerResponse } from "node:http";
import type { ControllerState } from "@schedurler/shared";
import type { ControllerStateStore } from "../storage/controllerStateStore";
import type { BrowserSocketServer } from "../ws/browserSocketServer";

type Deps = {
  controllerStateStore: ControllerStateStore;
  stateRef: { current: ControllerState };
  browserSocketServer: BrowserSocketServer;
  getExtensionConnectionCount: () => number;
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

export function handleGetState(
  response: ServerResponse,
  deps: Deps
): void {
  sendJson(response, 200, {
    state: deps.stateRef.current,
    extensionConnections: deps.getExtensionConnectionCount()
  });
}

export async function handleSetScheduleEnabled(
  request: IncomingMessage,
  response: ServerResponse,
  deps: Deps
): Promise<void> {
  const body = await readJsonBody(request);

  if (
    typeof body !== "object" ||
    body === null ||
    typeof (body as Record<string, unknown>).enabled !== "boolean"
  ) {
    sendJson(response, 400, { error: "enabled must be a boolean" });
    return;
  }

  const enabled = (body as Record<string, unknown>).enabled as boolean;
  deps.stateRef.current = { ...deps.stateRef.current, scheduleEnabled: enabled };
  await deps.controllerStateStore.save(deps.stateRef.current);

  deps.browserSocketServer.broadcast({
    type: "state_update",
    state: deps.stateRef.current,
    extensionConnections: deps.getExtensionConnectionCount()
  });

  sendJson(response, 200, { ok: true });
}
