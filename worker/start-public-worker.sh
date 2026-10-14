#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"
if [ ! -x .venv/bin/python ]; then
  echo 'Copy these files into your existing Bndrm folder, alongside .venv.'
  exit 1
fi
echo 'Connecting your Mac to standalone Bndrm. Ctrl+C stops processing.'
if command -v caffeinate >/dev/null 2>&1; then
  exec caffeinate -i .venv/bin/python start_public_worker.py
fi
exec .venv/bin/python start_public_worker.py
