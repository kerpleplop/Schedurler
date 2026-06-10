import type { Bookmark, ControllerState, ControllerSettings } from "@schedurler/shared";
import type { BookmarksStore } from "../storage/bookmarksStore";
import type { ControllerStateStore } from "../storage/controllerStateStore";
import type { SchedulesStore } from "../storage/schedulesStore";
import type { ControllerSocketServer } from "../ws/socketServer";

export type ControllerRequestContext = {
  settings: ControllerSettings;
  wsPath: string;
  stateRef: { current: ControllerState };
  bookmarksStore: BookmarksStore;
  schedulesStore: SchedulesStore;
  controllerStateStore: ControllerStateStore;
  socketServer: ControllerSocketServer;
};

export type ControllerSnapshot = {
  generatedAt: string;
  controller: {
    id: string;
    status: "ready" | "waiting_for_extensions";
    host: string;
    port: number;
    wsPath: string;
    lanAccessEnabled: boolean;
  };
  extensionConnections: number;
  state: ControllerState;
  bookmarks: Bookmark[];
};
