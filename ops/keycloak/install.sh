#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"

GREEN='\033[0;32m'; RED='\033[0;31m'; YELLOW='\033[1;33m'; NC='\033[0m'
ok()   { echo -e "${GREEN}[OK]${NC}  $*"; }
warn() { echo -e "${YELLOW}[WARN]${NC} $*"; }
fail() { echo -e "${RED}[FAIL]${NC} $*"; exit 1; }

CHECK_ONLY=false
[[ "${1:-}" == "--check" ]] && CHECK_ONLY=true

# ── .env ──────────────────────────────────────────────────────────────────────
[[ ! -f .env ]] && cp .env.example .env
chmod 600 .env

# Port check
ss -tlnp 2>/dev/null | grep -q ":8180 " && fail "Port 8180 already in use"
ok "Port 8180 free"

# Generate KC admin password if blank
if ! grep -q "^KC_ADMIN_PASSWORD=.\+" .env; then
  KC_PASS=$(openssl rand -base64 18 | tr -d '/+=')
  sed -i "s|^KC_ADMIN_PASSWORD=.*|KC_ADMIN_PASSWORD=${KC_PASS}|" .env
  printf "\n${GREEN}  Keycloak admin password (saved to .env):${NC} %s\n\n" "${KC_PASS}" >/dev/tty
fi

# Generate KC DB password if blank
if ! grep -q "^KC_DB_PASSWORD=.\+" .env; then
  DB_PASS=$(openssl rand -base64 18 | tr -d '/+=')
  sed -i "s|^KC_DB_PASSWORD=.*|KC_DB_PASSWORD=${DB_PASS}|" .env
fi

source .env

$CHECK_ONLY && { ok "Preflight OK"; exit 0; }

# ── MySQL database setup ───────────────────────────────────────────────────────
# MySQL root password is prompted interactively — never stored in any file
echo ""
echo "  To create the Keycloak database, MySQL root access is needed once."
echo "  The password is used only for this setup step and never saved."
read -rsp "  MySQL root password for ${KC_DB_HOST}: " MYSQL_ROOT_PASS
echo ""

if [[ -n "${MYSQL_ROOT_PASS}" ]]; then
  mysql -h "${KC_DB_HOST}" -P "${KC_DB_PORT}" -u root -p"${MYSQL_ROOT_PASS}" <<-SQL
    CREATE DATABASE IF NOT EXISTS \`${KC_DB_NAME}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
    CREATE USER IF NOT EXISTS '${KC_DB_USER}'@'%' IDENTIFIED BY '${KC_DB_PASSWORD}';
    GRANT ALL PRIVILEGES ON \`${KC_DB_NAME}\`.* TO '${KC_DB_USER}'@'%';
    FLUSH PRIVILEGES;
SQL
  ok "MySQL database ${KC_DB_NAME} ready"
else
  warn "Skipped DB creation. Manually run:"
  echo "  CREATE DATABASE ${KC_DB_NAME};"
  echo "  GRANT ALL ON ${KC_DB_NAME}.* TO '${KC_DB_USER}'@'%' IDENTIFIED BY '<password>';"
fi

# ── nginx TLS ─────────────────────────────────────────────────────────────────
if [[ ! -f /etc/ssl/keycloak/cert.pem ]]; then
  echo ""
  echo "  Generating self-signed TLS cert for Keycloak (10-year, SAN for ${KC_DB_HOST})..."
  sudo mkdir -p /etc/ssl/keycloak
  sudo openssl req -x509 -nodes -days 3650 \
    -newkey rsa:2048 \
    -keyout /etc/ssl/keycloak/key.pem \
    -out    /etc/ssl/keycloak/cert.pem \
    -subj   "/CN=192.168.11.225/O=MAS Callnet" \
    -addext "subjectAltName=IP:192.168.11.225"
  sudo chmod 600 /etc/ssl/keycloak/key.pem
  sudo chmod 644 /etc/ssl/keycloak/cert.pem
  ok "TLS cert created at /etc/ssl/keycloak/"
fi

# ── nginx config ──────────────────────────────────────────────────────────────
if [[ ! -f /etc/nginx/sites-enabled/keycloak.conf ]]; then
  sudo cp nginx-keycloak.conf /etc/nginx/sites-available/keycloak.conf
  sudo ln -s /etc/nginx/sites-available/keycloak.conf /etc/nginx/sites-enabled/keycloak.conf
  sudo nginx -t && sudo nginx -s reload
  ok "nginx keycloak vhost enabled"
fi

# ── Start ──────────────────────────────────────────────────────────────────────
docker compose pull --quiet
docker compose up -d

echo ""
echo "Waiting for Keycloak to be ready (may take 2 min)..."
STATUS=000
for i in $(seq 1 40); do
  STATUS=$(curl -s -o /dev/null -w "%{http_code}" "http://127.0.0.1:8180/health/ready" 2>/dev/null || echo "000")
  [[ "$STATUS" == "200" ]] && break
  sleep 5
done
[[ "$STATUS" == "200" ]] && ok "Keycloak is up" || warn "Keycloak not yet responding — check: docker compose logs keycloak"

KC_ADMIN=$(grep "^KC_ADMIN_USER=" .env | cut -d= -f2)
KC_PASS=$(grep "^KC_ADMIN_PASSWORD=" .env | cut -d= -f2)

echo ""
ok "Keycloak ready"
echo "  Admin UI: https://192.168.11.225:8443/admin"
echo "  Login:    ${KC_ADMIN} / ${KC_PASS}"
echo ""
echo "  Next steps:"
echo "  1. Log in, create realm 'mas-callnet'"
echo "  2. Create OIDC client 'hrms-backend' (confidential, redirect: https://mcnhrms.teammas.in/*)"
echo "  3. Create OIDC client 'mas-lms' (for LMS SSO)"
echo "  4. Set backend env: OIDC_ISSUER=${KC_HOSTNAME}/realms/mas-callnet"
