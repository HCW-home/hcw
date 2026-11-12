#!/usr/bin/env bash
#
# Triggers a Coolify deployment for one resource (an Application using the
# Docker Compose build pack) and waits for the deployment to finish.
#
# Coolify API (v4): POST /api/v1/deploy?uuid=<uuid>&force=false with a bearer
# token returns {deployments:[{message,resource_uuid,deployment_uuid}]}; the
# deployment state is then polled through GET /api/v1/deployments/{uuid} until
# it reports finished / failed / cancelled.
#
# A successful HTTP 200 only means the deployment was queued: the exit status
# of this script reflects the deployment result, not the webhook call.
#
# Env: COOLIFY_BASE_URL, COOLIFY_API_TOKEN, COOLIFY_SERVICE_UUID
#      COOLIFY_DEPLOY_TIMEOUT (seconds, default 1200)
#      COOLIFY_POLL_INTERVAL (seconds, default 15)

set -euo pipefail

: "${COOLIFY_BASE_URL:?COOLIFY_BASE_URL is not set}"
: "${COOLIFY_API_TOKEN:?COOLIFY_API_TOKEN is not set}"
: "${COOLIFY_SERVICE_UUID:?COOLIFY_SERVICE_UUID is not set}"

label="${1:-Coolify}"
timeout="${COOLIFY_DEPLOY_TIMEOUT:-1200}"
interval="${COOLIFY_POLL_INTERVAL:-15}"
api="${COOLIFY_BASE_URL%/}/api/v1"

body_file="$(mktemp)"
trap 'rm -f "$body_file"' EXIT

echo "Triggering ${label} deployment for resource ${COOLIFY_SERVICE_UUID}"
http_code="$(curl -sS -o "$body_file" -w '%{http_code}' \
  -X POST "${api}/deploy?uuid=${COOLIFY_SERVICE_UUID}&force=false" \
  -H "Authorization: Bearer ${COOLIFY_API_TOKEN}" \
  -H "Accept: application/json")"

if [ "$http_code" != "200" ]; then
  echo "::error::Coolify deploy request failed with HTTP ${http_code}"
  cat "$body_file"
  exit 1
fi

deployment_uuid="$(python3 - "$body_file" <<'PY'
import json
import sys

with open(sys.argv[1], encoding="utf-8") as handle:
    payload = json.load(handle)

for item in payload.get("deployments") or []:
    if item.get("deployment_uuid"):
        print(item["deployment_uuid"])
        break
PY
)"

if [ -z "$deployment_uuid" ]; then
  echo "::error::Coolify accepted the request but queued no deployment"
  cat "$body_file"
  exit 1
fi

echo "Queued deployment ${deployment_uuid}"
if [ -n "${GITHUB_OUTPUT:-}" ]; then
  echo "coolify_deployment_uuid=${deployment_uuid}" >> "$GITHUB_OUTPUT"
fi

deadline=$(( $(date +%s) + timeout ))
last_state=""

while :; do
  deployment_file="$body_file"
  curl -sS -o "$deployment_file" \
    -H "Authorization: Bearer ${COOLIFY_API_TOKEN}" \
    -H "Accept: application/json" \
    "${api}/deployments/${deployment_uuid}"

  read -r state logs_file < <(python3 - "$deployment_file" <<'PY'
import json
import sys
import tempfile

with open(sys.argv[1], encoding="utf-8") as handle:
    payload = json.load(handle)

logs = payload.get("logs") or ""
path = ""
if logs:
    handle = tempfile.NamedTemporaryFile("w", delete=False, encoding="utf-8")
    handle.write(logs[-8000:])
    handle.close()
    path = handle.name

print(payload.get("status", ""), path)
PY
)

  if [ "$state" != "$last_state" ]; then
    echo "Deployment ${deployment_uuid}: ${state:-<unknown>}"
    last_state="$state"
  fi

  case "$state" in
    finished)
      echo "Deployment ${deployment_uuid} finished successfully"
      if [ -n "${GITHUB_STEP_SUMMARY:-}" ]; then
        echo "Coolify deployment \`${deployment_uuid}\` (${label}): **finished**" >> "$GITHUB_STEP_SUMMARY"
      fi
      exit 0
      ;;
    failed|cancelled)
      echo "::error::Coolify deployment ${deployment_uuid} reported ${state}"
      if [ -n "${logs_file:-}" ] && [ -f "$logs_file" ]; then
        echo "----- last deployment logs -----"
        tail -n 120 "$logs_file"
        echo "--------------------------------"
        rm -f "$logs_file"
      fi
      exit 1
      ;;
  esac

  if [ "$(date +%s)" -ge "$deadline" ]; then
    echo "::error::timed out after ${timeout}s waiting for deployment ${deployment_uuid} (last state: ${state:-unknown})"
    if [ -n "${logs_file:-}" ] && [ -f "$logs_file" ]; then
      tail -n 120 "$logs_file"
      rm -f "$logs_file"
    fi
    exit 1
  fi

  sleep "$interval"
done
