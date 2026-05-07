import type { Server as HttpServer } from "node:http";
import type { ControllerState } from "@schedurler/shared";
import { WebSocket, WebSocketServer } from "ws";

export type BrowserEvent =
  | { type: "state_update"; state: ControllerState; extensionConnections: number }
  | { type: "bookmarks_updated"; bookmarks: unknown[] }
  | { type: "schedules_updated"; schedules: unknown[] };

export class BrowserSocketServer {
  private readonly wss: WebSocketServer;
  private readonly sockets = new Set<WebSocket>();

  constructor(server: HttpServer, path: string) {
    this.wss = new WebSocketServer({ server, path });

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
