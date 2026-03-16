import path from "node:path";
import {
  BOOKMARKS_FILE_NAME,
  CONTROLLER_STATE_FILE_NAME,
  SETTINGS_FILE_NAME,
  SCHEDULES_FILE_NAME,
  type ControllerSettings
} from "@schedurler/shared";

export type StoragePaths = {
  sharedDataDir: string;
  localDataDir: string;
  bookmarksFile: string;
  schedulesFile: string;
  controllerStateFile: string;
  settingsFile: string;
};

export function resolveStoragePaths(
  settings: ControllerSettings
): StoragePaths {
  return {
    sharedDataDir: settings.sharedDataDir,
    localDataDir: settings.localDataDir,
    bookmarksFile: path.join(settings.sharedDataDir, BOOKMARKS_FILE_NAME),
    schedulesFile: path.join(settings.sharedDataDir, SCHEDULES_FILE_NAME),
    controllerStateFile: path.join(
      settings.localDataDir,
      CONTROLLER_STATE_FILE_NAME
    ),
    settingsFile: path.join(settings.localDataDir, SETTINGS_FILE_NAME)
  };
}

