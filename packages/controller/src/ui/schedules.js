import * as api from "./api.js";

const section = document.getElementById("section-schedules");

let schedules = [];
let bookmarks = [];
let activeScheduleId = null;

export function setSchedules(data) {
  schedules = data;
  render();
}

export function setBookmarks(data) {
  bookmarks = data;
}

export function setActiveScheduleId(id) {
  activeScheduleId = id;
  render();
}

export async function init(bookmarkList) {
  bookmarks = bookmarkList;
  schedules = await api.listSchedules();
  render();
}

function render() {
  section.innerHTML = "";

  const heading = document.createElement("h2");
  heading.textContent = "Schedules";
  section.appendChild(heading);

  const createForm = buildCreateForm();
  section.appendChild(createForm);

  if (schedules.length === 0) {
    const empty = document.createElement("p");
    empty.className = "empty";
    empty.textContent = "No schedules yet.";
    section.appendChild(empty);
    return;
  }

  for (const schedule of schedules) {
    section.appendChild(buildScheduleCard(schedule));
  }
}

function buildCreateForm() {
  const form = document.createElement("form");
  form.className = "create-form";
  form.innerHTML = `
    <input name="name" type="text" placeholder="Schedule name" required />
    <button type="submit">Add schedule</button>
  `;

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const fd = new FormData(form);
    const name = fd.get("name").trim();
    try {
      await api.createSchedule({ name });
      schedules = await api.listSchedules();
      render();
    } catch (err) {
      showError(section, err.message);
    }
  });

  return form;
}

function buildScheduleCard(schedule) {
  const card = document.createElement("div");
  card.className = "schedule-card" + (schedule.id === activeScheduleId ? " is-active" : "");
  card.dataset.id = schedule.id;

  // Header row
  const header = document.createElement("div");
  header.className = "schedule-header";

  const title = document.createElement("strong");
  title.className = "schedule-name";
  title.textContent = schedule.name;
  header.appendChild(title);

  if (schedule.id === activeScheduleId) {
    const badge = document.createElement("span");
    badge.className = "badge-active";
    badge.textContent = "Active";
    header.appendChild(badge);
  }

  const actions = document.createElement("div");
  actions.className = "item-actions";

  if (schedule.id !== activeScheduleId) {
    const activateBtn = document.createElement("button");
    activateBtn.textContent = "Activate";
    activateBtn.addEventListener("click", async () => {
      try {
        await api.activateSchedule(schedule.id);
        const state = await api.getState();
        activeScheduleId = state.state.activeScheduleId;
        render();
      } catch (err) {
        showError(section, err.message);
      }
    });
    actions.appendChild(activateBtn);
  } else {
    const deactivateBtn = document.createElement("button");
    deactivateBtn.textContent = "Deactivate";
    deactivateBtn.addEventListener("click", async () => {
      try {
        await api.deactivateSchedule(schedule.id);
        activeScheduleId = null;
        render();
      } catch (err) {
        showError(section, err.message);
      }
    });
    actions.appendChild(deactivateBtn);
  }

  const editBtn = document.createElement("button");
  editBtn.textContent = "Rename";
  editBtn.addEventListener("click", () => showRenameForm(card, schedule));
  actions.appendChild(editBtn);

  const dupBtn = document.createElement("button");
  dupBtn.textContent = "Duplicate";
  dupBtn.addEventListener("click", async () => {
    try {
      await api.duplicateSchedule(schedule.id);
      schedules = await api.listSchedules();
      render();
    } catch (err) {
      showError(section, err.message);
    }
  });
  actions.appendChild(dupBtn);

  const deleteBtn = document.createElement("button");
  deleteBtn.textContent = "Delete";
  deleteBtn.className = "btn-danger";
  deleteBtn.addEventListener("click", async () => {
    if (!confirm(`Delete schedule "${schedule.name}"?`)) return;
    try {
      await api.deleteSchedule(schedule.id);
      schedules = await api.listSchedules();
      render();
    } catch (err) {
      showError(section, err.message);
    }
  });
  actions.appendChild(deleteBtn);

  header.appendChild(actions);
  card.appendChild(header);

  // Events list
  card.appendChild(buildEventsSection(schedule));

  return card;
}

function showRenameForm(card, schedule) {
  const form = document.createElement("form");
  form.className = "edit-form";
  form.innerHTML = `
    <input name="name" type="text" value="${esc(schedule.name)}" required />
    <button type="submit">Save</button>
    <button type="button" class="btn-cancel">Cancel</button>
  `;

  form.querySelector(".btn-cancel").addEventListener("click", () => render());

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const name = new FormData(form).get("name").trim();
    try {
      await api.updateSchedule(schedule.id, { name });
      schedules = await api.listSchedules();
      render();
    } catch (err) {
      showError(section, err.message);
    }
  });

  card.querySelector(".schedule-header").replaceWith(form);
}

function buildEventsSection(schedule) {
  const container = document.createElement("div");
  container.className = "events-section";

  const eventsLabel = document.createElement("h4");
  eventsLabel.textContent = "Events";
  container.appendChild(eventsLabel);

  if (schedule.events.length === 0) {
    const empty = document.createElement("p");
    empty.className = "empty small";
    empty.textContent = "No events.";
    container.appendChild(empty);
  } else {
    const list = document.createElement("ul");
    list.className = "event-list";
    for (const event of schedule.events) {
      list.appendChild(buildEventRow(schedule, event, list));
    }
    container.appendChild(list);
  }

  const addForm = buildAddEventForm(schedule);
  container.appendChild(addForm);

  return container;
}

function buildEventRow(schedule, event, list) {
  const bookmarkName = bookmarks.find(b => b.id === event.bookmarkId)?.name ?? event.bookmarkId;

  const li = document.createElement("li");
  li.className = "event-row";
  li.dataset.id = event.id;

  const info = document.createElement("span");
  info.className = "event-info";
  info.innerHTML = `<code>${esc(event.time)}</code> — ${esc(bookmarkName)} ${event.enabled ? "" : '<em>(disabled)</em>'}`;
  li.appendChild(info);

  const actions = document.createElement("span");
  actions.className = "item-actions";

  const toggleBtn = document.createElement("button");
  toggleBtn.textContent = event.enabled ? "Disable" : "Enable";
  toggleBtn.addEventListener("click", async () => {
    try {
      const updated = await api.updateEvent(schedule.id, event.id, { enabled: !event.enabled });
      schedules = schedules.map(s => s.id === schedule.id ? updated : s);
      render();
    } catch (err) {
      showError(section, err.message);
    }
  });
  actions.appendChild(toggleBtn);

  const editBtn = document.createElement("button");
  editBtn.textContent = "Edit";
  editBtn.addEventListener("click", () => showEditEventForm(li, schedule, event));
  actions.appendChild(editBtn);

  const deleteBtn = document.createElement("button");
  deleteBtn.textContent = "Delete";
  deleteBtn.className = "btn-danger";
  deleteBtn.addEventListener("click", async () => {
    try {
      const updated = await api.deleteEvent(schedule.id, event.id);
      schedules = schedules.map(s => s.id === schedule.id ? updated : s);
      render();
    } catch (err) {
      showError(section, err.message);
    }
  });
  actions.appendChild(deleteBtn);

  li.appendChild(actions);
  return li;
}

function showEditEventForm(li, schedule, event) {
  const form = document.createElement("form");
  form.className = "edit-form";
  form.innerHTML = `
    <input name="time" type="text" pattern="^([01]\\d|2[0-3]):[0-5]\\d$" value="${esc(event.time)}" placeholder="HH:MM" required />
    <select name="bookmarkId">
      ${bookmarks.map(b => `<option value="${esc(b.id)}" ${b.id === event.bookmarkId ? "selected" : ""}>${esc(b.name)}</option>`).join("")}
    </select>
    <label><input name="enabled" type="checkbox" ${event.enabled ? "checked" : ""} /> Enabled</label>
    <button type="submit">Save</button>
    <button type="button" class="btn-cancel">Cancel</button>
  `;

  form.querySelector(".btn-cancel").addEventListener("click", () => render());

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const fd = new FormData(form);
    const patch = {
      time: fd.get("time"),
      bookmarkId: fd.get("bookmarkId"),
      enabled: form.querySelector('[name="enabled"]').checked
    };
    try {
      const updated = await api.updateEvent(schedule.id, event.id, patch);
      schedules = schedules.map(s => s.id === schedule.id ? updated : s);
      render();
    } catch (err) {
      showError(section, err.message);
    }
  });

  li.replaceWith(form);
}

function buildAddEventForm(schedule) {
  const form = document.createElement("form");
  form.className = "create-form small";
  form.innerHTML = `
    <input name="time" type="text" pattern="^([01]\\d|2[0-3]):[0-5]\\d$" placeholder="HH:MM" required />
    <select name="bookmarkId">
      ${bookmarks.map(b => `<option value="${esc(b.id)}">${esc(b.name)}</option>`).join("")}
    </select>
    <button type="submit">Add event</button>
  `;

  if (bookmarks.length === 0) {
    const note = document.createElement("p");
    note.className = "empty small";
    note.textContent = "Add a bookmark first to create events.";
    form.replaceWith(note);
    return note;
  }

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const fd = new FormData(form);
    const data = {
      time: fd.get("time"),
      bookmarkId: fd.get("bookmarkId"),
      enabled: true
    };
    try {
      const updated = await api.addEvent(schedule.id, data);
      schedules = schedules.map(s => s.id === schedule.id ? updated : s);
      render();
    } catch (err) {
      showError(section, err.message);
    }
  });

  return form;
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
