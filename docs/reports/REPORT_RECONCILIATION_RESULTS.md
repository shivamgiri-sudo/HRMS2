# Report Reconciliation Results

_Template — to be populated after live validation run against staging/production-like database._

## Validation Methodology

Runtime validation runs against the connected `mas_hrms` database using:
`GET /api/reports/bpo-master/validation/source-accuracy?month=YYYY-MM`

This document captures the expected reconciliation rules and templates for results.

---

## Payroll Reconciliation

### Rule
```
SUM(salary_prep_line.net_salary) by run_id
= salary_prep_run.total_net
= SUM(salary_payslip.net_pay)
= approved_disbursal_total (when available)
```

### Timing Differences
- `salary_prep_run` and `salary_prep_line`: created at same time — no lag expected
- `salary_payslip`: generated from `salary_prep_line` — should match
- Bank disbursal: created after payroll approval — may differ if approval pending

### Results Template
| PAYROLL_MONTH | RUN_ID | PREP_LINE_TOTAL | RUN_TOTAL | PAYSLIP_TOTAL | DISBURSAL_TOTAL | STATUS |
|---|---|---|---|---|---|---|
| _To be populated after live run_ | — | — | — | — | — | PENDING |

---

## P&L Reconciliation

### Rule
```
SUM(LOB_REVENUE + UNALLOCATED_REVENUE per process) = PROCESS_REVENUE
SUM(LOB_COST + SHARED_COST + UNALLOCATED_DIFF per process) = PROCESS_COST
PROCESS_REVENUE - PROCESS_COST = EBITDA
```

### Results Template
| FINANCE_MONTH | BRANCH | PROCESS | LOB_REVENUE | UNALLOCATED | PROCESS_TOTAL | LOB_COST | SHARED_COST | PROCESS_COST | EBITDA | STATUS |
|---|---|---|---|---|---|---|---|---|---|---|
| _To be populated after live run_ | — | — | — | — | — | — | — | — | — | PENDING |

---

## GRN and Payment Reconciliation

### Rule
```
GRN_GROSS_AMOUNT = SUM(GRN_ALLOCATION_GROSS per GRN)
VENDOR_PAYMENT_DUE = SUM(PAYMENT_ALLOCATION_GROSS per vendor)
PAID + OUTSTANDING = DUE
```

### Results Template
| VENDOR | GRN_TOTAL | ALLOCATION_TOTAL | PAYMENT_DUE | PAID | OUTSTANDING | STATUS |
|---|---|---|---|---|---|---|
| _To be populated after live run_ | — | — | — | — | — | PENDING |

---

## Operational Reconciliation

### Attendance Rule
```
PRESENT + ABSENT + LEAVE + WEEK_OFF + HOLIDAY = ROSTERED_DAYS (per approved attendance policy)
```

### Volume Rule
```
COMPLETED + PENDING + REJECTED = ASSIGNED_OR_RECEIVED_VOLUME (per process-specific formula)
```

### Results Template
| REPORT_MONTH | BRANCH | PROCESS | PRESENT | ABSENT | LEAVE | WEEK_OFF | HOLIDAY | TOTAL | ROSTERED | MATCH | STATUS |
|---|---|---|---|---|---|---|---|---|---|---|---|
| _To be populated after live run_ | — | — | — | — | — | — | — | — | — | — | PENDING |

---

## Data Accuracy Per Report

| REPORT | SOURCE_ROWS | REPORT_ROWS | DISTINCT_GRAIN | DUPLICATES | ORPHANS | NULL_MANDATORY | FRESHNESS_MIN | RECONCILIATION |
|---|---|---|---|---|---|---|---|---|
| bpo-operations-productivity-master | PENDING | PENDING | PENDING | PENDING | PENDING | PENDING | PENDING | NOT_APPLICABLE |
| bpo-employee-performance-360-master | PENDING | PENDING | PENDING | PENDING | PENDING | PENDING | PENDING | NOT_APPLICABLE |
| bpo-client-sla-delivery-master | PENDING | PENDING | PENDING | PENDING | PENDING | PENDING | PENDING | NOT_APPLICABLE |
| bpo-wfm-attendance-shrinkage-master | PENDING | PENDING | PENDING | PENDING | PENDING | PENDING | PENDING | NOT_APPLICABLE |
| bpo-hr-workforce-lifecycle-master | PENDING | PENDING | PENDING | PENDING | PENDING | PENDING | PENDING | NOT_APPLICABLE |
| bpo-payroll-statutory-master | PENDING | PENDING | PENDING | PENDING | PENDING | PENDING | PENDING | PENDING |
| bpo-finance-pnl-profitability-master | PENDING | PENDING | PENDING | PENDING | PENDING | PENDING | PENDING | PENDING |
| bpo-quality-risk-compliance-master | PENDING | PENDING | PENDING | PENDING | PENDING | PENDING | PENDING | NOT_APPLICABLE |
| bpo-recruitment-training-readiness-master | PENDING | PENDING | PENDING | PENDING | PENDING | PENDING | PENDING | NOT_APPLICABLE |
| bpo-admin-asset-facility-master | PENDING | PENDING | PENDING | PENDING | PENDING | PENDING | PENDING | NOT_APPLICABLE |
| bpo-management-executive-master | PENDING | PENDING | PENDING | PENDING | PENDING | PENDING | PENDING | NOT_APPLICABLE |
| bpo-audit-compliance-control-master | PENDING | PENDING | PENDING | PENDING | PENDING | PENDING | PENDING | NOT_APPLICABLE |
| bpo-interview-to-exit-journey-ledger | PENDING | PENDING | PENDING | PENDING | PENDING | PENDING | PENDING | NOT_APPLICABLE |
| bpo-report-data-lineage-reconciliation-master | PENDING | PENDING | PENDING | PENDING | PENDING | PENDING | PENDING | NOT_APPLICABLE |

_All PENDING values must be filled by running the live validation endpoint against an approved staging or production-like database. Build success does not certify data accuracy._

---

## Reconciliation Status Legend

- **NOT_APPLICABLE**: Report type does not have a financial/operational reconciliation rule
- **PENDING**: Reconciliation rule exists but live data validation not yet run
- **RECONCILED**: Source totals match report totals within acceptable tolerance
- **DISCREPANCY**: Source totals do not match report totals — investigation required
- **NOT_EVIDENCED**: Source table/column missing — cannot compute reconciliation
