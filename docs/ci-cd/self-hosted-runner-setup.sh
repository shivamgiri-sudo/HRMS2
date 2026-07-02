#!/usr/bin/env bash
# Self-hosted GitHub Actions runner setup for 192.168.11.225
# Run this ONCE as masadmin on the production server.
#
# What it does:
#   1. Downloads the Actions runner agent (connects OUTBOUND to GitHub only)
#   2. Registers it against the HRMS2 repo using a Personal Access Token
#   3. Installs it as a systemd service so it survives reboots
#
# Prerequisites on the server:
#   - Ubuntu/Debian with systemd
#   - Node.js 20+, npm, pm2 already installed
#   - rsync installed (sudo apt-get install rsync)
#   - sudo access for masadmin
#
# Usage:
#   1. Go to https://github.com/shivamgiri-sudo/HRMS2/settings/actions/runners
#   2. Click "New self-hosted runner" → Linux x64
#   3. Copy the token shown (valid 1 hour) — it looks like: AXXXXXXXXXXXXXXXXXX
#   4. Run: bash self-hosted-runner-setup.sh <RUNNER_TOKEN>
#
set -euo pipefail

REPO_URL="https://github.com/shivamgiri-sudo/HRMS2"
RUNNER_VERSION="2.317.0"   # update if GitHub shows a newer version
RUNNER_DIR="$HOME/actions-runner"
RUNNER_NAME="hrms-prod-$(hostname)"

if [ $# -lt 1 ]; then
  echo "Usage: $0 <RUNNER_TOKEN>"
  echo ""
  echo "Get the token from:"
  echo "  $REPO_URL/settings/actions/runners/new?arch=x64&os=linux"
  exit 1
fi

TOKEN="$1"

echo "==> Creating runner directory: $RUNNER_DIR"
mkdir -p "$RUNNER_DIR"
cd "$RUNNER_DIR"

echo "==> Downloading Actions runner v${RUNNER_VERSION}"
curl -fsSL \
  "https://github.com/actions/runner/releases/download/v${RUNNER_VERSION}/actions-runner-linux-x64-${RUNNER_VERSION}.tar.gz" \
  -o actions-runner.tar.gz

echo "==> Extracting"
tar xzf actions-runner.tar.gz
rm actions-runner.tar.gz

echo "==> Installing dependencies"
sudo ./bin/installdependencies.sh

echo "==> Configuring runner"
./config.sh \
  --url "$REPO_URL" \
  --token "$TOKEN" \
  --name "$RUNNER_NAME" \
  --labels "self-hosted,Linux,X64,hrms-prod" \
  --work "_work" \
  --unattended \
  --replace

echo "==> Installing as systemd service (runs as $USER)"
sudo ./svc.sh install "$USER"
sudo ./svc.sh start

echo ""
echo "==> Runner status:"
sudo ./svc.sh status

echo ""
echo "Done. Runner '$RUNNER_NAME' is registered and running."
echo "Check it at: $REPO_URL/settings/actions/runners"
echo ""
echo "IMPORTANT — also run:"
echo "  pm2 save"
echo "to ensure PM2 restores hrms-backend on reboot."
