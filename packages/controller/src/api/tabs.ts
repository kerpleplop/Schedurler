import { randomUUID } from "node:crypto";
import type { ServerResponse } from "node:http";
import type { CloseTabCommand, GetTabsCommand } from "@schedurler/shared";
import type { TabRegistry } from "../tabRegistry";
import type { ControllerSocketServer } from "../ws/socketServer";

function sendJson(response: ServerResponse, status: number, payload: unknown): void {
  response.statusCode = status;
  response.setHeader("content-type", "application/json; charset=utf-8");
  response.end(JSON.stringify(payload, null, 2));
}

export function handleGetTabs(
  response: ServerResponse,
  deps: { tabRegistry: TabRegistry; socketServer: ControllerSocketServer }
): void {
  // Ask any connected device we have no tabs for to send a fresh snapshot.
  // The result arrives asynchronously via tabs_updated on the UI WebSocket.
  for (const deviceId of deps.socketServer.getConnectedDeviceIds()) {
    if (deps.tabRegistry.countForDevice(deviceId) === 0) {
      const command: GetTabsCommand = {
        type: "get_tabs",
        commandId: randomUUID(),
        sentAt: new Date().toISOString()
      };
      deps.socketServer.sendCommand(command, deviceId);
    }
  }

  sendJson(response, 200, { tabs: deps.tabRegistry.all() });
}

export async function handleCloseTab(
  response: ServerResponse,
  deviceId: string,
  tabId: number,
  deps: { socketServer: ControllerSocketServer }
): Promise<void> {
  const command: CloseTabCommand = {
    type: "close_tab",
    commandId: randomUUID(),
    sentAt: new Date().toISOString(),
    tabId
  };

  const sent = deps.socketServer.sendCommand(command, deviceId);

  if (!sent) {
    sendJson(response, 503, { error: "Device is not connected" });
    return;
  }

  sendJson(response, 202, { ok: true });
}
