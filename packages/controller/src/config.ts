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
  cwd: string = process.cwd(),
  env: NodeJS.ProcessEnv = process.env,
  argv: string[] = process.argv.slice(2)
): ControllerRuntimeConfig {
  const hostOverride = readHostOverride(env, argv);
  const portOverride = readPortOverride(env, argv);
  const sharedDataDir =
    normalizePath(env.SHARED_DATA_DIR) ??
    path.resolve(cwd, "data/shared");
  const localDataDir =
    normalizePath(env.LOCAL_DATA_DIR) ??
    path.resolve(cwd, "data/local");

  return {
    settings: {
      sharedDataDir,
      localDataDir,
      host: hostOverride ?? DEFAULT_CONTROLLER_HOST,
      port: parsePort(portOverride, DEFAULT_CONTROLLER_PORT)
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

function readHostOverride(
  env: NodeJS.ProcessEnv,
  argv: string[]
): string | null {
  return (
    readArgumentValue(argv, "host") ??
    readAssignmentValue(argv, "HOST") ??
    normalizePath(env.HOST) ??
    normalizePath(env.npm_config_host)
  );
}

function readPortOverride(
  env: NodeJS.ProcessEnv,
  argv: string[]
): string | undefined {
  return (
    readArgumentValue(argv, "port") ??
    readAssignmentValue(argv, "PORT") ??
    env.PORT
  );
}

function readArgumentValue(argv: string[], name: string): string | undefined {
  const flag = `--${name}`;
  const flagPrefix = `${flag}=`;

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];

    if (argument === flag) {
      return argv[index + 1];
    }

    if (argument.startsWith(flagPrefix)) {
      return argument.slice(flagPrefix.length);
    }
  }

  return undefined;
}

function readAssignmentValue(argv: string[], name: string): string | undefined {
  for (const argument of argv) {
    const separatorIndex = argument.indexOf("=");

    if (separatorIndex <= 0) {
      continue;
    }

    const key = argument.slice(0, separatorIndex);

    if (key.toUpperCase() !== name) {
      continue;
    }

    return argument.slice(separatorIndex + 1);
  }

  return undefined;
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
