import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

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
  const raw = await readFile(filePath, "utf8");
  return JSON.parse(raw);
}

export async function writeJsonFile<T>(
  filePath: string,
  value: T
): Promise<void> {
  await ensureParentDirectory(filePath);
  await writeFile(filePath, JSON.stringify(value, null, 2) + "\n", "utf8");
}

