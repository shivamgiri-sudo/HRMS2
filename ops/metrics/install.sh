#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"

CHECK_ONLY=false
[[ "${1:-}" == "--check" ]] && CHECK_ONLY=true

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; NC='\033[0m'
ok()   { echo -e "${GREEN}[OK]${NC}  $*"; }
warn() { echo -e "${YELLOW}[WARN]${NC} $*"; }
fail() { echo -e "${RED}[FAIL]${NC} $*"; exit 1; }

echo "=== hrms-metrics preflight ==="

docker info &>/dev/null || fail "Docker not running"
docker compose version &>/dev/null || fail "docker compose v2 not found"
ok "Docker OK"

DISK_FREE=$(df -BG /var/lib/docker 2>/dev/null | awk 'NR==2{print $4}' | tr -d 'G')
[[ "${DISK_FREE:-0}" -lt 4 ]] && fail "Need 4 GB free on /var/lib/docker, have ${DISK_FREE} GB"
ok "Disk: ${DISK_FREE} GB free"

RAM_AVAIL=$(awk '/MemAvailable/{printf "%d", $2/1024}' /proc/meminfo)
[[ "${RAM_AVAIL:-0}" -lt 1500 ]] && fail "Need 1.5 GB RAM, have ${RAM_AVAIL} MB"
ok "RAM: ${RAM_AVAIL} MB available"

for PORT in 9090 3000; do
  ss -tlnp 2>/dev/null | grep -q ":${PORT} " && fail "Port ${PORT} already in use"
done
ok "Ports 9090 and 3000 free"

$CHECK_ONLY && { ok "Preflight OK"; exit 0; }
ok "Preflight OK"

# ── .env ──────────────────────────────────────────────────────────────────────
if [[ ! -f .env ]]; then
  cp .env.example .env
fi
chmod 600 .env
source .env

# ── Grafana password ───────────────────────────────────────────────────────────
if ! grep -q "^GRAFANA_ADMIN_PASSWORD=.\+" .env 2>/dev/null; then
  GF_PASS=$(openssl rand -base64 18 | tr -d '/+=')
  sed -i "s|^GRAFANA_ADMIN_PASSWORD=.*|GRAFANA_ADMIN_PASSWORD=${GF_PASS}|" .env
  printf "\n${GREEN}  Grafana password (saved to .env):${NC} %s\n\n" "${GF_PASS}" >/dev/tty
fi

# ── Prometheus basic-auth web config ──────────────────────────────────────────
if [[ ! -f prometheus-web-config.yml ]]; then
  PROM_PASS=$(openssl rand -base64 18 | tr -d '/+=')
  echo "  Generating Prometheus basic-auth hash (uses Docker httpd image)..."
  PROM_HASH=$(docker run --rm httpd:2.4-alpine \
    sh -c "htpasswd -bnBC 12 '' '${PROM_PASS}' 2>/dev/null | tr -d ':\\n'")
  cat > prometheus-web-config.yml <<EOF
basic_auth_users:
  admin: ${PROM_HASH}
EOF
  chmod 600 prometheus-web-config.yml
  printf "${GREEN}  Prometheus password (saved in prometheus-web-config.yml):${NC} %s\n\n" "${PROM_PASS}" >/dev/tty
fi

# ── MySQL exporter credentials file ───────────────────────────────────────────
if [[ ! -f mysql-exporter.cnf ]]; then
  source .env
  if [[ -z "${METRICS_DB_PASSWORD:-}" ]]; then
    echo ""
    echo "  METRICS_DB_PASSWORD is not set in .env"
    echo "  Create a read-only MySQL user first:"
    echo "    GRANT SELECT, PROCESS, REPLICATION CLIENT ON *.* TO '${METRICS_DB_USER}'@'%' IDENTIFIED BY '<password>';"
    echo "  Then set METRICS_DB_PASSWORD in .env and re-run this script."
    fail "METRICS_DB_PASSWORD required"
  fi
  sed \
    -e "s/METRICS_DB_HOST/${METRICS_DB_HOST}/" \
    -e "s/METRICS_DB_USER/${METRICS_DB_USER}/" \
    -e "s/METRICS_DB_PASSWORD/${METRICS_DB_PASSWORD}/" \
    mysql-exporter.cnf.template > mysql-exporter.cnf
  chmod 600 mysql-exporter.cnf
  ok "mysql-exporter.cnf created (chmod 600)"
fi

# ── Start ──────────────────────────────────────────────────────────────────────
echo "Pulling images..."
docker compose pull --quiet
echo "Starting containers..."
docker compose up -d

echo ""
echo "Waiting for Grafana..."
STATUS=000
for i in $(seq 1 30); do
  STATUS=$(curl -s -o /dev/null -w "%{http_code}" "http://127.0.0.1:3000/api/health" 2>/dev/null || echo "000")
  [[ "$STATUS" == "200" ]] && break
  sleep 3
done
[[ "$STATUS" == "200" ]] && ok "Grafana is up" || warn "Grafana not yet responding — check: docker compose logs grafana"

BIND=$(grep "^BIND_IP=" .env | cut -d= -f2)
GF_PASS=$(grep "^GRAFANA_ADMIN_PASSWORD=" .env | cut -d= -f2)

printf "\n"
printf "  %-14s http://%s:3000   login: admin / %s\n" "Grafana" "${BIND}" "${GF_PASS}"
printf "  %-14s http://%s:9090   login: admin / <prometheus password shown above>\n" "Prometheus" "${BIND}"
printf "\n"
echo "  Dashboard auto-loaded: HRMS System Overview"
echo "  Import Node Exporter Full: Grafana > Dashboards > Import > ID 1860"
echo "  Import MySQL Overview:     Grafana > Dashboards > Import > ID 7362"
