const MAX_ENTRIES = 500;

export type LogLevel = "info" | "warn" | "error";

export type LogEntry = {
  timestamp: string;
  level: LogLevel;
  message: string;
};

export class LogBuffer {
  private readonly entries: LogEntry[] = [];

  add(level: LogLevel, message: string): LogEntry {
    const entry: LogEntry = { timestamp: new Date().toISOString(), level, message };
    this.entries.push(entry);
    if (this.entries.length > MAX_ENTRIES) {
      this.entries.shift();
    }
    return entry;
  }

  getAll(): readonly LogEntry[] {
    return this.entries;
  }
}
