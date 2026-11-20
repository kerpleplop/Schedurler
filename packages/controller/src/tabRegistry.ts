export type TabEntry = {
  deviceId: string;
  tabId: number;
  url: string;
  title?: string;
  favIconUrl?: string;
  label?: string;    // e.g. "Scheduled: Test" | "Bookmark: dragon" | undefined
  openedAt: string;  // ISO timestamp — set when first seen
};

/** Volatile in-memory tabs, keyed by device then tab id (tab ids are only unique within one browser). */
export class TabRegistry {
  private readonly byDevice = new Map<string, Map<number, TabEntry>>();

  get(deviceId: string, tabId: number): TabEntry | undefined {
    return this.byDevice.get(deviceId)?.get(tabId);
  }

  set(entry: TabEntry): void {
    let tabs = this.byDevice.get(entry.deviceId);
    if (!tabs) {
      tabs = new Map();
      this.byDevice.set(entry.deviceId, tabs);
    }
    tabs.set(entry.tabId, entry);
  }

  delete(deviceId: string, tabId: number): void {
    this.byDevice.get(deviceId)?.delete(tabId);
  }

  clearDevice(deviceId: string): void {
    this.byDevice.delete(deviceId);
  }

  tabIdsForDevice(deviceId: string): number[] {
    return Array.from(this.byDevice.get(deviceId)?.keys() ?? []);
  }

  countForDevice(deviceId: string): number {
    return this.byDevice.get(deviceId)?.size ?? 0;
  }

  all(): TabEntry[] {
    return Array.from(this.byDevice.values()).flatMap((tabs) => Array.from(tabs.values()));
  }
}
