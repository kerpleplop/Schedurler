import * as bookmarksSection from "./bookmarks.js";
import * as schedulesSection from "./schedules.js";
import * as api from "./api.js";

const extensionCountEl = document.getElementById("extension-count");
const activeScheduleNameEl = document.getElementById("active-schedule-name");
const tabActionEl = document.getElementById("status-tab-action");

let allSchedules = [];
let allBookmarks = [];

// --- Navigation ---

const navTabs = document.querySelectorAll(".nav-tab");
const sections = {
  bookmarks: document.getElementById("section-bookmarks"),
  schedules: document.getElementById("section-schedules")
};

navTabs.forEach((tab) => {
  tab.addEventListener("click", () => {
    navTabs.forEach((t) => t.classList.remove("active"));
    tab.classList.add("active");
    const target = tab.dataset.section;
    Object.entries(sections).forEach(([key, el]) => {
      el.hidden = key !== target;
    });
  });
});

// --- Status bar ---

function updateStatusBar(state, extensionConnections) {
  extensionCountEl.textContent = String(extensionConnections);

  const schedule = allSchedules.find(s => s.id === state.activeScheduleId);
  activeScheduleNameEl.textContent = schedule
    ? `${schedule.name}${state.scheduleEnabled ? "" : " (paused)"}`
    : "none";

  const action = state.activeTabAction;
  if (action.status === "pending") {
    tabActionEl.textContent = `Opening ${action.url ?? "…"}`;
  } else if (action.status === "completed" && action.url) {
    tabActionEl.textContent = `Last: ${action.url}`;
  } else if (action.status === "failed") {
    tabActionEl.textContent = `Error: ${action.errorMessage ?? "unknown"}`;
  } else {
    tabActionEl.textContent = "";
  }
}

// --- WebSocket ---

const WS_URL = `ws://${location.host}/ws/ui`;
let ws = null;
let reconnectDelay = 2000;

function connect() {
  ws = new WebSocket(WS_URL);

  ws.addEventListener("message", (event) => {
    let msg;
    try {
      msg = JSON.parse(event.data);
    } catch {
      return;
    }

    if (msg.type === "state_update") {
      updateStatusBar(msg.state, msg.extensionConnections);
    } else if (msg.type === "bookmarks_updated") {
      allBookmarks = msg.bookmarks;
      bookmarksSection.setBookmarks(allBookmarks);
      schedulesSection.setBookmarks(allBookmarks);
    } else if (msg.type === "schedules_updated") {
      allSchedules = msg.schedules;
      schedulesSection.setSchedules(allSchedules);
    }
  });

  ws.addEventListener("open", () => {
    reconnectDelay = 2000;
  });

  ws.addEventListener("close", () => {
    setTimeout(connect, reconnectDelay);
    reconnectDelay = Math.min(reconnectDelay * 2, 30000);
  });

  ws.addEventListener("error", () => {
    ws.close();
  });
}

// --- Init ---

async function init() {
  try {
    const [stateData, fetchedBookmarks, fetchedSchedules] = await Promise.all([
      api.getState(),
      api.listBookmarks(),
      api.listSchedules()
    ]);

    allBookmarks = fetchedBookmarks;
    allSchedules = fetchedSchedules;

    updateStatusBar(stateData.state, stateData.extensionConnections);

    await bookmarksSection.init(allBookmarks);
    await schedulesSection.init(allBookmarks);

    connect();
  } catch (err) {
    console.error("Failed to initialise Schedurler UI", err);
  }
}

init();
