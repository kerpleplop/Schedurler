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

export type TabEntry = {
  tabId: number;
  url: string;
  title?: string;
  favIconUrl?: string;
  label?: string;    // e.g. "Scheduled: Test" | "Bookmark: dragon" | undefined
  openedAt: string;  // ISO timestamp — set when first seen
};

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

  // Volatile in-memory tab registry — repopulated by the extension on connect.
  // Not persisted; stale scheduleTabId from disk is cleared on first extension message.
  const tabRegistry = new Map<number, TabEntry>();

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
    controllerStateStore,
    scheduleRunnerRef,
    tabRegistry,
    getLogs: () => logBuffer.getAll(),
    onExtensionMessage: async (message) => {
      await handleExtensionMessage(message, {
        stateRef,
        tabRegistry,
        controllerStateStore,
        socketServer,
        browserSocketServer,
        bookmarksStore,
        schedulesStore,
        log: (...args) => log(...args)
      });
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

  scheduleRunnerRef.current = new ScheduleRunner({
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
    scheduleTabId: null,
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
  tabRegistry: Map<number, TabEntry>;
  controllerStateStore: ControllerStateStore;
  socketServer: ControllerSocketServer;
  browserSocketServer: BrowserSocketServer;
  bookmarksStore: BookmarksStore;
  schedulesStore: SchedulesStore;
  log: (level: "info" | "warn" | "error", message: string) => void;
};

async function handleExtensionMessage(
  message: ExtensionToControllerMessage,
  ctx: MessageContext
): Promise<void> {
  const { stateRef, tabRegistry, controllerStateStore, socketServer, browserSocketServer, log } = ctx;

  switch (message.type) {
    case "hello": {
      log("info", `Extension connected: ${message.browser} v${message.version ?? "unknown"}`);
      // Clear stale scheduleTabId — the tab may no longer exist after a restart
      if (stateRef.current.scheduleTabId !== null) {
        stateRef.current = { ...stateRef.current, scheduleTabId: null };
        await controllerStateStore.save(stateRef.current);
      }
      browserSocketServer.broadcast({
        type: "state_update",
        state: stateRef.current,
        extensionConnections: socketServer.getConnectionCount()
      });
      return;
    }

    case "tab_opened": {
      const isScheduleSource = stateRef.current.activeTabAction.source === "schedule";

      stateRef.current = {
        ...stateRef.current,
        currentBookmarkId: message.bookmarkId ?? stateRef.current.currentBookmarkId,
        // If from a schedule, record this as the dedicated schedule tab
        scheduleTabId: isScheduleSource ? message.tabId : stateRef.current.scheduleTabId,
        activeTabAction: {
          bookmarkId: message.bookmarkId ?? null,
          url: message.url,
          startedAt: stateRef.current.activeTabAction.startedAt ?? message.observedAt,
          source: stateRef.current.activeTabAction.source,
          status: "completed"
        }
      };

      // Update tab registry entry with label
      const existing = tabRegistry.get(message.tabId);
      if (existing) {
        existing.url = message.url;
      } else {
        const label = await resolveTabLabel(message.tabId, stateRef, ctx);
        tabRegistry.set(message.tabId, {
          tabId: message.tabId,
          url: message.url,
          openedAt: message.observedAt,
          label
        });
      }

      // Notify UI of the updated tab list
      browserSocketServer.broadcast({
        type: "tabs_updated",
        tabs: tabsArray(tabRegistry)
      });
      break;
    }

    case "tab_closed": {
      const wasScheduleTab = stateRef.current.scheduleTabId === message.tabId;
      tabRegistry.delete(message.tabId);

      if (wasScheduleTab) {
        log("warn", "Schedule tab was closed by user — will re-open on next event");
        stateRef.current = { ...stateRef.current, scheduleTabId: null };
      }

      browserSocketServer.broadcast({
        type: "tabs_updated",
        tabs: tabsArray(tabRegistry)
      });

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
      // Merge incoming snapshot into registry (preserve openedAt for known tabs)
      const incoming = new Set(message.tabs.map((t) => t.tabId));

      // Remove tabs no longer open
      for (const id of tabRegistry.keys()) {
        if (!incoming.has(id)) tabRegistry.delete(id);
      }

      // Add/update tabs from snapshot
      for (const t of message.tabs) {
        const existing = tabRegistry.get(t.tabId);
        const label = resolveTabLabelFromId(t.tabId, stateRef, ctx);
        tabRegistry.set(t.tabId, {
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
        tabs: tabsArray(tabRegistry)
      });
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
  tabId: number,
  stateRef: { current: ControllerState },
  ctx: MessageContext
): Promise<string | undefined> {
  if (stateRef.current.scheduleTabId === tabId && stateRef.current.activeScheduleId) {
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

function tabsArray(registry: Map<number, TabEntry>): TabEntry[] {
  return Array.from(registry.values());
}

main().catch((error) => {
  console.error("[schedurler] controller failed to start", error);
  process.exitCode = 1;
});
