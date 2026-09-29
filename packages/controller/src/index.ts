import { randomUUID } from "node:crypto";
import type {
  ControllerState,
  ExtensionToControllerMessage
} from "@schedurler/shared";
import { broadcastDevices } from "./api/devices";
import { loadControllerConfig, persistResolvedSettings } from "./config";
import { LogBuffer } from "./logBuffer";
import { ScheduleRunner } from "./scheduler";
import { startControllerServer } from "./server";
import { BookmarksStore } from "./storage/bookmarksStore";
import { ControllerStateStore } from "./storage/controllerStateStore";
import { DevicesStore } from "./storage/devicesStore";
import { SchedulesStore } from "./storage/schedulesStore";
import { resolveStoragePaths } from "./storage/paths";
import { TabRegistry } from "./tabRegistry";
import type { ControllerSocketServer } from "./ws/socketServer";
import type { BrowserSocketServer } from "./ws/browserSocketServer";

async function main(): Promise<void> {
  const { settings, wsPath } = loadControllerConfig();
  const storagePaths = resolveStoragePaths(settings);

  const bookmarksStore = new BookmarksStore(storagePaths.bookmarksFile);
  const schedulesStore = new SchedulesStore(storagePaths.schedulesFile);
  const devicesStore = new DevicesStore(storagePaths.devicesFile);
  const controllerStateStore = new ControllerStateStore(
    storagePaths.controllerStateFile
  );

  await bookmarksStore.ensure();
  await schedulesStore.ensure();
  await devicesStore.ensure();
  await persistResolvedSettings(storagePaths, settings);

  const stateRef = {
    current: await controllerStateStore.loadOrCreate(createDefaultState())
  };

  // Volatile in-memory tab registry — repopulated by each extension on connect.
  // Not persisted; stale scheduleTabIds from disk are cleared as each device says hello.
  const tabRegistry = new TabRegistry();

  const logBuffer = new LogBuffer();

  // scheduleRunnerRef is populated after the server starts.
  // Closures below can reference it safely because HTTP callbacks
  // only fire after the event loop returns from main().
  const scheduleRunnerRef: { current: ScheduleRunner | null } = { current: null };

  // log is declared before startControllerServer so closures can reference it,
  // then assigned after to get access to browserSocketServer.
  let log: (level: "info" | "warn" | "error", message: string) => void = () => {};

  const { socketServer, browserSocketServer } = await startControllerServer({
    settings,
    wsPath,
    stateRef,
    bookmarksStore,
    schedulesStore,
    devicesStore,
    controllerStateStore,
    scheduleRunnerRef,
    tabRegistry,
    getLogs: () => logBuffer.getAll(),
    onExtensionMessage: async (message, deviceId) => {
      await handleExtensionMessage(message, deviceId, {
        stateRef,
        tabRegistry,
        controllerStateStore,
        socketServer,
        browserSocketServer,
        bookmarksStore,
        schedulesStore,
        devicesStore,
        log: (...args) => log(...args)
      });
    },
    onExtensionClose: (deviceId) => {
      handleDeviceClosed(deviceId, {
        stateRef,
        tabRegistry,
        controllerStateStore,
        socketServer,
        browserSocketServer,
        devicesStore,
        log: (...args) => log(...args)
      }).catch((error) => {
        console.error("[schedurler] failed to handle device disconnect", error);
      });
    }
  });

  log = (level, message) => {
    const entry = logBuffer.add(level, message);
    browserSocketServer.broadcast({ type: "log_entry", entry });
  };

  scheduleRunnerRef.current = new ScheduleRunner({
    stateRef,
    schedulesStore,
    bookmarksStore,
    devicesStore,
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
    scheduleTabIds: {},
    activeTabAction: {
      bookmarkId: null,
      url: null,
      startedAt: null,
      source: "system",
      status: "idle"
    }
  };
}

type MessageContext = {
  stateRef: { current: ControllerState };
  tabRegistry: TabRegistry;
  controllerStateStore: ControllerStateStore;
  socketServer: ControllerSocketServer;
  browserSocketServer: BrowserSocketServer;
  bookmarksStore: BookmarksStore;
  schedulesStore: SchedulesStore;
  devicesStore: DevicesStore;
  log: (level: "info" | "warn" | "error", message: string) => void;
};

/** Return a copy of the per-device schedule tab map without one device. */
function withoutScheduleTab(
  scheduleTabIds: Record<string, number>,
  deviceId: string
): Record<string, number> {
  const { [deviceId]: _removed, ...rest } = scheduleTabIds;
  return rest;
}

/** A device's socket went away: forget its tabs, and stamp when it was last seen. */
async function handleDeviceClosed(
  deviceId: string,
  ctx: Omit<MessageContext, "bookmarksStore" | "schedulesStore">
): Promise<void> {
  const { stateRef, tabRegistry, controllerStateStore, socketServer, browserSocketServer, devicesStore, log } = ctx;

  const devices = await devicesStore.list();
  const name = devices.find((d) => d.id === deviceId)?.name ?? deviceId;
  log("info", `Extension disconnected: ${name}`);

  await devicesStore.touch(deviceId, new Date().toISOString());
  tabRegistry.clearDevice(deviceId);

  if (deviceId in stateRef.current.scheduleTabIds) {
    stateRef.current = {
      ...stateRef.current,
      scheduleTabIds: withoutScheduleTab(stateRef.current.scheduleTabIds, deviceId)
    };
    await controllerStateStore.save(stateRef.current);
  }

  browserSocketServer.broadcast({ type: "tabs_updated", tabs: tabRegistry.all() });
  browserSocketServer.broadcast({
    type: "state_update",
    state: stateRef.current,
    extensionConnections: socketServer.getConnectionCount()
  });
  await broadcastDevices({ devicesStore, socketServer, tabRegistry, browserSocketServer });
}

async function handleExtensionMessage(
  message: ExtensionToControllerMessage,
  deviceId: string,
  ctx: MessageContext
): Promise<void> {
  const { stateRef, tabRegistry, controllerStateStore, socketServer, browserSocketServer, devicesStore, log } = ctx;

  switch (message.type) {
    case "hello": {
      const device = await devicesStore.registerSeen(message, new Date().toISOString());
      log(
        "info",
        `Extension connected: ${device.name} (${message.browser} v${message.version ?? "unknown"})`
      );
      // Clear this device's stale schedule tab — the tab may no longer exist after a restart
      if (deviceId in stateRef.current.scheduleTabIds) {
        stateRef.current = {
          ...stateRef.current,
          scheduleTabIds: withoutScheduleTab(stateRef.current.scheduleTabIds, deviceId)
        };
        await controllerStateStore.save(stateRef.current);
      }
      browserSocketServer.broadcast({
        type: "state_update",
        state: stateRef.current,
        extensionConnections: socketServer.getConnectionCount()
      });
      await broadcastDevices({ devicesStore, socketServer, tabRegistry, browserSocketServer });
      return;
    }

    case "tab_opened": {
      const isScheduleSource = stateRef.current.activeTabAction.source === "schedule";

      stateRef.current = {
        ...stateRef.current,
        currentBookmarkId: message.bookmarkId ?? stateRef.current.currentBookmarkId,
        // If from a schedule, record this as the device's dedicated schedule tab
        scheduleTabIds: isScheduleSource
          ? { ...stateRef.current.scheduleTabIds, [deviceId]: message.tabId }
          : stateRef.current.scheduleTabIds,
        activeTabAction: {
          bookmarkId: message.bookmarkId ?? null,
          url: message.url,
          startedAt: stateRef.current.activeTabAction.startedAt ?? message.observedAt,
          source: stateRef.current.activeTabAction.source,
          status: "completed"
        }
      };

      // Update tab registry entry with label
      const existing = tabRegistry.get(deviceId, message.tabId);
      if (existing) {
        existing.url = message.url;
      } else {
        const label = await resolveTabLabel(deviceId, message.tabId, stateRef, ctx);
        tabRegistry.set({
          deviceId,
          tabId: message.tabId,
          url: message.url,
          openedAt: message.observedAt,
          label
        });
      }

      // Notify UI of the updated tab list
      browserSocketServer.broadcast({
        type: "tabs_updated",
        tabs: tabRegistry.all()
      });
      await broadcastDevices({ devicesStore, socketServer, tabRegistry, browserSocketServer });
      break;
    }

    case "tab_closed": {
      const wasScheduleTab = stateRef.current.scheduleTabIds[deviceId] === message.tabId;
      tabRegistry.delete(deviceId, message.tabId);

      if (wasScheduleTab) {
        log("warn", "Schedule tab was closed by user — will re-open on next event");
        stateRef.current = {
          ...stateRef.current,
          scheduleTabIds: withoutScheduleTab(stateRef.current.scheduleTabIds, deviceId)
        };
      }

      browserSocketServer.broadcast({
        type: "tabs_updated",
        tabs: tabRegistry.all()
      });
      await broadcastDevices({ devicesStore, socketServer, tabRegistry, browserSocketServer });

      if (wasScheduleTab) {
        await controllerStateStore.save(stateRef.current);
        browserSocketServer.broadcast({
          type: "state_update",
          state: stateRef.current,
          extensionConnections: socketServer.getConnectionCount()
        });
      }
      return;
    }

    case "tabs_state": {
      const now = new Date().toISOString();
      log("info", `Tab snapshot received: ${message.tabs.length} tab(s)`);
      // Merge incoming snapshot into this device's registry (preserve openedAt for known tabs)
      const incoming = new Set(message.tabs.map((t) => t.tabId));

      // Remove tabs no longer open
      for (const id of tabRegistry.tabIdsForDevice(deviceId)) {
        if (!incoming.has(id)) tabRegistry.delete(deviceId, id);
      }

      // Add/update tabs from snapshot
      for (const t of message.tabs) {
        const existing = tabRegistry.get(deviceId, t.tabId);
        const label = resolveTabLabelFromId(t.tabId, stateRef, ctx);
        tabRegistry.set({
          deviceId,
          tabId: t.tabId,
          url: t.url,
          title: t.title,
          favIconUrl: t.favIconUrl,
          label,
          openedAt: existing?.openedAt ?? now
        });
      }

      browserSocketServer.broadcast({
        type: "tabs_updated",
        tabs: tabRegistry.all()
      });
      await broadcastDevices({ devicesStore, socketServer, tabRegistry, browserSocketServer });
      return;
    }

    case "command_failed": {
      stateRef.current = {
        ...stateRef.current,
        activeTabAction: {
          bookmarkId: message.bookmarkId ?? stateRef.current.activeTabAction.bookmarkId,
          url: stateRef.current.activeTabAction.url,
          startedAt: stateRef.current.activeTabAction.startedAt,
          source: stateRef.current.activeTabAction.source,
          status: "failed",
          errorMessage: message.errorMessage
        }
      };
      break;
    }

    case "status": {
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
  }

  await controllerStateStore.save(stateRef.current);

  browserSocketServer.broadcast({
    type: "state_update",
    state: stateRef.current,
    extensionConnections: socketServer.getConnectionCount()
  });
}

/** Build a label for a tab based on whether it's the schedule tab or a bookmark tab. */
async function resolveTabLabel(
  deviceId: string,
  tabId: number,
  stateRef: { current: ControllerState },
  ctx: MessageContext
): Promise<string | undefined> {
  if (stateRef.current.scheduleTabIds[deviceId] === tabId && stateRef.current.activeScheduleId) {
    const schedules = await ctx.schedulesStore.list();
    const schedule = schedules.find((s) => s.id === stateRef.current.activeScheduleId);
    if (schedule) return `Scheduled: ${schedule.name}`;
  }
  if (stateRef.current.activeTabAction.source !== "schedule" &&
      stateRef.current.activeTabAction.bookmarkId) {
    const bookmarks = await ctx.bookmarksStore.list();
    const bookmark = bookmarks.find((b) => b.id === stateRef.current.activeTabAction.bookmarkId);
    if (bookmark) return `Bookmark: ${bookmark.name}`;
  }
  return undefined;
}

/** Synchronous label resolution used in tabs_state (uses current in-memory state only). */
function resolveTabLabelFromId(
  tabId: number,
  stateRef: { current: ControllerState },
  _ctx: MessageContext
): string | undefined {
  // Preserve existing label if we already know it
  return undefined; // labels are enriched on tab_opened; tabs_state just carries raw data
}

main().catch((error) => {
  console.error("[schedurler] controller failed to start", error);
  process.exitCode = 1;
});
