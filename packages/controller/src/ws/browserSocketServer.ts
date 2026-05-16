import type { IncomingMessage } from "node:http";
import type { Duplex } from "node:stream";
import type { ControllerState } from "@schedurler/shared";
import { WebSocket, WebSocketServer } from "ws";
import type { LogEntry } from "../logBuffer";
import type { TabEntry } from "../index";

export type BrowserEvent =
  | { type: "state_update"; state: ControllerState; extensionConnections: number }
  | { type: "bookmarks_updated"; bookmarks: unknown[] }
  | { type: "schedules_updated"; schedules: unknown[] }
  | { type: "log_entry"; entry: LogEntry }
  | { type: "tabs_updated"; tabs: TabEntry[] };

export class BrowserSocketServer {
  private readonly wss: WebSocketServer;
  private readonly sockets = new Set<WebSocket>();

  constructor() {
    this.wss = new WebSocketServer({ noServer: true });

    this.wss.on("connection", (socket) => {
      this.sockets.add(socket);

      socket.on("close", () => {
        this.sockets.delete(socket);
      });

      socket.on("error", (error) => {
        console.error("[schedurler] browser websocket error", error);
      });
    });
  }

  handleUpgrade(request: IncomingMessage, socket: Duplex, head: Buffer): void {
    this.wss.handleUpgrade(request, socket, head, (ws) => {
      this.wss.emit("connection", ws, request);
    });
  }

  broadcast(event: BrowserEvent): void {
    const payload = JSON.stringify(event);

    for (const socket of this.sockets) {
      if (socket.readyState === WebSocket.OPEN) {
        socket.send(payload);
      }
    }
  }

  getConnectionCount(): number {
    let count = 0;
    for (const socket of this.sockets) {
      if (socket.readyState === WebSocket.OPEN) count += 1;
    }
    return count;
  }
}
