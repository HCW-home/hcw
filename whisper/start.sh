#!/bin/bash

# whisper-live startup script

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PORT=${WHISPER_PORT:-9090}

echo "Starting whisper-live server..."
echo "  Port: $PORT"
echo ""

python "$SCRIPT_DIR/server.py" --port "$PORT"