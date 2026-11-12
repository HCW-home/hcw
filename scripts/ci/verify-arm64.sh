#!/usr/bin/env bash
#
# Fails unless every platform in an image reference is linux/arm64.
# Used after pushing a release image and before any rollback, so an AMD64-only
# image can never reach the Oracle ARM64 server.

set -euo pipefail

ref="${1:-}"
if [ -z "$ref" ]; then
  echo "usage: $0 <image-reference>" >&2
  exit 2
fi

echo "Inspecting ${ref}"
if ! raw="$(docker buildx imagetools inspect "$ref" --raw)"; then
  echo "::error::could not read the manifest of ${ref}" >&2
  exit 1
fi

printf '%s' "$raw" | python3 - <<'PY'
import json
import sys

doc = json.load(sys.stdin)
platforms = []

if "manifests" in doc:  # multi-platform index
    for entry in doc["manifests"]:
        platform = entry.get("platform") or {}
        if platform.get("os") and platform.get("architecture"):
            platforms.append((platform["os"], platform["architecture"]))
elif doc.get("architecture"):
    platforms.append((doc.get("os", "linux"), doc["architecture"]))

if not platforms:
    sys.exit(f"::error::could not determine any platform for {doc.get('mediaType')}")

print("platforms: " + ", ".join(f"{os}/{arch}" for os, arch in platforms))

unsupported = sorted({f"{os}/{arch}" for os, arch in platforms if os != "linux" or arch != "arm64"})
if unsupported:
    sys.exit(f"::error::image is not linux/arm64 only: {', '.join(unsupported)}")

print("verified: linux/arm64")
PY
