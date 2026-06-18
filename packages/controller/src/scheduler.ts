import { randomUUID } from "node:crypto";
import type {
  Bookmark,
  CloseTabCommand,
  ControllerState,
  OpenUrlCommand,
  Schedule,
  ScheduleEvent
} from "@schedurler/shared";
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

/** Convert a HH:MM string to total minutes since midnight. */
function timeToMinutes(time: string): number {
  const [h, m] = time.split(":").map(Number);
  return h * 60 + m;
}

/**
 * Find the event that should have most recently fired at or before the given
 * time. If all events are in the future (none have fired yet today), wraps
 * around and returns the latest event in the 24-hour cycle — this represents
 * "yesterday's last event", which would have been the current bookmark.
 */
function findLastEvent(events: ScheduleEvent[], currentMinutes: number): ScheduleEvent | null {
  const enabled = events.filter((e) => e.enabled);
  if (enabled.length === 0) return null;

  const past = enabled.filter((e) => timeToMinutes(e.time) <= currentMinutes);

  const pool = past.length > 0 ? past : enabled;
  return pool.reduce((latest, e) =>
    timeToMinutes(e.time) > timeToMinutes(latest.time) ? e : latest
  );
}

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

    const { stateRef, schedulesStore, bookmarksStore } = this.options;

    if (!stateRef.current.scheduleEnabled || !stateRef.current.activeScheduleId) return;

    const schedules = await schedulesStore.list();
    const active = schedules.find((s) => s.id === stateRef.current.activeScheduleId);
    if (!active) return;

    const matchingEvents = active.events.filter((e) => e.enabled && e.time === minute);
    if (matchingEvents.length === 0) return;

    const bookmarks = await bookmarksStore.list();

    for (const event of matchingEvents) {
      await this.fireEvent(active, event, bookmarks);
    }
  }

  /**
   * Immediately fire the most-recently-due event for the given schedule.
   * Called when a schedule is activated so it opens the right bookmark right away.
   */
  async activateNow(schedule: Schedule): Promise<void> {
    const { bookmarksStore } = this.options;

    const now = new Date();
    const currentMinutes = now.getHours() * 60 + now.getMinutes();
    const event = findLastEvent(schedule.events, currentMinutes);
    if (!event) return;

    const bookmarks = await bookmarksStore.list();
    await this.fireEvent(schedule, event, bookmarks);
    // Stamp the current minute so tick() doesn't double-fire if activation
    // lands in the same wall-clock minute as a scheduled event.
    this.lastFiredMinute = this.currentMinute();
  }

  /**
   * Close the dedicated schedule tab (if one exists).
   * Called when a schedule is deactivated.
   */
  deactivateNow(): void {
    const { stateRef, socketServer, onLog } = this.options;
    const tabId = stateRef.current.scheduleTabId;

    if (tabId !== null) {
      const command: CloseTabCommand = {
        type: "close_tab",
        commandId: randomUUID(),
        sentAt: new Date().toISOString(),
        tabId
      };
      const sent = socketServer.sendCommand(command);
      if (sent) {
        onLog("info", "Schedule deactivated: closed tab");
      }
    }
  }

  /** Send an open/update command for one schedule event and update state. */
  private async fireEvent(
    schedule: Schedule,
    event: ScheduleEvent,
    bookmarks: Bookmark[]
  ): Promise<void> {
    const {
      stateRef,
      socketServer,
      controllerStateStore,
      browserSocketServer,
      onLog
    } = this.options;

    const bookmark = bookmarks.find((b) => b.id === event.bookmarkId);

    if (!bookmark) {
      onLog(
        "error",
        `Schedule "${schedule.name}": event at ${event.time} references missing bookmark ${event.bookmarkId}`
      );
      return;
    }

    const existingTabId = stateRef.current.scheduleTabId ?? undefined;

    const command: OpenUrlCommand = {
      type: "open_url",
      commandId: randomUUID(),
      sentAt: new Date().toISOString(),
      url: bookmark.url,
      bookmarkId: bookmark.id,
      source: "schedule",
      ...(existingTabId !== undefined ? { tabId: existingTabId } : {})
    };

    const sent = socketServer.sendCommand(command);

    if (!sent) {
      onLog(
        "warn",
        `Schedule "${schedule.name}": ${event.time} — no extension connected, skipped "${bookmark.name}"`
      );
      return;
    }

    const action = existingTabId !== undefined ? "updated tab to" : "opened";
    onLog("info", `Schedule "${schedule.name}": ${action} "${bookmark.name}" at ${event.time}`);

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

  stop(): void {
    clearInterval(this.timer);
  }
}
