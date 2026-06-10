---
name: controller-web-ui-slice
description: Plan and review controller-hosted browser UI work for Schedurler. Use when a task adds or changes controller-served web UI assets, UI-facing HTTP endpoints, local-network browser access, static asset serving, or controller-side view models for the web app.
---

# Controller Web Ui Slice

Plan controller-hosted web UI work without pushing ownership into the extension or inflating `packages/shared`.

## Read First

- Read `AGENTS.md`.
- Read `docs/codex-workflows.md`.
- Inspect `packages/controller/src/server.ts`, `packages/controller/src/index.ts`, `packages/controller/src/config.ts`, `packages/controller/src/ws/socketServer.ts`, and the relevant controller storage files.
- Read `packages/shared/src/types.ts` and `packages/shared/src/protocol.ts` only to confirm whether a proposed shape is truly shared.

## Classify The Task

Classify each requested change across these buckets before proposing edits:

- controller-local API
- shared type candidate
- extension protocol impact
- storage impact
- LAN exposure impact

Prefer controller-local scope. Treat `packages/shared` and `packages/extension` as opt-in only when the task clearly requires them.

## Keep The Boundary

- Keep UI assets, static asset hosting, HTTP routes, request parsing, response shaping, and browser-facing view models in `packages/controller`.
- Keep the controller as the source of truth for bookmarks, schedules, controller state, and extension connection state.
- Do not reuse controller-extension WebSocket messages as browser UI HTTP contracts unless the task proves the shape is truly shared across packages.
- Do not move controller decision logic, storage ownership, or schedule ownership into `packages/extension`.
- Escalate to `$shared-contract-change-gate` at `skills/shared-contract-change-gate` before proposing new shared types for UI-facing HTTP responses.

## Check Local-Network Readiness

Treat the deployment target as a trusted local network, not the public internet. Still check:

- bind host behavior and whether `HOST` must change from `127.0.0.1`
- browser-facing URL construction for LAN access
- origin and CORS posture for the planned browser access pattern
- documentation language that keeps the feature framed as local-network-only
- whether a single controller snapshot endpoint would reduce UI chattiness or coupling
- whether manual actions must fan out across multiple connected extensions rather than stopping at the first socket

Do not add public-internet hardening work unless the user explicitly asks.

## Choose The Subagent Flow

- Keep the main thread on repo context, boundary calls, cross-package synthesis, and root-file edits.
- Use `controller-builder` as the default implementation owner.
- Bring in `contracts-guardian` only when a shared contract change is justified.
- Bring in `extension-builder` only when browser-side protocol behavior must change.
- Use `verifier` after implementation, not before.

## Return This Output Contract

Return a concise plan with these headings:

- Task classification
- Ownership and write-scope plan
- Required subagents and order
- Contract impact
- Validation and closure checks
- Blockers and assumptions

## Default Conclusions

- Prefer a controller-local HTTP/API layer over early `packages/shared` growth.
- Prefer controller-local UI view models over raw storage shapes when the browser UI needs aggregation.
- Prefer adding controller endpoints first and only broadening scope after proving the need.
