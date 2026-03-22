# Codex Workflows

Use this with `AGENTS.md`, not instead of it.

## Analysis-First
- Main thread reads `AGENTS.md` and the relevant package files first.
- Spawn `contracts-guardian` to inspect shared-contract impact only when a task may cross package boundaries.
- Spawn `controller-builder` and `extension-builder` for package-local inspection when both sides might be affected.
- Have subagents return concise impact summaries before the main thread decides where edits belong.

## Package-Parallel Implementation
- Use `controller-builder` and `extension-builder` in parallel only when the task is package-local and shared contracts are already stable.
- Keep the main thread on integration, root-file edits, and conflict resolution.
- Bring in `repo-guardian` only when the task actually changes repo guidance or Codex workflow files.

## Shared-Contract Change Flow
- Treat `packages/shared` as serialized work.
- Update shared contracts first through the main thread or `contracts-guardian`.
- After shared changes land, revalidate controller and extension behavior against the new contracts before closing the task.
- Use `verifier` after downstream package updates, not before.

## Review Flow
- Implement with package-local agents first.
- Run `verifier` after the implementation phase.
- Have the main thread resolve findings, integrate cross-package fixes, and write the final synthesis.

## Likely Next Step
- For controller web server and local-network browser UI work, expect `controller-builder` to own most implementation.
- Use `contracts-guardian` only if shared API or shared data shapes truly need to change.
- Use `extension-builder` only if browser-side protocol behavior changes.
- Use `repo-guardian` only for targeted doc updates once the implementation path is settled.
