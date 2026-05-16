import { randomUUID } from "node:crypto";
import type { ServerResponse } from "node:http";
import type { CloseTabCommand, GetTabsCommand } from "@schedurler/shared";
import type { TabEntry } from "../index";
import type { ControllerSocketServer } from "../ws/socketServer";

function sendJson(response: ServerResponse, status: number, payload: unknown): void {
  response.statusCode = status;
  response.setHeader("content-type", "application/json; charset=utf-8");
  response.end(JSON.stringify(payload, null, 2));
}

export function handleGetTabs(
  response: ServerResponse,
  deps: { tabRegistry: Map<number, TabEntry>; socketServer: ControllerSocketServer }
): void {
  const tabs = Array.from(deps.tabRegistry.values());

  // If the registry is empty and an extension is connected, request a fresh snapshot.
  // The result arrives asynchronously via tabs_updated on the UI WebSocket.
  if (tabs.length === 0) {
    const command: GetTabsCommand = {
      type: "get_tabs",
      commandId: randomUUID(),
      sentAt: new Date().toISOString()
    };
    deps.socketServer.sendCommand(command);
  }

  sendJson(response, 200, { tabs });
}

export async function handleCloseTab(
  response: ServerResponse,
  tabId: number,
  deps: { socketServer: ControllerSocketServer }
): Promise<void> {
  const command: CloseTabCommand = {
    type: "close_tab",
    commandId: randomUUID(),
    sentAt: new Date().toISOString(),
    tabId
  };

  const sent = deps.socketServer.sendCommand(command);

  if (!sent) {
    sendJson(response, 503, { error: "No extension is connected" });
    return;
  }

  sendJson(response, 202, { ok: true });
}
