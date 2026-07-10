# Phase 1 AI Deployment to Production Server
# PowerShell Script for Windows
# Target: 192.168.11.225 (masadmin / Support#123)

$ErrorActionPreference = "Stop"

$SERVER = "masadmin@192.168.11.225"
$SERVER_BACKEND = "/home/masadmin/HRMS2/backend"
$SERVER_FRONTEND = "/home/masadmin/HRMS2"
$LOCAL_PATH = "C:\Users\ADMIN\Desktop\HRMS2-latest"

Write-Host "=====================================" -ForegroundColor Cyan
Write-Host "Phase 1 AI Deployment - PeopleOS" -ForegroundColor Cyan
Write-Host "=====================================" -ForegroundColor Cyan
Write-Host ""

# Step 1: Upload Backend AI Module
Write-Host "[1/6] Uploading backend AI module..." -ForegroundColor Yellow
scp -r "$LOCAL_PATH\backend\src\modules\ai" "${SERVER}:${SERVER_BACKEND}/src/modules/"

# Step 2: Upload SQL Migration
Write-Host "[2/6] Uploading SQL migration..." -ForegroundColor Yellow
scp "$LOCAL_PATH\backend\sql\500_ai_provider_foundation.sql" "${SERVER}:${SERVER_BACKEND}/sql/"

# Step 3: Upload Updated package.json
Write-Host "[3/6] Uploading package.json..." -ForegroundColor Yellow
scp "$LOCAL_PATH\backend\package.json" "${SERVER}:${SERVER_BACKEND}/"

# Step 4: Install Dependencies and Build Backend
Write-Host "[4/6] Installing dependencies and building backend..." -ForegroundColor Yellow
ssh $SERVER @"
cd $SERVER_BACKEND
npm install @google/generative-ai
npm run build
"@

# Step 5: Upload Frontend Files
Write-Host "[5/6] Uploading frontend files..." -ForegroundColor Yellow
scp "$LOCAL_PATH\src\pages\AIProviderSettings.tsx" "${SERVER}:${SERVER_FRONTEND}/src/pages/"
scp "$LOCAL_PATH\src\pages\PeopleOSCopilot.tsx" "${SERVER}:${SERVER_FRONTEND}/src/pages/"
scp "$LOCAL_PATH\src\App.tsx" "${SERVER}:${SERVER_FRONTEND}/src/"

# Step 6: Restart Backend
Write-Host "[6/6] Restarting backend..." -ForegroundColor Yellow
ssh $SERVER "cd $SERVER_BACKEND && pm2 restart mcn-hrms-backend"

Write-Host ""
Write-Host "=====================================" -ForegroundColor Green
Write-Host "✅ Deployment Complete!" -ForegroundColor Green
Write-Host "=====================================" -ForegroundColor Green
Write-Host ""
Write-Host "Next Steps:" -ForegroundColor Cyan
Write-Host "1. Add environment variables to backend/.env on server"
Write-Host "2. Build frontend on server: ssh $SERVER 'cd $SERVER_FRONTEND && npm run build'"
Write-Host "3. Test: Navigate to /settings/ai-providers and /peopleos/copilot"
Write-Host ""
Write-Host "Environment variables to add:" -ForegroundColor Yellow
Write-Host @"
GEMINI_API_KEY=your-gemini-api-key-here
GEMINI_DEFAULT_MODEL=gemini-flash
AI_ENCRYPTION_KEY=peopleos-ai-production-key-32-chars
AI_ENABLE_EXTERNAL_PROVIDERS=true
"@
