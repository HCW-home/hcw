#!/bin/bash

set -e

echo "=== whisper-live installer ==="
echo ""

# Check Python
if ! command -v python3 &>/dev/null; then
  echo "ERROR: python3 is not installed. Install it with: brew install python"
  exit 1
fi

PYTHON_VERSION=$(python3 -c "import sys; print(f'{sys.version_info.major}.{sys.version_info.minor}')")
echo "Python version: $PYTHON_VERSION"

# Check PortAudio (required by PyAudio, a whisper-live dependency)
if command -v brew &>/dev/null; then
  if ! brew list portaudio &>/dev/null 2>&1; then
    echo ""
    echo "Installing PortAudio (required for PyAudio)..."
    brew install portaudio
  else
    echo "PortAudio: already installed"
  fi
else
  echo "WARNING: Homebrew not found. If PyAudio fails to build, install PortAudio manually."
fi

# Create virtual environment if it doesn't exist
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
VENV_DIR="$SCRIPT_DIR/venv"

if [ ! -d "$VENV_DIR" ]; then
  echo ""
  echo "Creating virtual environment at $VENV_DIR ..."
  python3 -m venv "$VENV_DIR"
else
  echo "Virtual environment already exists at $VENV_DIR"
fi

# Activate venv
source "$VENV_DIR/bin/activate"

echo ""
echo "Installing dependencies..."
pip install --upgrade pip --quiet

# setuptools >= 70 removed pkg_resources which openai-whisper's setup.py requires.
# 'wheel' provides the bdist_wheel command also needed for the build.
# Pin both, then install openai-whisper without build isolation so it uses our
# venv's setuptools rather than pip's fresh isolated env (which gets latest setuptools).
pip install "setuptools==69.5.1" wheel --quiet
pip install --no-build-isolation "openai-whisper==20240930" --quiet

# Install whisper-live; pip will see openai-whisper is already satisfied and skip it.
pip install -r "$SCRIPT_DIR/requirements.txt"

echo ""
echo "=== Installation complete ==="
echo ""
echo "To start the server, run:"
echo "  cd $SCRIPT_DIR && ./run.sh"