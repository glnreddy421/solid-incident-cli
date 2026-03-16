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

# Live tail – TUI updates as new logs arrive
solidx analyze --live app.log

# k9s-like runtime options
solidx analyze logs.txt --inspect --interval 2 --skip-splash --log-level info

# Web UI mode (hand off to browser)
solidx analyze logs.txt --web
solidx analyze logs.txt --web --port 4000 --no-open

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

- `--web` — Hand off analysis to web UI on local port (default: 3456)
- `--port <number>` — Port for web UI
- `--no-open` — Do not open browser when starting web UI
- `--no-tui`
- `--inspect`
- `--interval <seconds>`
- `--hide-header`
- `--skip-splash`
- `--log-level <error|warn|info|debug>`
- `--json` / `--text` / `--md` / `--html`
- `--save`
- `--session-name <name>`
- `--no-ai` — Skip AI analysis (use local analysis only)
- `--report` / `--rca` / `--interview-story` — Generate reports on demand (requires backend)

## AI analysis and reports

When `SOLID_API_URL` is set, the CLI sends a compact schema (events, signals, graph) to the backend. The AI returns a brief analysis (summary, root-cause candidates, follow-up questions). Reports are generated on demand when you pass `--report`, `--rca`, or `--interview-story`.

```bash
# Start backend locally (Docker)
cd backend-api   # in solid repo
docker compose up

# Analyze with AI
SOLID_API_URL=http://localhost:9090 solidx analyze logs.txt

# Generate reports on demand
SOLID_API_URL=http://localhost:9090 solidx analyze logs.txt --report --rca
```

## Development

```bash
npm install
npm run typecheck
npm run build
npm test
```

## Homebrew packaging

See `docs/homebrew.md` for formula and release workflow.
