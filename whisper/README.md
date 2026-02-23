# whisper-live server

Real-time speech transcription server used by the HCW live captions feature.
The Django backend connects to this server and proxies audio from the browser; the browser never talks to whisper-live directly.

---

## How it fits in

```
Browser mic → Django backend → whisper-live (this folder) → transcript text → all participants
```

---

## Requirements

| Requirement | Notes |
|-------------|-------|
| Python 3.8 – 3.11 | 3.12+ not yet supported by openai-whisper |
| ~2 GB free RAM | `small` model (default); see model guide below |
| macOS | `install.sh` auto-installs PortAudio via Homebrew |
| Linux | Install PortAudio manually: `sudo apt install portaudio19-dev` |

---

## First-time setup

Run once after cloning:

```bash
cd whisper
./install.sh
```

This will:
1. Check that Python 3 is available
2. Install PortAudio via Homebrew (macOS only)
3. Create a `venv/` virtual environment
4. Pin `setuptools` to a compatible version (required by `openai-whisper`)
5. Install `openai-whisper` and `whisper-live==0.7.1`

> **Linux**: install PortAudio before running `install.sh`:
> ```bash
> sudo apt install portaudio19-dev   # Debian/Ubuntu
> sudo dnf install portaudio-devel   # Fedora/RHEL
> ```

---

## Starting the server

```bash
cd whisper
./run.sh
```

The server starts on **port 9090** by default and prints:

```
Starting whisper-live server on 0.0.0.0:9090
Model: determined per-client connection (default: small)
```

The Whisper model is downloaded automatically from HuggingFace on the **first run** (`~/.cache/huggingface/`). This takes a few minutes depending on your connection.

---

## Configuration

### Custom port

```bash
WHISPER_PORT=9091 ./run.sh
```

### Telling Django where to find the server

Set `WHISPER_LIVE_URL` in the Django environment (default is already `ws://localhost:9090`):

```bash
# backend/.env  or  shell export
WHISPER_LIVE_URL=ws://localhost:9090
```

If you changed the port or are running whisper-live on another machine:

```bash
WHISPER_LIVE_URL=ws://192.168.1.50:9091
```

---

## Model sizes

The model is requested per-client when a transcription session starts (configured in the backend). Reference:

| Model | RAM needed | Speed (CPU) | Quality |
|-------|-----------|-------------|---------|
| `tiny` | ~1 GB | Very fast | Low — testing only |
| `base` | ~1 GB | Fast | Acceptable |
| `small` | ~2 GB | Good | Good — recommended for development |
| `medium` | ~5 GB | Slower | Great |
| `large-v3` | ~10 GB | Slow on CPU | Best — production with GPU |

To change the default model used by the backend, edit `backend/consultations/consumers.py`:

```python
config = {
    ...
    "model": "base",   # change to tiny / small / medium / large-v3
    ...
}
```

---

## Scripts reference

| Script | Purpose |
|--------|---------|
| `install.sh` | One-time setup: creates `venv/`, installs all dependencies |
| `run.sh` | Activates `venv/` and starts the server (use this day-to-day) |
| `start.sh` | Called by `run.sh`; respects `WHISPER_PORT` env var |
| `server.py` | Python entry point — launches `TranscriptionServer` with `faster_whisper` backend |
| `requirements.txt` | Pins `whisper-live==0.7.1` |

---

## Troubleshooting

**`venv not found` error when running `run.sh`**
You haven't run the installer yet:
```bash
./install.sh
```

**`portaudio` / `PyAudio` build failure on Linux**
Install the system library first:
```bash
sudo apt install portaudio19-dev python3-dev
```
Then re-run `./install.sh`.

**Model download is slow / fails**
Models are fetched from HuggingFace. If you're on a restricted network, download them manually:
```bash
source venv/bin/activate
python -c "from faster_whisper import WhisperModel; WhisperModel('small')"
```

**Django logs show `Failed to connect to whisper-live`**
- Make sure `./run.sh` is running and shows no errors
- Confirm the port matches `WHISPER_LIVE_URL` in the backend
- Test connectivity: `curl http://localhost:9090` (expects a connection refused or upgrade response, not a timeout)

**Captions have high latency**
Switch to a smaller model (`tiny` or `base`) in the backend consumer config.

---

