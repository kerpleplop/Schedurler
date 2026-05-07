const BASE = "";

async function request(method, path, body) {
  const options = { method, headers: {} };
  if (body !== undefined) {
    options.headers["content-type"] = "application/json";
    options.body = JSON.stringify(body);
  }
  const res = await fetch(BASE + path, options);
  const data = await res.json();
  if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
  return data;
}

// Bookmarks
export const listBookmarks = () => request("GET", "/api/bookmarks").then(d => d.bookmarks);
export const createBookmark = (data) => request("POST", "/api/bookmarks", data).then(d => d.bookmark);
export const updateBookmark = (id, patch) => request("PATCH", `/api/bookmarks/${id}`, patch).then(d => d.bookmark);
export const deleteBookmark = (id) => request("DELETE", `/api/bookmarks/${id}`);

// Schedules
export const listSchedules = () => request("GET", "/api/schedules").then(d => d.schedules);
export const createSchedule = (data) => request("POST", "/api/schedules", data).then(d => d.schedule);
export const updateSchedule = (id, patch) => request("PATCH", `/api/schedules/${id}`, patch).then(d => d.schedule);
export const deleteSchedule = (id) => request("DELETE", `/api/schedules/${id}`);
export const duplicateSchedule = (id) => request("POST", `/api/schedules/${id}/duplicate`).then(d => d.schedule);
export const activateSchedule = (id) => request("POST", `/api/schedules/${id}/activate`);
export const deactivateSchedule = (id) => request("POST", `/api/schedules/${id}/deactivate`);

// Schedule events
export const addEvent = (scheduleId, data) => request("POST", `/api/schedules/${scheduleId}/events`, data).then(d => d.schedule);
export const updateEvent = (scheduleId, eventId, patch) => request("PATCH", `/api/schedules/${scheduleId}/events/${eventId}`, patch).then(d => d.schedule);
export const deleteEvent = (scheduleId, eventId) => request("DELETE", `/api/schedules/${scheduleId}/events/${eventId}`).then(d => d.schedule);

// Logs
export const getLogs = () => request("GET", "/api/logs").then(d => d.logs);

// State
export const getState = () => request("GET", "/api/state");
export const setScheduleEnabled = (enabled) => request("POST", "/api/state/schedule-enabled", { enabled });

// Commands
export const openUrl = (url, bookmarkId) => request("POST", "/api/commands/open-url", { url, bookmarkId, source: "manual" });
