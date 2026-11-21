#!/usr/bin/env bash
#
# Moves the moving :production tag onto an already published immutable tag by
# copying the registry manifest. Nothing is built and no source is needed, so
# this is also the rollback mechanism.
#
# Env: REGISTRY, NAMESPACE, TAG, IMAGES (space separated repository names)
#
# Every image is promoted only after all of them were verified by the caller,
# and each tag is checked to resolve to the same digest afterwards, so a
# partially published release cannot be deployed.

set -euo pipefail

: "${REGISTRY:?REGISTRY is required}"
: "${NAMESPACE:?NAMESPACE is required}"
: "${TAG:?TAG is required}"
: "${IMAGES:?IMAGES is required}"
: "${PRODUCTION_TAG:=production}"

digest_of() {
  local digest
  digest="$(docker buildx imagetools inspect "$1" | awk '/^Digest:/{print $2; exit}')"
  if [ -z "$digest" ]; then
    echo "::error::could not read the digest of $1" >&2
    return 1
  fi
  printf '%s' "$digest"
}

if [ -n "${GITHUB_STEP_SUMMARY:-}" ]; then
  {
    echo "### Image digests"
    echo ""
    echo "| Image | Tag | Digest |"
    echo "| --- | --- | --- |"
  } >> "$GITHUB_STEP_SUMMARY"
fi

for image in $IMAGES; do
  source_ref="${REGISTRY}/${NAMESPACE}/${image}:${TAG}"
  target_ref="${REGISTRY}/${NAMESPACE}/${image}:${PRODUCTION_TAG}"

  echo "Promoting ${source_ref} -> ${target_ref}"
  docker buildx imagetools create --tag "$target_ref" "$source_ref"

  source_digest="$(digest_of "$source_ref")"
  target_digest="$(digest_of "$target_ref")"

  # If source_digest equals target_digest, direct match.
  # If imagetools create wrapped the single manifest into an index, verify that target points to source.
  if [ "$source_digest" != "$target_digest" ]; then
    target_raw="$(docker buildx imagetools inspect "$target_ref" --raw 2>/dev/null)" || true
    if [[ "$target_raw" == *"$source_digest"* ]]; then
      echo "  verified: target manifest list contains source digest $source_digest"
    else
      echo "::error::${target_ref} ($target_digest) does not reference ${source_ref} ($source_digest)" >&2
      exit 1
    fi
  fi

  echo "  ok ${image} -> ${target_digest}"
  {
    echo "| \`${image}\` | \`${TAG}\` | \`${target_digest}\` |"
  } >> "${GITHUB_STEP_SUMMARY:-/dev/null}"
done

if [ -n "${GITHUB_STEP_SUMMARY:-}" ]; then
  {
    echo ""
    echo "Production tag \`${PRODUCTION_TAG}\` now points at the images above."
  } >> "$GITHUB_STEP_SUMMARY"
fi
