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
- When boundary or intent comments exist at architectural seams, read them before changing the behavior they describe and update them in the same change if the behavior or rationale moves.

## Naming And Scope
- Keep the product name `Schedurler` everywhere.
- Keep the app general-purpose. Do not hardcode any specific website, media workflow, or branded use case.
- New protocols, constants, and shared validation rules should be added to `packages/shared` first, then consumed by other packages.

## Codex Subagent Workflow
- The main thread is responsible for reading the relevant repo context first, choosing the smallest useful set of subagents, and keeping the task aligned with this file.
- The main thread owns final synthesis, conflict resolution, cross-package integration, and the final user-facing summary. Do not delegate those responsibilities away.
- `packages/controller` and `packages/extension` are usually safe for parallel package-local work when the shared contracts are already stable and the write sets are disjoint.
- `packages/shared` is a high-coordination zone. Edit it in a serialized way unless the main thread has a very specific reason not to.
- Root coordination files are also high-coordination zones: `AGENTS.md`, `README.md`, and `.codex/*` should generally be edited in a serialized, main-thread-led flow.
- Shared contracts remain canonical in `packages/shared`. Do not duplicate protocol shapes, validation rules, or naming conventions inside the controller or extension.
- The controller remains the source of truth. Do not move bookmark, schedule, or controller-state ownership into the extension.
- The extension must stay thin and browser-specific. Do not duplicate controller decision logic, storage logic, or schedule ownership inside it.
- Prefer package-local changes. If a task can be completed inside one package without broadening a shared contract, keep it there.
- If `packages/shared` changes, the controller and extension must both be revalidated before the task is considered complete.
- Subagents should return concise summaries to the main thread: changed files, contract impact, validation status, and blockers. Do not dump noisy raw logs unless the main thread explicitly asks for them.
- For likely future controller web UI work, keep the controller as the main implementation surface, involve `packages/shared` only for real shared-contract changes, and involve the extension only if browser-side protocol behavior must change.

## Repo-Local Skills
- Repo-local skills live under `skills/`. Treat them as task playbooks layered on top of this file and `.codex/agents/*.toml`.
- This section is the canonical source of truth for which repo-local skills exist and why they are used.
- `skills/controller-web-ui-slice`: use for controller-hosted browser UI, static asset serving, UI-facing controller APIs, and trusted local-network browser access work. This improves AI-driven coding by keeping web UI work controller-first, surfacing LAN bind and exposure checks early, and preventing accidental reuse of extension protocol shapes or premature `packages/shared` growth.
- `skills/feature-slice-decomposition`: use before multi-package or multi-agent implementation to assign ownership, sequencing, and return contracts. This improves subagent-driven coding by creating non-overlapping write scopes, making serialization versus parallelism explicit, and standardizing what each subagent must return to the main thread.
- `skills/shared-contract-change-gate`: use before editing `packages/shared` or proposing shared types for browser UI work. This improves boundary-sensitive coding by forcing shared-contract justification up front, blocking controller-local or UI-only shapes from leaking into `packages/shared`, and making downstream controller and extension revalidation explicit.
- Keep `AGENTS.md` as the architecture and boundary source of truth even when a repo-local skill is active.
