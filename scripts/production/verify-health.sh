#!/usr/bin/env bash
set -euo pipefail

die() {
  printf 'ERROR: %s\n' "$*" >&2
  exit 1
}

BASE_URL="${BASE_URL:-http://127.0.0.1:5055}"
TMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TMP_DIR"' EXIT

check_status() {
  local label="$1"
  local path="$2"
  local expected="$3"
  local body="$TMP_DIR/${label}.body"
  local code

  code="$(curl -sS -o "$body" -w '%{http_code}' "$BASE_URL$path")"
  if [[ "$code" == "$expected" ]]; then
    printf 'PASS %s -> %s\n' "$path" "$code"
    return 0
  fi

  printf 'FAIL %s -> expected %s, got %s\n' "$path" "$expected" "$code" >&2
  if [[ -s "$body" ]]; then
    printf 'Response body:\n' >&2
    sed -n '1,20p' "$body" >&2
  fi
  return 1
}

failures=0

check_status api_health /api/health 200 || failures=$((failures + 1))
check_status assessment_health /api/ats-ext/assessment/health 200 || failures=$((failures + 1))
check_status assessment_page /api/ats-ext/assessment 200 || failures=$((failures + 1))
check_status admin_dashboard /api/ats-ext/assessment-admin/dashboard 401 || failures=$((failures + 1))
check_status template_builder /api/ats-ext/assessment-admin/template-builder 200 || failures=$((failures + 1))
check_status legacy_template_builder /api/ats-ext/assessment-template-builder 308 || failures=$((failures + 1))
check_status public_queue '/api/ats/queue/public-display?branch=NOIDA' 200 || failures=$((failures + 1))

if (( failures > 0 )); then
  die "One or more health checks failed"
fi

printf 'SUMMARY: all required health checks passed\n'

