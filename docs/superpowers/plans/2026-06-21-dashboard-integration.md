# Dashboard Integration: hrms-audit → MyHRMS1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Integrate 11 dashboard pages and 3 backend modules from hrms-audit into MyHRMS1, pointing to live data sources (db_bill + mas_hrms), enabling role-based quality/performance/payroll dashboards.

**Architecture:** 
Copy frontend dashboards as-is (they use generic `hrmsApi` client). Adapt backend modules to MyHRMS1's Express structure (add routes to app.ts). Create data-mapping services that read from db_bill (quality metrics) and mas_hrms (performance, payroll). Route guards enforce role-based access (Quality/Performance for managers, Payroll for finance).

**Tech Stack:** React 18 + TypeScript + Recharts (dashboards), Express.js (backend), MySQL (db_bill + mas_hrms), shadcn/ui (components).

---

## Phase 1: Frontend Dashboards + Routing

### Task 1: Copy Dashboard Pages + Wire Routes

**Files:**
- Create: `src/pages/Dashboard.tsx` (and 10 others)
- Create: `src/components/dashboard/*.tsx` (all components)
- Modify: `src/app.tsx` (add routes)

**Steps:**
1. Copy all 11 dashboard page files from hrms-audit/src/pages
2. Copy all dashboard components from hrms-audit/src/components/dashboard
3. Add routes to src/app.tsx with role-based guards
4. Run `npm run build` to verify no TypeScript errors
5. Commit with message: "feat: add 11 dashboard pages + components from hrms-audit"

---

## Phase 2: Backend Modules + Data Services

### Task 2: Quality Dashboard Backend

**Files:**
- Create: `backend/src/modules/quality-dashboard/quality-dashboard.routes.ts`
- Create: `backend/src/modules/quality-dashboard/quality-insights.service.ts`
- Modify: `backend/src/app.ts` (register routes)

**Key Endpoints:**
- GET /api/quality-dashboard/agent-scores (joins db_bill.masjclrentry + db_audit.call_quality_assessment)
- GET /api/quality-dashboard/summary (aggregate metrics)

**Steps:**
1. Copy quality-dashboard module files from hrms-audit
2. Adapt routes to use MySQL queries against db_bill + db_audit
3. Update service methods to use db queries instead of Supabase
4. Register router in app.ts
5. Test: `curl -X GET http://localhost:5056/api/quality-dashboard/summary`
6. Commit with message: "feat: add quality dashboard backend + data adapter"

---

### Task 3: Performance Dashboard Backend

**Files:**
- Create: `backend/src/modules/performance-dashboard/performance-dashboard.routes.ts`
- Create: `backend/src/modules/performance-dashboard/performance-dashboard.service.ts`
- Modify: `backend/src/app.ts` (register routes)

**Key Endpoints:**
- GET /api/performance-dashboard/goals (from mas_hrms.employee_goals)
- GET /api/performance-dashboard/feedback (from mas_hrms.performance_feedback)
- GET /api/performance-dashboard/ratings (manager view)

**Steps:**
1. Copy performance-dashboard module from hrms-audit
2. Adapt routes to query mas_hrms.employee_goals + performance_feedback
3. Update service methods
4. Register router in app.ts
5. Test: `curl -X GET http://localhost:5056/api/performance-dashboard/goals`
6. Commit with message: "feat: add performance dashboard backend"

---

### Task 4: Payroll Dashboard Endpoints

**Files:**
- Modify: `backend/src/modules/payroll/payroll.routes.ts`
- Modify: `backend/src/app.ts` (ensure registration)

**Key Endpoints:**
- GET /api/payroll/summary (gross/net/CTC aggregates)
- GET /api/payroll/compliance (statutory field validation)

**Steps:**
1. Add summary endpoint querying mas_hrms.employees
2. Add compliance endpoint showing PAN/UAN/EPF/ESIC status
3. Register payroll router in app.ts
4. Test: `curl -X GET http://localhost:5056/api/payroll/summary`
5. Commit with message: "feat: add payroll dashboard endpoints"

---

### Task 5: End-to-End Test

**Files:**
- Test: All dashboard pages + APIs

**Steps:**
1. Verify backend + frontend running
2. Test each dashboard API endpoint returns data
3. Open browser to http://localhost:8080/dashboard
4. Verify navigation works (no 404s)
5. Verify charts render without errors
6. Commit: "feat: dashboards fully integrated and tested"

---

## Verification Checklist

- [ ] Frontend builds without errors
- [ ] All 11 dashboard pages accessible via routes
- [ ] Quality dashboard returns agent scores
- [ ] Performance dashboard returns goals
- [ ] Payroll dashboard returns compliance data
- [ ] Role guards prevent unauthorized access
- [ ] Charts render data correctly

