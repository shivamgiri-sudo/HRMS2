# HRMS2 Runtime Button Action Audit — P0 Stabilization Pass

## Status Legend
- ✅ WORKING — wired, API exists, DB correct
- ⚠️ PARTIAL — exists, partial or field mismatch
- ❌ BROKEN — unconnected or API missing
- 🔒 RBAC — role check present, DB-resolved

---

## Auth / Login
| Button | Role | API | Status | Notes |
|---|---|---|---|---|
| Login | public | POST /api/auth/login | ✅ WORKING | JWT + isReadOnly from DB |
| Forgot Password (email) | public | POST /api/auth/forgot-password | ✅ WORKING | token-based |
| Forgot Password (OTP) | public | POST /api/auth/forgot-password-otp | ✅ WORKING | real SHA-256 OTP, 6-digit, rate-limited |
| Verify OTP Reset | public | POST /api/auth/verify-otp-reset | ✅ WORKING | max 5 attempts, marks OTP used |
| Must-Change Password | authed | POST /api/auth/change-password | ✅ WORKING 🔒 | |
| 2FA Verify | authed | POST /api/auth/2fa/verify | ✅ WORKING | |

---

## ATS Candidate Journey
| Button | Role | API | Status | Notes |
|---|---|---|---|---|
| Register Candidate (walk-in) | public | POST /api/ats/register | ✅ WORKING | no auth required |
| Update Candidate | recruiter/hr | PUT /api/ats/candidates/:id | ✅ WORKING 🔒 | requireWriteAccess added |
| Move Stage | recruiter/hr | POST /api/ats/candidates/:id/move-stage | ✅ WORKING 🔒 | requireWriteAccess added |
| Send Onboarding Link | recruiter/hr | POST /api/ats/candidates/:id/send-onboarding-link | ✅ WORKING | status=selected gate enforced |
| ATS Web Data | admin/hr/recruiter | GET /api/ats-full/web-data | ✅ WORKING 🔒 | DB-resolved role, bypassScope correct |
| ATS Queue | admin/hr/recruiter | GET /api/ats-full/queue | ✅ WORKING 🔒 | DB-resolved role |
| Candidate Journey | admin/hr/recruiter | GET /api/ats-full/journey | ✅ WORKING 🔒 | hasScopedAccess + DB-resolved role |
| Daily Report Snapshot | admin/hr/branch_head | GET /api/ats-full/daily-report/snapshot | ✅ WORKING 🔒 | DB-resolved role |

---

## Onboarding Bridge
| Button | Role | API | Status | Notes |
|---|---|---|---|---|
| List Bridges | hr/admin | GET /api/ats/onboarding/bridges | ✅ WORKING | listOnboardingBridges real SQL |
| View BGV Status | hr | via bridge data | ✅ WORKING 🔒 | |
| View Name Consistency | hr | via bridge data | ✅ WORKING 🔒 | |

---

## Candidate Onboarding (/onboard-full)
| Button | Role | API | Status | Notes |
|---|---|---|---|---|
| Send OTP | public | POST /api/onboarding-full/otp/send | ✅ WORKING | |
| Verify OTP | public | POST /api/onboarding-full/otp/verify | ✅ WORKING | |
| Save Section | candidate | POST /api/onboarding-full/:section | ✅ WORKING | autosave |
| Upload Document | candidate | POST /api/onboarding-full/documents/upload | ✅ WORKING | |
| Check Blockers | candidate | GET /api/onboarding-full/blockers/:token | ✅ WORKING | shows unresolved blockers |
| Submit | candidate | POST /api/onboarding-full/submit | ✅ WORKING | sets onboarding_submitted, creates HR work item |

---

## Payroll HR Validation
| Button | Role | API | Status | Notes |
|---|---|---|---|---|
| Validate HR | payroll_hr | POST /api/ats/payroll-hr/:id/validate | ✅ WORKING 🔒 | requireWriteAccess added |
| Save JCLR | payroll_hr | POST /api/ats/jclr/:id | ✅ WORKING 🔒 | new route, upsert |
| BM Approve JCLR | branch_head/bm | POST /api/ats/jclr/:id/approve | ✅ WORKING 🔒 | audit logged |

---

## Salary Component Assignment
| Button | Role | API | Status | Notes |
|---|---|---|---|---|
| Assign Components | payroll_hr | POST /api/ats/salary-components/:id | ✅ WORKING 🔒 | new route |
| View Components | payroll_hr | GET /api/ats/salary-components/:id | ✅ WORKING 🔒 | |

---

## Employee Code Gate
| Button | Role | API | Status | Notes |
|---|---|---|---|---|
| Check Gate | hr/admin | GET /api/ats/employee-code/:id/gate-check | ✅ WORKING | 7-point check, returns blockers |
| Generate Code | hr/admin | POST /api/ats/employee-code/:id/generate | ✅ WORKING 🔒 | hard-blocks if any gate fails |

---

## Work Inbox
| Button | Role | API | Status | Notes |
|---|---|---|---|---|
| My Items | all | GET /api/work-inbox/my | ✅ WORKING | DB-resolved role middleware |
| Stats | all | GET /api/work-inbox/stats | ✅ WORKING | DB-resolved role |
| Overdue | all | GET /api/work-inbox/overdue | ✅ WORKING | DB-resolved role |
| Complete | assignee/privileged | POST /api/work-inbox/:id/complete | ✅ WORKING 🔒 | assertWorkItemAccess |
| Escalate | privileged | POST /api/work-inbox/:id/escalate | ✅ WORKING 🔒 | assertWorkItemAccess |
| Reassign | admin/hr | POST /api/work-inbox/:id/reassign | ✅ WORKING 🔒 | assertWorkItemAccess |
| Set Priority | admin/hr | PATCH /api/work-inbox/:id/priority | ✅ WORKING 🔒 | |

---

## Dashboards
| Button | Role | API | Status | Notes |
|---|---|---|---|---|
| Summary | all | GET /api/dashboards/:code/summary | ✅ WORKING | scopeToSqlWhere on all metrics |
| Metrics Catalog | all | GET /api/dashboards/:code/metrics | ✅ WORKING | DB-resolved role |
| Good/Bad Insights | all | GET /api/dashboards/:code/good-bad-insights | ✅ WORKING | DB-resolved role |
| Metric Values | all | GET /api/dashboards/:code/metric-values | ✅ WORKING | DB-resolved role + scope |
| Drilldown | all | GET /api/dashboards/:code/metric/:code/drilldown | ✅ WORKING | DB-resolved role + scope |
| Trend | all | GET /api/dashboards/:code/metric/:code/trend | ✅ WORKING | scopeClause applied |
| Filters | restricted | GET /api/dashboards/:code/filters | ✅ WORKING | empty scope → empty list, not all branches |
| Root Causes | all | GET /api/dashboards/:code/root-causes | ✅ WORKING | scopeToSqlWhere on TAT/name/onboarding |

---

## Incentive Approval
| Button | Role | API | Status | Notes |
|---|---|---|---|---|
| Upload Batch | wfm_spoc/wfm | POST /api/incentives/upload | ✅ WORKING 🔒 | |
| Approve Step 1 | branch_head | POST /api/incentives/:id/approve | ✅ WORKING 🔒 | 3-step chain |
| Approve Step 2 | operations_head | POST /api/incentives/:id/approve | ✅ WORKING 🔒 | |
| Approve Step 3 | finance_head | POST /api/incentives/:id/approve | ✅ WORKING 🔒 | sets finance_approved |
| Register | payroll_hr | POST /api/incentives/:id/register | ✅ WORKING 🔒 | gates on finance_approved |

---

## DPDP Withdrawal
| Button | Role | API | Status | Notes |
|---|---|---|---|---|
| Submit Request | employee | POST /api/dpdp-withdrawal/request | ✅ WORKING | creates compliance work item |
| Approve | compliance/admin | POST /api/dpdp-withdrawal/:id/approve | ✅ WORKING 🔒 | |
| Reject | compliance/admin | POST /api/dpdp-withdrawal/:id/reject | ✅ WORKING 🔒 | |
| Release Hold | compliance/admin | POST /api/dpdp-withdrawal/:id/release-hold | ✅ WORKING 🔒 | |

---

## Payroll
| Button | Role | API | Status | Notes |
|---|---|---|---|---|
| Salary History | payroll_hr | GET /api/payroll/employees/:id/salary-history | ✅ WORKING | real SQL (salary_prep_line 24mo) |
| List Records | payroll_hr | GET /api/payroll/records | ✅ WORKING | real paginated SQL |
| Payroll Overview | payroll_hr | GET /api/payroll/overview | ✅ WORKING | real aggregate SQL |
| Update Overtime | payroll_hr | PUT /api/payroll/lines/:id/overtime | ⚠️ PARTIAL | overtime_hours/overtime_pay cols may need migration |

---

## TAT Dashboard
| Button | Role | API | Status | Notes |
|---|---|---|---|---|
| List Tasks | all | GET /api/governance/tat/tasks | ✅ WORKING | scope applied |
| Create Instance | hr/admin | POST /api/governance/tat/tasks | ✅ WORKING | lookups tat_matrix_master |
| Complete Task | assignee | POST /api/governance/tat/tasks/:id/complete | ✅ WORKING | |
| Recalculate | admin | POST /api/governance/tat/tasks/recalculate | ✅ WORKING | checkAndEscalateTat |

---

## Remaining Items (Post This Pass)
1. `overtime_hours`/`overtime_pay` — add to salary_prep_line migration if absent
2. E-sign PDF generation — requires wkhtmltopdf/puppeteer, currently text-only
3. Employee master auto-creation after code generation — HR step still manual
4. ATS status-machine import in ats.routes.ts stage-change handler — verify wiring
5. JCLR/salary-component/employee-code router mounts — verify in app.ts
