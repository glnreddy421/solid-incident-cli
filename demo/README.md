# SOLID Demo: 4 Microservices + Failure Cascade

A sample Docker setup with 4 microservices that replicates a failure scenario. Logs are piped into **solidx** for live analysis—the intelligent engine pins the root cause (auth-service crash → connection refused cascade).

## Architecture

```
api-gateway (3000)
    ├── auth-service (3001)   ← crashes after ~3s
    ├── order-service (3002)
    └── payment-service (3003)
```

- **auth-service**: Intentionally crashes after 3 seconds to simulate CrashLoopBackOff
- **api-gateway**, **order-service**, **payment-service**: Depend on auth; log `connection refused`, `timeout`, `deadline exceeded` when auth is down

All services emit JSON logs with `timestamp`, `service`, `msg`, `level`—compatible with solidx's parser.

## Prerequisites

- Docker & Docker Compose
- [solidx](https://github.com/glnreddy421/solid-incident-cli) installed (`npm install -g solidx`)

## Quick Start

```bash
cd demo
./run-demo.sh
```

This will:
1. Start the 4 services
2. Wait for the failure cascade (auth crashes, others log connection refused)
3. Collect logs and launch solidx
4. Open the TUI with incident timeline, trace graph, and root-cause analysis

## Live Mode (TUI updates as logs stream)

```bash
./run-demo.sh --live
```

Tails logs in real time and **updates the TUI every 2 seconds** as new logs arrive. The analysis (signals, root cause, timeline) refreshes dynamically.

## Options

```bash
# Build images first (e.g. after editing services)
./run-demo.sh --build

# Live tail – TUI keeps updating as new logs arrive
./run-demo.sh --live

# Output modes (batch, no live updates)
./run-demo.sh --tui    # Interactive TUI (default)
./run-demo.sh --json   # Machine-readable JSON
./run-demo.sh --text   # Plain text report
./run-demo.sh --web    # Web UI in browser
```

## Live Log Piping (Manual)

For file-based live tail with your own log source:

**Terminal 1** – stream logs to a file:
```bash
docker compose logs -f 2>&1 | sed 's/^[^|]*|[[:space:]]*//' | grep -v '^$' | tee /tmp/demo.log
```

**Terminal 2** – run solidx in live mode (TUI updates every 2s):
```bash
solidx analyze --live /tmp/demo.log
```

## What solidx Detects

The intelligent engine (mock analysis + trace graph) will typically identify:

- **Repeated dependency failure** – connection refused pattern
- **CrashLoop pattern** – auth-service back-off
- **Root cause** – "A required dependency (e.g. Redis, DB, or another service) was unreachable"
- **Suggested steps** – verify dependency availability, check deployment events

## Files

```
demo/
├── docker-compose.yml
├── run-demo.sh
├── README.md
└── services/
    ├── api-gateway/
    ├── auth-service/
    ├── order-service/
    └── payment-service/
```
