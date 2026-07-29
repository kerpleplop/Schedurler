# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
# Install dependencies
npm install

# Build everything (shared first, then controller)
npm run build

# Build individual packages
npm run build:shared
npm run build:controller

# Run controller in dev mode (builds shared first, then runs via tsx)
npm run dev:controller

# Run controller from compiled output
npm run start:controller

# Run controller bound to all interfaces (for LAN/Raspberry Pi use)
npm run start:pi
```

Type-check is implicit in all `tsc -b` builds — strict mode is enabled. There is no separate lint or test command.

The `build` and `build:controller` scripts also copy `packages/controller/src/ui/` verbatim into `packages/controller/dist/ui/` — the web UI is plain HTML/CSS/JS and is not transpiled or bundled.

To load the Firefox extension during development: open `about:debugging` → This Firefox → Load Temporary Add-on → pick `packages/extension/manifest.json`.

To send a test command once the extension is connected:
```bash
curl -X POST http://127.0.0.1:4312/api/commands/open-url \
  -H "content-type: application/json" \
  -d '{"url":"https://example.com","source":"manual"}'
```

## Architecture

Schedurler is a local-first monorepo: a Node controller, a Firefox extension, and shared contracts. The controller runs on one machine, hosts a web UI for trusted LAN clients, and instructs one or more connected Firefox extensions to perform tab actions.

### Package roles

- **`packages/controller`** — source of truth for bookmarks, schedules, and device-local active state. Owns storage, HTTP API, WebSocket server, and web UI hosting.
- **`packages/extension`** — thin Firefox tab agent. Executes controller-issued commands, reports results. Stateless: no bookmark or schedule ownership.
- **`packages/shared`** — shared types, protocol definitions, constants, and validation helpers only. No filesystem logic, no browser APIs, no server implementation.

The extension must stay thin and browser-specific. If logic can live in the controller instead of the extension, prefer the controller.

### Two WebSocket servers

The controller runs **two separate WebSocket servers** on the same HTTP port, distinguished by path:

| Path | Class | Purpose |
|---|---|---|
| `/ws` | `ControllerSocketServer` | Extension ↔ controller (bidirectional, ping/pong heartbeat) |
| `/ws/ui` | `BrowserSocketServer` | Controller → browser UI (broadcast-only push) |

`ControllerSocketServer` receives `ExtensionToControllerMessage` frames and sends `ControllerToExtensionMessage` commands. `BrowserSocketServer` only broadcasts `BrowserEvent` objects (`state_update`, `bookmarks_updated`, `schedules_updated`, `tabs_updated`, `log_entry`) — it never receives messages from the UI.

The extension reads `controllerWsUrl` from `browser.storage.local` to override the default `ws://127.0.0.1:4312/ws`. This is how users configure the extension to connect to a controller on the LAN.

### HTTP API surface

All routes are in `packages/controller/src/server.ts`. There is no router library — routes are matched with a hand-rolled `matchPath` helper.

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/` | Serves UI `index.html` |
| `GET` | `/ui/*` | Serves static UI files |
| `GET` | `/health` | Liveness check + connection counts |
| `GET` | `/api/logs` | In-memory log buffer |
| `GET/POST` | `/api/bookmarks` | List / create bookmarks |
| `PATCH/DELETE` | `/api/bookmarks/:id` | Update / delete bookmark |
| `GET/POST` | `/api/schedules` | List / create schedules |
| `PATCH/DELETE` | `/api/schedules/:id` | Update / delete schedule |
| `POST` | `/api/schedules/:id/duplicate` | Clone a schedule |
| `POST` | `/api/schedules/:id/activate` | Activate + immediately fire most-recent event |
| `POST` | `/api/schedules/:id/deactivate` | Deactivate + close schedule tab |
| `POST` | `/api/schedules/:id/events` | Add an event to a schedule |
| `PATCH/DELETE` | `/api/schedules/:scheduleId/events/:eventId` | Update / remove an event |
| `GET` | `/api/state` | Current `ControllerState` |
| `POST` | `/api/state/schedule-enabled` | Toggle schedule running |
| `POST` | `/api/commands/open-url` | Manual one-off open URL command |
| `GET` | `/api/tabs` | Live tab registry |
| `DELETE` | `/api/tabs/:tabId` | Close a specific tab |

### Schedule runner

`ScheduleRunner` (`packages/controller/src/scheduler.ts`) ticks every second and deduplicates by wall-clock minute (`lastFiredMinute`). On activation it calls `activateNow()`, which finds the most-recently-due enabled event and fires it immediately so the correct bookmark opens right away. When a schedule tab already exists (`scheduleTabId`), the runner reuses it by passing `tabId` in the `open_url` command instead of opening a new tab.

### Extension keepalive tab

The extension maintains a hidden `about:blank` tab (`reservedTabId`) to keep Firefox alive when no other tabs are open. This tab is silently excluded from all `tabs_state` reports and never shown in the UI. It is recreated automatically if closed while the WebSocket is still connected.

### Storage model

| Env var | Default (dev) | Files |
|---|---|---|
| `SHARED_DATA_DIR` | `./data/shared` | `bookmarks.json`, `schedules.json` |
| `LOCAL_DATA_DIR` | `./data/local` | `controllerState.json`, `settings.json` |

Use those exact filenames everywhere. `HOST` (default `127.0.0.1`) and `PORT` (default `4312`) control the controller bind address.

### TypeScript build

The repo uses TypeScript project references (`tsc -b`). `packages/shared` must be built before `packages/controller`. The root `tsconfig.base.json` targets ES2021/CommonJS with strict mode.

## Ownership rules

**Shared contracts (`packages/shared`)**

Before adding anything to `packages/shared`, answer in order:
1. Can this shape stay controller-local or extension-local?
2. Is it domain-shared or protocol-shared — not UI-shaped?
3. Will at least two packages consume it directly?
4. Does it belong in types / validation / constants / controller-extension protocol?

Reject these from `packages/shared` by default: controller-only HTTP response envelopes, browser UI snapshot DTOs, UI-only view models or filters, storage implementation details, browser APIs or extension runtime logic, single-consumer abstractions.

New protocols, constants, and validation rules go to `packages/shared` first, then are consumed downstream.

**Web UI work**

Keep UI assets, HTTP routes, request parsing, response shaping, and browser-facing view models in `packages/controller`. The UI is plain HTML/CSS/JS in `packages/controller/src/ui/` — do not introduce a build step or framework. Do not reuse controller-extension WebSocket message shapes as browser UI HTTP contracts. The deployment target is a trusted local network only — don't add public-internet hardening unless explicitly requested. When adding a UI-facing endpoint, verify: bind host behavior, LAN URL construction, and CORS posture.

## Conventions

- Favor simple, boring, reliable code over abstractions.
- Keep controller behavior cross-platform (Windows and Linux).
- Firefox-first — don't assume Chromium-only APIs.
- Don't implement speculative scheduling features before the core controller/protocol/tab-action loop is solid.
- Short comments only where boundaries or intent aren't obvious from the code.
- Product name is `Schedurler` everywhere. Keep the app general-purpose — no hardcoded websites, media workflows, or branded use cases.
