#!/bin/bash

# Test Overtime API Endpoint
# This script tests the overtime update functionality

echo "🧪 Testing Payroll Overtime API"
echo "================================"
echo ""

# Colors
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Configuration
API_BASE="http://localhost:5055/api"
TEST_USER_EMAIL="admin@shivu.ai"
TEST_USER_PASSWORD="admin123"

echo "📋 Step 1: Login to get JWT token"
echo "-----------------------------------"

LOGIN_RESPONSE=$(curl -s -X POST "${API_BASE}/auth/login" \
  -H "Content-Type: application/json" \
  -d "{\"email\":\"${TEST_USER_EMAIL}\",\"password\":\"${TEST_USER_PASSWORD}\"}")

TOKEN=$(echo $LOGIN_RESPONSE | grep -o '"token":"[^"]*' | cut -d'"' -f4)

if [ -z "$TOKEN" ]; then
  echo -e "${RED}❌ Login failed!${NC}"
  echo "Response: $LOGIN_RESPONSE"
  exit 1
fi

echo -e "${GREEN}✅ Login successful${NC}"
echo "Token: ${TOKEN:0:20}..."
echo ""

echo "📋 Step 2: Get payroll runs"
echo "-----------------------------------"

RUNS_RESPONSE=$(curl -s -X GET "${API_BASE}/payroll/runs?runMonth=2026-06" \
  -H "Authorization: Bearer ${TOKEN}")

echo "Runs response:"
echo "$RUNS_RESPONSE" | head -20
echo ""

# Extract first run ID if exists
RUN_ID=$(echo $RUNS_RESPONSE | grep -o '"id":"[^"]*' | head -1 | cut -d'"' -f4)

if [ -z "$RUN_ID" ]; then
  echo -e "${YELLOW}⚠️  No payroll runs found for June 2026${NC}"
  echo -e "${YELLOW}💡 You need to create a payroll run first${NC}"
  exit 0
fi

echo -e "${GREEN}✅ Found run ID: ${RUN_ID}${NC}"
echo ""

echo "📋 Step 3: Get payroll lines"
echo "-----------------------------------"

LINES_RESPONSE=$(curl -s -X GET "${API_BASE}/payroll/runs/${RUN_ID}/lines" \
  -H "Authorization: Bearer ${TOKEN}")

echo "Lines response (first 500 chars):"
echo "$LINES_RESPONSE" | head -c 500
echo ""
echo ""

# Extract first line ID
LINE_ID=$(echo $LINES_RESPONSE | grep -o '"id":"[^"]*' | head -1 | cut -d'"' -f4)

if [ -z "$LINE_ID" ]; then
  echo -e "${RED}❌ No payroll lines found${NC}"
  exit 1
fi

echo -e "${GREEN}✅ Found line ID: ${LINE_ID}${NC}"
echo ""

echo "📋 Step 4: Test overtime update"
echo "-----------------------------------"

OVERTIME_RESPONSE=$(curl -s -X PATCH "${API_BASE}/payroll/lines/${LINE_ID}/overtime" \
  -H "Authorization: Bearer ${TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{"overtimeHours": 10, "overtimeAmount": 2500}')

echo "Overtime update response:"
echo "$OVERTIME_RESPONSE"
echo ""

# Check if successful
if echo "$OVERTIME_RESPONSE" | grep -q '"success":true'; then
  echo -e "${GREEN}✅ Overtime update successful!${NC}"
  echo ""
  echo "Updated values:"
  echo "$OVERTIME_RESPONSE" | grep -o '"overtime_hours":[0-9.]*'
  echo "$OVERTIME_RESPONSE" | grep -o '"overtime_amount":[0-9.]*'
else
  echo -e "${RED}❌ Overtime update failed!${NC}"
  echo ""
  echo "Error details:"
  echo "$OVERTIME_RESPONSE" | grep -o '"message":"[^"]*' || echo "Unknown error"
fi

echo ""
echo "🎉 Test complete!"
echo ""
echo "To test the UI:"
echo "1. Start frontend: npm run dev"
echo "2. Navigate to: http://localhost:8081/payroll/overtime"
echo "3. Login with: ${TEST_USER_EMAIL} / ${TEST_USER_PASSWORD}"
