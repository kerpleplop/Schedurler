---
name: shared-contract-change-gate
description: Gate edits to Schedurler shared contracts and prevent controller-local or UI-only shapes from leaking into packages/shared. Use when a task proposes changing packages/shared, shared types, shared validation helpers, shared constants, controller-extension protocol shapes, or new browser UI data that might be pushed into shared.
---

# Shared Contract Change Gate

Decide whether a proposed change truly belongs in `packages/shared` before any shared edit lands.

## Read First

- Read `AGENTS.md`.
- Inspect `packages/shared/src/types.ts`, `packages/shared/src/protocol.ts`, `packages/shared/src/validation.ts`, and `packages/shared/src/constraints.ts`.
- Inspect the concrete controller and extension call sites that would consume the proposed shared change.

## Ask The Gate Questions

Answer these questions in order:

1. Can this shape stay controller-local or extension-local?
2. Is this shape domain-shared or protocol-shared rather than UI-shaped?
3. Will at least two packages consume it directly?
4. Does the change belong to shared types, shared validation, shared constants, or controller-extension protocol definitions?

Keep the change out of `packages/shared` unless the answers clearly justify it.

## Reject These By Default

Reject these additions to `packages/shared` unless the task proves otherwise:

- controller-only HTTP response envelopes
- controller snapshot DTOs built only for the browser UI
- UI-only filters, sorting state, or view models
- storage implementation details
- browser APIs or extension runtime logic
- server implementation details
- speculative abstractions with only one current consumer

Prefer controller-local types for browser UI HTTP shapes unless multiple packages genuinely need the same contract.

## Approve Shared Changes Carefully

If the change does belong in `packages/shared`, require a concise impact note that covers:

- the exact shared files that need edits
- controller touch points
- extension touch points
- validation helper changes
- downstream revalidation requirements

Keep shared code runtime-agnostic. Do not add filesystem logic, browser APIs, or controller/server implementation details.

## Use The Repo Workflow

- Keep shared-contract edits serialized.
- Let the main thread or `contracts-guardian` own the shared change.
- Revalidate controller and extension behavior after any shared edit.
- Use `verifier` after downstream packages are aligned.

## Return This Output Contract

Return a concise plan with these headings:

- Task classification
- Ownership and write-scope plan
- Required subagents and order
- Contract impact
- Validation and closure checks
- Blockers and assumptions

## Default Conclusions

- Prefer no shared change unless the task clearly requires one.
- Prefer controller-local browser UI contracts over promoting UI shapes into shared.
- Prefer describing downstream impact explicitly before editing `packages/shared`.
