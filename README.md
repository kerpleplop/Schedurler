# Schedurler

Schedurler is a local-first monorepo for a controller service, a Firefox extension, and shared contracts that coordinate scheduled browser tab actions.

The intended finished product is a single controller running on one machine and serving a browser-based web app to other devices on the same trusted local network. People should be able to open the local web app from a phone, laptop, or desktop browser, manage bookmarks and schedules there, and have the controller instruct one or more connected Firefox extensions to carry out the actual browser tab actions on their machines.

## Product Direction
- One controller instance runs at a time and remains the source of truth for bookmarks, schedules, and device-local active state.
- The controller will host a user-friendly web app for trusted local-network use only, not public-internet deployment.
- Multiple web clients may be connected to the controller web UI at the same time.
- Multiple Firefox extensions may be connected to the controller at the same time so the same bookmark or schedule action can be applied across multiple computers.
- Bookmarks are saved in the controller-owned library and should support create, edit, rename, keyword tagging, sorting, and manual loading.
- Schedules are controller-owned 24-hour cycle definitions that map saved bookmarks to times of day and should support create, edit, rename, duplicate, activate, and event-level changes.
- The extension remains thin: it executes controller-issued browser actions and reports results back, but it does not own bookmark or schedule data.

## Current Status
- The controller already owns storage access, a small HTTP API, the controller-hosted web UI, and the WebSocket connection to extensions.
- The first controller-hosted web UI slice serves a same-origin browser app at `/` with controller status, bookmark listing and sorting, and manual bookmark loading.
- The Firefox extension already executes the controller command loop for opening, closing, muting, unmuting, and reporting tab state.
- The next major implementation surfaces are bookmark editing, schedule management, and richer multi-client status updates in the controller-hosted web app.

## Packages
- `packages/shared`: shared types, protocol definitions, constants, and validation helpers
- `packages/controller`: local Node controller with storage access, HTTP API, and WebSocket server
- `packages/extension`: Firefox extension that performs browser tab actions on controller commands

## Local Development
1. Install dependencies:
   ```bash
   npm install
   ```
2. Start the controller:
   ```bash
   npm run dev:controller
   ```
3. Open the controller web UI:
   - Local machine: `http://127.0.0.1:4312/`
   - Trusted LAN clients: start the controller with `HOST=0.0.0.0` and open `http://<controller-machine-ip>:4312/`
4. Temporarily load the Firefox extension:
   - Open `about:debugging`
   - Select `This Firefox`
   - Choose `Load Temporary Add-on...`
   - Pick `packages/extension/manifest.json`
5. Trigger an end-to-end command once the extension is connected:
   ```bash
   curl -X POST http://127.0.0.1:4312/api/commands/open-url \
     -H "content-type: application/json" \
     -d '{"url":"https://example.com","source":"manual"}'
   ```

The same-origin web UI at `/` can also load saved bookmarks through the controller once one or more Firefox extensions are connected.

## Environment Variables
- `SHARED_DATA_DIR`: shared path for `bookmarks.json` and `schedules.json`
- `LOCAL_DATA_DIR`: local path for `controllerState.json` and `settings.json`
- `HOST`: controller bind host, defaults to `127.0.0.1`
- `PORT`: controller port, defaults to `4312`

If the storage env vars are unset, the controller uses local development folders under `./data/shared` and `./data/local` and creates the JSON files on first start.

On a fresh controller setup, `bookmarks.json` is seeded with three example bookmarks so the web UI has placeholder data for manual loading and sorting tests right away.
