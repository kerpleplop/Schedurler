// Reviewable rebase-behavior smoke test: base-only bump, throwaway.
import { randomUUID } from "node:crypto";
import type {
  Bookmark,
  CloseTabCommand,
  ControllerState,
  OpenUrlCommand,
  Schedule,
  ScheduleEvent,
  ScheduleEventRecurrence
} from "@schedurler/shared";
import type { BookmarksStore } from "./storage/bookmarksStore";
import type { DevicesStore } from "./storage/devicesStore";
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
  devicesStore: DevicesStore;
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

/** Format a Date as a local YYYY-MM-DD string. */
function formatDate(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

const DEFAULT_RECURRENCE: ScheduleEventRecurrence = { type: "daily" };

/** Whether an event's recurrence rule includes the given day. Events without a recurrence fire daily. */
function matchesRecurrence(recurrence: ScheduleEventRecurrence | undefined, now: Date): boolean {
  const rule = recurrence ?? DEFAULT_RECURRENCE;
  switch (rule.type) {
    case "daily":
      return true;
    case "weekdays": {
      const day = now.getDay();
      return day >= 1 && day <= 5;
    }
    case "weekly":
      return rule.daysOfWeek.includes(now.getDay());
    case "once":
      return rule.date === formatDate(now);
  }
}

/** Find the most-recently-due event, wrapping to yesterday's last if none have fired today. */
function findLastEvent(events: ScheduleEvent[], currentMinutes: number, now: Date): ScheduleEvent | null {
  const enabled = events.filter((e) => e.enabled && matchesRecurrence(e.recurrence, now));
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

  /** Check the current minute and fire any matching schedule events. */
  private async tick(): Promise<void> {
    const minute = this.currentMinute();
    if (minute === this.lastFiredMinute) return;
    this.lastFiredMinute = minute;

    const { stateRef, schedulesStore, bookmarksStore } = this.options;

    if (!stateRef.current.scheduleEnabled || !stateRef.current.activeScheduleId) return;

    const schedules = await schedulesStore.list();
    const active = schedules.find((s) => s.id === stateRef.current.activeScheduleId);
    if (!active) return;

    const now = new Date();
    const matchingEvents = active.events.filter(
      (e) => e.enabled && e.time === minute && matchesRecurrence(e.recurrence, now)
    );
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
    const event = findLastEvent(schedule.events, currentMinutes, now);
    if (!event) return;

    const bookmarks = await bookmarksStore.list();
    await this.fireEvent(schedule, event, bookmarks);
    this.lastFiredMinute = this.currentMinute();
  }

  /**
   * Close the dedicated schedule tab on every device that has one.
   * Called when a schedule is deactivated.
   */
  deactivateNow(): void {
    const { stateRef, socketServer, onLog } = this.options;

    for (const [deviceId, tabId] of Object.entries(stateRef.current.scheduleTabIds)) {
      const command: CloseTabCommand = {
        type: "close_tab",
        commandId: randomUUID(),
        sentAt: new Date().toISOString(),
        tabId
      };
      const sent = socketServer.sendCommand(command, deviceId);
      if (sent) {
        onLog("info", "Schedule deactivated: closed tab");
      }
    }
  }

  /** Event targets override schedule targets; with neither set, every connected device is targeted. */
  private resolveTargetIds(schedule: Schedule, event: ScheduleEvent): string[] {
    const explicit = event.targetDeviceIds?.length
      ? event.targetDeviceIds
      : schedule.targetDeviceIds;

    return explicit && explicit.length > 0
      ? explicit
      : this.options.socketServer.getConnectedDeviceIds();
  }

  /** Send an open/update command for one schedule event and update state. Returns whether the command reached at least one device. */
  private async fireEvent(
    schedule: Schedule,
    event: ScheduleEvent,
    bookmarks: Bookmark[]
  ): Promise<boolean> {
    const {
      stateRef,
      socketServer,
      controllerStateStore,
      browserSocketServer,
      schedulesStore,
      devicesStore,
      onLog
    } = this.options;

    const bookmark = bookmarks.find((b) => b.id === event.bookmarkId);

    if (!bookmark) {
      onLog(
        "error",
        `Schedule "${schedule.name}": event at ${event.time} references missing bookmark ${event.bookmarkId}`
      );
      return false;
    }

    const targetIds = this.resolveTargetIds(schedule, event);

    if (targetIds.length === 0) {
      onLog(
        "warn",
        `Schedule "${schedule.name}": ${event.time} — no extension connected, skipped "${bookmark.name}"`
      );
      return false;
    }

    const deviceNames = new Map((await devicesStore.list()).map((d) => [d.id, d.name]));
    const sentAt = new Date().toISOString();
    let deliveredCount = 0;

    for (const deviceId of targetIds) {
      const deviceName = deviceNames.get(deviceId) ?? deviceId;
      const existingTabId = stateRef.current.scheduleTabIds[deviceId];

      const command: OpenUrlCommand = {
        type: "open_url",
        commandId: randomUUID(),
        sentAt,
        url: bookmark.url,
        bookmarkId: bookmark.id,
        source: "schedule",
        ...(existingTabId !== undefined ? { tabId: existingTabId } : {})
      };

      if (!socketServer.sendCommand(command, deviceId)) {
        onLog(
          "warn",
          `Schedule "${schedule.name}": ${event.time} — ${deviceName} not connected, skipped "${bookmark.name}"`
        );
        continue;
      }

      deliveredCount += 1;
      const action = existingTabId !== undefined ? "updated tab to" : "opened";
      onLog(
        "info",
        `Schedule "${schedule.name}": ${action} "${bookmark.name}" at ${event.time} on ${deviceName}`
      );
    }

    if (deliveredCount === 0) {
      return false;
    }

    // Update in-memory state before any await: devices may answer with tab_opened at once,
    // and that reply is attributed to a schedule only if the action is already marked as one.
    stateRef.current = {
      ...stateRef.current,
      currentBookmarkId: bookmark.id,
      activeTabAction: {
        bookmarkId: bookmark.id,
        url: bookmark.url,
        startedAt: sentAt,
        source: "schedule",
        status: "pending"
      }
    };

    await this.options.schedulesStore.recordFire(schedule.id, bookmark.id, sentAt);
    const schedules = await this.options.schedulesStore.list();
    browserSocketServer.broadcast({ type: "schedules_updated", schedules });

    await this.options.bookmarksStore.recordOpen(bookmark.id, sentAt);
    const updatedBookmarks = await this.options.bookmarksStore.list();
    browserSocketServer.broadcast({ type: "bookmarks_updated", bookmarks: updatedBookmarks });

    await controllerStateStore.save(stateRef.current);

    browserSocketServer.broadcast({
      type: "state_update",
      state: stateRef.current,
      extensionConnections: socketServer.getConnectionCount()
    });

    // Only retire a one-time event once it has actually fired, so a missing
    // bookmark or no reachable device leaves it enabled to try again.
    if (event.recurrence?.type === "once") {
      await schedulesStore.updateEvent(schedule.id, event.id, { enabled: false });
      browserSocketServer.broadcast({
        type: "schedules_updated",
        schedules: await schedulesStore.list()
      });
    }

    return true;
  }

  /** Stop the runner. Call on controller shutdown. */
  stop(): void {
    clearInterval(this.timer);
  }
}
