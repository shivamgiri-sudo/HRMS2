#!/bin/bash
# Phase 1 AI Deployment Script
# Target Server: 192.168.11.225 (masadmin)
# Date: 2026-07-10

set -e

echo "====================================="
echo "Phase 1 AI Deployment - PeopleOS"
echo "====================================="

# Server configuration
SERVER_USER="masadmin"
SERVER_HOST="192.168.11.225"
SERVER_BACKEND_PATH="/home/masadmin/HRMS2/backend"
SERVER_FRONTEND_PATH="/home/masadmin/HRMS2"

echo ""
echo "[1/8] Testing SSH connection..."
ssh -o BatchMode=yes -o ConnectTimeout=5 ${SERVER_USER}@${SERVER_HOST} "echo 'SSH connection successful'" || {
    echo "ERROR: Cannot connect to server. Check SSH access."
    exit 1
}

echo ""
echo "[2/8] Backing up current backend..."
ssh ${SERVER_USER}@${SERVER_HOST} "cd ${SERVER_BACKEND_PATH} && tar -czf backup-backend-$(date +%Y%m%d-%H%M%S).tar.gz src/ sql/ package.json"

echo ""
echo "[3/8] Uploading backend AI module..."
scp -r backend/src/modules/ai ${SERVER_USER}@${SERVER_HOST}:${SERVER_BACKEND_PATH}/src/modules/

echo ""
echo "[4/8] Uploading SQL migration..."
scp backend/sql/500_ai_provider_foundation.sql ${SERVER_USER}@${SERVER_HOST}:${SERVER_BACKEND_PATH}/sql/

echo ""
echo "[5/8] Updating package.json and installing dependencies..."
scp backend/package.json ${SERVER_USER}@${SERVER_HOST}:${SERVER_BACKEND_PATH}/
ssh ${SERVER_USER}@${SERVER_HOST} "cd ${SERVER_BACKEND_PATH} && npm install @google/generative-ai"

echo ""
echo "[6/8] Adding AI environment variables..."
ssh ${SERVER_USER}@${SERVER_HOST} "cd ${SERVER_BACKEND_PATH} && cat >> .env << 'EOF'

# AI Provider Configuration (Phase 1)
GEMINI_API_KEY=your-gemini-api-key-here
GEMINI_DEFAULT_MODEL=gemini-flash
GEMINI_BASE_URL=https://generativelanguage.googleapis.com
AI_ENCRYPTION_KEY=peopleos-ai-production-encryption-key-secure-random-32-chars
AI_ENABLE_EXTERNAL_PROVIDERS=true
AI_DEFAULT_PROVIDER=rule-based
AI_MAX_TOKENS_PER_REQUEST=2000
EOF
"

echo ""
echo "[7/8] Building and restarting backend..."
ssh ${SERVER_USER}@${SERVER_HOST} "cd ${SERVER_BACKEND_PATH} && npm run build && pm2 restart mcn-hrms-backend"

echo ""
echo "[8/8] Uploading frontend pages..."
scp src/pages/AIProviderSettings.tsx ${SERVER_USER}@${SERVER_HOST}:${SERVER_FRONTEND_PATH}/src/pages/
scp src/pages/PeopleOSCopilot.tsx ${SERVER_USER}@${SERVER_HOST}:${SERVER_FRONTEND_PATH}/src/pages/
scp src/App.tsx ${SERVER_USER}@${SERVER_HOST}:${SERVER_FRONTEND_PATH}/src/

echo ""
echo "====================================="
echo "✅ Phase 1 AI Deployment Complete!"
echo "====================================="
echo ""
echo "Next Steps:"
echo "1. SSH to server: ssh ${SERVER_USER}@${SERVER_HOST}"
echo "2. Build frontend: cd ${SERVER_FRONTEND_PATH} && npm run build"
echo "3. Verify migration: Check backend logs for 'Migration 500: AI Provider Foundation - Complete'"
echo "4. Test endpoints:"
echo "   - curl http://localhost:5055/api/ai/providers/active"
echo "   - Navigate to https://your-domain.com/settings/ai-providers (super admin)"
echo "   - Navigate to https://your-domain.com/peopleos/copilot (all users)"
echo ""
echo "Deployment log saved to: deployment-$(date +%Y%m%d-%H%M%S).log"
