#!/bin/bash
# Test script for attendance fixes
# Run after backend is started: npm run dev

set -e

API_BASE="http://localhost:5100/api"
TOKEN="${ADMIN_TOKEN:-}"

echo "=========================================="
echo "Attendance Fixes - API Endpoint Tests"
echo "=========================================="
echo ""

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

if [ -z "$TOKEN" ]; then
  echo -e "${YELLOW}⚠ Warning: ADMIN_TOKEN not set. Tests will fail without authentication.${NC}"
  echo "Set it with: export ADMIN_TOKEN='your-jwt-token'"
  echo ""
fi

# Test 1: Manual Engine Trigger
echo "Test 1: Manual Engine Trigger Endpoint"
echo "---------------------------------------"
DATE=$(date -d "1 day ago" +%Y-%m-%d 2>/dev/null || date -v-1d +%Y-%m-%d 2>/dev/null || echo "2025-07-24")
echo "Testing: POST /wfm/attendance/engine/trigger-batch"
echo "Date: $DATE"
echo ""

RESPONSE=$(curl -s -X POST "$API_BASE/wfm/attendance/engine/trigger-batch" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d "{\"date\": \"$DATE\"}" 2>&1)

if echo "$RESPONSE" | grep -q "success"; then
  echo -e "${GREEN}✓ Engine trigger endpoint working${NC}"
  echo "$RESPONSE" | head -5
else
  echo -e "${RED}✗ Engine trigger failed${NC}"
  echo "$RESPONSE"
fi
echo ""

# Test 2: Unlock Endpoint (needs actual employee ID and date)
echo "Test 2: Unlock Endpoint Structure Test"
echo "---------------------------------------"
echo "Testing: POST /wfm/attendance/:employeeId/:date/unlock"
echo "Note: This is a structure test with dummy IDs"
echo ""

DUMMY_EMP_ID="00000000-0000-0000-0000-000000000000"
DUMMY_DATE="2025-07-24"

RESPONSE=$(curl -s -X POST "$API_BASE/wfm/attendance/$DUMMY_EMP_ID/$DUMMY_DATE/unlock" \
  -H "Authorization: Bearer $TOKEN" 2>&1)

if echo "$RESPONSE" | grep -q "not found\|Forbidden\|success"; then
  echo -e "${GREEN}✓ Unlock endpoint responding (expected 404 for dummy ID)${NC}"
  echo "$RESPONSE" | head -3
else
  echo -e "${YELLOW}⚠ Unlock endpoint response: $RESPONSE${NC}"
fi
echo ""

# Test 3: Check backend routes are registered
echo "Test 3: Backend Routes Registration"
echo "------------------------------------"
echo "Checking if new endpoints are accessible..."
echo ""

# Test engine trigger without auth (should get 401/403)
RESPONSE=$(curl -s -o /dev/null -w "%{http_code}" -X POST "$API_BASE/wfm/attendance/engine/trigger-batch")
if [ "$RESPONSE" = "401" ] || [ "$RESPONSE" = "403" ]; then
  echo -e "${GREEN}✓ Engine trigger route registered (auth required)${NC}"
else
  echo -e "${YELLOW}⚠ Unexpected status code: $RESPONSE${NC}"
fi

# Test unlock without auth (should get 401/403)
RESPONSE=$(curl -s -o /dev/null -w "%{http_code}" -X POST "$API_BASE/wfm/attendance/dummy/2025-07-24/unlock")
if [ "$RESPONSE" = "401" ] || [ "$RESPONSE" = "403" ]; then
  echo -e "${GREEN}✓ Unlock route registered (auth required)${NC}"
else
  echo -e "${YELLOW}⚠ Unexpected status code: $RESPONSE${NC}"
fi

echo ""
echo "=========================================="
echo "Test Summary"
echo "=========================================="
echo ""
echo "All endpoint structure tests completed."
echo ""
echo "To run with actual data:"
echo "1. Start backend: cd backend && npm run dev"
echo "2. Login as admin and get JWT token"
echo "3. Set token: export ADMIN_TOKEN='your-jwt-token'"
echo "4. Re-run this script"
echo ""
echo "To test with real employee data:"
echo "- Replace DUMMY_EMP_ID with actual employee.id from database"
echo "- Replace DUMMY_DATE with actual attendance record date"
echo ""
