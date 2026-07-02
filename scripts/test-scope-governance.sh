#!/bin/bash

# Phase 10: Scope Governance Testing Script
# Tests 22 scenarios across 7 modules

set -e

API_BASE="http://localhost:3002/api"
RESULTS_FILE="test-results.md"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Counters
PASS=0
FAIL=0
TOTAL=22

echo "================================================"
echo "Phase 10: Scope Governance Testing"
echo "================================================"
echo ""

# Function to test API endpoint
test_api() {
  local test_num=$1
  local description=$2
  local method=$3
  local endpoint=$4
  local token=$5
  local body=$6
  local expected_status=$7

  echo -n "Test $test_num: $description... "

  if [ -z "$body" ]; then
    response=$(curl -s -w "\n%{http_code}" -X "$method" \
      "$API_BASE$endpoint" \
      -H "Authorization: Bearer $token" \
      -H "Content-Type: application/json")
  else
    response=$(curl -s -w "\n%{http_code}" -X "$method" \
      "$API_BASE$endpoint" \
      -H "Authorization: Bearer $token" \
      -H "Content-Type: application/json" \
      -d "$body")
  fi

  status_code=$(echo "$response" | tail -n1)

  if [ "$status_code" -eq "$expected_status" ]; then
    echo -e "${GREEN}✅ PASS${NC} (Got $status_code)"
    ((PASS++))
    echo "| $test_num | $description | $expected_status | $status_code | ✅ |" >> "$RESULTS_FILE"
  else
    echo -e "${RED}❌ FAIL${NC} (Expected $expected_status, Got $status_code)"
    ((FAIL++))
    echo "| $test_num | $description | $expected_status | $status_code | ❌ |" >> "$RESULTS_FILE"
  fi
}

# Initialize results file
cat > "$RESULTS_FILE" << 'EOF'
# Phase 10: Scope Governance Test Results

**Date**: $(date)
**Total Tests**: 22

## Test Results

| Test | Scenario | Expected | Actual | Status |
|------|----------|----------|--------|--------|
EOF

# Get auth tokens (user needs to login first)
echo "Please set environment variables for auth tokens:"
echo "  export HR_PUNE_TOKEN='...'"
echo "  export MANAGER_TOKEN='...'"
echo "  export RECRUITER_NOIDA_TOKEN='...'"
echo "  export FINANCE_AHMEDABAD_TOKEN='...'"
echo "  export WFM_PUNE_TOKEN='...'"
echo "  export CEO_TOKEN='...'"
echo "  export ADMIN_TOKEN='...'"
echo ""

# Check if tokens are set
if [ -z "$HR_PUNE_TOKEN" ]; then
  echo -e "${RED}ERROR: HR_PUNE_TOKEN not set${NC}"
  echo "Run: export HR_PUNE_TOKEN='<token>'"
  exit 1
fi

echo "Starting tests..."
echo ""

# ===== HR SCOPE TESTS (5) =====
echo -e "${YELLOW}=== HR Scope Tests ===${NC}"

# Test 1: HR creates employee in Pune (✅)
test_api 1 \
  "HR creates employee in Pune" \
  "POST" \
  "/employees" \
  "$HR_PUNE_TOKEN" \
  '{"branch_id":"pune","first_name":"Test","last_name":"User","email":"test1@example.com","mobile":"+919999999991","date_of_joining":"2026-06-04"}' \
  201

# Test 2: HR creates employee in Mumbai (❌)
test_api 2 \
  "HR creates employee in Mumbai" \
  "POST" \
  "/employees" \
  "$HR_PUNE_TOKEN" \
  '{"branch_id":"mumbai","first_name":"Test","last_name":"User","email":"test2@example.com","mobile":"+919999999992","date_of_joining":"2026-06-04"}' \
  403

# Test 3: HR views employee list (✅)
test_api 3 \
  "HR views employee list" \
  "GET" \
  "/employees" \
  "$HR_PUNE_TOKEN" \
  "" \
  200

# Test 4: HR updates Pune employee (✅)
# NOTE: Replace {pune_employee_id} with actual ID
test_api 4 \
  "HR updates Pune employee" \
  "PATCH" \
  "/employees/{pune_employee_id}" \
  "$HR_PUNE_TOKEN" \
  '{"first_name":"Updated"}' \
  200

# Test 5: HR updates Mumbai employee (❌)
# NOTE: Replace {mumbai_employee_id} with actual ID
test_api 5 \
  "HR updates Mumbai employee" \
  "PATCH" \
  "/employees/{mumbai_employee_id}" \
  "$HR_PUNE_TOKEN" \
  '{"first_name":"Updated"}' \
  403

# ===== MANAGER SCOPE TESTS (4) =====
echo ""
echo -e "${YELLOW}=== Manager Scope Tests ===${NC}"

# Test 6: Manager views employee list (✅)
test_api 6 \
  "Manager views employee list" \
  "GET" \
  "/employees" \
  "$MANAGER_TOKEN" \
  "" \
  200

# Test 7: Manager assigns KPI to team member (✅)
# NOTE: Replace IDs with actual values
test_api 7 \
  "Manager assigns KPI to team member" \
  "POST" \
  "/kpi/assignments" \
  "$MANAGER_TOKEN" \
  '{"employee_id":"{team_member_id}","template_id":"{template_id}"}' \
  201

# Test 8: Manager assigns KPI to non-team member (❌)
test_api 8 \
  "Manager assigns KPI to non-team member" \
  "POST" \
  "/kpi/assignments" \
  "$MANAGER_TOKEN" \
  '{"employee_id":"{other_employee_id}","template_id":"{template_id}"}' \
  403

# Test 9: Manager views all employees (scoped) (✅)
test_api 9 \
  "Manager views all employees" \
  "GET" \
  "/employees" \
  "$MANAGER_TOKEN" \
  "" \
  200

# ===== RECRUITER SCOPE TESTS (3) =====
echo ""
echo -e "${YELLOW}=== Recruiter Scope Tests ===${NC}"

# Test 10: Recruiter views candidates (✅)
test_api 10 \
  "Recruiter views candidates" \
  "GET" \
  "/ats/candidates" \
  "$RECRUITER_NOIDA_TOKEN" \
  "" \
  200

# Test 11: Recruiter moves Noida candidate (✅)
# NOTE: Replace {noida_candidate_id} with actual ID
test_api 11 \
  "Recruiter moves Noida candidate" \
  "POST" \
  "/ats/candidates/{noida_candidate_id}/move-stage" \
  "$RECRUITER_NOIDA_TOKEN" \
  '{"new_stage":"Interview"}' \
  200

# Test 12: Recruiter moves Mumbai candidate (❌)
# NOTE: Replace {mumbai_candidate_id} with actual ID
test_api 12 \
  "Recruiter moves Mumbai candidate" \
  "POST" \
  "/ats/candidates/{mumbai_candidate_id}/move-stage" \
  "$RECRUITER_NOIDA_TOKEN" \
  '{"new_stage":"Interview"}' \
  403

# ===== FINANCE/PAYROLL SCOPE TESTS (3) =====
echo ""
echo -e "${YELLOW}=== Finance/Payroll Scope Tests ===${NC}"

# Test 13: Finance creates run for Ahmedabad (✅)
test_api 13 \
  "Finance creates run for Ahmedabad" \
  "POST" \
  "/payroll/runs" \
  "$FINANCE_AHMEDABAD_TOKEN" \
  '{"branch_id":"ahmedabad","month_year":"2026-06","description":"Test run"}' \
  201

# Test 14: Finance creates run for Delhi (❌)
test_api 14 \
  "Finance creates run for Delhi" \
  "POST" \
  "/payroll/runs" \
  "$FINANCE_AHMEDABAD_TOKEN" \
  '{"branch_id":"delhi","month_year":"2026-06","description":"Test run"}' \
  403

# Test 15: Finance assigns salary (✅)
# NOTE: Replace {ahmedabad_employee_id} with actual ID
test_api 15 \
  "Finance assigns salary" \
  "POST" \
  "/payroll/salary-assignments" \
  "$FINANCE_AHMEDABAD_TOKEN" \
  '{"employee_id":"{ahmedabad_employee_id}","structure_id":"{structure_id}","effective_from":"2026-06-01"}' \
  201

# ===== WFM/ROSTER SCOPE TESTS (4) =====
echo ""
echo -e "${YELLOW}=== WFM/Roster Scope Tests ===${NC}"

# Test 16: WFM creates plan for Pune (✅)
test_api 16 \
  "WFM creates plan for Pune" \
  "POST" \
  "/wfm/roster/plans" \
  "$WFM_PUNE_TOKEN" \
  '{"branch_id":"pune","process_id":"process_1","start_date":"2026-06-10","end_date":"2026-06-16"}' \
  201

# Test 17: WFM creates plan for Noida (❌)
test_api 17 \
  "WFM creates plan for Noida" \
  "POST" \
  "/wfm/roster/plans" \
  "$WFM_PUNE_TOKEN" \
  '{"branch_id":"noida","process_id":"process_2","start_date":"2026-06-10","end_date":"2026-06-16"}' \
  403

# Test 18: WFM submits draft (✅)
test_api 18 \
  "WFM submits draft" \
  "POST" \
  "/wfm/auto-roster/plans" \
  "$WFM_PUNE_TOKEN" \
  '{"branch_id":"pune","process_id":"process_1","start_date":"2026-06-10","end_date":"2026-06-16"}' \
  201

# Test 19: WFM publishes plan (❌)
# NOTE: Replace {plan_id} with actual ID
test_api 19 \
  "WFM publishes plan" \
  "PATCH" \
  "/wfm/roster/plans/{plan_id}/publish" \
  "$WFM_PUNE_TOKEN" \
  '{}' \
  403

# ===== CEO/ADMIN TESTS (3) =====
echo ""
echo -e "${YELLOW}=== CEO/Admin Tests ===${NC}"

# Test 20: CEO views all employees (✅)
test_api 20 \
  "CEO views all employees" \
  "GET" \
  "/employees" \
  "$CEO_TOKEN" \
  "" \
  200

# Test 21: CEO updates employee (❌ or ✅ depending on implementation)
# NOTE: Replace {employee_id} with actual ID
test_api 21 \
  "CEO updates employee" \
  "PATCH" \
  "/employees/{employee_id}" \
  "$CEO_TOKEN" \
  '{"first_name":"Updated"}' \
  403

# Test 22: Admin overrides scope (✅)
test_api 22 \
  "Admin overrides scope" \
  "POST" \
  "/employees" \
  "$ADMIN_TOKEN" \
  '{"branch_id":"any_branch","first_name":"Admin","last_name":"Test","email":"admintest@example.com","mobile":"+919999999999","date_of_joining":"2026-06-04"}' \
  201

# ===== SUMMARY =====
echo ""
echo "================================================"
echo "Test Summary"
echo "================================================"
echo -e "Total Tests: $TOTAL"
echo -e "${GREEN}Passed: $PASS${NC}"
echo -e "${RED}Failed: $FAIL${NC}"
echo ""

if [ $FAIL -eq 0 ]; then
  echo -e "${GREEN}✅ ALL TESTS PASSED!${NC}"
  exit 0
else
  echo -e "${RED}❌ SOME TESTS FAILED${NC}"
  echo "Check $RESULTS_FILE for details"
  exit 1
fi
