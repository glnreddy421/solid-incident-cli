#!/usr/bin/env bash
# Run 4-microservice failure demo and pipe logs to solidx for live analysis.
# Usage: ./run-demo.sh [--build] [--live|--tui|--json|--text|--web]
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

BUILD=false
MODE=""
LIVE=false
for arg in "$@"; do
  case "$arg" in
    --build) BUILD=true ;;
    --live)  LIVE=true ;;
    --tui)   MODE="--inspect --interval 2 --skip-splash" ;;
    --json)  MODE="--json --no-tui" ;;
    --text)  MODE="--text --no-tui" ;;
    --web)   MODE="--web --no-open" ;;
    *) ;;
  esac
done

# Default: TUI inspect mode
if [[ -z "$MODE" ]]; then
  MODE="--inspect --interval 2 --skip-splash"
fi

echo "=== SOLID Demo: 4 microservices + failure cascade ==="
echo "auth-service will crash after ~3s -> connection refused cascade"
echo ""

if [[ "$BUILD" == "true" ]]; then
  echo "[1/5] Building images..."
  docker compose build
fi

echo "[2/5] Starting stack..."
docker compose up -d

if [[ "$LIVE" == "true" ]]; then
  DEMO_LOG=$(mktemp)
  trap "rm -f $DEMO_LOG; docker compose down 2>/dev/null; exit" EXIT INT TERM
  echo "[3/5] Tailing logs to $DEMO_LOG (Ctrl+C to stop)..."
  docker compose logs -f 2>&1 | sed 's/^[^|]*|[[:space:]]*//' | grep -v '^$' >> "$DEMO_LOG" &
  TAIL_PID=$!
  sleep 6
  echo "[4/5] Launching solidx --live (TUI updates every 2s as new logs arrive)..."
  solidx analyze --live "$DEMO_LOG" --inspect --interval 2 --skip-splash
  kill $TAIL_PID 2>/dev/null || true
  docker compose down 2>/dev/null || true
  exit 0
fi

echo "[3/5] Waiting for failure cascade (auth crashes, others log connection refused)..."
sleep 8

echo "[4/5] Collecting logs and launching solidx..."
DEMO_LOG=$(mktemp)
docker compose logs 2>&1 | sed 's/^[^|]*|[[:space:]]*//' | grep -v '^$' | head -200 > "$DEMO_LOG"
solidx analyze "$DEMO_LOG" $MODE
rm -f "$DEMO_LOG"

echo ""
echo "[5/5] Stopping stack..."
docker compose down
