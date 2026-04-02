import type { Server as HttpServer } from "node:http";
import {
  isExtensionToControllerMessage,
  type ControllerToExtensionMessage,
  type ExtensionToControllerMessage
} from "@schedurler/shared";
import { WebSocket, WebSocketServer, type RawData } from "ws";

export type ControllerSocketServerOptions = {
  server: HttpServer;
  path: string;
  onMessage: (message: ExtensionToControllerMessage) => Promise<void> | void;
};

export class ControllerSocketServer {
  private readonly wss: WebSocketServer;
  private readonly sockets = new Set<WebSocket>();
  private readonly onMessage: ControllerSocketServerOptions["onMessage"];

  constructor(options: ControllerSocketServerOptions) {
    this.onMessage = options.onMessage;
    this.wss = new WebSocketServer({
      server: options.server,
      path: options.path
    });
    this.wss.on("error", (error) => {
      console.error("[schedurler] websocket server error", error);
    });

    this.wss.on("connection", (socket) => {
      this.sockets.add(socket);

      socket.on("message", async (data) => {
        await this.handleMessage(data);
      });

      socket.on("close", () => {
        this.sockets.delete(socket);
      });

      socket.on("error", (error) => {
        console.error("[schedurler] websocket client error", error);
      });
    });
  }

  getConnectionCount(): number {
    let count = 0;

    for (const socket of this.sockets) {
      if (socket.readyState === WebSocket.OPEN) {
        count += 1;
      }
    }

    return count;
  }

  broadcastCommand(command: ControllerToExtensionMessage): number {
    const payload = JSON.stringify(command);
    let deliveredTo = 0;

    for (const socket of this.sockets) {
      if (socket.readyState === WebSocket.OPEN) {
        try {
          socket.send(payload);
          deliveredTo += 1;
        } catch (error) {
          this.sockets.delete(socket);
          socket.terminate();
          console.error("[schedurler] failed to send websocket command", error);
        }
      }
    }

    return deliveredTo;
  }

  private async handleMessage(data: RawData): Promise<void> {
    const text = toUtf8(data);
    let parsed: unknown;

    try {
      parsed = JSON.parse(text);
    } catch (error) {
      console.error("[schedurler] invalid websocket JSON", error);
      return;
    }

    if (!isExtensionToControllerMessage(parsed)) {
      console.error("[schedurler] invalid extension message", parsed);
      return;
    }

    await this.onMessage(parsed);
  }
}

function toUtf8(data: RawData): string {
  if (typeof data === "string") {
    return data;
  }

  if (Array.isArray(data)) {
    return Buffer.concat(data).toString("utf8");
  }

  if (data instanceof ArrayBuffer) {
    return Buffer.from(data).toString("utf8");
  }

  return data.toString("utf8");
}
