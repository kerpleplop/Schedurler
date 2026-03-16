# Schedurler

Schedurler is a local-first monorepo for a controller service, a Firefox extension, and shared contracts that coordinate scheduled browser tab actions.

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
3. Temporarily load the Firefox extension:
   - Open `about:debugging`
   - Select `This Firefox`
   - Choose `Load Temporary Add-on...`
   - Pick `packages/extension/manifest.json`
4. Trigger an end-to-end command once the extension is connected:
   ```bash
   curl -X POST http://127.0.0.1:4312/api/commands/open-url \
     -H "content-type: application/json" \
     -d '{"url":"https://example.com","source":"manual"}'
   ```

## Environment Variables
- `SHARED_DATA_DIR`: shared path for `bookmarks.json` and `schedules.json`
- `LOCAL_DATA_DIR`: local path for `controllerState.json` and `settings.json`
- `HOST`: controller bind host, defaults to `127.0.0.1`
- `PORT`: controller port, defaults to `4312`

If the storage env vars are unset, the controller uses local development folders under `./data/shared` and `./data/local` and creates the JSON files on first start.
