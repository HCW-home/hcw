#!/usr/bin/env bash
#
# Validates the deployment configuration without publishing anything:
#   * every Compose file parses and interpolates;
#   * the production stack contains no build directives, so Oracle never
#     compiles source;
#   * every production service runs a pinned GHCR image (no :latest-only tags);
#   * internal services (api, db, redis) publish no host ports;
#   * the PostgreSQL/Redis data mounts and the existing service set are intact;
#   * the Dockerfiles pass BuildKit's own Dockerfile checks.
#
# Requires: docker compose v2, docker buildx, python3 + pyyaml.

set -euo pipefail

cd "$(dirname "$0")/../.."

fail=0
production_file="docker-compose.production.yml"

# Interpolation values for the variables the production files require. They are
# throw-away placeholders; nothing is pulled or started here.
export DJANGOSECRET_KEY=ci-placeholder-secret
export POSTGRES_PASSWORD=ci-placeholder-password
export WWJ_BACKEND_URL=http://api:8000
export GHCR_OWNER=ci-placeholder
export APP_TAG=production
export WWJ_TAG=production

for file in docker-compose.yml "$production_file" docker-compose.waruwnjo.yml; do
  if [ ! -f "$file" ]; then
    echo "::error::$file is missing"
    fail=1
    continue
  fi
  echo "Validating ${file}"
  if ! docker compose -f "$file" config --quiet; then
    echo "::error::$file is not a valid Compose file"
    fail=1
  fi
done

echo "Checking production stack invariants"
python3 - "$production_file" <<'PY' || fail=1
import sys

import yaml

path = sys.argv[1]
with open(path, encoding="utf-8") as handle:
    compose = yaml.safe_load(handle)

problems = []
services = compose.get("services") or {}

expected = {
    "migrate", "provision", "api", "admin", "celery", "scheduler",
    "patient", "practitioner", "db", "redis",
}
missing = expected - set(services)
if missing:
    problems.append(f"missing services: {', '.join(sorted(missing))}")

# Services running this repository's custom images. db/redis intentionally use
# upstream Docker Hub images and are excluded from the GHCR requirement.
custom_images = {
    "api", "admin", "patient", "practitioner",
    "celery", "scheduler", "migrate", "provision",
}

for name, service in services.items():
    if "build" in service:
        problems.append(f"{name}: has a build directive (Oracle must never build)")

    image = service.get("image")
    if not image:
        problems.append(f"{name}: no image reference")
        continue

    if name in custom_images and not image.startswith("ghcr.io/"):
        problems.append(f"{name}: image {image} is not a GHCR image")

    # A moving tag is allowed (production), a latest-only tag is not.
    if image.rsplit(":", 1)[-1] == "latest":
        problems.append(f"{name}: image uses the :latest tag")

    if name in {"api", "db", "redis"} and service.get("ports"):
        problems.append(f"{name}: publishes host ports but is an internal service")

    if name in custom_images and service.get("pull_policy") != "always":
        problems.append(f"{name}: pull_policy is not 'always'")

db_volumes = services.get("db", {}).get("volumes") or []
if not any("./data/postgres_data" in str(volume) for volume in db_volumes):
    problems.append("db: ./data/postgres_data mount was dropped")

redis_volumes = services.get("redis", {}).get("volumes") or []
if not any("./data/redis_data" in str(volume) for volume in redis_volumes):
    problems.append("redis: ./data/redis_data mount was dropped")

if compose.get("volumes"):
    problems.append("top-level named volumes were added; the existing bind mounts must be preserved")

for problem in problems:
    print(f"::error::{path}: {problem}")

sys.exit(1 if problems else 0)
PY

echo "Checking Dockerfiles"
for context in backend patient practitioner waruwenjo; do
  dockerfile="${context}/Dockerfile"
  [ -f "$dockerfile" ] || continue

  if [ "$context" = "waruwenjo" ] && [ ! -f waruwenjo/package.json ]; then
    echo "Skipping ${dockerfile}: WaruWenJo Angular sources are not committed yet"
    continue
  fi

  echo "  ${dockerfile}"
  # BuildKit's Dockerfile checks: fails on error-level diagnostics only.
  if ! docker buildx build --check --progress=plain -f "$dockerfile" "$context"; then
    echo "::error::${dockerfile} failed Dockerfile checks"
    fail=1
  fi
done

if [ "$fail" -ne 0 ]; then
  echo "::error::deployment configuration validation failed"
  exit 1
fi

echo "Deployment configuration is valid"
