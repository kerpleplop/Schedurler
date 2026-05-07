import type { IncomingMessage } from "node:http";
import type { Duplex } from "node:stream";
import {
  isExtensionToControllerMessage,
  type ControllerToExtensionMessage,
  type ExtensionToControllerMessage
} from "@schedurler/shared";
import { WebSocket, WebSocketServer, type RawData } from "ws";

export type ControllerSocketServerOptions = {
  onMessage: (message: ExtensionToControllerMessage) => Promise<void> | void;
  onClose: () => void;
};

const HEARTBEAT_INTERVAL_MS = 15_000;

export class ControllerSocketServer {
  private readonly wss: WebSocketServer;
  private readonly sockets = new Set<WebSocket>();
  private readonly alive = new WeakSet<WebSocket>();
  private readonly onMessage: ControllerSocketServerOptions["onMessage"];
  private readonly heartbeat: ReturnType<typeof setInterval>;

  constructor(options: ControllerSocketServerOptions) {
    this.onMessage = options.onMessage;
    this.wss = new WebSocketServer({ noServer: true });

    this.wss.on("connection", (socket) => {
      this.alive.add(socket);
      this.sockets.add(socket);

      socket.on("pong", () => this.alive.add(socket));

      socket.on("message", async (data) => {
        await this.handleMessage(data);
      });

      socket.on("close", () => {
        this.sockets.delete(socket);
        options.onClose();
      });

      socket.on("error", (error) => {
        console.error("[schedurler] websocket client error", error);
      });
    });

    this.heartbeat = setInterval(() => {
      for (const socket of this.sockets) {
        if (!this.alive.has(socket)) {
          socket.terminate();
          this.sockets.delete(socket);
          continue;
        }
        this.alive.delete(socket);
        socket.ping();
      }
    }, HEARTBEAT_INTERVAL_MS);

    this.wss.on("close", () => clearInterval(this.heartbeat));
  }

  handleUpgrade(request: IncomingMessage, socket: Duplex, head: Buffer): void {
    this.wss.handleUpgrade(request, socket, head, (ws) => {
      this.wss.emit("connection", ws, request);
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

  sendCommand(command: ControllerToExtensionMessage): boolean {
    const payload = JSON.stringify(command);

    for (const socket of this.sockets) {
      if (socket.readyState === WebSocket.OPEN) {
        socket.send(payload);
        return true;
      }
    }

    return false;
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

