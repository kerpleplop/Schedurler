const DEFAULT_CONTROLLER_WS_URL = "ws://127.0.0.1:4312/ws";
const RECONNECT_DELAY_MS = 2000;

let socket = null;
let reconnectTimer = null;
let lastControlledTabId = null;

async function connect() {
  if (socket && (socket.readyState === WebSocket.CONNECTING || socket.readyState === WebSocket.OPEN)) {
    return;
  }

  const url = await getControllerWsUrl();
  socket = new WebSocket(url);

  socket.addEventListener("open", handleOpen);
  socket.addEventListener("message", handleMessage);
  socket.addEventListener("close", handleClose);
  socket.addEventListener("error", handleError);
}

async function getControllerWsUrl() {
  const stored = await browser.storage.local.get("controllerWsUrl");
  const configuredValue = stored.controllerWsUrl;

  if (typeof configuredValue === "string" && configuredValue.trim().length > 0) {
    return configuredValue.trim();
  }

  return DEFAULT_CONTROLLER_WS_URL;
}

function handleOpen() {
  sendMessage({
    type: "hello",
    extensionId: "schedurler-firefox-agent",
    browser: "firefox",
    connectedAt: new Date().toISOString(),
    version: browser.runtime.getManifest().version
  });

  sendStatus("ready", "Connected to controller");
}

function handleClose() {
  socket = null;
  scheduleReconnect();
}

function handleError(error) {
  console.error("[schedurler-extension] websocket error", error);
}

async function handleMessage(event) {
  let message;

  try {
    message = JSON.parse(event.data);
  } catch (error) {
    sendStatus("error", `Invalid controller message: ${String(error)}`);
    return;
  }

  switch (message.type) {
    case "open_url":
      await handleOpenUrl(message);
      return;
    case "close_tab":
      await handleCloseTab(message);
      return;
    case "mute_tab":
      await handleMuteTab(message, true);
      return;
    case "unmute_tab":
      await handleMuteTab(message, false);
      return;
    case "get_status":
      await reportCurrentStatus();
      return;
    default:
      sendStatus("error", `Unknown command type: ${String(message.type)}`);
  }
}

async function handleOpenUrl(command) {
  try {
    const tab = await browser.tabs.create({
      url: command.url,
      active: true
    });

    if (typeof tab.id !== "number") {
      throw new Error("Firefox did not return a tab id");
    }

    lastControlledTabId = tab.id;

    sendMessage({
      type: "tab_opened",
      commandId: command.commandId,
      bookmarkId:
        typeof command.bookmarkId === "string" ? command.bookmarkId : null,
      tabId: tab.id,
      url: typeof tab.url === "string" ? tab.url : command.url,
      observedAt: new Date().toISOString()
    });
  } catch (error) {
    reportCommandFailure(command, error);
  }
}

async function handleCloseTab(command) {
  const targetTabId = getTargetTabId(command);

  if (targetTabId === null) {
    sendStatus("error", "No tab is available to close");
    return;
  }

  try {
    await browser.tabs.remove(targetTabId);

    if (lastControlledTabId === targetTabId) {
      lastControlledTabId = null;
    }

    sendStatus("ready", "Closed tab", {
      activeTabId: null,
      activeUrl: null
    });
  } catch (error) {
    reportCommandFailure(command, error);
  }
}

async function handleMuteTab(command, muted) {
  const targetTabId = getTargetTabId(command);

  if (targetTabId === null) {
    sendStatus("error", `No tab is available to ${muted ? "mute" : "unmute"}`);
    return;
  }

  try {
    const tab = await browser.tabs.update(targetTabId, { muted });

    sendStatus("ready", muted ? "Muted tab" : "Unmuted tab", {
      activeTabId: typeof tab.id === "number" ? tab.id : targetTabId,
      activeUrl: typeof tab.url === "string" ? tab.url : null
    });
  } catch (error) {
    reportCommandFailure(command, error);
  }
}

async function reportCurrentStatus() {
  if (lastControlledTabId === null) {
    sendStatus("ready", "No controlled tab", {
      activeTabId: null,
      activeUrl: null
    });
    return;
  }

  try {
    const tab = await browser.tabs.get(lastControlledTabId);

    sendStatus("ready", "Controlled tab status", {
      activeTabId: typeof tab.id === "number" ? tab.id : lastControlledTabId,
      activeUrl: typeof tab.url === "string" ? tab.url : null
    });
  } catch (_error) {
    lastControlledTabId = null;
    sendStatus("ready", "Controlled tab no longer exists", {
      activeTabId: null,
      activeUrl: null
    });
  }
}

function getTargetTabId(command) {
  if (Number.isInteger(command.tabId)) {
    return command.tabId;
  }

  return lastControlledTabId;
}

function reportCommandFailure(command, error) {
  sendMessage({
    type: "command_failed",
    commandId: command.commandId,
    commandType: command.type,
    bookmarkId:
      typeof command.bookmarkId === "string" ? command.bookmarkId : null,
    errorMessage: error instanceof Error ? error.message : String(error),
    observedAt: new Date().toISOString()
  });
}

function sendStatus(status, message, extraFields = {}) {
  sendMessage({
    type: "status",
    status,
    observedAt: new Date().toISOString(),
    message,
    ...extraFields
  });
}

function sendMessage(message) {
  if (!socket || socket.readyState !== WebSocket.OPEN) {
    return;
  }

  socket.send(JSON.stringify(message));
}

function scheduleReconnect() {
  if (reconnectTimer !== null) {
    return;
  }

  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    connect().catch((error) => {
      console.error("[schedurler-extension] reconnect failed", error);
    });
  }, RECONNECT_DELAY_MS);
}

browser.runtime.onStartup.addListener(() => {
  connect().catch((error) => {
    console.error("[schedurler-extension] startup connect failed", error);
  });
});

browser.runtime.onInstalled.addListener(() => {
  connect().catch((error) => {
    console.error("[schedurler-extension] install connect failed", error);
  });
});

connect().catch((error) => {
  console.error("[schedurler-extension] initial connect failed", error);
});
