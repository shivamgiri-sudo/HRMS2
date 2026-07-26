# BPO Report Coverage Gap Analysis
## Mapping 32 Operational Domains to 14 Master Reports

**Document type:** Coverage Gap Analysis
**Branch:** agent/deep-section-reports
**Date:** 2026-07-26
**Author:** PR #59 Task 2 - Deep Section Reports

---

## Purpose

This document maps 32 BPO operational domains against the 14 existing master report codes
defined in the HRMS2 report catalog. For each domain it records:

- What data tables actually exist in `backend/sql/` migrations (verified by code inspection)
- Which master report already covers the domain
- What fields are missing from current report definitions
- Where missing source data would come from
- Where the missing fields should be added (recommended placement)
- Whether a new master report is required (answer for this phase: **none**)

---

## Reference: 14 Existing Master Report Codes

| # | Report Code |
|---|-------------|
| 1 | bpo-operations-productivity-master |
| 2 | bpo-employee-performance-360-master |
| 3 | bpo-client-sla-delivery-master |
| 4 | bpo-wfm-attendance-shrinkage-master |
| 5 | bpo-hr-workforce-lifecycle-master |
| 6 | bpo-payroll-statutory-master |
| 7 | bpo-finance-pnl-profitability-master |
| 8 | bpo-quality-risk-compliance-master |
| 9 | bpo-recruitment-training-readiness-master |
| 10 | bpo-admin-asset-facility-master |
| 11 | bpo-management-executive-master |
| 12 | bpo-audit-compliance-control-master |
| 13 | bpo-interview-to-exit-journey-ledger |
| 14 | bpo-report-data-lineage-reconciliation-master |

---

## Domain Coverage Table

| # | MODULE | AVAILABLE DATA (verified tables) | CURRENT REPORT | MISSING FIELDS | MISSING SOURCE | RECOMMENDED PLACEMENT | NEW REPORT | BUSINESS OWNER | COMPLIANCE IMPACT |
|---|--------|----------------------------------|----------------|---------------|----------------|----------------------|------------|----------------|-------------------|
| 1 | **SALES AND BUSINESS DEVELOPMENT** | `integration_hub_config` row `crm` (008_integration_hub.sql); no dedicated CRM/sales schema in `mas_hrms` | bpo-finance-pnl-profitability-master (partial: revenue actuals only) | Pipeline stage, deal size, win/loss ratio, sales cycle days, conversion by vertical | Upstream CRM system (external); pull via Integration Hub CRM connector | Add Business Development Pipeline sub-section to `bpo-finance-pnl-profitability-master` | **No** | Business Head / Finance | Low |
| 2 | **CLIENT CONTRACT AND RATE GOVERNANCE** | `contract_master`, `vendor_master` (024_erp.sql); `process_billing_rate`, `finance_period` (377); `billing_unit`, `billing_invoice` (036_erp_billing.sql); `clients` (101_client_master_enhancement.sql) | bpo-client-sla-delivery-master (SLA side); bpo-finance-pnl-profitability-master (billing side) | Contract expiry dates, rate-card version history, rate escalation schedule, SLA penalty clauses, approved vs. billed rate reconciliation | `contract_master.expiry_date` and effective-dated rate-card version table missing | Add Contract and Rate Governance sub-section to `bpo-client-sla-delivery-master`; billing reconciliation to `bpo-finance-pnl-profitability-master` | **No** | Finance / Account Management | Medium - audit evidence for client disputes |
| 3 | **CAPACITY AND SEAT UTILISATION** | `branch_master` (001_core_org.sql); `wfm_roster_plan`, `wfm_roster_assignment` (005); `wfm_slot_requirement` (233); `workforce_mandate` (022b) - no `branch_seat_capacity` table exists | bpo-wfm-attendance-shrinkage-master (roster grain) | Total seats per branch, allocated seats, idle seats, seat utilisation %, infrastructure cost per seat | `branch_seat_capacity` table absent; needs new migration column on `branch_master` or a new table | Add Capacity and Seat Utilisation section to `bpo-wfm-attendance-shrinkage-master`; infrastructure cost to `bpo-finance-pnl-profitability-master` | **No** | WFM / Facilities | Low |
| 4 | **FORECAST VERSUS ACTUAL** | `wfm_slot_requirement` (233), `wfm_roster_plan` (005), `shrinkage_daily_snapshot` (021b), `process_delivery_actual` (415), `wfm_process_planning_rule` (232) - dedicated `wfm_forecast` table absent | bpo-wfm-attendance-shrinkage-master | Forecasted call volume, forecasted AHT, actual vs. forecast variance %, shrinkage forecast vs. actual | `wfm_forecast` table missing; `wfm_slot_requirement.required_headcount` is only numeric demand anchor | Add Forecast vs. Actual sub-section to `bpo-wfm-attendance-shrinkage-master`; operational KPI variance to `bpo-operations-productivity-master` | **No** | WFM / Operations | Low |
| 5 | **REAL-TIME OPERATIONS / RTA** | `rta_roster_sync_log` (223); `adherence_alert` (021b); `attendance_reconciliation_record` (021b); `wfm_attendance_session`, `wfm_break_log` (005); `wfm_external_punch_staging` (005) - no interval-level `rta_event` table | bpo-wfm-attendance-shrinkage-master (adherence alerts) | Real-time agent state, interval-level call volume, occupancy %, live schedule adherence score | `rta_event` interval table absent; dialer/iSpark arrives via `wfm_external_punch_staging` (staging only) | Add RTA and Adherence sub-section to `bpo-wfm-attendance-shrinkage-master`; live KPI tiles to `bpo-operations-productivity-master` | **No** | WFM / RTA | Low |
| 6 | **WORKFORCE FORECASTING** | `wfm_slot_requirement` (233), `wfm_process_planning_rule` (232), `workforce_mandate` (022b), `attrition_snapshot` (011) - no `wfm_forecast` or `demand_plan` table | bpo-wfm-attendance-shrinkage-master | Long-range headcount demand, shrinkage assumption inputs, seasonal adjustment factors, hiring demand pipeline linkage | Forecast table absent; `wfm_slot_requirement.required_headcount` is the only numeric demand anchor | Add Workforce Demand Forecast sub-section to `bpo-wfm-attendance-shrinkage-master`; headcount gap to `bpo-recruitment-training-readiness-master` | **No** | WFM / HR | Low |
| 7 | **ABSENTEEISM AND ATTRITION** | `leave_request`, `leave_balance_ledger` (006); `exit_request`, `attrition_snapshot` (011); `wfm_attendance_session` (005); `shrinkage_daily_snapshot` (021b); `employee_lifecycle_event` (016) | bpo-wfm-attendance-shrinkage-master (absence); bpo-hr-workforce-lifecycle-master (exit/attrition) | Absenteeism rate by branch/process/week, AWOL count, voluntary vs. involuntary split, 30/60/90-day attrition cohort | Tables exist; cohort bucketing derivable from `exit_request.exit_type` not yet in report | Add cohort attrition sub-section to `bpo-hr-workforce-lifecycle-master`; weekly absenteeism KPI to `bpo-wfm-attendance-shrinkage-master` | **No** | HR / WFM | Medium - statutory evidence for attrition reporting |
| 8 | **LEAVE LIABILITY** | `leave_balance_ledger`, `leave_type_master` (006); leave encashment (018_payroll_exit_completion.sql); `salary_prep_line` (007_payroll.sql) | bpo-hr-workforce-lifecycle-master (leave balances); bpo-payroll-statutory-master (encashment) | Leave liability valuation (days x daily rate), projected encashment liability at year-end, leave-liability-to-headcount ratio | `leave_balance_ledger` exists; daily rate join to `salary_prep_line` computable but not materialised | Add Leave Liability sub-section to `bpo-payroll-statutory-master`; accrual summary to `bpo-finance-pnl-profitability-master` | **No** | Finance / Payroll | High - accrual accounting, gratuity and F&F obligation |
| 9 | **EMPLOYEE ENGAGEMENT** | `survey_master`, `survey_question`, `survey_response`, `pulse_check`, `gamification_point_log`, `kudos_transaction`, `employee_tier_status` (038_engagement_gamification.sql); `people_experience_health_snapshot` (204) | bpo-hr-workforce-lifecycle-master (partial: sentiment/health snapshot) | eNPS score trend, participation rate by branch, top detractor themes, gamification activity score, recognition rate | Tables exist; aggregation logic for eNPS bucketing and participation % not in current report definitions | Add Engagement and Recognition sub-section to `bpo-hr-workforce-lifecycle-master` | **No** | HR | Low |
| 10 | **GRIEVANCES AND DISCIPLINARY CASES** | `grievance` (016_employee_lifecycle.sql); `posh_complaint` (029_labour_law.sql); no `disciplinary_action` or `show_cause_notice` table found in any migration | bpo-hr-workforce-lifecycle-master (grievance); bpo-audit-compliance-control-master (POSH) | Disciplinary case status, show-cause issuance, suspension pending enquiry, case resolution TAT, recurrence rate | `disciplinary_action` table missing - only `grievance` and `posh_complaint` exist | Add Grievance and Disciplinary section to `bpo-hr-workforce-lifecycle-master`; POSH stats to `bpo-audit-compliance-control-master` | **No** - `disciplinary_action` migration is Phase 2 backlog | HR / Compliance | High - POSH Act statutory obligation |
| 11 | **PERFORMANCE APPRAISAL** | `kpi_score`, `kpi_assignment`, `kpi_template`, `kpi_metric_master` (010_kpi.sql); `management_kpi_summary`, `coaching_session`, `performance_alert` (019_performance_surfaces.sql) | bpo-employee-performance-360-master | Annual appraisal cycle status, bell-curve distribution, increment recommendation, promotion eligibility flag | Appraisal cycle orchestration table absent; `kpi_score` records scores but not cycle state or increment recommendation | Add Appraisal Cycle Summary sub-section to `bpo-employee-performance-360-master` | **No** | HR / Line Manager | Medium - evidence for salary revision audit |
| 12 | **COACHING AND PIP** | `coaching_session` (019_performance_surfaces.sql); `pip_record`, `pip_checkpoint` (023_career_pip.sql); `career_path` (023) | bpo-employee-performance-360-master | Coaching session completion rate, PIP success rate, PIP-to-exit conversion rate, coach workload per supervisor, PIP extension count | Tables exist and are complete for basic metrics | Add Coaching and PIP sub-section to `bpo-employee-performance-360-master` | **No** | Operations / HR | Medium - compliance documentation for involuntary exit |
| 13 | **LEARNING AND CERTIFICATION** | `lms_employee_mapping`, `lms_learning_progress_snapshot`, `lms_certification_snapshot`, `lms_sync_audit_log` (020_lms_integration.sql); `lms_learner_progress`, `lms_assessment_scores`, `lms_sync_audit` (250_lms_integration_schema.sql); sync audit (252) | bpo-recruitment-training-readiness-master | Trainer effectiveness score (from LMS), certification expiry alerts, module-wise completion rate, time-to-certification by cohort | LMS is external deployed system; data arrives via sync snapshots; trainer effectiveness score field absent from sync tables | Add Certification Readiness sub-section to `bpo-recruitment-training-readiness-master` | **No** | Training / LMS Integration | Medium - Operations handover-readiness gating |
| 14 | **RECRUITMENT SOURCE EFFECTIVENESS** | `ats_sourcing_channel` (004_ats.sql); `ats_candidate.sourcing_channel` column (004); `ats_candidate_stage_log` (004); `ats_onboarding_bridge` (004) | bpo-recruitment-training-readiness-master | Cost per hire by source, time-to-fill by source, offer-to-joining ratio by source, quality-of-hire score at 90 days | `ats_sourcing_channel` and `sourcing_channel` column exist; `cost_per_hire` and 90-day quality score fields absent | Add Source Effectiveness sub-section to `bpo-recruitment-training-readiness-master` | **No** | Recruitment | Low |
| 15 | **TRAINER EFFECTIVENESS** | `coaching_session` (019) - coach_id available; `lms_learner_progress` (250) - batch linked; no dedicated trainer effectiveness score table | bpo-recruitment-training-readiness-master | Trainer NPS, average time-to-competency for trainer cohorts, pass-rate per trainer, class size vs. outcomes | Trainer rating table missing; LMS is authoritative source for trainer scores (external system) | Add Trainer Effectiveness sub-section to `bpo-recruitment-training-readiness-master`; surface via LMS sync | **No** | Training | Medium - identifies training quality risk |
| 16 | **QUALITY CALIBRATION** | Calibration page-access rows in `102_role_page_access_seed.sql`; no dedicated `quality_calibration` or `call_calibration` schema table exists in any migration | bpo-quality-risk-compliance-master | Calibration session count, calibration score variance, inter-rater reliability index, calibration action items resolved | `quality_calibration` table absent; call quality data arrives via iSpark/dialer connector | Add Quality Calibration sub-section to `bpo-quality-risk-compliance-master`; data from dialer KPI connector | **No** - `quality_calibration` table is Phase 7 backlog | Quality / Operations | Medium - ISO/client audit requirement |
| 17 | **CLIENT ESCALATIONS** | `escalation_matrix_master`, `task_escalation_log` (294_tat_escalation_matrix.sql); `client_audit_log` (101); `process_performance_metrics` (101) - no dedicated `client_escalation` ticket table | bpo-client-sla-delivery-master | Escalation ticket count by severity, escalation-to-resolution TAT, repeat escalation rate, root-cause classification, client satisfaction post-resolution | Dedicated `client_escalation` table absent; `task_escalation_log` captures internal TAT escalations only | Add Client Escalation sub-section to `bpo-client-sla-delivery-master` | **No** - `client_escalation` table is Phase 7 backlog | Account Management | High - client SLA penalty evidence |
| 18 | **DATA PRIVACY / DPDP** | `data_consent`, `data_rights_request`, `data_retention_policy`, `dpdp_config` (030); `dpdp_consent_withdrawal`, `dpdp_withdrawal_audit_log`, `dpdp_processing_hold`, `dpdp_withdrawal_task`, `dpdp_withdrawal_evidence` (293/513); `security_audit_event` (521) | bpo-audit-compliance-control-master | Data rights request fulfilment rate, consent withdrawal TAT, data retention breach count, DPDP processing hold count, DPA audit readiness score | Tables exist and are comprehensive; aggregation report section not yet defined | Add DPDP Compliance sub-section to `bpo-audit-compliance-control-master` | **No** | DPO / Compliance | Critical - India DPDP Act 2023 statutory obligation |
| 19 | **STATUTORY FILING** | `employee_uan`, `esic_contribution_summary`, `pt_slab_master`, `minimum_wage_master` (028_statutory_compliance.sql); `statutory_config`, `salary_prep_run` (007) - no `pf_submission_log` or `esi_submission_log` found | bpo-payroll-statutory-master | PF challan filing status per period, ESIC challan filing status, PT filing status, filing due date vs. actual, penalty exposure | `pf_submission_log` and `esi_submission_log` absent; `esic_contribution_summary.challan_status` is the only filing-status field | Add Statutory Filing Tracker sub-section to `bpo-payroll-statutory-master` | **No** - `pf_submission_log`/`esi_submission_log` are Phase 5 backlog | Payroll / Compliance | Critical - PF/ESIC/PT statutory filing deadline |
| 20 | **INTERNAL AUDIT** | `audit_action_log` (020_lms_integration.sql, 131, 1002); `security_audit_event` (521); `finance_action_audit_log` (413); `client_audit_log` (101) | bpo-audit-compliance-control-master | Audit finding count by severity, open vs. closed findings, repeat observations, auditee department response rate, corrective action closure TAT | Multiple module-specific audit logs exist but no unified internal audit finding table; `corrective_action` table absent (domain 32) | Add Internal Audit sub-section to `bpo-audit-compliance-control-master` drawing from `security_audit_event` and `finance_action_audit_log` | **No** | Internal Audit / Compliance | High - audit committee and ISO evidence |
| 21 | **ACCESS REVIEW** | `workforce_role_catalog`, `user_roles`, `user_assignment_scope`, `role_page_access` (003_access_control.sql); `security_audit_event` (521); `auth_session` (530) - no `user_access_review` or `access_certification` table | bpo-audit-compliance-control-master | Stale access count, privileged account review status, access certification completion rate, orphaned accounts, last login > 90 days | `user_access_review` certification table absent; access state derivable from `user_roles` + `auth_session` | Add Access Review sub-section to `bpo-audit-compliance-control-master` | **No** - `user_access_review` table is Phase 2/12 backlog | IT Security / Compliance | High - ISO 27001 access review control |
| 22 | **ASSET RECOVERY** | `asset_master`, `asset_assignment`, `asset_service_log` (016_employee_lifecycle.sql); `exit_clearance_checklist`, `exit_request` (011_exit_management.sql) | bpo-admin-asset-facility-master (asset side); bpo-interview-to-exit-journey-ledger (exit clearance side) | Asset pending recovery count at exit, recovery SLA breach count, asset write-off at exit, recovery value vs. cost, depot turnaround TAT | Tables exist and are sufficient; cross-join between `asset_assignment` and `exit_clearance_checklist` not materialised in any report | Add Asset Recovery at Exit sub-section to `bpo-admin-asset-facility-master`; clearance linkage to `bpo-interview-to-exit-journey-ledger` | **No** | Admin / HR | Medium - fixed asset register compliance |
| 23 | **VENDOR AND PROCUREMENT** | `vendor_master`, `contract_master`, `expense_claim`, `procurement_request` (024_erp.sql); `vendor_payment_transaction`, `bank_master`, `grn_request`, `vendor_payment_tracking`, `finance_action_audit_log` (413); `vendor_payment_tracking` (310) | bpo-finance-pnl-profitability-master (cost side); bpo-admin-asset-facility-master (procurement side) | Vendor performance score, PO-to-GRN cycle time, pending PO count, vendor payment ageing, procurement savings vs. budget | Tables exist at transaction level; vendor performance scoring and savings vs. budget fields absent | Add Vendor and Procurement sub-section to `bpo-finance-pnl-profitability-master` | **No** | Finance / Admin | Medium - accounts payable audit |
| 24 | **BUDGET VERSUS ACTUAL** | `pnl_allocation_policy` (415); `process_monthly_plan`, `pnl_adjustment_journal`, `pnl_period_signoff`, `process_billing_rate`, `finance_period` (377) - no `budget_master` or `budget_allocation` table | bpo-finance-pnl-profitability-master | Annual budget per cost centre, monthly budget phasing, YTD actual vs. budget variance %, forecast-to-close, budget reforecast log | `budget_master` table absent; `process_monthly_plan` covers only process-level revenue/cost targets | Add Budget vs. Actual sub-section to `bpo-finance-pnl-profitability-master` | **No** - `budget_master` is Phase 9 ERP backlog | Finance | High - CFO and board financial reporting |
| 25 | **GRN AND PAYABLE** | `grn_request` (413); `vendor_payment_transaction` (413); `bank_master` (413); `vendor_payment_tracking` (310); `procurement_request` (024) - normalised `grn_header`/`grn_line` absent | bpo-finance-pnl-profitability-master | GRN-to-invoice match rate, 3-way match exception count, ageing payable bucket (0-30, 31-60, 60+ days), disputed invoice count | Normalised `grn_header`/`grn_line` tables absent; `grn_request` is a simplified record; 3-way match logic absent | Add GRN and Payables Ageing sub-section to `bpo-finance-pnl-profitability-master` | **No** - normalised GRN tables are Phase 9 ERP backlog | Finance | Medium - accounts payable audit |
| 26 | **COLLECTIONS AND RECEIVABLES** | `billing_invoice` (036_erp_billing.sql, 999_fix_missing_ceo_metrics_tables.sql); `billing_unit` (036) - `payment_receipt` table not found in any migration | bpo-finance-pnl-profitability-master | DSO (days sales outstanding), ageing receivable bucket, disputed invoice count, collection efficiency %, bad-debt provision | `payment_receipt` table absent; `billing_invoice` has a status column but no receipt linkage | Add Collections and Receivables sub-section to `bpo-finance-pnl-profitability-master` | **No** - `payment_receipt` is Phase 9 ERP backlog | Finance | High - revenue recognition and cash flow |
| 27 | **BRANCH PROFITABILITY** | `process_revenue_rule`, `process_delivery_actual`, `process_revenue_component`, `process_pnl_cost_component`, `pnl_cost_classification_rule`, `pnl_allocation_policy` (415_bpo_pnl_revenue_cost_model.sql); `branch_master` (001_core_org.sql) | bpo-finance-pnl-profitability-master | Branch-level EBITDA, revenue per seat, cost per seat, branch P&L waterfall, inter-branch cost allocation | `pnl_allocation_result` is derivable from the cost model; branch grain exists via `branch_master` join | Add Branch Profitability sub-section to `bpo-finance-pnl-profitability-master` | **No** | Finance / Branch Head | High - management accounts |
| 28 | **PROCESS / LOB PROFITABILITY** | `process_revenue_rule`, `process_delivery_actual`, `process_revenue_component`, `process_pnl_cost_component` (415); `process_billing_rate`, `process_monthly_plan`, `pnl_period_signoff` (377); `process_master`, `lob_master` (001) | bpo-finance-pnl-profitability-master | LOB-level contribution margin, revenue per FTE, cost-to-serve per LOB, LOB-level SLA penalty deduction | Tables exist at the right grain; LOB contribution margin and cost-to-serve require JOIN across delivery actuals and cost components | Add Process/LOB Profitability sub-section to `bpo-finance-pnl-profitability-master` | **No** | Finance / Process Manager | High - client P&L and billing verification |
| 29 | **VISITOR AND PHYSICAL SECURITY** | `visitor_profile`, `visitor_visit`, `visitor_companion`, `visitor_consent`, `visitor_approval`, `visitor_badge`, `visitor_check_event`, `visitor_belonging`, `visitor_vehicle`, `visitor_security_exception`, `visitor_configuration` (409_visitor_management_foundation.sql) | bpo-admin-asset-facility-master | Visitor count by day/branch, uncleared visitor alerts, average dwell time, security exception rate, badge issuance turnaround | Tables are comprehensive; report section not yet defined in `bpo-admin-asset-facility-master` | Add Visitor and Physical Security sub-section to `bpo-admin-asset-facility-master` | **No** | Admin / Security | Medium - physical security audit evidence |
| 30 | **HELPDESK AND IT SLA** | `helpdesk_ticket`, `helpdesk_ticket_comment` (016_employee_lifecycle.sql and 204_people_experience_command_center.sql); `tat_matrix_master`, `task_tat_instance`, `task_escalation_log` (294_tat_escalation_matrix.sql) | bpo-admin-asset-facility-master | Helpdesk ticket SLA compliance rate, first-contact resolution rate, repeat ticket rate, open-ticket ageing bucket, IT downtime incident count | `helpdesk_ticket` table exists; lacks `resolution_time` and `sla_target` columns; IT-category filter absent | Add IT Helpdesk SLA sub-section to `bpo-admin-asset-facility-master` | **No** | IT / Admin | Medium - ISO 20000 / ITIL evidence |
| 31 | **BUSINESS CONTINUITY** | No `bcp_plan` or `incident_log` table found in any migration file; `security_audit_event` (521) captures security incidents only | bpo-audit-compliance-control-master (partial: security incident side) | BCP test completion dates, BCP invocation count, RTO/RPO test results, DR drill outcomes, critical dependency mapping | `bcp_plan` and `incident_log` tables completely absent from schema | Add Business Continuity stub section to `bpo-audit-compliance-control-master`; mark as Phase 10 data-gap | **No** - `bcp_plan`/`incident_log` migration is Phase 10 backlog | IT / Risk | High - ISO 22301, client audit requirement |
| 32 | **RISK AND CORRECTIVE ACTION** | No `risk_register` or `corrective_action` table found in any migration file; `security_audit_event` (521) and `posh_complaint` (029) are the closest risk-adjacent tables | bpo-audit-compliance-control-master (partial: security and POSH risk events) | Risk ID, risk category, likelihood, impact, inherent score, control effectiveness, residual score, corrective action owner, closure date | `risk_register` and `corrective_action` tables completely absent from schema | Add Risk Register and CAR stub section to `bpo-audit-compliance-control-master`; mark as Phase 10 data-gap | **No** - `risk_register`/`corrective_action` migration is Phase 10 backlog | Risk / Compliance | High - ISO 31000, client and regulatory audit |

---

## Missing Table Backlog Summary

The following tables were found to be **absent** from all `backend/sql/` migration files and must be created in future phases before the corresponding report sub-sections can be fully populated:

| Missing Table | Domain | Target Phase | Recommended Report |
|---|---|---|---|
| `branch_seat_capacity` | Capacity and Seat Utilisation (3) | Phase 4 (WFM) | bpo-wfm-attendance-shrinkage-master |
| `wfm_forecast` | Forecast vs. Actual (4), Workforce Forecasting (6) | Phase 4 (WFM) | bpo-wfm-attendance-shrinkage-master |
| `rta_event` (interval-level) | Real-Time Operations / RTA (5) | Phase 7 (Ops/Quality) | bpo-wfm-attendance-shrinkage-master |
| `disciplinary_action` / `show_cause_notice` | Grievances and Disciplinary (10) | Phase 2 (Employee Lifecycle) | bpo-hr-workforce-lifecycle-master |
| `quality_calibration` | Quality Calibration (16) | Phase 7 (Ops/Quality) | bpo-quality-risk-compliance-master |
| `client_escalation` | Client Escalations (17) | Phase 7 (Ops/Quality) | bpo-client-sla-delivery-master |
| `pf_submission_log` | Statutory Filing (19) | Phase 5 (Payroll) | bpo-payroll-statutory-master |
| `esi_submission_log` | Statutory Filing (19) | Phase 5 (Payroll) | bpo-payroll-statutory-master |
| `user_access_review` | Access Review (21) | Phase 2/12 (Access) | bpo-audit-compliance-control-master |
| `budget_master` | Budget vs. Actual (24) | Phase 9 (ERP) | bpo-finance-pnl-profitability-master |
| `grn_header` / `grn_line` (normalised) | GRN and Payable (25) | Phase 9 (ERP) | bpo-finance-pnl-profitability-master |
| `payment_receipt` | Collections and Receivables (26) | Phase 9 (ERP) | bpo-finance-pnl-profitability-master |
| `bcp_plan` / `incident_log` | Business Continuity (31) | Phase 10 | bpo-audit-compliance-control-master |
| `risk_register` / `corrective_action` | Risk and Corrective Action (32) | Phase 10 | bpo-audit-compliance-control-master |

---

## Report-to-Domain Mapping Summary

| Master Report | Domains Covered | Missing Sub-sections to Add |
|---|---|---|
| bpo-operations-productivity-master | 4 (partial), 5 (partial) | Forecast vs. Actual operational KPI variance; RTA live KPI tiles |
| bpo-employee-performance-360-master | 11, 12 | Appraisal Cycle Summary; Coaching and PIP |
| bpo-client-sla-delivery-master | 2 (partial), 17 | Contract and Rate Governance; Client Escalation |
| bpo-wfm-attendance-shrinkage-master | 3, 4, 5, 6, 7 (partial) | Capacity/Seat; Forecast vs. Actual; RTA/Adherence; Workforce Forecasting; Absenteeism cohort |
| bpo-hr-workforce-lifecycle-master | 7 (partial), 9, 10 | Attrition cohort; Engagement and Recognition; Grievance and Disciplinary |
| bpo-payroll-statutory-master | 8, 19 | Leave Liability; Statutory Filing Tracker |
| bpo-finance-pnl-profitability-master | 1, 2 (partial), 8 (partial), 23, 24, 25, 26, 27, 28 | BD Pipeline; Contract Rate Recon; Leave Liability accrual; Vendor/Procurement; Budget vs. Actual; GRN/Payables; Collections; Branch P&L; LOB P&L |
| bpo-quality-risk-compliance-master | 16, 18 (partial) | Quality Calibration; DPDP sub-section |
| bpo-recruitment-training-readiness-master | 13, 14, 15 | Certification Readiness; Source Effectiveness; Trainer Effectiveness |
| bpo-admin-asset-facility-master | 22 (partial), 23 (partial), 29, 30 | Asset Recovery at Exit; Vendor/Procurement; Visitor/Physical Security; IT Helpdesk SLA |
| bpo-management-executive-master | 27 (roll-up), 28 (roll-up) | Branch and LOB P&L executive roll-up |
| bpo-audit-compliance-control-master | 18, 19 (partial), 20, 21, 31, 32 | DPDP Compliance; Access Review; Internal Audit; BCP stub; Risk/CAR stub |
| bpo-interview-to-exit-journey-ledger | 22 (partial) | Asset Recovery clearance linkage at exit |
| bpo-report-data-lineage-reconciliation-master | All 32 | Data lineage entries for each domain; missing-source stubs for backlog tables |

---

## Conclusion

**Total domains analysed:** 32

**Domains fully covered by existing master reports (tables present, fields derivable):**
Domains 7, 8, 9, 12, 13, 14, 18, 22, 23, 27, 28, 29 - 12 domains have all required source tables in place.

**Domains partially covered (tables exist, sub-section or fields need adding to existing reports):**
Domains 1, 2, 3, 4, 5, 6, 10, 11, 15, 16, 17, 19, 20, 21, 24, 25, 26, 30 - 18 domains require new sub-sections or columns added to existing master reports.

**Domains with blocking schema gaps (tables completely absent):**
Domains 10 (disciplinary_action), 16 (quality_calibration), 17 (client_escalation), 19 (pf/esi submission logs), 21 (user_access_review), 24 (budget_master), 25 (grn_header/line), 26 (payment_receipt), 31 (bcp_plan/incident_log), 32 (risk_register/corrective_action) - 10 domains have one or more missing tables, all scheduled for future phase migrations.

**New master reports required for this phase: NONE.**

All 32 BPO operational domains can be accommodated within the 14 existing master report codes. The correct approach for this phase is to:

1. Add sub-sections and fields to existing master reports where source tables are present.
2. Register data-gap stubs (placeholder rows with `data_available: false`) in `bpo-report-data-lineage-reconciliation-master` for the 14 missing tables.
3. Raise migration tickets for the 14 missing tables in their respective delivery phases.
4. Avoid creating new top-level report codes until Phase 9-10 ERP and Operations completions introduce genuinely orthogonal report dimensions.

> **Decision:** No new master report codes are to be created as part of PR #59. All gap remediation is via sub-section additions to the 14 existing masters.
