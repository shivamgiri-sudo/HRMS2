# PeopleOS CEO Demo — Login Matrix

## Demo Password
Source: `PEOPLEOS_DEMO_PASSWORD` env var  
Fallback (non-production only): `Demo@12345!`  
All demo users must change password on first real login (force_change_password = true).

## Demo Users

| Email | Role | Expected Visible Modules | Notes |
|-------|------|--------------------------|-------|
| superadmin@demo.peopleOS.ai | Super Admin | All modules | Full access |
| hradmin@demo.peopleOS.ai | HR Admin | Employees, ATS, Docs, Lifecycle, Leave, Exit, HR Dashboard | No payroll run |
| recruiter@demo.peopleOS.ai | Recruiter | Assigned ATS candidates only | Scoped by assignment |
| employee@demo.peopleOS.ai | Employee | Own profile, roster, leave, payslip, learning, assets, tickets | Self-only |
| wfm@demo.peopleOS.ai | WFM | Demand, Roster, RTA, Shrinkage, Attendance | Process-scoped |
| processmanager@demo.peopleOS.ai | Process Manager | Mapped process roster, performance, staffing, actions | Scoped |
| am@demo.peopleOS.ai | Assistant Manager | Mapped team actions, monitoring | No roster edit |
| tl@demo.peopleOS.ai | Team Leader | Team attendance, breaks, alerts, actions | No roster edit |
| qa@demo.peopleOS.ai | QA | Quality, performance, coaching | No payroll |
| trainer@demo.peopleOS.ai | Trainer | LMS readiness, training pipeline | No ATS edit |
| payroll@demo.peopleOS.ai | Payroll/Finance | Payroll, payslip, F&F, tax | No client portal |
| branchhead@demo.peopleOS.ai | Branch Head | Branch dashboard, roster, performance | No payroll detail |
| ceo@demo.peopleOS.ai | CEO/Leadership | Leadership dashboards, client health, staffing | Aggregate only |
| client@demo.peopleOS.ai | Client User | Client portal only — aggregate HC, training, roster coverage | No PII |

## Client Portal Demo
Client: MCN Demo Client  
Process: Neemans_Inbound (mapped)  
Visible: HC summary, training pipeline, roster coverage %, shortage risk, action plan  
NOT visible: salary, individual attendance reasons, raw roster rows, PII, grievances

## Demo Employees (MySQL)
See `backend/src/modules/demo/demo.seed.ts` for full list.  
Processes: Neemans_Inbound (Mumbai), Neemans_Outbound (Delhi)  
Support staff: PM, Manager, WFM, Trainer, MIS, HR, QA, TL, RTM/RTA

## How to Run Demo Seed (non-production only)
```bash
ALLOW_DEMO_SEED=true PEOPLEOS_DEMO_PASSWORD=Demo@12345! node -e "
  import('./dist/modules/demo/demo.seed.js').then(m => m.runDemoSeed().then(console.log))
"
```
Or via API (non-prod): `POST /api/demo/seed` with admin JWT.

## Security Notes
- Demo passwords are NEVER stored in MySQL
- Supabase Auth manages actual authentication
- MySQL tracks user_id → role mapping and force_change_password flag only
- All account control actions are audit-logged in account_control_log
