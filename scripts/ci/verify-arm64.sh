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

# Try docker buildx imagetools inspect first.
# If --raw is empty or unparseable, fall back to standard inspect without --raw.
raw=""
if raw="$(docker buildx imagetools inspect "$ref" --raw 2>/dev/null)" && [ -n "$raw" ]; then
  printf '%s' "$raw" | python3 - <<'PY'
import json
import sys

raw_input = sys.stdin.read().strip()
if not raw_input:
    sys.exit("::error::manifest payload is empty")

try:
    doc = json.loads(raw_input)
except Exception as e:
    sys.exit(f"::error::failed to parse manifest JSON: {e}\nRaw output was:\n{raw_input}")

platforms = []
if "manifests" in doc:  # multi-platform index
    for entry in doc["manifests"]:
        platform = entry.get("platform") or {}
        if platform.get("os") and platform.get("architecture"):
            platforms.append((platform["os"], platform["architecture"]))
elif doc.get("architecture"):
    platforms.append((doc.get("os", "linux"), doc["architecture"]))

if platforms:
    print("platforms: " + ", ".join(f"{os}/{arch}" for os, arch in platforms))
    unsupported = sorted({f"{os}/{arch}" for os, arch in platforms if os != "linux" or arch != "arm64"})
    if unsupported:
        sys.exit(f"::error::image is not linux/arm64 only: {', '.join(unsupported)}")
    print("verified: linux/arm64")
    sys.exit(0)
sys.exit(1)
PY
  exit 0
fi

# Fallback: parse formatted text output from `docker buildx imagetools inspect "$ref"`
echo "Falling back to human-readable inspection output..."
inspect_output="$(docker buildx imagetools inspect "$ref" 2>&1)" || {
  echo "::error::could not inspect ${ref}: ${inspect_output}" >&2
  exit 1
}

echo "$inspect_output"

if echo "$inspect_output" | grep -qi "linux/arm64"; then
  if echo "$inspect_output" | grep -qiE "linux/(amd64|386|arm/v7|arm/v6|riscv64|ppc64le|s390x)"; then
    echo "::error::image contains non-arm64 architectures" >&2
    exit 1
  fi
  echo "verified: linux/arm64"
  exit 0
fi

# Fallback 2: docker manifest inspect
if command -v docker >/dev/null 2>&1; then
  echo "Trying docker manifest inspect..."
  if manifest_output="$(docker manifest inspect "$ref" 2>/dev/null)"; then
    if echo "$manifest_output" | grep -qi "arm64"; then
      echo "verified: linux/arm64"
      exit 0
    fi
  fi
fi

echo "::error::could not verify linux/arm64 architecture for ${ref}" >&2
exit 1
