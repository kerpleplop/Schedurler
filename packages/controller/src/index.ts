import { randomUUID } from "node:crypto";
import type {
  ControllerState,
  ExtensionToControllerMessage
} from "@schedurler/shared";
import { loadControllerConfig, persistResolvedSettings } from "./config";
import { LogBuffer } from "./logBuffer";
import { ScheduleRunner } from "./scheduler";
import { startControllerServer } from "./server";
import { BookmarksStore } from "./storage/bookmarksStore";
import { ControllerStateStore } from "./storage/controllerStateStore";
import { SchedulesStore } from "./storage/schedulesStore";
import { resolveStoragePaths } from "./storage/paths";
import type { ControllerSocketServer } from "./ws/socketServer";
import type { BrowserSocketServer } from "./ws/browserSocketServer";

async function main(): Promise<void> {
  const { settings, wsPath } = loadControllerConfig();
  const storagePaths = resolveStoragePaths(settings);

  const bookmarksStore = new BookmarksStore(storagePaths.bookmarksFile);
  const schedulesStore = new SchedulesStore(storagePaths.schedulesFile);
  const controllerStateStore = new ControllerStateStore(
    storagePaths.controllerStateFile
  );

  await bookmarksStore.ensure();
  await schedulesStore.ensure();
  await persistResolvedSettings(storagePaths, settings);

  const stateRef = {
    current: await controllerStateStore.loadOrCreate(createDefaultState())
  };

  const logBuffer = new LogBuffer();

  // Declared before startControllerServer so closures below can reference it.
  // Assigned immediately after, before any callback can fire.
  let log: (level: "info" | "warn" | "error", message: string) => void = () => {};

  const { socketServer, browserSocketServer } = await startControllerServer({
    settings,
    wsPath,
    stateRef,
    bookmarksStore,
    schedulesStore,
    controllerStateStore,
    getLogs: () => logBuffer.getAll(),
    onExtensionMessage: async (message) => {
      await handleExtensionMessage(
        message,
        stateRef,
        controllerStateStore,
        socketServer,
        browserSocketServer,
        log
      );
    },
    onExtensionClose: () => {
      log("info", "Extension disconnected");
      browserSocketServer.broadcast({
        type: "state_update",
        state: stateRef.current,
        extensionConnections: socketServer.getConnectionCount()
      });
    }
  });

  log = (level, message) => {
    const entry = logBuffer.add(level, message);
    browserSocketServer.broadcast({ type: "log_entry", entry });
  };

  new ScheduleRunner({
    stateRef,
    schedulesStore,
    bookmarksStore,
    socketServer,
    controllerStateStore,
    browserSocketServer,
    onLog: log
  });

  const base = `http://${settings.host}:${settings.port}`;
  console.log(`[schedurler] controller listening on ${base}`);
  console.log(`[schedurler] web UI available at ${base}/`);
  console.log(`[schedurler] websocket endpoint ws://${settings.host}:${settings.port}${wsPath}`);
}

function createDefaultState(): ControllerState {
  return {
    controllerId: randomUUID(),
    activeScheduleId: null,
    scheduleEnabled: false,
    currentBookmarkId: null,
    activeTabAction: {
      bookmarkId: null,
      url: null,
      startedAt: null,
      source: "system",
      status: "idle"
    }
  };
}

async function handleExtensionMessage(
  message: ExtensionToControllerMessage,
  stateRef: { current: ControllerState },
  controllerStateStore: ControllerStateStore,
  socketServer: ControllerSocketServer,
  browserSocketServer: BrowserSocketServer,
  log: (level: "info" | "warn" | "error", message: string) => void
): Promise<void> {
  switch (message.type) {
    case "hello":
      log("info", `Extension connected: ${message.browser} v${message.version ?? "unknown"}`);
      browserSocketServer.broadcast({
        type: "state_update",
        state: stateRef.current,
        extensionConnections: socketServer.getConnectionCount()
      });
      return;
    case "tab_opened":
      stateRef.current = {
        ...stateRef.current,
        currentBookmarkId: message.bookmarkId ?? stateRef.current.currentBookmarkId,
        activeTabAction: {
          bookmarkId: message.bookmarkId ?? null,
          url: message.url,
          startedAt:
            stateRef.current.activeTabAction.startedAt ?? message.observedAt,
          source: stateRef.current.activeTabAction.source,
          status: "completed"
        }
      };
      break;
    case "command_failed":
      stateRef.current = {
        ...stateRef.current,
        activeTabAction: {
          bookmarkId:
            message.bookmarkId ?? stateRef.current.activeTabAction.bookmarkId,
          url: stateRef.current.activeTabAction.url,
          startedAt: stateRef.current.activeTabAction.startedAt,
          source: stateRef.current.activeTabAction.source,
          status: "failed",
          errorMessage: message.errorMessage
        }
      };
      break;
    case "status":
      if (message.status === "error") {
        stateRef.current = {
          ...stateRef.current,
          activeTabAction: {
            ...stateRef.current.activeTabAction,
            status: "failed",
            errorMessage: message.message ?? "Extension reported an error"
          }
        };
      }
      break;
  }

  await controllerStateStore.save(stateRef.current);

  browserSocketServer.broadcast({
    type: "state_update",
    state: stateRef.current,
    extensionConnections: socketServer.getConnectionCount()
  });
}

main().catch((error) => {
  console.error("[schedurler] controller failed to start", error);
  process.exitCode = 1;
});
