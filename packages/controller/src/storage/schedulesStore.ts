import { isSchedule, type Schedule } from "@schedurler/shared";
import { ensureJsonFile, readJsonFile } from "./jsonFile";

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
}

