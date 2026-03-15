# SOLID CLI/TUI-First Architecture

## Revised Product Architecture

SOLID is now a CLI-first product with an optional TUI investigation mode:

- Local engine parses and analyzes logs from files/stdin/pipes/streams.
- Backend AI receives only structured incident schema (never raw logs).
- CLI and TUI share contracts, engine, storage, and backend API client.
- TUI is a visualization/investigation layer, not infrastructure control.
- Non-interactive environments default to non-TUI outputs.

## Package/Folder Structure

```text
src/
  index.ts
  cli/
    commands.ts
    input.ts
    mode.ts
  contracts/
    index.ts
    model.ts
    errors.ts
    session.ts
  engine/
    analysisEngine.ts
  api/
    backendClient.ts
  storage/
    sessionStore.ts
    configStore.ts
  output/
    renderers.ts
  tui/
    keymap.ts
    renderer.ts
```

This structure mirrors a monorepo package intent:
- `apps/cli` -> `src/cli`
- `packages/contracts` -> `src/contracts`
- `packages/engine` -> `src/engine`
- `packages/api-client` -> `src/api`
- `packages/storage` -> `src/storage`
- `packages/output` -> `src/output`
- `packages/tui` -> `src/tui`

## Mode Detection Rules

Priority order:

1. explicit output mode flags (`--json`, `--text`, `--md`, `--html`, `--report`)
2. explicit non-TUI override (`--no-tui`)
3. terminal capability auto-detection:
   - interactive TTY => TUI
   - non-interactive/CI => text

Invalid combinations are rejected, e.g. `--json --md`.

## TUI Fallback Behavior

If TUI initialization fails in interactive mode, SOLID:

1. prints a clear warning
2. falls back to plain text output
3. exits safely without crash

## MVP TUI Panels

- Summary
- Timeline
- Flow
- Raw Events
- AI Analysis
- Reports
- Raw Schema

