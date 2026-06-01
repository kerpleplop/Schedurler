const DEFAULT_CONTROLLER_WS_URL = "ws://127.0.0.1:4312/ws";
const RECONNECT_DELAY_MS = 2000;
const RESERVED_TAB_RECREATE_DELAY_MS = 300;

let socket = null;
let isConnecting = false;
let reconnectTimer = null;
let lastControlledTabId = null;

// Keepalive tab — prevents Firefox from closing when all user-visible tabs are closed.
// Never reported to the controller; never shown in the Open Tabs UI.
let reservedTabId = null;
let reservedTabRecreateTimer = null;

async function connect() {
  if (isConnecting) {
    return;
  }

  if (socket && (socket.readyState === WebSocket.CONNECTING || socket.readyState === WebSocket.OPEN)) {
    return;
  }

  isConnecting = true;
  const url = await getControllerWsUrl();
  isConnecting = false;
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

  // Send a full tab snapshot so the controller can populate its registry
  reportAllTabs().catch((error) => {
    console.error("[schedurler-extension] failed to report tabs on connect", error);
  });

  // Ensure the keepalive tab exists whenever the controller connects.
  // Handles the case where Firefox was already running but the reserved tab
  // was somehow lost between disconnections.
  ensureReservedTab().catch((error) => {
    console.error("[schedurler-extension] failed to ensure reserved tab on connect", error);
  });
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
    case "get_tabs":
      await reportAllTabs();
      return;
    default:
      sendStatus("error", `Unknown command type: ${String(message.type)}`);
  }
}

async function handleOpenUrl(command) {
  try {
    let tab;

    if (Number.isInteger(command.tabId)) {
      // Reuse an existing tab by updating its URL
      tab = await browser.tabs.update(command.tabId, { url: command.url, active: true });
    } else {
      // Open a new tab
      tab = await browser.tabs.create({ url: command.url, active: true });
    }

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
      url: command.url,
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

  // Never close the reserved keepalive tab via a controller command
  if (targetTabId === reservedTabId) {
    sendStatus("error", "Cannot close the reserved keepalive tab");
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

async function reportAllTabs() {
  try {
    const tabs = await browser.tabs.query({});
    sendMessage({
      type: "tabs_state",
      tabs: tabs
        .filter(t => typeof t.id === "number" && t.id !== reservedTabId)
        .map(t => ({
          tabId: t.id,
          url: typeof t.url === "string" ? t.url : "",
          title: typeof t.title === "string" ? t.title : undefined,
          favIconUrl: typeof t.favIconUrl === "string" && t.favIconUrl ? t.favIconUrl : undefined
        })),
      observedAt: new Date().toISOString()
    });
  } catch (error) {
    console.error("[schedurler-extension] failed to query tabs", error);
  }
}

// Creates the reserved keepalive tab if it doesn't already exist.
// If a reserved tab ID is known, verifies it's still alive first.
async function ensureReservedTab() {
  if (reservedTabId !== null) {
    try {
      await browser.tabs.get(reservedTabId);
      return; // Still alive, nothing to do
    } catch {
      // Tab no longer exists
      reservedTabId = null;
    }
  }

  try {
    const tab = await browser.tabs.create({ url: "about:blank", active: false });
    if (typeof tab.id === "number") {
      reservedTabId = tab.id;
    }
  } catch (error) {
    console.error("[schedurler-extension] failed to create reserved tab", error);
  }
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

browser.tabs.onRemoved.addListener((tabId) => {
  if (tabId === reservedTabId) {
    reservedTabId = null;

    // Only recreate if the WebSocket is still open — if the user is intentionally
    // closing Firefox the socket will be gone too, and we don't want to fight them.
    if (socket && socket.readyState === WebSocket.OPEN) {
      if (reservedTabRecreateTimer !== null) {
        clearTimeout(reservedTabRecreateTimer);
      }
      reservedTabRecreateTimer = setTimeout(() => {
        reservedTabRecreateTimer = null;
        ensureReservedTab().catch((error) => {
          console.error("[schedurler-extension] failed to recreate reserved tab", error);
        });
      }, RESERVED_TAB_RECREATE_DELAY_MS);
    }

    // Don't report reserved tab closure to the controller
    return;
  }

  sendMessage({
    type: "tab_closed",
    tabId,
    observedAt: new Date().toISOString()
  });
});

// Notify controller when a new tab is opened by the user
browser.tabs.onCreated.addListener(() => {
  reportAllTabs().catch((error) => {
    console.error("[schedurler-extension] failed to report tabs on create", error);
  });
});

// Notify controller when a tab navigates to a new URL
browser.tabs.onUpdated.addListener((_tabId, changeInfo) => {
  if (changeInfo.url) {
    reportAllTabs().catch((error) => {
      console.error("[schedurler-extension] failed to report tabs on update", error);
    });
  }
});

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

// Create the keepalive tab on extension startup
ensureReservedTab().catch((error) => {
  console.error("[schedurler-extension] failed to create reserved tab on startup", error);
});
