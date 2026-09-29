import type { IncomingMessage } from "node:http";
import type { Duplex } from "node:stream";
import {
  isExtensionToControllerMessage,
  type ControllerToExtensionMessage,
  type ExtensionToControllerMessage
} from "@schedurler/shared";
import { WebSocket, WebSocketServer, type RawData } from "ws";

export type ControllerSocketServerOptions = {
  /** Called for every valid message once the socket has identified itself with a hello. */
  onMessage: (message: ExtensionToControllerMessage, deviceId: string) => Promise<void> | void;
  /** Called when the socket currently bound to a device closes. */
  onClose: (deviceId: string) => void;
};

const HEARTBEAT_INTERVAL_MS = 15_000;

export class ControllerSocketServer {
  private readonly wss: WebSocketServer;
  private readonly sockets = new Set<WebSocket>();
  private readonly alive = new WeakSet<WebSocket>();
  // A device is bound to its socket by the hello message; the newest socket wins.
  private readonly socketsByDevice = new Map<string, WebSocket>();
  private readonly deviceBySocket = new WeakMap<WebSocket, string>();
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
        try {
          await this.handleMessage(socket, data);
        } catch (error) {
          // One bad message must not take the controller (and every other device) down.
          console.error("[schedurler] failed to handle extension message", error);
        }
      });

      socket.on("close", () => {
        this.sockets.delete(socket);

        // A socket replaced by a reconnect must not mark the device as gone.
        const deviceId = this.deviceBySocket.get(socket);
        if (deviceId !== undefined && this.socketsByDevice.get(deviceId) === socket) {
          this.socketsByDevice.delete(deviceId);
          options.onClose(deviceId);
        }
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

  /** Ids of devices that have said hello and still have an open socket. */
  getConnectedDeviceIds(): string[] {
    const ids: string[] = [];

    for (const [deviceId, socket] of this.socketsByDevice) {
      if (socket.readyState === WebSocket.OPEN) {
        ids.push(deviceId);
      }
    }

    return ids;
  }

  isDeviceConnected(deviceId: string): boolean {
    return this.socketsByDevice.get(deviceId)?.readyState === WebSocket.OPEN;
  }

  getConnectionCount(): number {
    return this.getConnectedDeviceIds().length;
  }

  /** Send a command to one device. Returns false if that device is not connected. */
  sendCommand(command: ControllerToExtensionMessage, deviceId: string): boolean {
    const socket = this.socketsByDevice.get(deviceId);

    if (!socket || socket.readyState !== WebSocket.OPEN) {
      return false;
    }

    socket.send(JSON.stringify(command));
    return true;
  }

  private async handleMessage(socket: WebSocket, data: RawData): Promise<void> {
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

    if (parsed.type === "hello") {
      this.bindDevice(socket, parsed.deviceId);
    }

    const deviceId = this.deviceBySocket.get(socket);

    if (deviceId === undefined) {
      console.error("[schedurler] ignoring message from socket that has not sent hello");
      return;
    }

    await this.onMessage(parsed, deviceId);
  }

  private bindDevice(socket: WebSocket, deviceId: string): void {
    const previous = this.socketsByDevice.get(deviceId);

    // Same install reconnecting before the old socket timed out: drop the stale one.
    if (previous && previous !== socket) {
      previous.terminate();
    }

    this.socketsByDevice.set(deviceId, socket);
    this.deviceBySocket.set(socket, deviceId);
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

