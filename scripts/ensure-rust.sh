#!/usr/bin/env bash
set -euo pipefail

echo "[setup:rust] Checking Rust/Cargo..."
if command -v cargo >/dev/null 2>&1; then
  echo "[setup:rust] Cargo already installed: $(cargo --version)"
  exit 0
fi

OS="$(uname -s || true)"
if [[ "${OS}" == "Darwin" ]]; then
  if ! xcode-select -p >/dev/null 2>&1; then
    echo "[setup:rust] Xcode Command Line Tools not found. Triggering installer..."
    xcode-select --install || true
    echo "[setup:rust] Complete the Xcode tools install dialog, then rerun: npm run personal:dev"
    exit 1
  fi
fi

echo "[setup:rust] Installing Rust toolchain via rustup..."
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y

if [[ -f "${HOME}/.cargo/env" ]]; then
  # shellcheck disable=SC1090
  source "${HOME}/.cargo/env"
fi

if ! command -v cargo >/dev/null 2>&1; then
  echo "[setup:rust] Rust installed but cargo is not on PATH for this shell."
  echo "[setup:rust] Run: source \"\$HOME/.cargo/env\""
  exit 1
fi

echo "[setup:rust] Rust ready: $(cargo --version)"
