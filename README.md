# SOLID (CLI: `solidx`)

Terminal-first incident investigation for logs.

## Install

```bash
npm install -g solidx
```

Homebrew (after tap/release setup):

```bash
brew install solidx
```

Command:

```bash
solidx
```

## Quick start

```bash
# Analyze one or more log files
solidx analyze logs.txt
solidx analyze api.log worker.log db.log

# Analyze piped input
cat incident.log | solidx analyze
kubectl logs pod | solidx analyze

# Auto-detected TUI (interactive terminal)
solidx analyze logs.txt

# k9s-like runtime options
solidx analyze logs.txt --inspect --interval 2 --skip-splash --log-level info

# Non-TUI output modes
solidx analyze logs.txt --json
solidx analyze logs.txt --md
solidx analyze logs.txt --text
```

## Commands

- `solidx analyze [files...]`
- `solidx session list`
- `solidx session show <id>`
- `solidx session delete <id>`
- `solidx export <id> --json|--text|--md|--html`
- `solidx config show`
- `solidx config set <key> <value>`

## Analyze options

- `--no-tui`
- `--inspect`
- `--interval <seconds>`
- `--hide-header`
- `--skip-splash`
- `--log-level <error|warn|info|debug>`
- `--json` / `--text` / `--md` / `--html`
- `--save`
- `--session-name <name>`
- `--no-ai`
- `--report` / `--rca` / `--interview-story`

## Development

```bash
npm install
npm run typecheck
npm run build
npm test
```

## Homebrew packaging

See `docs/homebrew.md` for formula and release workflow.
