import path from "node:path";
import {
  DEFAULT_CONTROLLER_HOST,
  DEFAULT_CONTROLLER_PORT,
  DEFAULT_CONTROLLER_WS_PATH,
  type ControllerSettings
} from "@schedurler/shared";
import type { StoragePaths } from "./storage/paths";
import { writeJsonFile } from "./storage/jsonFile";

export type ControllerRuntimeConfig = {
  settings: ControllerSettings;
  wsPath: string;
};

export function loadControllerConfig(
  cwd: string = process.cwd()
): ControllerRuntimeConfig {
  const sharedDataDir =
    normalizePath(process.env.SHARED_DATA_DIR) ??
    path.resolve(cwd, "data/shared");
  const localDataDir =
    normalizePath(process.env.LOCAL_DATA_DIR) ??
    path.resolve(cwd, "data/local");

  return {
    settings: {
      sharedDataDir,
      localDataDir,
      host: normalizePath(process.env.HOST) ?? DEFAULT_CONTROLLER_HOST,
      port: parsePort(process.env.PORT, DEFAULT_CONTROLLER_PORT)
    },
    wsPath: DEFAULT_CONTROLLER_WS_PATH
  };
}

export async function persistResolvedSettings(
  storagePaths: StoragePaths,
  settings: ControllerSettings
): Promise<void> {
  await writeJsonFile(storagePaths.settingsFile, settings);
}

function normalizePath(value: string | undefined): string | null {
  if (!value) {
    return null;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function parsePort(value: string | undefined, fallback: number): number {
  if (!value) {
    return fallback;
  }

  const parsed = Number.parseInt(value, 10);

  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 65535) {
    throw new Error(`Invalid PORT value: ${value}`);
  }

  return parsed;
}

