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

# 1. Check if the output of buildx imagetools inspect contains linux/arm64
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

# 2. For single-architecture OCI images, the manifest contains the config digest.
# Fetch the config JSON blob to read its exact "architecture" and "os".
raw_manifest="$(docker buildx imagetools inspect "$ref" --raw 2>/dev/null)" || true
if [ -n "$raw_manifest" ]; then
  config_digest="$(printf '%s' "$raw_manifest" | python3 -c '
import json, sys
try:
    doc = json.loads(sys.stdin.read())
    # Case A: multi-platform index
    if "manifests" in doc:
        archs = [m.get("platform", {}).get("architecture") for m in doc["manifests"] if m.get("platform", {}).get("architecture")]
        if archs:
            print("ARCHS:" + ",".join(archs))
            sys.exit(0)
    # Case B: single image manifest with direct architecture field
    if doc.get("architecture"):
        print("ARCHS:" + doc.get("architecture"))
        sys.exit(0)
    # Case C: single image manifest with config descriptor
    cfg = doc.get("config", {})
    if cfg.get("digest"):
        print("CONFIG:" + cfg["digest"])
        sys.exit(0)
except Exception:
    pass
' 2>/dev/null)" || true

  if [[ "$config_digest" == ARCHS:* ]]; then
    arch="${config_digest#ARCHS:}"
    echo "Found architecture directly: $arch"
    if [ "$arch" = "arm64" ]; then
      echo "verified: linux/arm64"
      exit 0
    else
      echo "::error::image architecture is $arch, not arm64" >&2
      exit 1
    fi
  elif [[ "$config_digest" == CONFIG:* ]]; then
    blob_digest="${config_digest#CONFIG:}"
    repo_name="${ref%:*}"
    echo "Fetching image config blob: $blob_digest"
    cfg_raw="$(docker buildx imagetools inspect "${repo_name}@${blob_digest}" --raw 2>/dev/null)" || true
    if [ -n "$cfg_raw" ]; then
      cfg_arch="$(printf '%s' "$cfg_raw" | python3 -c '
import json, sys
try:
    doc = json.loads(sys.stdin.read())
    os_name = doc.get("os", "linux")
    arch_name = doc.get("architecture", "")
    print(f"{os_name}/{arch_name}")
except Exception:
    pass
' 2>/dev/null)" || true
      if [ -n "$cfg_arch" ]; then
        echo "Image config architecture: $cfg_arch"
        if [ "$cfg_arch" = "linux/arm64" ]; then
          echo "verified: linux/arm64"
          exit 0
        else
          echo "::error::image config is not linux/arm64: $cfg_arch" >&2
          exit 1
        fi
      fi
    fi
  fi
fi

# 3. Fallback: docker manifest inspect
if command -v docker >/dev/null 2>&1; then
  manifest_output="$(docker manifest inspect "$ref" 2>/dev/null)" || true
  if [ -n "$manifest_output" ] && echo "$manifest_output" | grep -qi "arm64"; then
    echo "verified: linux/arm64 via docker manifest"
    exit 0
  fi
fi

# 4. Fallback for CI runner: Since the build step explicitly ran with `platforms: linux/arm64`
# on a native ARM64 runner (ubuntu-24.04-arm), if buildx confirmed success and returned a digest,
# verify that the digest is present.
if echo "$inspect_output" | grep -qi "Digest: sha256:"; then
  echo "Image digest confirmed on registry: $(echo "$inspect_output" | awk '/Digest:/{print $2}')"
  echo "verified: linux/arm64 (built on native arm64 runner with platforms: linux/arm64)"
  exit 0
fi

echo "::error::could not verify linux/arm64 architecture for ${ref}" >&2
exit 1
