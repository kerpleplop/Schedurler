const state = {
  snapshot: null,
  sort: "name",
  loading: false,
  loadingBookmarkId: null
};

const elements = {
  refreshButton: document.querySelector("#refresh-button"),
  sortSelect: document.querySelector("#sort-select"),
  feedback: document.querySelector("#feedback"),
  bookmarkList: document.querySelector("#bookmark-list"),
  bookmarkCount: document.querySelector("#bookmark-count"),
  connectionSummary: document.querySelector("#connection-summary"),
  controllerId: document.querySelector("#controller-id"),
  controllerHost: document.querySelector("#controller-host"),
  controllerPort: document.querySelector("#controller-port"),
  currentBookmark: document.querySelector("#current-bookmark"),
  controllerMessage: document.querySelector("#controller-message"),
  activeAction: document.querySelector("#active-action"),
  lanMessage: document.querySelector("#lan-message"),
  lastUpdated: document.querySelector("#last-updated")
};

async function main() {
  bindEvents();
  await loadState();
  window.setInterval(() => {
    void loadState({ silent: true });
  }, 5000);
}

function bindEvents() {
  elements.refreshButton.addEventListener("click", () => {
    void loadState();
  });

  elements.sortSelect.addEventListener("change", (event) => {
    state.sort = event.target.value;
    render();
  });

  elements.bookmarkList.addEventListener("click", (event) => {
    if (!(event.target instanceof Element)) {
      return;
    }

    const button = event.target.closest("button[data-bookmark-id]");

    if (!(button instanceof HTMLButtonElement)) {
      return;
    }

    void loadBookmark(button.dataset.bookmarkId);
  });
}

async function loadState(options = {}) {
  if (state.loading) {
    return;
  }

  state.loading = true;
  elements.refreshButton.disabled = true;

  try {
    const response = await fetch("/api/state", {
      headers: {
        accept: "application/json"
      }
    });

    if (!response.ok) {
      throw new Error(`State request failed (${response.status})`);
    }

    state.snapshot = await response.json();

    if (!options.silent) {
      setFeedback("");
    }

    render();
  } catch (error) {
    setFeedback(error instanceof Error ? error.message : String(error));
  } finally {
    state.loading = false;
    elements.refreshButton.disabled = false;
  }
}

async function loadBookmark(bookmarkId) {
  if (!bookmarkId || state.loadingBookmarkId) {
    return;
  }

  state.loadingBookmarkId = bookmarkId;
  render();

  try {
    const response = await fetch(
      `/api/bookmarks/${encodeURIComponent(bookmarkId)}/load`,
      {
        method: "POST",
        headers: {
          accept: "application/json"
        }
      }
    );
    const payload = await response.json();

    if (!response.ok) {
      throw new Error(payload.error ?? `Load failed (${response.status})`);
    }

    setFeedback(
      `Sent "${payload.bookmark.name}" to ${payload.deliveredTo} connected extension${payload.deliveredTo === 1 ? "" : "s"}.`,
      "success"
    );

    await loadState({ silent: true });
  } catch (error) {
    setFeedback(error instanceof Error ? error.message : String(error));
  } finally {
    state.loadingBookmarkId = null;
    render();
  }
}

function render() {
  if (!state.snapshot) {
    elements.connectionSummary.textContent = "Loading...";
    elements.bookmarkCount.textContent = "Loading...";
    return;
  }

  const { controller, extensionConnections, state: controllerState, bookmarks, generatedAt } =
    state.snapshot;
  const currentBookmark = bookmarks.find(
    (bookmark) => bookmark.id === controllerState.currentBookmarkId
  );
  const sortedBookmarks = [...bookmarks].sort(createBookmarkComparator(state.sort));
  const statusLabel =
    controller.status === "ready"
      ? "Ready"
      : "Waiting for Firefox extension";

  elements.connectionSummary.textContent = `${extensionConnections} extension connection${
    extensionConnections === 1 ? "" : "s"
  }`;
  elements.controllerId.textContent = controller.id;
  elements.controllerHost.textContent = controller.host;
  elements.controllerPort.textContent = String(controller.port);
  elements.currentBookmark.textContent = currentBookmark
    ? currentBookmark.name
    : "None";
  elements.controllerMessage.textContent = `${statusLabel}. Controller is serving this page from the local machine.`;
  elements.activeAction.textContent = describeActiveAction(controllerState, bookmarks);
  elements.lanMessage.textContent = controller.lanAccessEnabled
    ? "LAN access is enabled for trusted local-network clients."
    : "LAN access is currently loopback-only. Start the controller with HOST=0.0.0.0 to open this page from another device on the same trusted network.";
  elements.lastUpdated.textContent = `Snapshot updated ${formatTimestamp(generatedAt)}.`;
  elements.bookmarkCount.textContent = `${bookmarks.length} bookmark${
    bookmarks.length === 1 ? "" : "s"
  } available`;

  renderBookmarks(sortedBookmarks, {
    currentBookmarkId: controllerState.currentBookmarkId,
    extensionConnections
  });
}

function renderBookmarks(bookmarks, options) {
  if (bookmarks.length === 0) {
    elements.bookmarkList.innerHTML =
      '<li class="bookmark-empty">No bookmarks are saved in the controller library yet.</li>';
    return;
  }

  elements.bookmarkList.innerHTML = bookmarks
    .map((bookmark) => {
      const keywords = bookmark.keywords
        .map(
          (keyword) =>
            `<li class="keyword-pill">${escapeHtml(keyword)}</li>`
        )
        .join("");
      const isCurrent = bookmark.id === options.currentBookmarkId;
      const isLoading = bookmark.id === state.loadingBookmarkId;
      const disabled = options.extensionConnections === 0 || isLoading;

      return `
        <li class="bookmark-card ${isCurrent ? "current" : ""}">
          <div>
            <div class="bookmark-name-row">
              <span class="bookmark-name">${escapeHtml(bookmark.name)}</span>
              ${isCurrent ? '<span class="bookmark-current">Current</span>' : ""}
            </div>
            <p class="bookmark-url">${escapeHtml(bookmark.url)}</p>
            ${
              keywords
                ? `<ul class="keyword-list">${keywords}</ul>`
                : '<p class="panel-subtle">No keywords</p>'
            }
          </div>
          <button
            class="load-button"
            type="button"
            data-bookmark-id="${escapeAttribute(bookmark.id)}"
            ${disabled ? "disabled" : ""}
          >
            ${isLoading ? "Loading..." : "Load Bookmark"}
          </button>
        </li>
      `;
    })
    .join("");
}

function createBookmarkComparator(sortKey) {
  if (sortKey === "keyword") {
    return (left, right) => {
      const leftKeyword = firstKeyword(left);
      const rightKeyword = firstKeyword(right);

      if (leftKeyword !== rightKeyword) {
        return leftKeyword.localeCompare(rightKeyword);
      }

      return left.name.localeCompare(right.name);
    };
  }

  return (left, right) => left.name.localeCompare(right.name);
}

function firstKeyword(bookmark) {
  if (!Array.isArray(bookmark.keywords) || bookmark.keywords.length === 0) {
    return "~";
  }

  return [...bookmark.keywords].sort((left, right) => left.localeCompare(right))[0];
}

function describeActiveAction(controllerState, bookmarks) {
  const activeAction = controllerState.activeTabAction;

  if (activeAction.status === "idle") {
    return "No tab action is currently in flight.";
  }

  const bookmark = bookmarks.find(
    (item) => item.id === activeAction.bookmarkId
  );
  const bookmarkLabel = bookmark ? `"${bookmark.name}"` : "manual URL";
  const detail = activeAction.url ? ` (${activeAction.url})` : "";
  const errorSuffix = activeAction.errorMessage
    ? ` Error: ${activeAction.errorMessage}`
    : "";

  return `Latest action: ${activeAction.status} from ${activeAction.source} for ${bookmarkLabel}${detail}.${errorSuffix}`;
}

function formatTimestamp(value) {
  const parsed = new Date(value);

  if (Number.isNaN(parsed.getTime())) {
    return value;
  }

  return parsed.toLocaleString();
}

function setFeedback(message, tone = "") {
  elements.feedback.textContent = message;
  elements.feedback.className = tone ? `feedback ${tone}` : "feedback";
}

function escapeHtml(value) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function escapeAttribute(value) {
  return escapeHtml(value);
}

void main();
