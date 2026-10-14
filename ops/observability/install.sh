#!/usr/bin/env bash
# Install / upgrade the HRMS observability stack (GlitchTip + Uptime Kuma).
#
#   ./install.sh            first install, or re-run safely (idempotent)
#   ./install.sh --upgrade  pull the pinned versions in .env and restart
#   ./install.sh --check    preflight checks only, changes nothing
#
# Never touches HRMS, its MySQL or nginx. Writes only inside this folder and Docker volumes.
set -euo pipefail
cd "$(dirname "$0")"

MODE="${1:-install}"
red()   { printf '\033[31m%s\033[0m\n' "$*"; }
green() { printf '\033[32m%s\033[0m\n' "$*"; }
info()  { printf '  %s\n' "$*"; }
fail()  { red "FAIL: $*"; exit 1; }

# ── Preflight ────────────────────────────────────────────────────────────────
echo "Preflight"
command -v docker >/dev/null || fail "docker is not installed"
docker compose version >/dev/null 2>&1 || fail "docker compose v2 plugin is not installed"
docker info >/dev/null 2>&1 || fail "cannot talk to the docker daemon (add this user to the docker group?)"
command -v openssl >/dev/null || fail "openssl is not installed"

DOCKER_ROOT="$(docker info --format '{{.DockerRootDir}}' 2>/dev/null || echo /var/lib/docker)"
FREE_GB=$(df -BG --output=avail "$DOCKER_ROOT" 2>/dev/null | tail -1 | tr -dc '0-9')
[ "${FREE_GB:-0}" -ge 6 ] || fail "only ${FREE_GB}G free on $DOCKER_ROOT; need at least 6G (images ~1.8G + data)"
info "disk free on $DOCKER_ROOT: ${FREE_GB}G"
AVAIL_MB=$(awk '/MemAvailable/ {print int($2/1024)}' /proc/meminfo)
[ "${AVAIL_MB:-0}" -ge 2000 ] || fail "only ${AVAIL_MB}MB RAM available; need ~2GB for the stack"
info "RAM available: ${AVAIL_MB}MB"

[ -f .env ] || { cp .env.example .env; info "created .env from .env.example"; }
chmod 600 .env
set -a; . ./.env; set +a

case "${BIND_IP:-127.0.0.1}" in
  0.0.0.0|"::") fail "BIND_IP=${BIND_IP} would expose the UIs on every interface. Use 127.0.0.1 or the LAN IP." ;;
esac

port_busy() {  # $1 = port. Busy only if something OTHER than our own containers holds it.
  local p="$1"
  if docker compose ps --format '{{.Ports}}' 2>/dev/null | grep -q ":$p->"; then return 1; fi
  ss -ltnH 2>/dev/null | awk '{print $4}' | grep -qE "(^|:)$p$"
}
for p in "${GT_PORT:-8710}" "${KUMA_PORT:-3001}"; do
  port_busy "$p" && fail "port $p is already in use by another program; change it in .env"
done
info "ports ${GT_PORT:-8710} (GlitchTip) and ${KUMA_PORT:-3001} (Uptime Kuma) are free"
green "Preflight OK"
[ "$MODE" = "--check" ] && exit 0

# ── Secrets (generated once, never printed except the admin password on first run) ────────────
set_env() {  # $1 key  $2 value — replace or append in .env without echoing the value
  if grep -q "^$1=" .env; then
    python3 - "$1" "$2" <<'PY'
import sys, re, pathlib
k, v = sys.argv[1], sys.argv[2]
p = pathlib.Path(".env"); t = p.read_text()
t = re.sub(rf"^{re.escape(k)}=.*$", f"{k}={v}", t, flags=re.M)
p.write_text(t)
PY
  else
    printf '%s=%s\n' "$1" "$2" >> .env
  fi
}
NEW_ADMIN_PASSWORD=""
[ -n "${GT_SECRET_KEY:-}" ]  || { set_env GT_SECRET_KEY  "$(openssl rand -hex 32)"; info "generated GT_SECRET_KEY"; }
[ -n "${GT_DB_PASSWORD:-}" ] || { set_env GT_DB_PASSWORD "$(openssl rand -hex 24)"; info "generated GT_DB_PASSWORD"; }
if [ -z "${GT_ADMIN_PASSWORD:-}" ]; then
  NEW_ADMIN_PASSWORD="$(openssl rand -base64 18 | tr -d '/+=' | cut -c1-20)"
  set_env GT_ADMIN_PASSWORD "$NEW_ADMIN_PASSWORD"
fi
chmod 600 .env
set -a; . ./.env; set +a

# ── Start ──────────────────────────────────────────────────────────────────
echo "Pulling pinned images (GlitchTip ${GT_VERSION}, Uptime Kuma ${KUMA_VERSION})"
docker compose pull -q
docker compose up -d --remove-orphans

echo "Waiting for GlitchTip to become healthy"
for i in $(seq 1 60); do
  state=$(docker inspect -f '{{.State.Health.Status}}' "$(docker compose ps -q gt-web)" 2>/dev/null || echo starting)
  [ "$state" = "healthy" ] && break
  sleep 5
done
[ "$state" = "healthy" ] || { docker compose logs --tail 40 gt-web gt-migrate; fail "GlitchTip did not become healthy"; }
green "GlitchTip is up on http://${BIND_IP}:${GT_PORT}"

echo "Waiting for Uptime Kuma"
for i in $(seq 1 40); do
  curl -fsS -o /dev/null "http://${BIND_IP}:${KUMA_PORT}/" && break
  sleep 3
done
curl -fsS -o /dev/null "http://${BIND_IP}:${KUMA_PORT}/" || fail "Uptime Kuma did not start"
green "Uptime Kuma is up on http://${BIND_IP}:${KUMA_PORT}"

# ── GlitchTip admin, organisation and projects ──────────────────────────────
echo "Provisioning GlitchTip (admin, organisation, 3 projects, PII scrubbing)"
docker compose exec -T -e GT_ADMIN_EMAIL="$GT_ADMIN_EMAIL" -e GT_ADMIN_PASSWORD="$GT_ADMIN_PASSWORD" \
  gt-web ./manage.py shell < glitchtip_provision.py | tee .provision.out | grep -v '^DSN' || true
grep '^DSN' .provision.out | awk '{print $2"="$3}' > dsn.txt
chmod 600 dsn.txt .provision.out
rm -f .provision.out

echo
green "Done."
echo "  GlitchTip    http://${BIND_IP}:${GT_PORT}   login: ${GT_ADMIN_EMAIL}"
[ -n "$NEW_ADMIN_PASSWORD" ] && echo "               password (shown once, also in .env): ${NEW_ADMIN_PASSWORD}"
echo "  Uptime Kuma  http://${BIND_IP}:${KUMA_PORT}   (create the admin on first visit, then run kuma_provision)"
echo "  DSNs for HRMS are in $(pwd)/dsn.txt (chmod 600). Put them in the HRMS env files:"
echo "    backend/.env   ERROR_TRACKING_DSN=<hrms-backend DSN>"
echo "                   ERROR_TRACKING_WORKERS_DSN=<hrms-workers DSN>"
echo "    frontend build VITE_ERROR_TRACKING_DSN=<hrms-frontend DSN>"
