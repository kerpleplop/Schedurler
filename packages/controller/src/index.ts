import { randomUUID } from "node:crypto";
import type {
  ControllerState,
  ExtensionToControllerMessage
} from "@schedurler/shared";
import { loadControllerConfig, persistResolvedSettings } from "./config";
import { startControllerServer } from "./server";
import { BookmarksStore } from "./storage/bookmarksStore";
import { ControllerStateStore } from "./storage/controllerStateStore";
import { SchedulesStore } from "./storage/schedulesStore";
import { resolveStoragePaths } from "./storage/paths";

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

  await startControllerServer({
    settings,
    wsPath,
    stateRef,
    bookmarksStore,
    schedulesStore,
    controllerStateStore,
    onExtensionMessage: async (message) => {
      await handleExtensionMessage(message, stateRef, controllerStateStore);
    }
  });

  console.log(
    `[schedurler] controller listening on http://${settings.host}:${settings.port}`
  );
  console.log(
    `[schedurler] websocket endpoint ws://${settings.host}:${settings.port}${wsPath}`
  );
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
  controllerStateStore: ControllerStateStore
): Promise<void> {
  switch (message.type) {
    case "hello":
      console.log(
        `[schedurler] extension connected (${message.browser}) ${message.version ?? ""}`.trim()
      );
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
}

main().catch((error) => {
  console.error("[schedurler] controller failed to start", error);
  process.exitCode = 1;
});

