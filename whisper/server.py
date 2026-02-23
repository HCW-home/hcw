#!/usr/bin/env python3
"""
Launcher for the whisper-live WebSocket server.
The model size is specified per-client in the connection options,
so no model path is needed here.
"""

import argparse
import logging
from whisper_live.server import TranscriptionServer

logging.basicConfig(level=logging.INFO)

def main():
    parser = argparse.ArgumentParser(description="whisper-live server")
    parser.add_argument("--host", default="0.0.0.0", help="Bind host (default: 0.0.0.0)")
    parser.add_argument("--port", type=int, default=9090, help="Bind port (default: 9090)")
    args = parser.parse_args()

    print(f"Starting whisper-live server on {args.host}:{args.port}")
    print("Model: determined per-client connection (default: small)")
    print("")

    server = TranscriptionServer()
    server.run(
        host=args.host,
        port=args.port,
        backend="faster_whisper",
    )

if __name__ == "__main__":
    main()