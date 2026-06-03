# MAS Callnet PeopleOS — CEO Rollout Plan
## Target: Live by 10th June 2026

**Prepared for:** CEO, MAS Callnet  
**Date:** 3rd June 2026  
**Platform Status:** 87% complete — core HRMS fully functional, 3 days to production-ready

---

## Executive Summary

The PeopleOS platform is **feature-complete for all critical workflows** — ATS, employee lifecycle, attendance, leave, payroll, WFM/roster, compliance, client portal, and communication. The remaining work (3–4 days) is infrastructure hardening, process module MySQL migration, SMTP credentials, UAT, and deployment. **10th June is achievable.**

---

## Current State Snapshot (as of 3rd June)

| Area | Status | Notes |
|---|---|---|
| Employee CRUD + Onboarding | ✅ Complete | Full MySQL, file uploads on disk |
| ATS — Walk-in to Hire | ✅ Complete | Public registration → recruiter → offer → employee |
| Attendance + Clock-in/out | ✅ Complete | Web + geolocation |
| Leave Management | ✅ Complete | Apply, approve, balance, holidays |
| WFM Roster + Capacity | ✅ Complete | Demand → draft → publish → acknowledge |
| Payroll Foundation | ✅ Complete | Salary structures, payslips, TDS, F&F |
| Statutory Compliance | ✅ Complete | PF/UAN, ESIC, ECR, Labour, DPDP |
| Performance Feedback | ✅ Complete | 360°, goals, development plans |
| Helpdesk / Grievances | ✅ Complete | Ticket raise and resolve |
| Assets & Documents | ✅ Complete | Assign, return, service log |
| Communication | ✅ Complete | Email/SMS/WhatsApp configurable from admin panel |
| Client Portal | ✅ Complete | Process-scoped KPI visibility, no PII leak |
| LMS Integration | ✅ Complete | Deep-link + sync surface to existing LMS |
| Exit Management | ✅ Complete | Resignation → F&F workflow |
| Access Control (RBAC) | ✅ Complete | 12 roles, page-level permissions |
| **Process Module (MySQL)** | ⚠️ Needs 4 hours | Last Supabase dependency — needs MySQL repo |
| **SMTP / SMS credentials** | ⚠️ Config only | 30 minutes to configure from admin panel |
| **Quality/Ops Dashboards** | ⚠️ Placeholder | Non-blocking for launch — visible to QA/Ops roles only |
| **Deployment** | 🔲 Pending | Express + Vite build + DNS — 1 day |

---

## Day-by-Day Rollout Plan

---

### Day 1 — Tuesday, 4th June
**Theme: Fix the last backend gap + deploy to staging**

#### Morning (9 AM – 1 PM) — Engineering
- [ ] Implement `process.repository.mysql.ts` — replaces last Supabase dependency
  - Tables: `process_master` already in MySQL (created in `001_core_org.sql`)
  - Methods: `list()`, `getById()`, `create()`, `update()`, `updateStatus()`
  - ~2 hours of work
- [ ] Run all 71 SQL migrations on production MySQL (122.184.128.90)
  - Command: `mysql -u root -p mas_hrms < backend/sql/000_run_all.sql`
  - Verify 40+ tables created: `SHOW TABLES;`
- [ ] Build backend: `cd backend && npm install && npm run build`
- [ ] Deploy backend to production server / Railway
  - Confirm `/api/health` returns `{"db":"connected"}`

#### Afternoon (2 PM – 6 PM) — Engineering
- [ ] Build frontend: `npm install && npm run build`
- [ ] Deploy frontend `dist/` to Vercel or serve via Nginx
- [ ] Set `VITE_HRMS_API_URL` in frontend env to backend URL
- [ ] Smoke test: `/auth` login, `/dashboard`, `/employees`, `/ats/dashboard`
- [ ] Configure email in admin panel: Settings → Communication Config → Email tab
  - SMTP Host, Gmail App Password, From address → Save → Test

**End of Day 1 Checkpoint:** Platform running on staging URL, all core endpoints responding, email working.

---

### Day 2 — Wednesday, 5th June
**Theme: Data setup + role configuration**

#### Morning (9 AM – 1 PM) — HR Admin (you)
- [ ] **Org Masters setup** — `/org-masters`
  - Add all branches (Ahmedabad, Mumbai, etc.)
  - Add all departments
  - Add all designations
  - Add all processes/LOBs
  - Add call centre codes
- [ ] **Leave Types** — `/settings` → Leave Types tab
  - Create: Casual Leave, Sick Leave, Privilege Leave, Maternity, etc.
  - Set max days, carry-forward rules, approval requirements
- [ ] **Attendance Rules** — `/attendance-rules-master`
  - Set late-mark threshold, half-day rules, overtime policy
- [ ] **Holidays** — `/calendar`
  - Add all 2026 public holidays and company holidays

#### Afternoon (2 PM – 6 PM) — HR Admin
- [ ] **Employee import** — `/bulk-upload`
  - Download employee template
  - Fill all existing employees (employee code, name, mobile, email, department, designation, DOJ, salary)
  - Upload and validate
  - Fix any row errors
- [ ] **Role assignments** — `/settings/access-control`
  - Assign Recruiter role to recruiting team
  - Assign WFM role to workforce team
  - Assign Finance role to payroll team
  - Assign Manager role to team leads and branch heads
- [ ] Configure SMS (Twilio or MSG91) in admin panel if credentials available

**End of Day 2 Checkpoint:** All employees imported, org hierarchy set, roles assigned.

---

### Day 3 — Thursday, 6th June
**Theme: Process config + payroll setup + ATS go-live**

#### Morning (9 AM – 1 PM) — Finance / Payroll team
- [ ] **Salary structures** — `/payroll`
  - Create salary bands for each grade (Basic, HRA, TA, Other Allowances)
  - Assign to all employees
- [ ] **Statutory config** — `/payroll/statutory-config`
  - PF: Employee 12%, Employer 12%
  - ESIC: Employee 0.75%, Employer 3.25%
  - TDS: Slab configuration
  - Professional Tax: State-wise
- [ ] **Process KPI config** — `/process-config`
  - Set AHT, FCR, adherence targets per process

#### Afternoon (2 PM – 6 PM) — Recruitment team
- [ ] **ATS Form Config** — `/ats/form-config`
  - Activate required fields for candidate registration
  - Add recruiters to the system
  - Set sourcing channels (Walk-in, LinkedIn, Referral, etc.)
- [ ] **Test walk-in flow end-to-end:**
  1. Open `/interview-registration` (no login needed) on a mobile/tablet
  2. Register a test candidate
  3. Login as Recruiter → `/ats/recruiter/my-candidates` — verify candidate appears
  4. Move candidate through stages: Applied → Screening → Selected
  5. Send onboarding link
  6. Complete onboarding → verify employee created in `/employees`
- [ ] **Client Portal setup** — `/client-master`
  - Add client accounts
  - Map clients to processes/LOBs
  - Set portal login credentials

**End of Day 3 Checkpoint:** First real employee onboarded end-to-end through ATS. Payroll configured.

---

### Day 4 — Friday, 7th June
**Theme: WFM + Attendance + Manager journeys**

#### Morning (9 AM – 1 PM) — WFM team
- [ ] **Roster setup** — `/roster-master-builder`
  - Create shift templates (Morning, Afternoon, Night, General)
  - Set capacity per shift per process
- [ ] **Week-off rules** — `/wfm/extensions`
  - Configure weekly off days per process
- [ ] **First roster** — `/wfm/roster`
  - Create roster for week of 9th–15th June
  - Allocate employees to shifts
  - Publish roster
  - Verify employees can see their roster at `/my-roster`
- [ ] **Test attendance flow:**
  - Employee login → Dashboard → clock-in (test with geolocation)
  - Admin view at `/attendance` — verify record appears

#### Afternoon (2 PM – 6 PM) — Managers + Team Leads
- [ ] **Manager journey walkthrough:**
  - Login as Manager
  - View team leaves at `/leaves` — approve/reject a test leave
  - View team attendance
  - Access `/management/dashboard` — KPI cards
  - Submit a helpdesk ticket at `/helpdesk`
- [ ] **Employee self-service walkthrough:**
  - Login as Employee
  - Apply leave at `/leaves`
  - View payslip at `/payroll/payslips` (after first payroll run)
  - View goals at `/performance`
  - Raise helpdesk ticket
- [ ] **WhatsApp setup** (if Twilio/Meta credentials available)
  - Settings → Communication Config → WhatsApp
  - Test send to a phone number

**End of Day 4 Checkpoint:** All role journeys tested and working. Roster published for first week.

---

### Day 5 — Saturday, 8th June
**Theme: UAT + Bug fixes + Performance hardening**

#### Full day — All teams

**UAT Session 1 (9 AM – 12 PM) — HR Admin role:**
- [ ] Create employee from scratch (not bulk import)
- [ ] Upload ID proof document
- [ ] Assign asset (laptop)
- [ ] Generate offer letter
- [ ] Generate experience letter
- [ ] Run attendance regularization for a past date
- [ ] Process a full-and-final settlement for a test employee

**UAT Session 2 (12 PM – 3 PM) — Recruiter role:**
- [ ] Process 3 walk-in candidates end-to-end
- [ ] Use ATS sourcing analysis dashboard
- [ ] Reject a candidate with remarks
- [ ] Use the onboarding bridge

**UAT Session 3 (3 PM – 6 PM) — Fix session:**
- [ ] Log all issues found in UAT
- [ ] Fix P1 (blocker) issues immediately
- [ ] Document P2 (minor) issues for post-launch
- [ ] Re-test fixed flows

**End of Day 5 Checkpoint:** UAT complete, all P1 issues resolved.

---

### Day 6 — Sunday, 9th June
**Theme: Final hardening + training + go-live prep**

#### Morning (9 AM – 1 PM) — Engineering
- [ ] Final production deployment with all UAT fixes
- [ ] Enable production domain (e.g. hrms.mascallnet.com)
- [ ] SSL certificate configuration
- [ ] Set production env vars:
  ```
  NODE_ENV=production
  JWT_SECRET=<strong 32-char secret>
  PORTAL_JWT_SECRET=<strong 32-char secret>
  PAYROLL_BANK_KEY=<strong 16+ char secret>
  COMM_SECRET=<strong 16+ char secret>
  FRONTEND_URL=https://hrms.mascallnet.com
  ```
- [ ] Test production URL — all flows working
- [ ] Backup production database

#### Afternoon (2 PM – 6 PM) — HR Admin
- [ ] **Quick training sessions** (30 min each):
  - Recruiter team: ATS walk-in flow, candidate stages, onboarding
  - WFM team: Roster creation, live tracker, RTA board
  - HR team: Employee lifecycle, documents, leave approvals
  - Finance team: Payroll run, statutory, TDS
  - Managers: Leave approval, attendance, team dashboard
- [ ] Create user accounts for all staff
- [ ] Share login credentials and the platform URL
- [ ] Configure notification preferences for each team

**End of Day 6 Checkpoint:** System live on production domain, all users created, team trained.

---

### Day 7 — Monday, 10th June 🚀
**LAUNCH DAY**

#### Morning (9 AM – 11 AM) — CEO + HR Admin
- [ ] CEO walkthrough of the platform (30 min demo)
  - Command Center / Dashboard
  - Live ATS pipeline
  - Employee directory
  - Roster for the week
  - Communication working
- [ ] Send all-hands communication to employees with login details
- [ ] Walk-in registration goes live — recruiters use `/ats/waiting-queue`
- [ ] First real roster acknowledged by employees

#### Day 1 Live Monitoring (11 AM – 6 PM)
- [ ] Monitor `/api/health` endpoint
- [ ] Watch for login issues → escalate immediately
- [ ] First payroll run (if month-end): Finance team runs payroll
- [ ] Check `/communication/dispatch` — ensure notifications are sending
- [ ] Client portal access: share portal login to clients

---

## Post-Launch — Week of 11th–17th June

| Day | Activity |
|---|---|
| 11th | First full day of real attendance — monitor clock-in data |
| 12th | Review any errors, fix P2 issues from UAT |
| 13th | Payroll reconciliation if running mid-month |
| 14th | Enable Quality/Operations dashboards (Phase 2 build) |
| 17th | First week review — CEO + HR + WFM |

---

## Infrastructure Requirements

### Production Server Setup

**Backend (Express API):**
```
Server: Any Linux VPS — minimum 2 vCPU, 4 GB RAM
OR: Railway.app (existing setup)
Port: 5055
Node.js: 18+
```

**Frontend (React Static):**
```
Vercel (recommended — already configured in CLAUDE.md)
OR: Nginx on same VPS
```

**Database:**
```
MySQL 8.0+ at 122.184.128.90 (already running)
Database: mas_hrms
Storage: minimum 50 GB
Backups: daily automated
```

**File Storage:**
```
backend/uploads/ folder — must be on persistent disk
Minimum: 100 GB for documents, resumes, payslips
Mount as persistent volume if using Railway/Docker
```

---

## Credentials to Collect Before 4th June

Have these ready before Day 1 starts:

| Credential | What it is | Where to get it |
|---|---|---|
| Gmail App Password | For email sending | myaccount.google.com → Security → App Passwords |
| Twilio Account SID | SMS sending | console.twilio.com |
| Twilio Auth Token | SMS sending | console.twilio.com |
| Twilio Messaging Service SID | SMS sending | Twilio → Messaging → Services |
| Production domain | Where the app lives | Your domain registrar |
| SSL certificate | HTTPS | Free via Let's Encrypt |

---

## Risk Register

| Risk | Probability | Impact | Mitigation |
|---|---|---|---|
| Production DB migration fails | Low | High | Run on staging first, backup before running |
| Bulk employee import errors | Medium | Medium | Validate in staging with 5 test employees first |
| Email delivery issues | Medium | Medium | Test before Day 1 ends; have WhatsApp as fallback |
| User adoption resistance | Medium | High | 30-min role-based training on Day 6 |
| Late credential collection | High | Medium | Collect all credentials by 3rd June EOD |
| Quality/Ops dashboards not ready | High | Low | These are non-blocking; QA/Ops roles will see a placeholder |

---

## Go / No-Go Checklist for 10th June

**Must be ✅ before launch:**
- [ ] `/api/health` returns `{"db":"connected"}` on production
- [ ] All 71 SQL migrations applied
- [ ] At least 10 employees successfully imported
- [ ] 1 walk-in candidate processed end-to-end through ATS
- [ ] Email sending confirmed working
- [ ] At least 1 roster published and acknowledged
- [ ] All 12 roles have at least 1 user assigned
- [ ] Client portal login working for at least 1 client
- [ ] Production domain + SSL live

**Can launch with these pending (P2):**
- [ ] Quality Dashboard (placeholder page — visible but empty)
- [ ] Operations Dashboard (placeholder page)
- [ ] WhatsApp (optional — email + SMS sufficient for launch)
- [ ] Payroll first run (can do after launch week)

---

## CEO Demo Script (10th June, 30 minutes)

1. **Walk-in registration** (2 min) — open on phone, register a candidate without logging in
2. **Recruiter view** (3 min) — candidate appears instantly, move through stages
3. **Employee created** (2 min) — show employee in directory after onboarding
4. **Live attendance** (2 min) — employee clocks in, admin sees it in real-time
5. **Roster for week** (3 min) — show published roster, employee acknowledgement
6. **Leave approval** (2 min) — apply leave as employee, approve as manager
7. **Payslip** (2 min) — HR generates payslip, employee views it
8. **Client portal** (3 min) — client logs in, sees only their process KPIs
9. **Communication** (2 min) — send test SMS/email from admin panel
10. **Dashboard / Command Center** (5 min) — CEO view, all KPIs, headcount, attrition
11. **Q&A** (4 min)

---

*Plan prepared by engineering team — 3rd June 2026*
*Platform repository: https://github.com/tausifansari-mcn/HRMS*
