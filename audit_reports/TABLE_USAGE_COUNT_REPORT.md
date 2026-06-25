# TABLE_USAGE_COUNT_REPORT

**Generated:** 2026-06-25  
**Database:** mas_hrms  
**Latest Commit:** eb0f12b

## Usage Counts by Table

| Table | BE Route | BE Service | Raw SQL | FE Usage | Migration | Seed | Test |
|-------|----------|------------|---------|----------|-----------|------|------|
| ats_candidate | 0 | 198 | 163 | 1 | 136 | 0 | 0 |
| ats_candidate_documents | 0 | 2 | 1 | 0 | 1 | 0 | 0 |
| ats_onboarding_bridge | 0 | 27 | 23 | 0 | 8 | 0 | 0 |
| ats_onboarding_request | 0 | 15 | 13 | 0 | 5 | 0 | 0 |
| candidate_onboarding_profile | 0 | 27 | 25 | 0 | 111 | 0 | 0 |
| candidate_onboarding_autosave | 0 | 2 | 1 | 0 | 4 | 0 | 0 |
| candidate_onboarding_document | 0 | 9 | 8 | 0 | 2 | 0 | 0 |
| candidate_onboarding_bank_detail | 0 | 16 | 15 | 0 | 15 | 0 | 0 |
| candidate_bgv_check | 0 | 15 | 12 | 0 | 8 | 0 | 0 |
| candidate_bgv_report | 0 | 9 | 6 | 0 | 8 | 0 | 0 |
| candidate_bgv_consent | 0 | 5 | 4 | 0 | 4 | 0 | 0 |
| employees | 0 | 886 | 608 | 419 | 489 | 0 | 0 |
| employee_bank_detail | 0 | 22 | 18 | 0 | 15 | 0 | 0 |
| employee_documents | 0 | 21 | 16 | 1 | 11 | 0 | 0 |
| employee_document_vault | 0 | 2 | 0 | 0 | 2 | 0 | 0 |
| employee_statutory_info | 0 | 6 | 2 | 0 | 5 | 0 | 0 |
| employee_uan | 0 | 16 | 13 | 0 | 12 | 0 | 0 |
| employee_address | 0 | 0 | 0 | 0 | 4 | 0 | 0 |
| employee_emergency_contact | 0 | 5 | 3 | 0 | 8 | 0 | 0 |
| employee_nominee | 0 | 16 | 9 | 0 | 5 | 0 | 0 |
| employee_legacy_meta | 0 | 1 | 0 | 0 | 2 | 0 | 0 |
| attendance_daily_record | 0 | 116 | 75 | 0 | 48 | 0 | 0 |
| biometric_attendance_log | 0 | 4 | 3 | 0 | 4 | 0 | 0 |
| attendance_reconciliation_record | 0 | 11 | 8 | 0 | 7 | 0 | 0 |
| attendance_regularization | 0 | 22 | 13 | 0 | 25 | 0 | 0 |
| attendance_manual_override | 0 | 11 | 5 | 0 | 4 | 0 | 0 |
| attendance_exception | 0 | 8 | 6 | 0 | 2 | 0 | 0 |
| attendance_rule_config | 0 | 7 | 6 | 0 | 6 | 0 | 0 |
| leave_request | 0 | 40 | 27 | 7 | 44 | 0 | 0 |
| leave_balance_ledger | 0 | 16 | 14 | 0 | 30 | 0 | 0 |
| leave_el_accrual_ledger | 0 | 0 | 1 | 0 | 10 | 0 | 0 |
| leave_credit_schedule | 0 | 0 | 1 | 0 | 3 | 0 | 0 |
| leave_type_master | 0 | 30 | 32 | 0 | 59 | 0 | 0 |
| leave_policy_config | 0 | 0 | 0 | 0 | 24 | 0 | 0 |
| salary_prep_run | 0 | 80 | 79 | 0 | 24 | 0 | 0 |
| salary_prep_line | 0 | 89 | 81 | 1 | 29 | 0 | 0 |
| payroll_readiness_snapshot | 0 | 8 | 5 | 0 | 2 | 0 | 0 |
| payroll_readiness_flag | 0 | 3 | 1 | 0 | 2 | 0 | 0 |
| payroll_disbursement | 0 | 10 | 8 | 0 | 2 | 0 | 0 |
| payroll_salary_slabs | 0 | 5 | 2 | 0 | 6 | 0 | 0 |
| salary_register | 0 | 3 | 0 | 0 | 7 | 0 | 0 |

## Key Observations

1. **employees** is the most heavily used table (886 service references, 608 raw SQL, 419 frontend, 489 migrations)
2. **ats_candidate** is the second most used (198 service, 163 SQL, 136 migrations)
3. Several tables have **migration references but zero code usage**:
   - leave_el_accrual_ledger (10 migrations, 0 code)
   - leave_credit_schedule (3 migrations, 0 code)
   - leave_policy_config (24 migrations, 0 code)
   - employee_address (4 migrations, 0 code)
   - employee_legacy_meta (2 migrations, 1 code)
4. **employee_document_vault** has 2 migration references but zero code usage
5. **ats_candidate_documents** has minimal usage (2 service, 1 SQL, 1 migration)

## Tables Needing Review
- Tables with migrations but no code: Possible legacy/deprecated
- Tables with high migration count but low code: May indicate schema churn