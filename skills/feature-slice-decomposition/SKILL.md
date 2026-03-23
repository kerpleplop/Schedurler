---
name: feature-slice-decomposition
description: Decompose larger Schedurler work into main-thread and subagent slices. Use when a task spans multiple packages, needs several implementation phases, or would benefit from parallel controller, extension, shared, or verification work without overlapping write scopes.
---

# Feature Slice Decomposition

Break larger Schedurler work into clean slices before coding so the main thread and subagents do not collide.

## Read First

- Read `AGENTS.md`.
- Read `.codex/agents/*.toml`.
- Read `docs/codex-workflows.md`.
- Inspect the task-relevant package files before assigning any work.

## Decide Whether To Decompose

Use this skill when any of these are true:

- the task touches more than one package
- the task needs `packages/shared` plus downstream consumers
- the task has distinct analysis, implementation, and verification phases
- the task can safely parallelize controller and extension work after contract stabilization

Keep work local when the task is package-local and the next step is blocked on a single urgent change.

## Slice The Work

Define slices before any implementation:

- main-thread responsibilities
- owned paths for each subagent
- forbidden paths for each subagent
- sequencing dependencies
- handoff format for each subagent

Keep `AGENTS.md`, `README.md`, `.codex/*`, and cross-package synthesis with the main thread unless the user explicitly asks otherwise.

## Use The Default Order

Follow this sequence unless the task gives a strong reason not to:

1. Inspect locally and identify the likely write set.
2. Decide whether `packages/shared` changes are needed.
3. Serialize shared-contract work first when needed.
4. Parallelize `packages/controller` and `packages/extension` only after contracts are stable.
5. Run `verifier` after implementation slices finish.
6. Keep final integration and user-facing synthesis on the main thread.

## Write Better Subagent Briefs

Each subagent brief must state:

- owned files or package scope
- files to avoid editing
- exact task goal
- required return fields
- validation obligations
- reminder that other agents may also be editing the repo and they must not revert unrelated changes

Prefer concise return fields:

- changed files
- contract impact
- validation status
- blockers

## Apply Repo-Specific Defaults

- Default controller-heavy work to `controller-builder`.
- Bring in `contracts-guardian` only for real `packages/shared` questions.
- Bring in `extension-builder` only when browser-side behavior changes.
- Bring in `repo-guardian` only for intentional workflow or root-doc changes.
- Bring in `verifier` after the code slices are done.

## Return This Output Contract

Return a concise plan with these headings:

- Task classification
- Ownership and write-scope plan
- Required subagents and order
- Contract impact
- Validation and closure checks
- Blockers and assumptions

## Avoid These Failure Modes

- Do not assign overlapping write ownership.
- Do not parallelize work that depends on an unresolved shared-contract decision.
- Do not delegate main-thread synthesis, conflict resolution, or root-file ownership away.
- Do not let verification happen before the relevant implementation slice exists.
