# Manager / Team Leader E2E Test Matrix

> Playwright-based E2E tests with demo session injection  
> Date: 2026-06-10  
> Framework: Playwright (Chromium) | Base URL: http://localhost:8080  

---

## 1. Legend

| Symbol | Meaning |
|--------|---------|
| P1 | Critical — blocks release |
| P2 | High — core user flow |
| P3 | Medium — important but not blocking |
| P4 | Low — nice to have |
| ✅ | Test exists |
| 🆕 | New test to write |
| 🚫 | Negative test (should fail/be hidden) |

---

## 2. Manager Smoke Tests (`e2e/manager.smoke.ts`)

| # | Test | Route | Assertion | Priority | Status |
|---|------|-------|-----------|:--------:|:------:|
| M01 | Manager login screen loads | `/auth` | Page has login form | P1 | 🆕 |
| M02 | Manager demo login → Dashboard | `/dashboard` | Nav visible, no crash | P1 | 🆕 |
| M03 | Manager → Management Dashboard | `/management/dashboard` | KPI cards visible | P1 | 🆕 |
| M04 | Manager → Team Analytics | `/team-analytics` | Charts/tables visible | P1 | 🆕 |
| M05 | Manager → Performance (Team tab) | `/performance` | Team tab active, ratings visible | P2 | 🆕 |
| M06 | Manager → Employee list | `/employees` | Employee cards visible, scoped | P2 | 🆕 |
| M07 | Manager → Employee detail | `/employees/:id` | Profile loads, journey visible | P2 | 🆕 |
| M08 | Manager → Leave review inbox | `/leave/requests` | Pending requests visible | P2 | 🆕 |
| M09 | Manager → WFM Live tracker | `/wfm/live` | Live dashboard visible | P2 | 🆕 |
| M10 | Manager → WFM Roster | `/wfm/roster` | Roster calendar visible | P2 | 🆕 |
| M11 | Manager → Work inbox | `/work-inbox` | Pending approvals visible | P3 | 🆕 |
| M12 | Manager → Goals | `/goals` | Goals list visible | P3 | 🆕 |
| M13 | Manager → KPI Config | `/kpi/config` | KPI cards visible | P3 | 🆕 |
| M14 | Manager → Process Config | `/process/config` | Process cards visible | P3 | 🆕 |
| M15 | Manager → Career Planning | `/career-planning` | Career plans visible | P4 | 🆕 |

---

## 3. Team Leader Smoke Tests (`e2e/team-leader.smoke.ts`)

| # | Test | Route | Assertion | Priority | Status |
|---|------|-------|-----------|:--------:|:------:|
| TL01 | TL login screen loads | `/auth` | Page has login form | P1 | 🆕 |
| TL02 | TL demo login → Dashboard | `/dashboard` | Nav visible, no crash | P1 | 🆕 |
| TL03 | TL → WFM Roster | `/wfm/roster` | Roster calendar visible | P2 | ✅ |
| TL04 | TL → WFM Live tracker | `/wfm/live` | Live dashboard visible | P2 | 🆕 |
| TL05 | TL → Work inbox | `/work-inbox` | Pending approvals visible | P2 | 🆕 |
| TL06 | TL → Goals | `/goals` | Goals list visible | P3 | 🆕 |
| TL07 | TL → Career Planning | `/career-planning` | Career plans visible | P3 | 🆕 |
| TL08 | TL → RTA Board | `/rta-board` | RTA board visible | P3 | 🆕 |
| TL09 | TL → Helpdespk | `/helpdesk` | Tickets visible | P3 | 🆕 |
| TL10 | TL → LMS My Learning | `/lms/my-learning` | Courses visible | P3 | 🆕 |

---

## 4. Manager Negative Tests

| # | Test | Route/Action | Expected Result | Priority | Status |
|---|------|-------------|-----------------|:--------:|:------:|
| MN01 | Cannot access admin dashboard | `/admin/dashboard` | Redirect or 403 | P2 | 🆕 |
| MN02 | Cannot access customization rules | `/customization` | Page hidden / 403 | P2 | 🆕 |
| MN03 | Cannot approve auto-roster | `/auto-roster/plans/:id/approve` (POST) | 403 | P2 | 🆕 |
| MN04 | Cannot edit employee outside scope | Query employee from other branch | Employee not in list | P2 | 🆕 |
| MN05 | Cannot access finance/payroll | `/payroll` | Page hidden / 403 | P3 | 🆕 |
| MN06 | Cannot access ATS dashboard | `/ats` | Page hidden / 403 | P3 | 🆕 |

---

## 5. Team Leader Negative Tests

| # | Test | Route/Action | Expected Result | Priority | Status |
|---|------|-------------|-----------------|:--------:|:------:|
| TLN01 | Cannot access management dashboard | `/management/dashboard` | Page hidden / 403 | P2 | 🆕 |
| TLN02 | Cannot access KPI config | `/kpi/config` | Page hidden / 403 | P2 | 🆕 |
| TLN03 | Cannot access team analytics | `/team-analytics` | Page hidden / 403 | P2 | 🆕 |
| TLN04 | Cannot access employee list | `/employees` | Page hidden / 403 | P2 | 🆕 |
| TLN05 | Cannot approve leave requests | Should not have `/leave/requests` page | Page hidden / 403 | P2 | 🆕 |
| TLN06 | Cannot access customization | `/customization` | Page hidden / 403 | P3 | 🆕 |

---

## 6. Scope Enforcement Tests

| # | Test | Scenario | Expected Result | Priority | Status |
|---|------|----------|-----------------|:--------:|:------:|
| SE01 | Manager sees only scoped employees | Manager from Process A | Employee list shows only Process A employees | P1 | 🆕 |
| SE02 | Manager rating limited to subordinates | Manager tries to rate non-report | 403 or employee not in dropdown | P1 | 🆕 |
| SE03 | TL work inbox scoped to team | TL with 5 direct reports | Shows only 5 subordinate requests | P2 | 🆕 |
| SE04 | Manager WFM roster scoped | Manager from Branch B | Roster shows only Branch B agents | P2 | 🆕 |
| SE05 | Manager cannot see other manager's approvals | Manager from Process A | Other process approvals not visible | P2 | 🆕 |

---

## 7. Cross-Role Integration Tests

| # | Test | Flow | Priority | Status |
|---|------|------|:--------:|:------:|
| CI01 | Employee applies leave → Manager approves | `/leave/apply` → `/leave/requests` → approve | P1 | 🆕 |
| CI02 | Employee submits goal → Manager reviews | `/goals` → manager navigates to goals → review | P2 | 🆕 |
| CI03 | Employee requests regularization → Manager approves | `/attendance` → `/regularizations` → approve | P2 | 🆕 |
| CI04 | TL escalates issue → Manager resolves | `/work-inbox` → TL creates → Manager acts | P2 | 🆕 |
| CI05 | Manager publishes roster → TL views | `/wfm/roster` → publish → TL sees updated roster | P2 | 🆕 |

---

## 8. Test File Structure

```
e2e/
  helpers.ts              (existing)
  smoke.smoke.ts          (existing — preserve)
  manager.smoke.ts        (🆕 new — manager smoke tests M01-M15)
  team-leader.smoke.ts    (🆕 new — TL tests TL01-TL10)
  manager.negative.ts     (🆕 new — negative tests MN01-MN06)
  team-leader.negative.ts (🆕 new — negative tests TLN01-TLN06)
  scope.smoke.ts          (🆕 new — scope tests SE01-SE05)
  integration.smoke.ts    (🆕 new — cross-role CI01-CI05)
```

---

## 9. Configuration Changes

| File | Change | Reason |
|------|--------|--------|
| `playwright.config.ts` | Expand `testMatch` from `**/*.smoke.ts` | Include `.negative.ts` and `.integration.ts` |
| `package.json` | Add `test:e2e` script with `playwright test` | Convenience command |
| `package.json` | Add `test:unit` script with `vitest --run` | Frontend unit test entry point |

---

## 10. Execution Order

1. **Phase 1**: Write `manager.smoke.ts` M01-M05 (login + dashboard + analytics)
2. **Phase 2**: Write `team-leader.smoke.ts` TL01-TL05 (login + roster + inbox)
3. **Phase 3**: Write negative tests (`manager.negative.ts`, `team-leader.negative.ts`)
4. **Phase 4**: Write scope tests (`scope.smoke.ts`)
5. **Phase 5**: Write integration tests (`integration.smoke.ts`)
6. **Phase 6**: Fill remaining P3/P4 tests
7. **Phase 7**: Full test suite run + CI integration

---

*Matrix version: 1.0 | Based on commit df5593b4ef1807dc8b0145644f13d67e07cda14d*
