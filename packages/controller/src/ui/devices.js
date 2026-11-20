import * as api from "./api.js";
import { relativeTime } from "./time.js";

const section = document.getElementById("section-devices");

let devices = [];
// A rename form that is open when a devices_updated event arrives must not be wiped out.
let editingId = null;

export function init(initialDevices) {
  devices = initialDevices ?? [];
  render();
}

export function setDevices(data) {
  devices = data;
  if (editingId === null) render();
}

function render() {
  section.innerHTML = "";

  const heading = document.createElement("h2");
  heading.textContent = "Devices";
  section.appendChild(heading);

  if (devices.length === 0) {
    const empty = document.createElement("p");
    empty.className = "empty";
    empty.textContent = "No devices yet. Connect a Firefox extension to see it here.";
    section.appendChild(empty);
    return;
  }

  const list = document.createElement("ul");
  list.className = "item-list";

  for (const device of devices) {
    list.appendChild(buildDeviceRow(device));
  }

  section.appendChild(list);
}

function buildDeviceRow(device) {
  const li = document.createElement("li");
  li.className = "item-row";
  li.dataset.id = device.id;

  const info = document.createElement("div");
  info.className = "item-info";

  const nameLine = document.createElement("div");
  const name = document.createElement("strong");
  name.className = "device-name";
  name.textContent = device.name;
  nameLine.appendChild(name);

  const badge = document.createElement("span");
  badge.className = device.online ? "badge-online" : "badge-offline";
  badge.textContent = device.online ? "Online" : "Offline";
  nameLine.appendChild(badge);
  info.appendChild(nameLine);

  const meta = document.createElement("span");
  meta.className = "device-meta";
  const seen = device.online ? "connected" : `last seen ${relativeTime(device.lastSeenAt) || "never"}`;
  meta.textContent = `${device.browser} · ${device.tabCount} tab${device.tabCount === 1 ? "" : "s"} · ${seen}`;
  info.appendChild(meta);

  li.appendChild(info);

  const actions = document.createElement("div");
  actions.className = "item-actions";

  const renameBtn = document.createElement("button");
  renameBtn.textContent = "Rename";
  renameBtn.addEventListener("click", () => showRenameForm(li, device));
  actions.appendChild(renameBtn);

  const forgetBtn = document.createElement("button");
  forgetBtn.textContent = "Forget";
  forgetBtn.className = "btn-danger";
  forgetBtn.disabled = device.online;
  forgetBtn.title = device.online ? "Connected devices cannot be forgotten" : "Remove this device";
  forgetBtn.addEventListener("click", async () => {
    if (!confirm(`Forget device "${device.name}"?`)) return;
    try {
      await api.forgetDevice(device.id);
    } catch (err) {
      showError(section, err.message);
    }
  });
  actions.appendChild(forgetBtn);

  li.appendChild(actions);
  return li;
}

function showRenameForm(li, device) {
  editingId = device.id;

  const form = document.createElement("form");
  form.className = "edit-form";

  const input = document.createElement("input");
  input.name = "name";
  input.type = "text";
  input.value = device.name;
  input.maxLength = 60;
  input.required = true;
  form.appendChild(input);

  const save = document.createElement("button");
  save.type = "submit";
  save.textContent = "Save";
  form.appendChild(save);

  const cancel = document.createElement("button");
  cancel.type = "button";
  cancel.className = "btn-cancel";
  cancel.textContent = "Cancel";
  form.appendChild(cancel);

  const close = () => {
    editingId = null;
    render();
  };

  cancel.addEventListener("click", close);

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    try {
      await api.renameDevice(device.id, input.value.trim());
      close();
    } catch (err) {
      showError(section, err.message);
    }
  });

  li.replaceWith(form);
  input.focus();
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
