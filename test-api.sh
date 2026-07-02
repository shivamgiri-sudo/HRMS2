#!/bin/bash

# MAS-CallNet HRMS: Comprehensive API Testing Script
# Date: 2026-06-01
# Purpose: Test all endpoints with MySQL-only (no Supabase)

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Config
BACKEND_URL="http://localhost:5055"
PASS=0
FAIL=0
TOTAL=0

# Demo tokens (from backend authMiddleware.ts)
ADMIN_TOKEN="mock-token-admin"
HR_TOKEN="mock-token-hr"
MANAGER_TOKEN="mock-token-process_manager"
EMPLOYEE_TOKEN="mock-token-employee"

echo "========================================="
echo "MAS-CallNet HRMS API Test Suite"
echo "========================================="
echo ""

# Check backend running
echo "Checking backend..."
if ! curl -s "$BACKEND_URL" > /dev/null; then
    echo -e "${RED}✗ Backend not running on $BACKEND_URL${NC}"
    echo "Start backend: cd backend && npm run dev"
    exit 1
fi
echo -e "${GREEN}✓ Backend running${NC}"
echo ""

# Helper function
test_endpoint() {
    local name=$1
    local method=$2
    local endpoint=$3
    local token=$4
    local expected_status=$5
    local data=$6

    TOTAL=$((TOTAL + 1))

    if [ "$method" == "POST" ] || [ "$method" == "PATCH" ] || [ "$method" == "PUT" ]; then
        response=$(curl -s -w "\n%{http_code}" -X "$method" \
            -H "Authorization: Bearer $token" \
            -H "Content-Type: application/json" \
            -d "$data" \
            "$BACKEND_URL$endpoint")
    else
        response=$(curl -s -w "\n%{http_code}" \
            -H "Authorization: Bearer $token" \
            "$BACKEND_URL$endpoint")
    fi

    status=$(echo "$response" | tail -1)
    body=$(echo "$response" | sed '$d')

    if [ "$status" == "$expected_status" ]; then
        echo -e "${GREEN}✓ $name${NC} (HTTP $status)"
        PASS=$((PASS + 1))
        return 0
    else
        echo -e "${RED}✗ $name${NC} (Expected $expected_status, got $status)"
        echo "   Response: $body"
        FAIL=$((FAIL + 1))
        return 1
    fi
}

# ==========================================
# P0 TESTS: AUTHENTICATION
# ==========================================
echo "========================================="
echo "P0: AUTHENTICATION TESTS"
echo "========================================="

test_endpoint "TC-AUTH-001: Protected route without token" "GET" "/api/employees" "" "401"
test_endpoint "TC-AUTH-002: Protected route with admin token" "GET" "/api/employees" "$ADMIN_TOKEN" "200"
test_endpoint "TC-AUTH-003: Account control endpoint (admin)" "GET" "/api/account-control/audit-log/test-user" "$ADMIN_TOKEN" "200"

echo ""

# ==========================================
# P0 TESTS: EMPLOYEE MANAGEMENT
# ==========================================
echo "========================================="
echo "P0: EMPLOYEE MANAGEMENT TESTS"
echo "========================================="

test_endpoint "TC-EMP-001: Get all employees (Admin)" "GET" "/api/employees" "$ADMIN_TOKEN" "200"
test_endpoint "TC-EMP-002: Get all employees (HR)" "GET" "/api/employees" "$HR_TOKEN" "200"
test_endpoint "TC-EMP-003: Get employees (Manager)" "GET" "/api/employees" "$MANAGER_TOKEN" "200"
test_endpoint "TC-EMP-004: Get employees (Employee - should fail)" "GET" "/api/employees" "$EMPLOYEE_TOKEN" "403"

# Create test employee
TEST_EMPLOYEE_DATA='{
  "full_name": "Test User API",
  "email": "testapi@test.com",
  "phone": "9999999999",
  "date_of_joining": "2026-06-01",
  "employment_type": "full_time",
  "status": "active"
}'

test_endpoint "TC-EMP-005: Create employee (Admin)" "POST" "/api/employees" "$ADMIN_TOKEN" "201" "$TEST_EMPLOYEE_DATA"

echo ""

# ==========================================
# P0 TESTS: ATTENDANCE
# ==========================================
echo "========================================="
echo "P0: ATTENDANCE TESTS"
echo "========================================="

test_endpoint "TC-ATT-001: Clock-in (Employee)" "POST" "/api/wfm/sessions/clock-in" "$EMPLOYEE_TOKEN" "200" '{}'
test_endpoint "TC-ATT-002: Get attendance sessions (Employee)" "GET" "/api/wfm/sessions" "$EMPLOYEE_TOKEN" "200"
test_endpoint "TC-ATT-003: Start break (Employee)" "POST" "/api/wfm/sessions/break" "$EMPLOYEE_TOKEN" "200" '{"type":"lunch"}'
test_endpoint "TC-ATT-004: Get sessions (Manager - team only)" "GET" "/api/wfm/sessions" "$MANAGER_TOKEN" "200"

# Regularization
REG_DATA='{
  "session_date": "2026-06-01",
  "reason": "Forgot to clock in",
  "proof_url": ""
}'
test_endpoint "TC-ATT-005: Submit regularization (Employee)" "POST" "/api/wfm/regularizations" "$EMPLOYEE_TOKEN" "201" "$REG_DATA"

echo ""

# ==========================================
# P0 TESTS: PAYROLL
# ==========================================
echo "========================================="
echo "P0: PAYROLL TESTS"
echo "========================================="

test_endpoint "TC-PAY-001: Get payroll runs (HR)" "GET" "/api/payroll/runs" "$HR_TOKEN" "200"
test_endpoint "TC-PAY-002: Get salary structures (HR)" "GET" "/api/payroll/structures" "$HR_TOKEN" "200"
test_endpoint "TC-PAY-003: Get salary components (Admin)" "GET" "/api/payroll/components" "$ADMIN_TOKEN" "200"
test_endpoint "TC-PAY-004: Get payroll runs (Employee - should fail)" "GET" "/api/payroll/runs" "$EMPLOYEE_TOKEN" "403"

echo ""

# ==========================================
# P1 TESTS: ATS
# ==========================================
echo "========================================="
echo "P1: ATS TESTS"
echo "========================================="

test_endpoint "TC-ATS-001: Get candidates (HR)" "GET" "/api/ats/candidates" "$HR_TOKEN" "200"

CANDIDATE_DATA='{
  "full_name": "Test Candidate",
  "email": "testcandidate@test.com",
  "phone": "8888888888",
  "position_applied": "Agent",
  "source": "walk_in"
}'
test_endpoint "TC-ATS-002: Create candidate (HR)" "POST" "/api/ats/candidates" "$HR_TOKEN" "201" "$CANDIDATE_DATA"

test_endpoint "TC-ATS-003: Get onboarding bridge (HR)" "GET" "/api/ats/onboarding-bridge" "$HR_TOKEN" "200"

echo ""

# ==========================================
# P1 TESTS: LEAVE
# ==========================================
echo "========================================="
echo "P1: LEAVE TESTS"
echo "========================================="

test_endpoint "TC-LEV-001: Get leave types" "GET" "/api/leave/types" "$EMPLOYEE_TOKEN" "200"
test_endpoint "TC-LEV-002: Get leave balance (Employee)" "GET" "/api/leave/balance" "$EMPLOYEE_TOKEN" "200"
test_endpoint "TC-LEV-003: Get leave requests (Employee)" "GET" "/api/leave/requests" "$EMPLOYEE_TOKEN" "200"

LEAVE_DATA='{
  "from_date": "2026-06-10",
  "to_date": "2026-06-12",
  "days_requested": 3,
  "reason": "Family vacation",
  "is_half_day": false
}'
test_endpoint "TC-LEV-004: Apply leave (Employee)" "POST" "/api/leave/requests" "$EMPLOYEE_TOKEN" "201" "$LEAVE_DATA"

echo ""

# ==========================================
# P2 TESTS: CLIENT PORTAL
# ==========================================
echo "========================================="
echo "P2: CLIENT PORTAL TESTS"
echo "========================================="

test_endpoint "TC-PORTAL-001: Portal health check" "GET" "/api/portal/health" "" "200"

OTP_DATA='{"email": "demo@mascallnet.com"}'
test_endpoint "TC-PORTAL-002: Request OTP" "POST" "/api/portal/auth/request-otp" "" "200" "$OTP_DATA"

echo ""

# ==========================================
# RBAC VALIDATION TESTS (CRITICAL)
# ==========================================
echo "========================================="
echo "RBAC VALIDATION TESTS (CRITICAL)"
echo "========================================="

test_endpoint "RBAC-001: Employee cannot access payroll runs" "GET" "/api/payroll/runs" "$EMPLOYEE_TOKEN" "403"
test_endpoint "RBAC-002: Employee cannot access all employees" "GET" "/api/employees" "$EMPLOYEE_TOKEN" "403"
test_endpoint "RBAC-003: Manager cannot access payroll" "GET" "/api/payroll/runs" "$MANAGER_TOKEN" "403"
test_endpoint "RBAC-004: Admin can access everything" "GET" "/api/org/branches" "$ADMIN_TOKEN" "200"

echo ""

# ==========================================
# SUMMARY
# ==========================================
echo "========================================="
echo "TEST SUMMARY"
echo "========================================="
echo -e "Total:  $TOTAL"
echo -e "${GREEN}Passed: $PASS${NC}"
echo -e "${RED}Failed: $FAIL${NC}"
echo ""

if [ $FAIL -eq 0 ]; then
    echo -e "${GREEN}✓ All tests passed!${NC}"
    exit 0
else
    echo -e "${RED}✗ Some tests failed${NC}"
    exit 1
fi
