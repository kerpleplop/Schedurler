import { randomUUID } from "node:crypto";
import {
  isClockTime,
  isSchedule,
  type Schedule,
  type ScheduleEvent,
  type ScheduleEventRecurrence,
  type ScheduleStats
} from "@schedurler/shared";
import { ensureJsonFile, readJsonFile, writeJsonFile } from "./jsonFile";

/** Empty target lists mean "no override", so drop the field rather than store []. */
function withTargets<T extends { targetDeviceIds?: string[] }>(
  item: T,
  targetDeviceIds: string[] | undefined
): T {
  const { targetDeviceIds: _previous, ...rest } = item;
  return (targetDeviceIds && targetDeviceIds.length > 0
    ? { ...rest, targetDeviceIds }
    : rest) as T;
}

export class SchedulesStore {
  constructor(private readonly filePath: string) {}

  async ensure(): Promise<void> {
    await ensureJsonFile(this.filePath, [] as Schedule[]);
  }

  async list(): Promise<Schedule[]> {
    const data = await readJsonFile(this.filePath);

    if (!Array.isArray(data) || !data.every(isSchedule)) {
      throw new Error(`Invalid schedules data in ${this.filePath}`);
    }

    return data;
  }

  async create(data: { name: string }): Promise<Schedule> {
    const schedules = await this.list();
    const schedule: Schedule = { id: randomUUID(), name: data.name, events: [] };
    await writeJsonFile(this.filePath, [...schedules, schedule]);
    return schedule;
  }

  async update(
    id: string,
    patch: { name?: string; targetDeviceIds?: string[] }
  ): Promise<Schedule | null> {
    const schedules = await this.list();
    const index = schedules.findIndex((s) => s.id === id);

    if (index === -1) {
      return null;
    }

    let updated: Schedule = schedules[index];
    if (patch.name !== undefined) {
      updated = { ...updated, name: patch.name };
    }
    if (patch.targetDeviceIds !== undefined) {
      updated = withTargets(updated, patch.targetDeviceIds);
    }
    schedules[index] = updated;
    await writeJsonFile(this.filePath, schedules);
    return updated;
  }

  async remove(id: string): Promise<boolean> {
    const schedules = await this.list();
    const index = schedules.findIndex((s) => s.id === id);

    if (index === -1) {
      return false;
    }

    schedules.splice(index, 1);
    await writeJsonFile(this.filePath, schedules);
    return true;
  }

  async duplicate(id: string): Promise<Schedule | null> {
    const schedules = await this.list();
    const source = schedules.find((s) => s.id === id);

    if (!source) {
      return null;
    }

    const copy: Schedule = {
      id: randomUUID(),
      name: `${source.name} (copy)`,
      events: source.events.map((e) => ({ ...e, id: randomUUID() }))
    };
    if (source.targetDeviceIds) {
      copy.targetDeviceIds = [...source.targetDeviceIds];
    }

    await writeJsonFile(this.filePath, [...schedules, copy]);
    return copy;
  }

  async addEvent(
    scheduleId: string,
    eventData: {
      time: string;
      bookmarkId: string;
      enabled: boolean;
      recurrence?: ScheduleEventRecurrence;
      targetDeviceIds?: string[];
    }
  ): Promise<Schedule | null> {
    if (!isClockTime(eventData.time)) {
      return null;
    }

    const schedules = await this.list();
    const index = schedules.findIndex((s) => s.id === scheduleId);

    if (index === -1) {
      return null;
    }

    const { targetDeviceIds, ...eventFields } = eventData;
    const event = withTargets<ScheduleEvent>(
      { id: randomUUID(), ...eventFields },
      targetDeviceIds
    );
    const updated = {
      ...schedules[index],
      events: [...schedules[index].events, event]
    };
    schedules[index] = updated;
    await writeJsonFile(this.filePath, schedules);
    return updated;
  }

  async updateEvent(
    scheduleId: string,
    eventId: string,
    patch: {
      time?: string;
      bookmarkId?: string;
      enabled?: boolean;
      recurrence?: ScheduleEventRecurrence;
      targetDeviceIds?: string[];
    }
  ): Promise<Schedule | null> {
    if (patch.time !== undefined && !isClockTime(patch.time)) {
      return null;
    }

    const schedules = await this.list();
    const scheduleIndex = schedules.findIndex((s) => s.id === scheduleId);

    if (scheduleIndex === -1) {
      return null;
    }

    const eventIndex = schedules[scheduleIndex].events.findIndex(
      (e) => e.id === eventId
    );

    if (eventIndex === -1) {
      return null;
    }

    const events = [...schedules[scheduleIndex].events];
    const { targetDeviceIds, ...fields } = patch;
    let event: ScheduleEvent = { ...events[eventIndex], ...fields };
    if (targetDeviceIds !== undefined) {
      event = withTargets(event, targetDeviceIds);
    }
    events[eventIndex] = event;
    const updated = { ...schedules[scheduleIndex], events };
    schedules[scheduleIndex] = updated;
    await writeJsonFile(this.filePath, schedules);
    return updated;
  }

  async removeEvent(
    scheduleId: string,
    eventId: string
  ): Promise<Schedule | null> {
    const schedules = await this.list();
    const scheduleIndex = schedules.findIndex((s) => s.id === scheduleId);

    if (scheduleIndex === -1) {
      return null;
    }

    const events = schedules[scheduleIndex].events.filter(
      (e) => e.id !== eventId
    );

    if (events.length === schedules[scheduleIndex].events.length) {
      return null;
    }

    const updated = { ...schedules[scheduleIndex], events };
    schedules[scheduleIndex] = updated;
    await writeJsonFile(this.filePath, schedules);
    return updated;
  }

  async recordFire(id: string, bookmarkId: string, firedAt: string): Promise<Schedule | null> {
    const schedules = await this.list();
    const index = schedules.findIndex((s) => s.id === id);

    if (index === -1) {
      return null;
    }

    const stats: ScheduleStats = {
      runCount: (schedules[index].stats?.runCount ?? 0) + 1,
      lastFiredAt: firedAt,
      lastBookmarkId: bookmarkId
    };

    const updated = { ...schedules[index], stats };
    schedules[index] = updated;
    await writeJsonFile(this.filePath, schedules);
    return updated;
  }

  // Remove all events referencing the given bookmarkId across all schedules.
  // Returns true if any schedules were modified.
  async removeEventsByBookmarkId(bookmarkId: string): Promise<boolean> {
    const schedules = await this.list();
    let modified = false;

    const updated = schedules.map((s) => {
      const filtered = s.events.filter((e) => e.bookmarkId !== bookmarkId);
      if (filtered.length !== s.events.length) {
        modified = true;
        return { ...s, events: filtered };
      }
      return s;
    });

    if (modified) {
      await writeJsonFile(this.filePath, updated);
    }

    return modified;
  }
}
