#!/usr/bin/env bash
#
# Probes the deployed application over HTTP after a Coolify deployment.
#
# HEALTHCHECK_URLS is a newline- or comma-separated list; each entry is either
# "name|https://url" or a bare URL. Values come from GitHub Actions secrets so
# internal hostnames are never committed.
#
# When HEALTHCHECK_URLS is empty the probes are skipped with a warning: the
# deployment result itself is still authoritative, but a release without
# health URLs is only partially verified.

set -euo pipefail

urls="${HEALTHCHECK_URLS:-}"
retries="${HEALTHCHECK_RETRIES:-20}"
delay="${HEALTHCHECK_DELAY:-15}"

if [ -z "$(printf '%s' "$urls" | tr -d '[:space:],')" ]; then
  echo "::warning::HEALTHCHECK_URLS is not configured; skipping post-deployment HTTP probes."
  if [ -n "${GITHUB_STEP_SUMMARY:-}" ]; then
    echo "No health check URLs configured for this stack; health was not probed." >> "$GITHUB_STEP_SUMMARY"
  fi
  exit 0
fi

failures=0

while IFS= read -r entry; do
  [ -z "$entry" ] && continue
  entry="$(printf '%s' "$entry" | sed 's/^[[:space:]]*//; s/[[:space:]]*$//')"
  [ -z "$entry" ] && continue

  if [[ "$entry" == *"|"* ]]; then
    name="${entry%%|*}"
    url="${entry#*|}"
  else
    name="$entry"
    url="$entry"
  fi

  attempt=1
  ok=false
  while [ "$attempt" -le "$retries" ]; do
    code="$(curl -sS -o /dev/null -w '%{http_code}' --max-time 10 "$url" || echo "000")"
    if [ "$code" -ge 200 ] && [ "$code" -lt 400 ]; then
      echo "${name}: HTTP ${code} (attempt ${attempt}/${retries})"
      ok=true
      break
    fi
    echo "${name}: HTTP ${code} (attempt ${attempt}/${retries}); retrying in ${delay}s"
    attempt=$(( attempt + 1 ))
    if [ "$attempt" -le "$retries" ]; then sleep "$delay"; fi
  done

  if [ "$ok" != true ]; then
    echo "::error::${name} failed its health check: ${url}"
    failures=$(( failures + 1 ))
  fi

  if [ -n "${GITHUB_STEP_SUMMARY:-}" ]; then
    if [ "$ok" = true ]; then
      echo "Health check \`${name}\`: **ok**" >> "$GITHUB_STEP_SUMMARY"
    else
      echo "Health check \`${name}\`: **failed**" >> "$GITHUB_STEP_SUMMARY"
    fi
  fi
done < <(printf '%s' "$urls" | tr ',' '\n')

if [ "$failures" -gt 0 ]; then
  echo "::error::${failures} health check(s) failed after deployment"
  exit 1
fi

echo "All health checks passed"
