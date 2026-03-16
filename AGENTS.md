# Schedurler Agent Guide

## Product
Schedurler is a local-first system for opening, focusing, muting, unmuting, and closing browser tabs or URLs on a schedule. The controller runs on a user machine, owns the data model for that machine, and coordinates a thin browser extension over WebSocket.

## Package Boundaries
- `packages/controller`: local Node service. Owns storage access, HTTP API, device-local state, future scheduler execution, and future web UI hosting.
- `packages/extension`: Firefox tab agent. Executes browser-specific tab actions and reports results back to the controller. Keep it thin.
- `packages/shared`: shared types, protocol definitions, constants, and validation helpers only. No filesystem logic, no browser APIs, no server implementation.

## Source Of Truth Rules
- The controller is the source of truth for bookmarks, schedules, and this device's active state.
- The extension must not persist or own bookmarks or schedules.
- Shared message and data contracts belong in `packages/shared`. Do not redefine them inside the controller or extension.
- If logic can live in the controller instead of the extension, prefer the controller.

## Storage Model
- Shared library storage lives at a machine-specific path and contains `bookmarks.json` and `schedules.json`.
- Local device storage lives on the controller machine and contains `controllerState.json` and `settings.json`.
- Use the exact file names above everywhere.
- Read storage roots from `SHARED_DATA_DIR` and `LOCAL_DATA_DIR`, with simple local development defaults when those env vars are unset.

## Implementation Priorities
- Favor simple, boring, reliable code over abstractions.
- Keep the extension browser-specific and operational, not stateful.
- Preserve cross-platform controller behavior for Windows and Linux.
- Firefox is the initial browser target. Do not assume Chromium-only APIs.
- Do not implement speculative scheduling features before the controller, protocol, and tab-action loop are solid.
- Keep comments short and only where boundaries or intent are not obvious from the code.

## Naming And Scope
- Keep the product name `Schedurler` everywhere.
- Keep the app general-purpose. Do not hardcode any specific website, media workflow, or branded use case.
- New protocols, constants, and shared validation rules should be added to `packages/shared` first, then consumed by other packages.

