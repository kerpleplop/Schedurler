import { randomUUID } from "node:crypto";
import {
  isClockTime,
  isSchedule,
  type Schedule,
  type ScheduleEvent,
  type ScheduleEventRecurrence
} from "@schedurler/shared";
import { ensureJsonFile, readJsonFile, writeJsonFile } from "./jsonFile";

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

  async update(id: string, patch: { name: string }): Promise<Schedule | null> {
    const schedules = await this.list();
    const index = schedules.findIndex((s) => s.id === id);

    if (index === -1) {
      return null;
    }

    const updated = { ...schedules[index], ...patch };
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

    const event: ScheduleEvent = { id: randomUUID(), ...eventData };
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
    events[eventIndex] = { ...events[eventIndex], ...patch };
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
