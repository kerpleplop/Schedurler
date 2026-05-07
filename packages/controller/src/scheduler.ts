import { randomUUID } from "node:crypto";
import type { ControllerState, OpenUrlCommand } from "@schedurler/shared";
import type { BookmarksStore } from "./storage/bookmarksStore";
import type { ControllerStateStore } from "./storage/controllerStateStore";
import type { SchedulesStore } from "./storage/schedulesStore";
import type { ControllerSocketServer } from "./ws/socketServer";
import type { BrowserSocketServer } from "./ws/browserSocketServer";
import type { LogLevel } from "./logBuffer";

const TICK_INTERVAL_MS = 1_000;

export type ScheduleRunnerOptions = {
  stateRef: { current: ControllerState };
  schedulesStore: SchedulesStore;
  bookmarksStore: BookmarksStore;
  socketServer: ControllerSocketServer;
  controllerStateStore: ControllerStateStore;
  browserSocketServer: BrowserSocketServer;
  onLog: (level: LogLevel, message: string) => void;
};

export class ScheduleRunner {
  private readonly options: ScheduleRunnerOptions;
  private lastFiredMinute: string | null = null;
  private readonly timer: ReturnType<typeof setInterval>;

  constructor(options: ScheduleRunnerOptions) {
    this.options = options;
    this.timer = setInterval(() => {
      this.tick().catch((error) => {
        console.error("[schedurler] schedule runner error", error);
      });
    }, TICK_INTERVAL_MS);
  }

  private currentMinute(): string {
    const now = new Date();
    return `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;
  }

  private async tick(): Promise<void> {
    const minute = this.currentMinute();
    if (minute === this.lastFiredMinute) return;
    this.lastFiredMinute = minute;

    const {
      stateRef,
      schedulesStore,
      bookmarksStore,
      socketServer,
      controllerStateStore,
      browserSocketServer,
      onLog
    } = this.options;

    if (!stateRef.current.scheduleEnabled || !stateRef.current.activeScheduleId) return;

    const schedules = await schedulesStore.list();
    const active = schedules.find((s) => s.id === stateRef.current.activeScheduleId);
    if (!active) return;

    const matchingEvents = active.events.filter((e) => e.enabled && e.time === minute);
    if (matchingEvents.length === 0) return;

    const bookmarks = await bookmarksStore.list();

    for (const event of matchingEvents) {
      const bookmark = bookmarks.find((b) => b.id === event.bookmarkId);

      if (!bookmark) {
        onLog("error", `Schedule "${active.name}": event at ${minute} references missing bookmark ${event.bookmarkId}`);
        continue;
      }

      const command: OpenUrlCommand = {
        type: "open_url",
        commandId: randomUUID(),
        sentAt: new Date().toISOString(),
        url: bookmark.url,
        bookmarkId: bookmark.id,
        source: "schedule"
      };

      const sent = socketServer.sendCommand(command);

      if (!sent) {
        onLog("warn", `Schedule "${active.name}": ${minute} — no extension connected, skipped "${bookmark.name}"`);
        continue;
      }

      onLog("info", `Schedule "${active.name}": fired "${bookmark.name}" at ${minute}`);

      stateRef.current = {
        ...stateRef.current,
        currentBookmarkId: bookmark.id,
        activeTabAction: {
          bookmarkId: bookmark.id,
          url: bookmark.url,
          startedAt: command.sentAt,
          source: "schedule",
          status: "pending"
        }
      };

      await controllerStateStore.save(stateRef.current);

      browserSocketServer.broadcast({
        type: "state_update",
        state: stateRef.current,
        extensionConnections: socketServer.getConnectionCount()
      });
    }
  }

  stop(): void {
    clearInterval(this.timer);
  }
}
