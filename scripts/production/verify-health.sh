#!/usr/bin/env bash
set -euo pipefail

die() {
  printf 'ERROR: %s\n' "$*" >&2
  exit 1
}

# EXPECTED_GIT_SHA: pass the SHA you just deployed. When set, this script fails the deploy
# unless the running process actually reports that SHA via /api/health/version — added after
# the 2026-08-13 outage (docs/incidents/2026-08-13-migration-1006-production-outage.md), where
# `pm2 list` reporting "online" was mistaken for a successful deploy while the HTTP listener
# had never bound at all. PM2 process status is not evidence of application health; this
# script — actually invoked, not eyeballed — is.
EXPECTED_GIT_SHA="${EXPECTED_GIT_SHA:-}"
BACKEND_PORT="${BACKEND_PORT:-5055}"
BASE_URL="${BASE_URL:-http://127.0.0.1:5055}"
EXPECTED_ASSESSMENT_STATUS="${EXPECTED_ASSESSMENT_STATUS:-enabled}"
EXPECTED_ONE_ASSESSMENT_ATTEMPT="${EXPECTED_ONE_ASSESSMENT_ATTEMPT:-true}"
EXPECTED_MAX_TYPING_ATTEMPTS="${EXPECTED_MAX_TYPING_ATTEMPTS:-2}"
EXPECTED_QUEUE_LIFECYCLE_ISOLATED="${EXPECTED_QUEUE_LIFECYCLE_ISOLATED:-true}"
EXPECTED_LEGACY_TEMPLATE_LOCATION="${EXPECTED_LEGACY_TEMPLATE_LOCATION:-/api/ats-ext/assessment-admin/template-builder}"
EXPECTED_PUBLIC_QUEUE_BRANCH="${EXPECTED_PUBLIC_QUEUE_BRANCH:-NOIDA}"

export EXPECTED_ASSESSMENT_STATUS
export EXPECTED_ONE_ASSESSMENT_ATTEMPT
export EXPECTED_MAX_TYPING_ATTEMPTS
export EXPECTED_QUEUE_LIFECYCLE_ISOLATED
export EXPECTED_LEGACY_TEMPLATE_LOCATION
export EXPECTED_PUBLIC_QUEUE_BRANCH

TMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TMP_DIR"' EXIT

request() {
  local path="$1"
  local label="$2"
  local body="$TMP_DIR/${label}.body"
  local headers="$TMP_DIR/${label}.headers"
  local code

  code="$(curl -sS -D "$headers" -o "$body" -w '%{http_code}' "$BASE_URL$path")"
  printf '%s\n%s\n%s' "$code" "$body" "$headers"
}

print_fail() {
  local path="$1"
  local expected="$2"
  local got="$3"
  local body="$4"
  printf 'FAIL %s -> expected %s, got %s\n' "$path" "$expected" "$got" >&2
  if [[ -s "$body" ]]; then
    printf 'Response body:\n' >&2
    sed -n '1,40p' "$body" >&2
  fi
}

check_status() {
  local label="$1"
  local path="$2"
  local expected="$3"
  local response code body headers

  response="$(request "$path" "$label")"
  code="$(printf '%s\n' "$response" | sed -n '1p')"
  body="$(printf '%s\n' "$response" | sed -n '2p')"
  headers="$(printf '%s\n' "$response" | sed -n '3p')"

  if [[ "$code" == "$expected" ]]; then
    printf 'PASS %s -> %s\n' "$path" "$code"
    return 0
  fi

  print_fail "$path" "$expected" "$code" "$body"
  return 1
}

check_port_bound() {
  # Fails fast, before any HTTP attempt, with an unambiguous message — a connection-refused
  # curl error further down can look like a slow server if you're not already watching for
  # it. This is exactly the check that would have caught the outage in under a second: PM2
  # reported the process "online" for the entire ~24 minutes it never had this port open.
  if command -v ss >/dev/null 2>&1; then
    if ss -tln "( sport = :$BACKEND_PORT )" 2>/dev/null | grep -q ":$BACKEND_PORT"; then
      printf 'PASS port %s is bound\n' "$BACKEND_PORT"
      return 0
    fi
  elif command -v netstat >/dev/null 2>&1; then
    if netstat -tln 2>/dev/null | grep -q ":$BACKEND_PORT "; then
      printf 'PASS port %s is bound\n' "$BACKEND_PORT"
      return 0
    fi
  else
    printf 'WARN neither ss nor netstat available — skipping port-bound check, relying on HTTP checks only\n' >&2
    return 0
  fi
  printf 'FAIL port %s is not bound — the process may show as "online" in PM2 while never having started its HTTP listener (this is exactly how the 2026-08-13 outage went undetected)\n' "$BACKEND_PORT" >&2
  return 1
}

check_version_and_schema() {
  local response code body headers commit_value pending_value applied_value

  response="$(request /api/health/version version)"
  code="$(printf '%s\n' "$response" | sed -n '1p')"
  body="$(printf '%s\n' "$response" | sed -n '2p')"
  headers="$(printf '%s\n' "$response" | sed -n '3p')"

  if [[ "$code" != "200" ]]; then
    print_fail /api/health/version 200 "$code" "$body"
    return 1
  fi

  if ! node - "$body" "$EXPECTED_GIT_SHA" <<'EOF' >/dev/null 2>&1
const fs = require('fs');
const bodyPath = process.argv[2];
const expectedSha = process.argv[3];
const payload = JSON.parse(fs.readFileSync(bodyPath, 'utf8'));

const problems = [];
if (!payload || payload.success !== true) problems.push('success!=true');
if (!payload.commit || payload.commit === 'unknown') problems.push('commit unknown — build did not stamp itself');
if (expectedSha && payload.commit && !expectedSha.startsWith(payload.commit) && !payload.commit.startsWith(expectedSha)) {
  problems.push(`commit=${payload.commit} does not match expected ${expectedSha} — old code is still running`);
}
if (!payload.schema || payload.schema.valid !== true) problems.push('schema.valid!=true');
if (payload.schema && Number(payload.schema.pending) !== 0) problems.push(`schema.pending=${payload.schema.pending} — code and database are from different releases`);

if (problems.length > 0) { console.error(problems.join('; ')); process.exit(1); }
EOF
  then
    print_fail /api/health/version 200 "$code" "$body"
    return 1
  fi

  commit_value="$(node -e "console.log(JSON.parse(require('fs').readFileSync(process.argv[1],'utf8')).commit)" "$body")"
  pending_value="$(node -e "console.log(JSON.parse(require('fs').readFileSync(process.argv[1],'utf8')).schema.pending)" "$body")"
  applied_value="$(node -e "console.log(JSON.parse(require('fs').readFileSync(process.argv[1],'utf8')).schema.applied)" "$body")"

  printf 'PASS /api/health/version -> commit=%s schema.applied=%s schema.pending=%s\n' "$commit_value" "$applied_value" "$pending_value"
  return 0
}

check_json_root_health() {
  local response code body headers

  response="$(request /api/health api_health)"
  code="$(printf '%s\n' "$response" | sed -n '1p')"
  body="$(printf '%s\n' "$response" | sed -n '2p')"
  headers="$(printf '%s\n' "$response" | sed -n '3p')"

  if [[ "$code" != "200" ]]; then
    print_fail /api/health 200 "$code" "$body"
    return 1
  fi

  if ! node - "$body" <<'EOF' >/dev/null 2>&1
const fs = require('fs');
const bodyPath = process.argv[2];
const payload = JSON.parse(fs.readFileSync(bodyPath, 'utf8'));
if (typeof payload === 'object' && payload !== null && 'success' in payload && payload.success !== true) {
  process.exit(1);
}
EOF
  then
    print_fail /api/health 200 "$code" "$body"
    return 1
  fi

  printf 'PASS /api/health -> %s\n' "$code"
  return 0
}

check_assessment_health() {
  local response code body headers status_value one_attempt_value typing_attempts_value queue_lifecycle_value

  response="$(request /api/ats-ext/assessment/health assessment_health)"
  code="$(printf '%s\n' "$response" | sed -n '1p')"
  body="$(printf '%s\n' "$response" | sed -n '2p')"
  headers="$(printf '%s\n' "$response" | sed -n '3p')"

  if [[ "$code" != "200" ]]; then
    print_fail /api/ats-ext/assessment/health 200 "$code" "$body"
    return 1
  fi

  if ! node - "$body" "$EXPECTED_ASSESSMENT_STATUS" "$EXPECTED_ONE_ASSESSMENT_ATTEMPT" "$EXPECTED_MAX_TYPING_ATTEMPTS" "$EXPECTED_QUEUE_LIFECYCLE_ISOLATED" <<'EOF' >/dev/null 2>&1
const fs = require('fs');
const bodyPath = process.argv[2];
const expectedStatus = process.argv[3];
const expectedOne = process.argv[4] === 'true';
const expectedTyping = Number(process.argv[5]);
const expectedQueue = process.argv[6] === 'true';
const payload = JSON.parse(fs.readFileSync(bodyPath, 'utf8'));
const data = payload && payload.data;

const problems = [];
if (!payload || payload.success !== true) {
  problems.push('success!=true');
}
if (!data || typeof data !== 'object') {
  problems.push('data missing');
} else {
  if (data.status !== expectedStatus) problems.push(`status=${data.status}`);
  if (data.oneAssessmentAttempt !== expectedOne) problems.push(`oneAssessmentAttempt=${data.oneAssessmentAttempt}`);
  if (Number(data.maxTypingAttempts) !== expectedTyping) problems.push(`maxTypingAttempts=${data.maxTypingAttempts}`);
  if (data.queueLifecycleIsolated !== expectedQueue) problems.push(`queueLifecycleIsolated=${data.queueLifecycleIsolated}`);
}

if (problems.length > 0) {
  console.error(problems.join('; '));
  process.exit(1);
}
EOF
  then
    print_fail /api/ats-ext/assessment/health 200 "$code" "$body"
    return 1
  fi

  status_value="$(node - "$body" <<'EOF'
const fs = require('fs');
const bodyPath = process.argv[2];
const payload = JSON.parse(fs.readFileSync(bodyPath, 'utf8'));
process.stdout.write(String(payload.data.status));
EOF
)"
  one_attempt_value="$(node - "$body" <<'EOF'
const fs = require('fs');
const bodyPath = process.argv[2];
const payload = JSON.parse(fs.readFileSync(bodyPath, 'utf8'));
process.stdout.write(String(payload.data.oneAssessmentAttempt));
EOF
)"
  typing_attempts_value="$(node - "$body" <<'EOF'
const fs = require('fs');
const bodyPath = process.argv[2];
const payload = JSON.parse(fs.readFileSync(bodyPath, 'utf8'));
process.stdout.write(String(payload.data.maxTypingAttempts));
EOF
)"
  queue_lifecycle_value="$(node - "$body" <<'EOF'
const fs = require('fs');
const bodyPath = process.argv[2];
const payload = JSON.parse(fs.readFileSync(bodyPath, 'utf8'));
process.stdout.write(String(payload.data.queueLifecycleIsolated));
EOF
)"

  printf 'PASS /api/ats-ext/assessment/health -> %s (status=%s, oneAssessmentAttempt=%s, maxTypingAttempts=%s, queueLifecycleIsolated=%s)\n' \
    "$code" "$status_value" "$one_attempt_value" "$typing_attempts_value" "$queue_lifecycle_value"
  return 0
}

check_redirect() {
  local path="$1"
  local expected_code="$2"
  local expected_location="$3"
  local label="$4"
  local response code body headers location

  response="$(request "$path" "$label")"
  code="$(printf '%s\n' "$response" | sed -n '1p')"
  body="$(printf '%s\n' "$response" | sed -n '2p')"
  headers="$(printf '%s\n' "$response" | sed -n '3p')"

  if [[ "$code" != "$expected_code" ]]; then
    print_fail "$path" "$expected_code" "$code" "$body"
    return 1
  fi

  location="$(awk 'BEGIN{IGNORECASE=1} /^location:/ { sub(/\r$/, "", $0); sub(/^[^:]+:[[:space:]]*/, "", $0); print; exit }' "$headers")"
  if [[ -z "$location" || "$location" != "$expected_location" ]]; then
    printf 'FAIL %s -> expected Location exactly %s, got %s\n' "$path" "$expected_location" "${location:-missing}" >&2
    return 1
  fi

  printf 'PASS %s -> %s Location=%s\n' "$path" "$code" "$location"
  return 0
}

failures=0

check_port_bound || failures=$((failures + 1))
check_version_and_schema || failures=$((failures + 1))
check_json_root_health || failures=$((failures + 1))
check_assessment_health || failures=$((failures + 1))
check_status assessment_page /api/ats-ext/assessment 200 || failures=$((failures + 1))
check_status admin_dashboard /api/ats-ext/assessment-admin/dashboard 401 || failures=$((failures + 1))
check_status template_builder /api/ats-ext/assessment-admin/template-builder 200 || failures=$((failures + 1))
check_redirect /api/ats-ext/assessment-template-builder 308 "$EXPECTED_LEGACY_TEMPLATE_LOCATION" legacy_template_builder || failures=$((failures + 1))
check_status public_queue "/api/ats/queue/public-display?branch=$EXPECTED_PUBLIC_QUEUE_BRANCH" 200 || failures=$((failures + 1))

if (( failures > 0 )); then
  die "One or more health checks failed"
fi

printf 'SUMMARY: all required health checks passed\n'
