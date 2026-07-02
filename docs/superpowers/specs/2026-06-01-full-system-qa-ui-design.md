# MAS-CallNet HRMS — Full System QA + UI Design Spec

**Date:** 2026-06-01  
**Status:** Active  
**Scope:** End-to-end flow audit, broken page fixes, dummy data seeding, enterprise UI overhaul

---

## Design System

| Token | Value |
|-------|-------|
| Primary | `#2563EB` (blue-600) |
| Accent/CTA | `#059669` (emerald-600) |
| Background | `#F8FAFC` (slate-50) |
| Foreground | `#0F172A` (slate-950) |
| Muted bg | `#F1F5FD` |
| Border | `#E2E8F0` (slate-200) |
| Destructive | `#DC2626` |
| Style | Data-Dense Dashboard |
| Heading font | Inter (replacing Fira Code — more readable for HR context) |
| Body font | Inter |
| Sidebar width | 256px |
| Card radius | rounded-xl (12px) |
| Animation | 150–200ms ease-out |

---

## Audit Findings

### 1. DB — Zero rows in critical tables

| Table | Rows | Impact |
|-------|------|--------|
| `employees` | 0 | Every page that loads employee data is blank |
| `ats_candidate` | 0 | ATS pages show empty |
| `cost_centre_master` | 0 | Cost centre dropdowns crash |
| `grade_band_master` | 0 | Grade dropdowns empty |
| `salary_structure_master` | 0 | Payroll can't run |
| `leave_request` | 0 | Leave pages empty |
| `wfm_attendance_session` | 0 | Attendance empty |

**Fix:** Seed script `043_demo_data.sql` — 11 employees (one per role), ATS candidates, leave requests, attendance records, payroll structure.

### 2. Missing Backend Endpoints

| Frontend calls | Backend has? | Fix |
|---------------|-------------|-----|
| `GET /api/employees/me` | ❌ No | Add to employee.routes.ts |
| `GET /api/ats/walkin-queue` | ❌ No | Add to ats.routes.ts |
| `GET /api/ats/waiting-queue` | ❌ No | Alias → same handler |
| `GET /api/integrations/connectors` | ❌ No (registered as `/api/integration-hub`) | Fix frontend path |
| `GET /api/integrations/runs` | ❌ No | Fix frontend path |
| `GET /api/statutory/*` | ❌ No (registered as `/api/compliance`) | Fix frontend path |
| `GET /api/tax/declarations` | ❌ No (registered as `/api/payroll`) | Fix frontend path |

### 3. Frontend Wrong API Paths

| Page | Wrong path | Correct path |
|------|-----------|-------------|
| NativeIntegrationHub | `/api/integrations/connectors` | `/api/integration-hub/connectors` |
| NativeStatutoryCompliance | `/api/statutory/uan` | `/api/compliance/uan` |
| NativeTaxDeclaration | `/api/tax/declarations` | `/api/payroll/tax-declarations` |
| NativeMaternityLeave | `/api/leave/maternity` | `/api/compliance/maternity` |
| NativePerformanceFeedbackAssignments | `/performance-feedback/my-assignments` | `/api/performance-feedback/requests` |

### 4. Pages with No Real Data Connection

| Page | Issue |
|------|-------|
| NativeATSDashboardReplica | Client-side adapter, no live API |
| NativePlaceholderPage (LMS Admin, WFM Live) | Stub — needs real content |
| Performance.tsx | Queries Supabase directly, should use hrmsApi |
| Reports.tsx | No API calls — shows static |
| Index.tsx (dashboard) | Uses hooks that call Supabase, not hrmsApi |

### 5. UI Problems

- Sidebar too dense — 40+ items in flat list with no visual hierarchy
- Cards have inconsistent padding (some 4px, some 24px)  
- Tables have no loading states — show broken layouts during fetch
- No empty state illustrations — just plain text
- Color inconsistency — some pages use blue-600, others indigo-500, others violet
- Form errors are generic ("Error occurred")
- No toast notifications on success/failure for most actions
- Mobile sidebar overlaps content on 375px
- No active state indicator in sidebar matching current route

---

## Fix Plan

### Phase 1: Data Foundation (043_demo_data.sql)
- 5 branches (existing) + seed cost centres linked to depts
- 3 grade bands: Junior/Mid/Senior
- 1 salary structure: Standard with Basic/HRA/TA components
- 11 employees (one per demo role: admin, hr, recruiter, manager, tl, qa, wfm, finance, employee, ceo, trainer)
- 15 ATS candidates (5 walkin, 5 in interview, 5 offered)
- Attendance for current month (all employees, 20 days)
- Leave requests (3 approved, 2 pending)
- 1 payroll run (current month, prepared)
- Engagement points and badges for employees

### Phase 2: Backend Fixes
- Add `GET /api/employees/me` — returns employee record for logged-in user
- Add `GET /api/ats/walkin-queue` — returns candidates with source=walkin
- Fix integration-hub path aliases

### Phase 3: Frontend Path Fixes  
- Fix all wrong API base paths (5 pages)
- Fix hrmsApi demo session token (demo users get mock token)

### Phase 4: UI Overhaul
- DashboardLayout: grouped sidebar with collapsible sections, active route highlight, role-filtered nav
- Global CSS tokens: consistent colors, spacing, radius
- Table component: skeleton loading, empty state, pagination
- Card component: consistent padding, shadow, hover state
- Toast system: success/error on all mutations
- Dashboard (Index.tsx): real stat cards with API data

---

## Flow Verification Matrix (with dummy data)

| Flow | Roles | Entry → Exit |
|------|-------|-------------|
| Walk-in registration | Public | /interview-registration → DB candidate |
| ATS processing | Recruiter, HR | Walkin queue → stage move → offer → bridge |
| Employee onboarding | HR, Admin | Bridge → create employee → documents |
| Daily attendance | Employee | Mark in/out → session in DB |
| Leave request | Employee | Apply → manager approves → balance deducted |
| Payroll run | Finance, Payroll | Prepare → calculate → approve → payslip |
| Performance feedback | Manager, Employee | Cycle → request → form → report |
| Exit request | Employee, HR | Resign → notice → F&F → exit |
| Client portal | CEO, Client | Login → overview → process KPIs |
