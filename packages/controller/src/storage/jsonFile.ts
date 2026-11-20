import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

// Reads and writes of the same file are serialized in-process, so a read never sees a
// half-written file when several devices report at once.
const fileQueues = new Map<string, Promise<unknown>>();

function serialized<T>(filePath: string, task: () => Promise<T>): Promise<T> {
  const previous = fileQueues.get(filePath) ?? Promise.resolve();
  const run = previous.then(task, task);
  const tail = run.catch(() => undefined);

  fileQueues.set(filePath, tail);
  void tail.then(() => {
    if (fileQueues.get(filePath) === tail) {
      fileQueues.delete(filePath);
    }
  });

  return run;
}

async function ensureParentDirectory(filePath: string): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true });
}

export async function ensureJsonFile<T>(
  filePath: string,
  defaultValue: T
): Promise<void> {
  await ensureParentDirectory(filePath);

  try {
    await readFile(filePath, "utf8");
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;

    if (code === "ENOENT") {
      await writeJsonFile(filePath, defaultValue);
      return;
    }

    throw error;
  }
}

export async function readJsonFile(filePath: string): Promise<unknown> {
  const raw = await serialized(filePath, () => readFile(filePath, "utf8"));
  return JSON.parse(raw);
}

export async function writeJsonFile<T>(
  filePath: string,
  value: T
): Promise<void> {
  await ensureParentDirectory(filePath);
  await serialized(filePath, () =>
    writeFile(filePath, JSON.stringify(value, null, 2) + "\n", "utf8")
  );
}

