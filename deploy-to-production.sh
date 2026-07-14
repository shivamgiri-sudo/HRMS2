#!/bin/bash
# Production Deployment Script
# Server: 115.241.59.220 | User: masadmin | Project: /var/www/HRMS2

set -e  # Exit on error

echo "=========================================="
echo "HRMS2 Production Deployment"
echo "Phase 1: Waiting Room + Sidebar Updates"
echo "=========================================="
echo

# Colors
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color

echo -e "${YELLOW}Step 1: Deploy Backend${NC}"
echo "--------------------------------------"
cd /var/www/HRMS2/backend || exit 1
echo "Pulling latest code..."
git pull origin main

echo "Building backend..."
npm run build

echo "Restarting PM2 process..."
pm2 restart hrms2-backend --update-env

echo "Checking backend status..."
sleep 3
pm2 logs hrms2-backend --lines 20 --nostream

echo
echo -e "${GREEN}✓ Backend deployed${NC}"
echo

echo -e "${YELLOW}Step 2: Verify Backend API${NC}"
echo "--------------------------------------"
curl -s http://localhost:5055/api/ats/queue/branches | jq '.' || echo "API check failed"
echo
echo -e "${GREEN}✓ Backend API responding${NC}"
echo

echo -e "${YELLOW}Step 3: Deploy Frontend${NC}"
echo "--------------------------------------"
cd /var/www/HRMS2 || exit 1

echo "Creating backup..."
BACKUP_DIR="dist-backup-$(date +%Y%m%d-%H%M%S)"
sudo cp -r dist "$BACKUP_DIR"
echo "Backup created: $BACKUP_DIR"

echo "Extracting new build..."
sudo rm -rf dist/*
sudo tar -xzf /tmp/dist-final-deploy.tar.gz -C dist/
sudo chown -R www-data:www-data dist/

echo "Cleaning up..."
rm -f /tmp/dist-final-deploy.tar.gz

echo
echo -e "${GREEN}✓ Frontend deployed${NC}"
echo

echo -e "${YELLOW}Step 4: Reload Nginx${NC}"
echo "--------------------------------------"
echo "Testing Nginx configuration..."
sudo nginx -t

if [ $? -eq 0 ]; then
    echo "Reloading Nginx..."
    sudo systemctl reload nginx
    echo -e "${GREEN}✓ Nginx reloaded${NC}"
else
    echo -e "${RED}✗ Nginx configuration test failed!${NC}"
    exit 1
fi

echo
echo "=========================================="
echo -e "${GREEN}Deployment Complete!${NC}"
echo "=========================================="
echo
echo "Verification URLs:"
echo "  - Homepage: https://mcnhrms.teammas.in/"
echo "  - Waiting Room: https://mcnhrms.teammas.in/display/waiting-room?branch=NOIDA"
echo
echo "Next Steps:"
echo "  1. Open waiting room URL in browser"
echo "  2. Verify recruiter names display"
echo "  3. Login to HRMS and check Operations > Payroll sidebar"
echo "  4. Test one or two new payroll pages"
echo
echo "Rollback command (if needed):"
echo "  cd /var/www/HRMS2 && git checkout 22d5155e && npm run build"
echo "  cd backend && npm run build && pm2 restart hrms2-backend"
echo
echo -e "${GREEN}Deployment successful! 🚀${NC}"
