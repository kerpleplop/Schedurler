import { isControllerState, type ControllerState } from "@schedurler/shared";
import { ensureJsonFile, readJsonFile, writeJsonFile } from "./jsonFile";

export class ControllerStateStore {
  constructor(private readonly filePath: string) {}

  async loadOrCreate(defaultState: ControllerState): Promise<ControllerState> {
    await ensureJsonFile(this.filePath, defaultState);

    const data = await readJsonFile(this.filePath);

    if (!isControllerState(data)) {
      throw new Error(`Invalid controller state data in ${this.filePath}`);
    }

    // Migrate older persisted state that predates per-device scheduleTabIds.
    // A legacy single scheduleTabId is dropped: tab ids don't survive a restart anyway.
    const { scheduleTabId: _legacyScheduleTabId, ...rest } = data as ControllerState & {
      scheduleTabId?: unknown;
    };
    return {
      ...rest,
      scheduleTabIds: data.scheduleTabIds ?? {}
    };
  }

  async save(state: ControllerState): Promise<void> {
    await writeJsonFile(this.filePath, state);
  }
}

