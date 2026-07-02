# MAS-CallNet HRMS: Test Coverage Report

**Date**: 2026-06-02  
**Tested Modules**: 2/39 (5%)  
**Coverage**: Critical gaps across all major subsystems

---

## Current Test Coverage

### ✅ Modules with Tests (2)

| Module | Test Files | Tests | Status | Notes |
|--------|------------|-------|--------|-------|
| **customization** | 3 | 33 (18 pass, 15 skip) | 🟡 Partial | Unit + E2E pass, integration needs DB |
| **communication** | 2 | 16 (all pass) | ✅ Good | Unit tests only, integration needs DB |

**Total**: 49 tests (34 passing, 15 skipped)

---

## ❌ Modules Without Tests (37)

### Priority 1: Critical Business Logic (15 modules)

| Module | Risk | Reason |
|--------|------|--------|
| **payroll** | 🔴 Critical | Salary calculations, statutory compliance, money handling |
| **leave** | 🔴 Critical | Balance calculations, carry forward, encashment logic |
| **wfm** | 🔴 Critical | Attendance tracking, shift assignments, overtime |
| **ats** | 🔴 Critical | Candidate lifecycle, offer generation, conversion |
| **employees** | 🔴 Critical | Core CRUD, employee data integrity |
| **compliance** | 🔴 Critical | PF/ESI/PT/TDS calculations, statutory filing |
| **lifecycle** | 🟠 High | Onboarding, probation, confirmation workflows |
| **exit** | 🟠 High | F&F calculations, clearance workflows |
| **roster** | 🟠 High | Week-off logic, roster generation, governance |
| **org** | 🟠 High | Master data (branch, dept, designation, LOB) |
| **goals** | 🟠 High | KPI scoring, performance calculations |
| **benefits** | 🟠 High | Reimbursement calculations, claim approval |
| **assets** | 🟠 High | Asset assignment, depreciation, return tracking |
| **helpdesk** | 🟡 Medium | Ticket routing, SLA tracking |
| **integration-hub** | 🟡 Medium | Data sync, validation, connector logic |

### Priority 2: Extensions & Utilities (10 modules)

| Module | Risk | Notes |
|--------|------|-------|
| **ats-extensions** | 🟡 Medium | Offer management, pre-joining |
| **wfm-extensions** | 🟡 Medium | Regularization, break logs |
| **performance-feedback** | 🟡 Medium | 360 feedback, coaching |
| **management** | 🟡 Medium | Quality, TNI, alerts |
| **letters** | 🟡 Medium | Document generation, templates |
| **privacy** | 🟡 Medium | DPDP compliance, consent tracking |
| **career** | 🟡 Medium | Career path, succession planning |
| **mobility** | 🟡 Medium | Transfer requests, relocation |
| **kpi** | 🟡 Medium | KPI tracking, scorecard logic |
| **migration** | 🟡 Medium | Data migration utilities |

### Priority 3: Supporting Systems (12 modules)

| Module | Risk | Notes |
|--------|------|-------|
| **access** | 🟢 Low | RBAC, permission checks |
| **account-control** | 🟢 Low | User management |
| **engagement** | 🟢 Low | Surveys, pulse, kudos (0% implemented per plan) |
| **erp** | 🟢 Low | ERP integrations |
| **inbox** | 🟢 Low | Notification inbox |
| **jobs** | 🟢 Low | Job postings |
| **lms** | 🟢 Low | Learning management |
| **portal** | 🟢 Low | Client portal, KPI dashboards |
| **process** | 🟢 Low | Process master CRUD |
| **rta** | 🟢 Low | Real-time analytics |
| **workflow** | 🟢 Low | Workflow engine |
| **workforce-mandate** | 🟢 Low | Workforce planning |

---

## Test Type Breakdown

### Unit Tests
**Current**: 34 passing (communication: 16, customization: 18)  
**Needed**: ~500-800 tests across 37 modules

**Priority modules**:
- Payroll: salary calculations, component logic, statutory formulas
- Leave: balance calculations, carry forward, proration
- WFM: attendance rules, shift logic, overtime calculations
- ATS: candidate scoring, offer generation
- Compliance: PF/ESI/PT/TDS calculators

### Integration Tests
**Current**: 15 tests (all skipped due to DB access)  
**Needed**: ~200-400 tests

**Blocked by**: MySQL remote write access denied  
**Solution**: Mock DB or test environment setup

**Priority**:
- Payroll run end-to-end (prep → calc → approval → disbursal)
- Leave request workflow (apply → approval → balance update)
- Attendance session (clock-in → break → clock-out → regularization)
- ATS conversion (candidate → offer → onboarding → employee)
- Exit F&F (resignation → clearance → F&F → final settlement)

### E2E Tests
**Current**: 10 passing (customization scenarios)  
**Needed**: ~50-100 critical user flows

**Priority flows**:
1. Employee onboarding (ATS → offer → onboarding → employee creation)
2. Payroll cycle (attendance → leave → advances → run → payslip)
3. Leave management (apply → approve → balance update)
4. Performance review (goal set → KPI track → review → rating)
5. Exit process (resign → clearance → F&F → final settlement)

---

## Critical Test Gaps by Risk

### 🔴 Critical Gaps (Money/Compliance)

1. **Payroll Calculation Engine**
   - ❌ No tests for salary component calculations
   - ❌ No tests for PF/ESI/PT/TDS deductions
   - ❌ No tests for advance recovery
   - ❌ No tests for arrears/proration
   - ❌ No tests for F&F calculations
   - **Risk**: Wrong salary = legal issues + employee dissatisfaction

2. **Leave Balance Logic**
   - ❌ No tests for leave accrual
   - ❌ No tests for carry forward
   - ❌ No tests for encashment calculations
   - ❌ No tests for proration on mid-year joining
   - **Risk**: Incorrect balances = compliance issues

3. **Attendance Calculations**
   - ❌ No tests for present/absent/LWP days
   - ❌ No tests for overtime calculations
   - ❌ No tests for shift differential
   - ❌ No tests for grace period logic
   - **Risk**: Wrong attendance = payroll errors

4. **Statutory Compliance**
   - ❌ No tests for PF ECR generation
   - ❌ No tests for ESI challan calculations
   - ❌ No tests for PT slab application
   - ❌ No tests for TDS calculations (Old/New regime)
   - ❌ No tests for Form 16/24Q generation
   - **Risk**: Non-compliance = penalties + legal action

### 🟠 High Gaps (Business Logic)

5. **ATS Conversion Flow**
   - ❌ No tests for candidate → employee conversion
   - ❌ No tests for employee code generation
   - ❌ No tests for offer acceptance workflow
   - ❌ No tests for onboarding bridge data
   - **Risk**: Data inconsistency, duplicate employees

6. **Performance Calculations**
   - ❌ No tests for KPI scoring (achievement %)
   - ❌ No tests for rating calculations (S/A/B/C/D)
   - ❌ No tests for performance bell curve
   - **Risk**: Unfair appraisals, demotivation

7. **Roster Generation**
   - ❌ No tests for week-off assignment
   - ❌ No tests for shift rotation logic
   - ❌ No tests for support ratio enforcement
   - **Risk**: Operational failures, understaffing

### 🟡 Medium Gaps (Workflows)

8. **Approval Workflows**
   - ❌ No tests for multi-level approval chains
   - ❌ No tests for auto-escalation
   - ❌ No tests for delegation logic
   - **Risk**: Stuck workflows, approval bottlenecks

9. **Document Generation**
   - ❌ No tests for offer letter generation
   - ❌ No tests for appointment letter
   - ❌ No tests for experience certificate
   - **Risk**: Template errors, missing data

10. **Data Validation**
    - ❌ No tests for Aadhar/PAN validation
    - ❌ No tests for email/phone format validation
    - ❌ No tests for date range validations
    - **Risk**: Invalid data in production

---

## Recommended Test Strategy

### Phase 1: Critical Money Logic (Week 1-2)
**Priority**: 🔴 Critical modules (payroll, leave, wfm, compliance)

**Tasks**:
1. Payroll component calculations (10-15 tests)
2. Statutory deductions (PF/ESI/PT/TDS) (15-20 tests)
3. Leave balance calculations (8-10 tests)
4. Attendance present/absent/LWP logic (10-12 tests)
5. F&F calculations (8-10 tests)

**Total**: ~60-70 unit tests  
**Goal**: Cover all money-handling logic

### Phase 2: Core CRUD + Workflows (Week 3-4)
**Priority**: 🟠 High modules (employees, ats, lifecycle, exit)

**Tasks**:
1. Employee CRUD operations (5-8 tests)
2. ATS candidate lifecycle (10-15 tests)
3. Onboarding workflows (8-10 tests)
4. Exit workflows (8-10 tests)
5. Approval chain logic (5-8 tests)

**Total**: ~40-50 tests  
**Goal**: Core business flows tested

### Phase 3: Integration Tests (Week 5-6)
**Priority**: End-to-end critical paths

**Tasks**:
1. Setup test DB environment (separate schema)
2. Payroll run E2E (prep → calc → approve → disburse)
3. Leave request E2E (apply → approve → balance update)
4. Attendance E2E (clock-in → break → clock-out → regularization)
5. ATS E2E (candidate → offer → onboard → employee)

**Total**: ~20-30 integration tests  
**Blocker**: Need test DB credentials or mock setup

### Phase 4: Edge Cases + Validation (Week 7-8)
**Priority**: 🟡 Medium modules + edge cases

**Tasks**:
1. Date boundary tests (month-end, year-end)
2. Proration tests (mid-year joining/exit)
3. Negative scenarios (invalid data, insufficient balance)
4. Race conditions (concurrent approvals, double submit)
5. Performance tests (bulk operations, large datasets)

**Total**: ~30-40 tests  
**Goal**: Production-hardening

---

## Test Infrastructure Gaps

### Missing Setup
- [ ] Test database (separate from production)
- [ ] Test data seeding scripts
- [ ] Mock services (email, SMS, WhatsApp)
- [ ] Test fixtures (sample employees, templates)
- [ ] CI/CD test pipeline
- [ ] Code coverage reporting

### Current Blockers
1. **DB Access**: `shivam_user` has no write access from remote IP
   - **Solution**: Create test DB user or use local MySQL instance
2. **No Test Environment**: Tests hitting production DB
   - **Solution**: Separate `.env.test` with test DB credentials
3. **No Mocks**: Real email/SMS/WhatsApp providers called
   - **Solution**: Mock providers for testing

---

## Code Coverage Target

| Category | Current | Target | Priority |
|----------|---------|--------|----------|
| **Overall** | ~5% | 70% | - |
| **Critical Modules** | 0% | 90% | 🔴 High |
| **High Modules** | 0% | 75% | 🟠 Medium |
| **Low Modules** | 0% | 50% | 🟢 Low |

**Critical modules**: payroll, leave, wfm, compliance, statutory  
**High modules**: employees, ats, lifecycle, exit, roster, org  
**Low modules**: engagement, portal, workflow, lms, jobs

---

## Quick Wins (Low Effort, High Value)

### 1. Validation Tests (1-2 hours each)
- Aadhar validation (12 digits, Luhn check)
- PAN validation (format: ABCDE1234F)
- Email/phone format validation
- Date range validation

### 2. Calculation Tests (2-3 hours each)
- PF calculation (12% of basic)
- ESI calculation (0.75% employee, 3.25% employer)
- PT slab application (state-wise)
- Proration logic (days worked / total days)

### 3. Helper Function Tests (1 hour each)
- Date formatters
- Currency formatters
- Tax regime selectors
- Leave balance calculators

**Total Quick Wins**: ~20-30 tests in 2-3 days

---

## Long-Term Test Coverage Plan

### Q3 2026 Goals
- ✅ Critical modules: 90% coverage (payroll, leave, wfm, compliance)
- ✅ High modules: 75% coverage (employees, ats, lifecycle, exit)
- ✅ Integration tests: 30+ critical flows
- ✅ E2E tests: 10+ user journeys
- ✅ CI/CD: Automated test runs on PR

### Q4 2026 Goals
- ✅ All modules: 70%+ coverage
- ✅ Performance tests: Load, stress, endurance
- ✅ Security tests: Auth, RBAC, input sanitization
- ✅ UI tests: Frontend component testing
- ✅ Regression suite: Automated smoke tests

---

## Test Documentation Needed

- [ ] Test strategy document
- [ ] Test data management guide
- [ ] Mock service setup guide
- [ ] CI/CD integration guide
- [ ] Test case catalog
- [ ] Known issues / flaky tests log

---

## Summary

**Current State**:
- 2/39 modules tested (5% coverage)
- 49 tests total (34 passing, 15 skipped)
- No integration tests running (DB access blocked)
- No E2E tests for critical flows

**Immediate Priorities**:
1. 🔴 Payroll calculations + statutory compliance (60-70 tests)
2. 🔴 Leave balance + carry forward logic (10-15 tests)
3. 🔴 Attendance present/absent calculations (10-12 tests)
4. 🟠 ATS conversion flow (10-15 tests)
5. 🟠 Employee CRUD operations (5-8 tests)

**Estimated Effort**:
- Phase 1 (Critical): 2 weeks, ~70 tests
- Phase 2 (Core): 2 weeks, ~50 tests
- Phase 3 (Integration): 2 weeks, ~30 tests
- Phase 4 (Edge cases): 2 weeks, ~40 tests

**Total**: 8 weeks to reach 70% coverage on critical paths

---

**Report Generated**: 2026-06-02  
**Modules Scanned**: 39  
**Test Files Found**: 5  
**Status**: 🔴 Critical test coverage gap - immediate action required
