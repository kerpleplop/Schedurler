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
```

Type-check is implicit in all `tsc -b` builds — strict mode is enabled. There is no separate lint or test command.

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

- **`packages/controller`** — source of truth for bookmarks, schedules, and device-local active state. Owns storage, HTTP API, WebSocket server, and future web UI hosting.
- **`packages/extension`** — thin Firefox tab agent. Executes controller-issued commands, reports results. Stateless: no bookmark or schedule ownership.
- **`packages/shared`** — shared types, protocol definitions, constants, and validation helpers only. No filesystem logic, no browser APIs, no server implementation.

The extension must stay thin and browser-specific. If logic can live in the controller instead of the extension, prefer the controller.

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

Keep UI assets, HTTP routes, request parsing, response shaping, and browser-facing view models in `packages/controller`. Do not reuse controller-extension WebSocket message shapes as browser UI HTTP contracts. The deployment target is a trusted local network only — don't add public-internet hardening unless explicitly requested. When adding a UI-facing endpoint, verify: bind host behavior, LAN URL construction, and CORS posture.

## Conventions

- Favor simple, boring, reliable code over abstractions.
- Keep controller behavior cross-platform (Windows and Linux).
- Firefox-first — don't assume Chromium-only APIs.
- Don't implement speculative scheduling features before the core controller/protocol/tab-action loop is solid.
- Short comments only where boundaries or intent aren't obvious from the code.
- Product name is `Schedurler` everywhere. Keep the app general-purpose — no hardcoded websites, media workflows, or branded use cases.
