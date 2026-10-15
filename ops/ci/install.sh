#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"

GREEN='\033[0;32m'; RED='\033[0;31m'; NC='\033[0m'
ok()   { echo -e "${GREEN}[OK]${NC}  $*"; }
fail() { echo -e "${RED}[FAIL]${NC} $*"; exit 1; }

[[ ! -f .env ]] && cp .env.example .env

# Generate agent secret if blank
if ! grep -q "^AGENT_SECRET=.\+" .env 2>/dev/null; then
  SECRET=$(openssl rand -hex 32)
  sed -i "s|^AGENT_SECRET=.*|AGENT_SECRET=${SECRET}|" .env
fi

# Check GitHub credentials are set
source .env
[[ -z "${GITHUB_CLIENT_ID:-}" ]] && fail "GITHUB_CLIENT_ID is not set in .env
  Create an OAuth App at https://github.com/settings/applications/new
  Callback URL: http://${BIND_IP}:3333/authorize"
[[ -z "${GITHUB_CLIENT_SECRET:-}" ]] && fail "GITHUB_CLIENT_SECRET is not set in .env"

docker compose pull --quiet
docker compose up -d
ok "Woodpecker CI started at http://${BIND_IP}:3333"
