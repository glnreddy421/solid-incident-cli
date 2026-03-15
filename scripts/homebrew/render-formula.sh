#!/usr/bin/env bash
set -euo pipefail

# Usage:
# VERSION=0.2.0 \
# DARWIN_ARM64_SHA256=... \
# DARWIN_X64_SHA256=... \
# LINUX_ARM64_SHA256=... \
# LINUX_X64_SHA256=... \
# ./scripts/homebrew/render-formula.sh

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
FORMULA_PATH="$ROOT_DIR/brew/Formula/solidx.rb"

require_env() {
  local key="$1"
  if [[ -z "${!key:-}" ]]; then
    echo "Missing required env var: $key" >&2
    exit 1
  fi
}

require_env VERSION
require_env DARWIN_ARM64_SHA256
require_env DARWIN_X64_SHA256
require_env LINUX_ARM64_SHA256
require_env LINUX_X64_SHA256

if [[ ! -f "$FORMULA_PATH" ]]; then
  echo "Formula file not found: $FORMULA_PATH" >&2
  exit 1
fi

tmp="$(mktemp)"
cp "$FORMULA_PATH" "$tmp"

sed -E \
  -e "s/version \"[0-9]+\.[0-9]+\.[0-9]+\"/version \"$VERSION\"/" \
  -e "s/REPLACE_DARWIN_ARM64_SHA256/$DARWIN_ARM64_SHA256/" \
  -e "s/REPLACE_DARWIN_X64_SHA256/$DARWIN_X64_SHA256/" \
  -e "s/REPLACE_LINUX_ARM64_SHA256/$LINUX_ARM64_SHA256/" \
  -e "s/REPLACE_LINUX_X64_SHA256/$LINUX_X64_SHA256/" \
  "$tmp" > "$FORMULA_PATH"

rm -f "$tmp"
echo "Updated formula at $FORMULA_PATH for v$VERSION"

