const container = document.getElementById("section-logs");

let autoScroll = true;

export function init(initialLogs) {
  container.innerHTML = `
    <div class="logs-toolbar">
      <h2>Logs</h2>
      <button id="logs-clear-btn">Clear</button>
    </div>
    <ol id="log-list" class="log-list"></ol>
  `;

  document.getElementById("logs-clear-btn").addEventListener("click", () => {
    document.getElementById("log-list").innerHTML = "";
  });

  const list = document.getElementById("log-list");
  list.addEventListener("scroll", () => {
    const atBottom = list.scrollHeight - list.scrollTop - list.clientHeight < 4;
    autoScroll = atBottom;
  });

  for (const entry of initialLogs) {
    appendEntry(entry);
  }
}

export function appendEntry(entry) {
  const list = document.getElementById("log-list");
  if (!list) return;

  const time = new Date(entry.timestamp).toLocaleTimeString();
  const li = document.createElement("li");
  li.className = `log-entry log-${entry.level}`;
  li.innerHTML = `<span class="log-time">${time}</span><span class="log-level">${entry.level}</span><span class="log-msg"></span>`;
  li.querySelector(".log-msg").textContent = entry.message;
  list.appendChild(li);

  if (autoScroll) {
    list.scrollTop = list.scrollHeight;
  }
}
