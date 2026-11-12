#!/usr/bin/env bash
#
# Maps the files changed by a commit onto the custom images that must be
# rebuilt. Reads BASE_SHA / HEAD_SHA / FORCE_ALL from the environment and
# writes GitHub Actions outputs to $GITHUB_OUTPUT.
#
# The component -> path mapping mirrors the actual build contexts, so a change
# to a Dockerfile, requirements.txt, package.json or nginx template is never
# missed:
#
#   backend/**       -> hcw6-backend (target api) and hcw6-admin (target admin,
#                       which copies backend/statics and backend/nginx)
#   patient/**       -> hcw6-patient
#   practitioner/**  -> hcw6-practitioner
#   waruwenjo/**     -> hcw6-waruwenjo (excluding committed build artefacts)
#
# Anything unclassifiable (root files, docs, CI) rebuilds nothing, which is
# safe: those paths are not inputs to any image.

set -euo pipefail

: "${GITHUB_OUTPUT:?GITHUB_OUTPUT must be set (run this from GitHub Actions)}"

base="${BASE_SHA:-}"
head="${HEAD_SHA:-HEAD}"
force_all="${FORCE_ALL:-false}"
namespace="$(printf '%s' "${GITHUB_REPOSITORY_OWNER:-}" | tr '[:upper:]' '[:lower:]')"
sha="${GITHUB_SHA:-$(git rev-parse HEAD)}"

files="$(mktemp)"
trap 'rm -f "$files"' EXIT

if [ "$force_all" = "true" ]; then
  echo "force_all=true: treating every tracked file as changed."
  git ls-files > "$files"
elif [ -n "$base" ] && [ "$base" != "0000000000000000000000000000000000000000" ] \
  && git cat-file -e "${base}^{commit}" 2>/dev/null; then
  echo "Changes between ${base} and ${head}:"
  git diff --name-only "$base" "$head" > "$files"
  sed -n '1,100p' "$files"
else
  # New branch or a push without a usable base: be conservative and rebuild.
  echo "No usable base commit; treating every tracked file as changed."
  git ls-files > "$files"
fi

changed() {
  grep -Eq "$1" "$files"
}

backend=false
patient=false
practitioner=false
waruwenjo=false

if changed '^backend/'; then backend=true; fi
if changed '^patient/'; then patient=true; fi
if changed '^practitioner/'; then practitioner=true; fi

# waruwenjo/dist, waruwenjo/node_modules and waruwenjo/.angular are committed
# build artefacts in this repository and are not image inputs.
if grep -E '^waruwenjo/' "$files" \
  | grep -vE '^waruwenjo/(dist|node_modules|\.angular)/' \
  | grep -q .; then
  waruwenjo=true
fi

# The WaruWenJo Angular workspace is not committed in this repository (only a
# prebuilt dist/ and one spec file exist), so its image cannot be built yet.
# Skipping it keeps releases green; remove this guard once the sources land.
if [ "$waruwenjo" = "true" ] \
  && { [ ! -f waruwenjo/package.json ] || [ ! -f waruwenjo/angular.json ]; }; then
  echo "::warning::waruwenjo sources are incomplete (package.json/angular.json missing); skipping hcw6-waruwenjo."
  waruwenjo=false
fi

entries=()
images=()

if [ "$backend" = true ]; then
  entries+=('{"image":"hcw6-backend","context":"backend","dockerfile":"backend/Dockerfile","target":"api"}')
  entries+=('{"image":"hcw6-admin","context":"backend","dockerfile":"backend/Dockerfile","target":"admin"}')
  images+=("hcw6-backend" "hcw6-admin")
fi
if [ "$patient" = true ]; then
  entries+=('{"image":"hcw6-patient","context":"patient","dockerfile":"patient/Dockerfile","target":"patient"}')
  images+=("hcw6-patient")
fi
if [ "$practitioner" = true ]; then
  entries+=('{"image":"hcw6-practitioner","context":"practitioner","dockerfile":"practitioner/Dockerfile","target":"practitioner"}')
  images+=("hcw6-practitioner")
fi
if [ "$waruwenjo" = true ]; then
  entries+=('{"image":"hcw6-waruwenjo","context":"waruwenjo","dockerfile":"waruwenjo/Dockerfile","target":"waruwenjo"}')
  images+=("hcw6-waruwenjo")
fi

# A GitHub Actions matrix must never be empty, so a no-op entry is used when
# nothing changed; the workflow skips every build step for it.
if [ "${#entries[@]}" -eq 0 ]; then
  entries+=('{"image":"noop"}')
fi

deploy_hcw=false
if [ "$backend" = true ] || [ "$patient" = true ] || [ "$practitioner" = true ]; then
  deploy_hcw=true
fi

deploy_waruwenjo=false
if [ "$waruwenjo" = true ]; then
  deploy_waruwenjo=true
fi

tag="sha-${sha}"
images_out="${images[*]:-}"

echo "namespace=${namespace}"
echo "tag=${tag}"
echo "images=${images_out:-<none>}"
echo "deploy_hcw=${deploy_hcw} deploy_waruwenjo=${deploy_waruwenjo}"

{
  echo "matrix={\"include\":[$(IFS=,; echo "${entries[*]}")]}"
  echo "images=${images_out}"
  echo "tag=${tag}"
  echo "namespace=${namespace}"
  echo "deploy_hcw=${deploy_hcw}"
  echo "deploy_waruwenjo=${deploy_waruwenjo}"
} >> "$GITHUB_OUTPUT"
