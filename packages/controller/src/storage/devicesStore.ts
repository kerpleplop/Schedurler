import { isDevice, type Device } from "@schedurler/shared";
import { ensureJsonFile, readJsonFile, writeJsonFile } from "./jsonFile";

const DEFAULT_DEVICE_NAME = "Firefox";

export class DevicesStore {
  // Extensions often reconnect at the same moment (e.g. after a controller restart),
  // so read-modify-write cycles are serialized to avoid losing one device's update.
  private queue: Promise<unknown> = Promise.resolve();

  constructor(private readonly filePath: string) {}

  async ensure(): Promise<void> {
    await ensureJsonFile(this.filePath, [] as Device[]);
  }

  async list(): Promise<Device[]> {
    const data = await readJsonFile(this.filePath);

    if (!Array.isArray(data) || !data.every(isDevice)) {
      throw new Error(`Invalid devices data in ${this.filePath}`);
    }

    return data;
  }

  /** Register a device the first time it connects, and record that it was seen. Keeps any name the user set. */
  registerSeen(
    hello: { deviceId: string; deviceName?: string },
    seenAt: string
  ): Promise<Device> {
    return this.serialize(async () => {
      const devices = await this.list();
      const index = devices.findIndex((d) => d.id === hello.deviceId);

      if (index === -1) {
        const device: Device = {
          id: hello.deviceId,
          name: hello.deviceName?.trim() || DEFAULT_DEVICE_NAME,
          browser: "firefox",
          lastSeenAt: seenAt
        };
        await writeJsonFile(this.filePath, [...devices, device]);
        return device;
      }

      const updated = { ...devices[index], lastSeenAt: seenAt };
      devices[index] = updated;
      await writeJsonFile(this.filePath, devices);
      return updated;
    });
  }

  touch(id: string, seenAt: string): Promise<Device | null> {
    return this.serialize(async () => {
      const devices = await this.list();
      const index = devices.findIndex((d) => d.id === id);

      if (index === -1) {
        return null;
      }

      const updated = { ...devices[index], lastSeenAt: seenAt };
      devices[index] = updated;
      await writeJsonFile(this.filePath, devices);
      return updated;
    });
  }

  rename(id: string, name: string): Promise<Device | null> {
    return this.serialize(async () => {
      const devices = await this.list();
      const index = devices.findIndex((d) => d.id === id);

      if (index === -1) {
        return null;
      }

      const updated = { ...devices[index], name };
      devices[index] = updated;
      await writeJsonFile(this.filePath, devices);
      return updated;
    });
  }

  remove(id: string): Promise<boolean> {
    return this.serialize(async () => {
      const devices = await this.list();
      const index = devices.findIndex((d) => d.id === id);

      if (index === -1) {
        return false;
      }

      devices.splice(index, 1);
      await writeJsonFile(this.filePath, devices);
      return true;
    });
  }

  private serialize<T>(task: () => Promise<T>): Promise<T> {
    const run = this.queue.then(task, task);
    this.queue = run.catch(() => undefined);
    return run;
  }
}
