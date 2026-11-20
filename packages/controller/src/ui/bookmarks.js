import * as api from "./api.js";
import { relativeTime } from "./time.js";

const section = document.getElementById("section-bookmarks");

let bookmarks = [];
let devices = [];
// Device id the "Open" buttons send to; "" means every connected device.
let openTargetId = "";

export function setBookmarks(data) {
  bookmarks = data;
  render();
}

// devices_updated fires on every tab change; only re-render when the list a user could pick from changes.
export function setDevices(data) {
  const changed = deviceSignature(data) !== deviceSignature(devices);
  devices = data;
  if (changed) render();
}

function deviceSignature(list) {
  return JSON.stringify(list.map(d => [d.id, d.name]));
}

export async function init(deviceList) {
  devices = deviceList ?? [];
  bookmarks = await api.listBookmarks();
  render();
}

function render() {
  section.innerHTML = "";

  const heading = document.createElement("h2");
  heading.textContent = "Bookmarks";
  section.appendChild(heading);

  const createForm = buildCreateForm();
  section.appendChild(createForm);

  const targetPicker = buildOpenTargetPicker();
  if (targetPicker) section.appendChild(targetPicker);

  if (bookmarks.length === 0) {
    const empty = document.createElement("p");
    empty.className = "empty";
    empty.textContent = "No bookmarks yet.";
    section.appendChild(empty);
    return;
  }

  const list = document.createElement("ul");
  list.className = "item-list";

  for (const bookmark of bookmarks) {
    list.appendChild(buildBookmarkRow(bookmark));
  }

  section.appendChild(list);
}

function buildOpenTargetPicker() {
  if (devices.length < 2) return null;

  if (openTargetId !== "" && !devices.some(d => d.id === openTargetId)) {
    openTargetId = "";
  }

  const label = document.createElement("label");
  label.className = "open-target";
  label.append("Open on: ");

  const select = document.createElement("select");
  const allOption = new Option("All connected devices", "");
  select.appendChild(allOption);
  for (const device of devices) {
    select.appendChild(new Option(device.name, device.id));
  }
  select.value = openTargetId;
  select.addEventListener("change", () => {
    openTargetId = select.value;
  });

  label.appendChild(select);
  return label;
}

function buildCreateForm() {
  const form = document.createElement("form");
  form.className = "create-form";
  form.innerHTML = `
    <input name="name" type="text" placeholder="Name" required />
    <input name="url" type="url" placeholder="URL" required />
    <input name="keywords" type="text" placeholder="Keywords (comma-separated)" />
    <button type="submit">Add bookmark</button>
  `;

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const fd = new FormData(form);
    const name = fd.get("name").trim();
    const url = fd.get("url").trim();
    const keywords = fd.get("keywords").split(",").map(k => k.trim()).filter(Boolean);

    try {
      await api.createBookmark({ name, url, keywords });
      bookmarks = await api.listBookmarks();
      render();
    } catch (err) {
      showError(section, err.message);
    }
  });

  return form;
}

function buildBookmarkRow(bookmark) {
  const li = document.createElement("li");
  li.className = "item-row";
  li.dataset.id = bookmark.id;

  const info = document.createElement("div");
  info.className = "item-info";
  info.innerHTML = `
    <strong class="item-name">${esc(bookmark.name)}</strong>
    <a class="item-url" href="${esc(bookmark.url)}" title="${esc(bookmark.url)}" target="_blank" rel="noreferrer">${esc(shortUrl(bookmark.url))}</a>
    ${bookmark.keywords.length > 0 ? `<span class="item-keywords">${bookmark.keywords.map(esc).join(", ")}</span>` : ""}
    ${bookmark.stats ? `<span class="item-stats">Opened ${bookmark.stats.openCount} time${bookmark.stats.openCount === 1 ? "" : "s"} · last: ${relativeTime(bookmark.stats.lastOpenedAt)}</span>` : ""}
  `;
  li.appendChild(info);

  const actions = document.createElement("div");
  actions.className = "item-actions";

  const openBtn = document.createElement("button");
  openBtn.textContent = "Open";
  openBtn.title = "Send to connected extension";
  openBtn.addEventListener("click", async () => {
    try {
      await api.openUrl(bookmark.url, bookmark.id, openTargetId ? [openTargetId] : undefined);
    } catch (err) {
      showError(section, err.message);
    }
  });
  actions.appendChild(openBtn);

  const editBtn = document.createElement("button");
  editBtn.textContent = "Edit";
  editBtn.addEventListener("click", () => showEditForm(li, bookmark));
  actions.appendChild(editBtn);

  const deleteBtn = document.createElement("button");
  deleteBtn.textContent = "Delete";
  deleteBtn.className = "btn-danger";
  deleteBtn.addEventListener("click", async () => {
    if (!confirm(`Delete bookmark "${bookmark.name}"?`)) return;
    try {
      await api.deleteBookmark(bookmark.id);
      bookmarks = await api.listBookmarks();
      render();
    } catch (err) {
      showError(section, err.message);
    }
  });
  actions.appendChild(deleteBtn);

  li.appendChild(actions);
  return li;
}

function showEditForm(li, bookmark) {
  const form = document.createElement("form");
  form.className = "edit-form";
  form.innerHTML = `
    <input name="name" type="text" value="${esc(bookmark.name)}" required />
    <input name="url" type="url" value="${esc(bookmark.url)}" required />
    <input name="keywords" type="text" value="${bookmark.keywords.map(esc).join(", ")}" />
    <button type="submit">Save</button>
    <button type="button" class="btn-cancel">Cancel</button>
  `;

  form.querySelector(".btn-cancel").addEventListener("click", () => render());

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const fd = new FormData(form);
    const patch = {
      name: fd.get("name").trim(),
      url: fd.get("url").trim(),
      keywords: fd.get("keywords").split(",").map(k => k.trim()).filter(Boolean)
    };
    try {
      await api.updateBookmark(bookmark.id, patch);
      bookmarks = await api.listBookmarks();
      render();
    } catch (err) {
      showError(section, err.message);
    }
  });

  li.replaceWith(form);
}

function shortUrl(url) {
  try {
    const parsed = new URL(url);
    return `${parsed.hostname}${parsed.pathname}`.replace(/\/$/, "") || parsed.hostname;
  } catch {
    return url;
  }
}

function esc(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
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
