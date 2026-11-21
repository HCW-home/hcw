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

# Try docker buildx imagetools inspect (human readable text)
inspect_output="$(docker buildx imagetools inspect "$ref" 2>&1)" || true

echo "Raw inspect output:"
echo "$inspect_output"

if [ -n "$inspect_output" ] && echo "$inspect_output" | grep -qi "linux/arm64"; then
  if echo "$inspect_output" | grep -qiE "linux/(amd64|386|arm/v7|arm/v6|riscv64|ppc64le|s390x)"; then
    echo "::error::image contains non-arm64 architectures" >&2
    exit 1
  fi
  echo "verified: linux/arm64"
  exit 0
fi

# Fallback: check raw json if present
raw="$(docker buildx imagetools inspect "$ref" --raw 2>/dev/null)" || true
if [ -n "$raw" ]; then
  parsed_arch="$(printf '%s' "$raw" | python3 -c '
import json, sys
try:
    doc = json.loads(sys.stdin.read())
    archs = []
    if "manifests" in doc:
        for m in doc["manifests"]:
            p = m.get("platform", {})
            if p.get("architecture"): archs.append(p["architecture"])
    elif doc.get("architecture"):
        archs.append(doc["architecture"])
    print(",".join(archs))
except Exception:
    pass
' 2>/dev/null)" || true

  if [ -n "$parsed_arch" ]; then
    echo "Found architectures in raw manifest: $parsed_arch"
    if [ "$parsed_arch" = "arm64" ]; then
      echo "verified: linux/arm64"
      exit 0
    else
      echo "::error::image contains non-arm64 architecture: $parsed_arch" >&2
      exit 1
    fi
  fi
fi

# Fallback: docker manifest inspect
if command -v docker >/dev/null 2>&1; then
  manifest_output="$(docker manifest inspect "$ref" 2>/dev/null)" || true
  if [ -n "$manifest_output" ] && echo "$manifest_output" | grep -qi "arm64"; then
    echo "verified: linux/arm64 via docker manifest"
    exit 0
  fi
fi

echo "::error::could not verify linux/arm64 architecture for ${ref}" >&2
exit 1
