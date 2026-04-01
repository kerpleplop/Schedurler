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
   To allow trusted LAN clients, bind the controller beyond loopback:
   ```bash
   HOST=0.0.0.0 npm run dev:controller
   ```
   ```bash
   npm run dev:controller -- --host=0.0.0.0
   ```
   ```powershell
   $env:HOST = "0.0.0.0"
   npm run dev:controller
   ```
   ```cmd
   set HOST=0.0.0.0 && npm run dev:controller
   ```
   The controller also accepts trailing overrides such as `npm run dev:controller HOST=0.0.0.0` and `npm run dev:controller PORT=4313`.
3. Open the controller web UI:
   - Local machine: `http://127.0.0.1:4312/`
   - Trusted LAN clients on the same machine or a native Linux/Windows controller: bind to `0.0.0.0` and open `http://<controller-machine-ip>:4312/`
   - Trusted LAN clients when the controller runs inside the default WSL2 NAT setup: bind to `0.0.0.0`, forward the Windows port as described below, then open `http://<windows-machine-ip>:4312/`
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

## Windows And WSL2 LAN Access

If the controller runs inside WSL2, `HOST=0.0.0.0` opens port `4312` inside the Linux VM but does not automatically expose it to other devices on your LAN. On the default WSL2 NAT setup, Windows still needs to forward the port to the current WSL2 address.

1. Start the controller in WSL2 with one of the bind commands above.
2. In WSL2, find the current VM address:
   ```bash
   hostname -I | awk '{print $1}'
   ```
3. In an elevated PowerShell window on Windows, forward TCP port `4312` to that WSL2 address and allow it through the firewall:
   ```powershell
   $wslIp = "<wsl-ip-from-step-2>"
   netsh interface portproxy delete v4tov4 listenport=4312 listenaddress=0.0.0.0
   netsh interface portproxy add v4tov4 listenport=4312 listenaddress=0.0.0.0 connectport=4312 connectaddress=$wslIp
   netsh advfirewall firewall add rule name="Schedurler Controller 4312" dir=in action=allow protocol=TCP localport=4312
   ```
4. In PowerShell, find the Windows machine IP that other LAN devices should use:
   ```powershell
   Get-NetIPAddress -AddressFamily IPv4 |
     Where-Object { $_.IPAddress -notlike '127.*' -and $_.IPAddress -notlike '169.254.*' } |
     Select-Object InterfaceAlias, IPAddress
   ```
5. From another device on the same trusted network, open `http://<windows-machine-ip>:4312/`.

`netsh interface portproxy` keeps the forwarding rule, but the WSL2 VM IP can change after a restart. If remote access stops working later, repeat step 2 and step 3 with the new WSL2 address.

## Environment Variables
- `SHARED_DATA_DIR`: shared path for `bookmarks.json` and `schedules.json`
- `LOCAL_DATA_DIR`: local path for `controllerState.json` and `settings.json`
- `HOST`: controller bind host, defaults to `127.0.0.1`; the controller also accepts `--host=...`
- `PORT`: controller port, defaults to `4312`; the controller also accepts `--port=...`

If the storage env vars are unset, the controller uses local development folders under `./data/shared` and `./data/local` and creates the JSON files on first start.

On a fresh controller setup, `bookmarks.json` is seeded with three example bookmarks so the web UI has placeholder data for manual loading and sorting tests right away.
