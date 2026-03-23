import type { ControllerRequestContext, ControllerSnapshot } from "./types";

const LOOPBACK_HOSTS = new Set(["127.0.0.1", "localhost", "::1"]);

export async function buildControllerSnapshot(
  context: ControllerRequestContext
): Promise<ControllerSnapshot> {
  const bookmarks = await context.bookmarksStore.list();
  const extensionConnections = context.socketServer.getConnectionCount();

  return {
    generatedAt: new Date().toISOString(),
    controller: {
      id: context.stateRef.current.controllerId,
      status: extensionConnections > 0 ? "ready" : "waiting_for_extensions",
      host: context.settings.host,
      port: context.settings.port,
      wsPath: context.wsPath,
      lanAccessEnabled: !LOOPBACK_HOSTS.has(context.settings.host)
    },
    extensionConnections,
    state: context.stateRef.current,
    bookmarks
  };
}
