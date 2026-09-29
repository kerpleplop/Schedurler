import * as api from "./api.js";

const section = document.getElementById("section-tabs");

let tabs = [];
let devices = [];

export function init(initialTabs, initialDevices) {
  tabs = initialTabs ?? [];
  devices = initialDevices ?? [];
  render();
}

export function setTabs(data) {
  tabs = data;
  render();
}

export function setDevices(data) {
  devices = data;
  render();
}

function render() {
  section.innerHTML = "";

  const heading = document.createElement("h2");
  heading.textContent = "Open Tabs";
  section.appendChild(heading);

  if (tabs.length === 0) {
    const empty = document.createElement("p");
    empty.className = "empty";
    empty.textContent = "No open tabs reported by any device.";
    section.appendChild(empty);
    return;
  }

  // Tab ids are only unique within one browser, so tabs are grouped per device.
  const byDevice = new Map();
  for (const tab of tabs) {
    if (!byDevice.has(tab.deviceId)) byDevice.set(tab.deviceId, []);
    byDevice.get(tab.deviceId).push(tab);
  }

  for (const [deviceId, deviceTabs] of byDevice) {
    const heading = document.createElement("h4");
    heading.textContent = devices.find(d => d.id === deviceId)?.name ?? deviceId;
    section.appendChild(heading);

    const grid = document.createElement("div");
    grid.className = "tab-grid";
    section.appendChild(grid);

    for (const tab of deviceTabs) {
      grid.appendChild(buildTabCard(tab));
    }
  }
}

function buildTabCard(tab) {
  const card = document.createElement("div");
  card.className = "tab-card";

  // Favicon
  const favicon = document.createElement("img");
  favicon.className = "tab-favicon";
  favicon.width = 20;
  favicon.height = 20;
  favicon.alt = "";

  if (tab.favIconUrl) {
    favicon.src = tab.favIconUrl;
    favicon.onerror = () => { favicon.src = ""; favicon.className += " tab-favicon-fallback"; };
  } else {
    favicon.className += " tab-favicon-fallback";
  }

  // Top row: favicon + label badge (if present) + close button
  const topRow = document.createElement("div");
  topRow.className = "tab-top-row";
  topRow.appendChild(favicon);

  if (tab.label) {
    const badge = document.createElement("span");
    badge.className = "tab-label";
    badge.textContent = tab.label;
    topRow.appendChild(badge);
  }

  const closeBtn = document.createElement("button");
  closeBtn.className = "tab-close";
  closeBtn.title = "Close tab";
  closeBtn.textContent = "✕";
  closeBtn.addEventListener("click", async () => {
    try {
      closeBtn.disabled = true;
      await api.closeTab(tab.deviceId, tab.tabId);
    } catch (err) {
      closeBtn.disabled = false;
      showError(section, err.message);
    }
  });
  topRow.appendChild(closeBtn);

  card.appendChild(topRow);

  // Page title or hostname as title
  const title = document.createElement("div");
  title.className = "tab-title";
  title.textContent = tab.title || hostname(tab.url) || tab.url;
  card.appendChild(title);

  // Truncated URL
  const urlEl = document.createElement("div");
  urlEl.className = "tab-url";
  urlEl.textContent = tab.url;
  card.appendChild(urlEl);

  // Relative timestamp
  const time = document.createElement("div");
  time.className = "tab-time";
  time.textContent = relativeTime(tab.openedAt);
  card.appendChild(time);

  return card;
}

function hostname(url) {
  try {
    return new URL(url).hostname;
  } catch {
    return null;
  }
}

function relativeTime(iso) {
  if (!iso) return "";
  const diff = Date.now() - new Date(iso).getTime();
  const s = Math.floor(diff / 1000);
  if (s < 60) return "just now";
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  return `${h}h ago`;
}

function showError(container, message) {
  let el = container.querySelector(".error-msg");
  if (!el) {
    el = document.createElement("p");
    el.className = "error-msg";
    container.prepend(el);
  }
  el.textContent = message;
  setTimeout(() => el.remove(), 4000);
}
