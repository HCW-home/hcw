#!/bin/bash

# Activate the virtual environment and start whisper-live
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
VENV_DIR="$SCRIPT_DIR/venv"

if [ ! -d "$VENV_DIR" ]; then
  echo "Virtual environment not found. Run install.sh first:"
  echo "  cd $SCRIPT_DIR && ./install.sh"
  exit 1
fi

source "$VENV_DIR/bin/activate"
exec "$SCRIPT_DIR/start.sh"