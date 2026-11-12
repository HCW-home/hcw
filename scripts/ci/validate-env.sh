#!/usr/bin/env bash
#
# Every variable a production Compose file interpolates must be documented in
# the deployment guide, so nobody has to guess which Coolify environment
# variable is missing. Only names are checked; values never appear in logs.

set -euo pipefail

cd "$(dirname "$0")/../.."

docs="docs/CICD-COOLIFY-DEPLOYMENT.md"
if [ ! -f "$docs" ]; then
  echo "::error::${docs} is missing"
  exit 1
fi

vars="$(grep -hoE '\$\{[A-Z][A-Z0-9_]*' \
  docker-compose.production.yml docker-compose.waruwnjo.yml \
  | sed 's/^\${//' | sort -u)"

if [ -z "$vars" ]; then
  echo "::error::no environment variables found in the production Compose files"
  exit 1
fi

missing=0
while IFS= read -r name; do
  [ -z "$name" ] && continue
  if ! grep -q "\`${name}\`" "$docs"; then
    echo "::error::${name} is used by a production Compose file but is not documented in ${docs}"
    missing=$(( missing + 1 ))
  fi
done <<< "$vars"

if [ "$missing" -gt 0 ]; then
  echo "::error::${missing} undocumented environment variable(s)"
  exit 1
fi

echo "All production environment variables are documented:"
echo "$vars" | sed 's/^/  - /'
