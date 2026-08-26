# Statutory Filing and PII-at-Rest — Remediation Plan

**Written:** 2026-08-26
**Basis:** every count below was measured read-only against live `mas_hrms` on 2026-08-26. No figure here is taken from a prior document.
**Status:** plan only. No code in this document has been written, and no data operation has been run.

---

## 0. Why this is a plan and not a patch

Two of the four findings raised in the audit validation were fixed in code the same day
(`ce8a513c`, `d43ca99f`). The remaining two cannot be: one is blocked on data the client
must supply, the other would destroy live records if applied today. This document says
exactly what is missing, in what order it has to happen, and what is outside our control.

---

## 1. Statutory filing

### 1.1 What already exists

The wiring is not the problem. Every statutory router is mounted and reachable:

| Router | Mount |
|---|---|
| `payrollStatutoryFilingRouter` | `/api/payroll/statutory-filing` (app.ts:403) |
| `tdsCertificatePartARouter` | `/api/payroll/tds-certificate/part-a` (app.ts:389) |
| `pfCreationRouter` | `/api/payroll/pf` (app.ts:420) |
| `payrollComplianceRouter` | `/api/payroll-compliance` (app.ts:419) |

Supporting code exists too: `statutory-filing-readiness.service.ts`,
`statutory-applicability.service.ts`, `statutory-config.resolver.ts`,
`professional-tax-states.ts`, `pf-applicability.service.ts`, `taxDeclaration.service.ts`,
`tds-certificate-part-a.service.ts`.

Payroll itself is live and carrying real volume — **103 runs, 129,696 salary lines**. The
gap is not "payroll doesn't work". The gap is that nothing has ever been *filed*.

### 1.2 What is actually missing — measured

| Area | Live state | Verdict |
|---|---|---|
| Filing register | `statutory_filing_record` — **4 rows**, all `2026-08`, all `pending` | One month scaffolded, nothing filed |
| PF establishment | `pf_establishment_master` **0**, `pf_policy_master` **0** | **Hard blocker** — no PF code, so ECR cannot be filed at all |
| PF employee data | UAN present on **419 of 1,121** active employees (37%) | Blocker for the 702 without |
| EPF profiles | `employee_epf_compliance_profile` 6, `employee_epf_ecr_readiness` 6 | Effectively unused |
| ESIC | `esic_contribution_summary` 12 rows | Effectively unused |
| TDS | `tds_deductor` **0**, `tds_challan` **0**, `tds_certificate_part_a` **0**, `tds_csi_import_batch` **0**, `salary_run_manual_tds` **0** | Genuinely foundation-only — no TAN identity exists |
| Gratuity | `gratuity_accrual_ledger` **3,137**; `gratuity_calculation_audit` **0**; `gratuity_distribution` **0** | Accrual works on real data; payout side unused |
| F&F | `full_final_calculation` **1** row vs 57,838 exited employees | Effectively unused |

Note the gratuity row: the common claim that gratuity is "foundation-only" is wrong.
Accrual runs and holds 3,137 real rows. It is the calculation-audit and distribution side
that has never been exercised.

### 1.3 Blocked on the client, not on engineering

These cannot be built around. Until they arrive, the corresponding filing is impossible
regardless of how much code is written:

1. **PF establishment code(s)** — one per registered establishment. Populates
   `pf_establishment_master`. Without it ECR generation has no employer identity.
2. **TAN** (Tax Deduction and Collection Account Number) — populates `tds_deductor`.
   Without it no 24Q/Form 138 return and no Part A certificate can be produced.
3. **ESIC employer code** and the sub-codes per covered branch.
4. **PT registration numbers per state** — `professional-tax-states.ts` carries the slabs,
   but a return is filed against a registration number we do not hold.
5. **Missing UAN for 702 active employees** — either supplied by the employees or raised
   as fresh UANs through the EPFO portal.

### 1.4 Sequence

Each phase is independently shippable. Do not start a later phase before its blocker clears.

| Phase | Work | Blocked on | Rough size |
|---|---|---|---|
| S1 | Load establishment/TAN/ESIC/PT master data; seed `pf_establishment_master`, `tds_deductor` | Client data (1.3) | Days once data arrives |
| S2 | UAN capture drive for the 702 active employees without one; reuse the existing EPF validation path | Employee data | Weeks, mostly chasing |
| S3 | Wire the filing register into a real monthly cycle — generate the EPF/ESIC/PT/TDS rows per month instead of the current 4 hand-made rows, mark filed with challan | S1 | Small; the table and 6 endpoints exist |
| S4 | TDS from zero: declaration → computation → challan → 24Q/138 → Part A. Also close the dormant ambiguous-slab bug where a bare catch swallows the fail-closed guard | S1 (TAN) | Largest single piece |
| S5 | F&F reconciliation — make `full_final_calculation` the real settlement path rather than a 1-row curiosity | — | Medium |
| S6 | Gratuity payout — `gratuity_calculation_audit` and `gratuity_distribution` on top of the working accrual ledger | — | Medium |

### 1.5 How to talk about this

"Payroll is done" and "statutory is done" are different claims and only the first is
defensible. Payroll calculation and disbursal are live. Statutory *filing* has never
happened once. Keep the two separate in any status report.

---

## 2. PII at rest — why the plaintext cannot be dropped yet

The audit finding ("PII written unmasked to the database") is **true**. The proposed
remedy — null the plaintext columns — would cause data loss today. Measured:

| Column | Plaintext rows | Ciphertext rows | Plaintext with **no** ciphertext |
|---|---|---|---|
| `aadhaar_number` | 30,182 | 30,117 | **65** (64 of them valid 12-digit) |
| `pan_number` | 26,505 | 23,356 | **3,156** (484 valid-format; the rest are `NA`-style junk) |
| `bank_account_number` | 28,727 | — no encrypted column exists — | **28,727** |

So nulling the plaintext right now destroys 64 real Aadhaars, 484 real PANs, and every one
of the 28,727 bank account numbers, which have nowhere to go.

### 2.1 Three prerequisites

**P1 — Finish the existing backfill.** `backend/scripts/employee-pii-encrypt-backfill.mjs`
is correct and idempotent (writes only `WHERE <col>_encrypted IS NULL`, batched,
transactional). It has no format filter, so a re-run encrypts all 3,221 pending values
including the `NA` junk. It **cannot be run from a dev machine**: it refuses on the
all-zeros dev key, correctly, because ciphertext written under that key would be
undecryptable in production. `FIELD_ENCRYPTION_KEY` exists only on the server, so this is a
server-side run, verified first with `scripts/field-key-fingerprint.mjs`.

**P2 — Bank account numbers have no encryption at all.** There is no
`bank_account_number_encrypted` column. This needs a migration (column + key version),
a backfill, and a repoint — it is a project of its own, not a step in P1. Note
`fieldEncryption.ts` already exports `resolveAccountNumber()`/
`resolveAccountNumberWithConflict()`, so the read-side helper shape is decided.

**P3 — Repoint the readers.** Roughly fifteen non-test services still read the plaintext
columns directly and would break the moment they are nulled:

```
ats/onboarding-full.service.ts              employees/epfDeclarationForm.ts
ats-full-parity/atsFullParity.service.ts    employees/epfKycCapture.service.ts
employees/employee-creation-orchestrator    employees/profile-approval.service.ts
employees/employee.compliance.routes.ts     employees/statutory-approval.routes.ts
employees/employee.routes.ts                employees/universalDigitalFormFill.service.ts
employees/employeeCompliancePrivacy.ts      payroll/pf-creation.service.ts
employees/epfComplianceValidation.service   privacy-engine/privacyFieldProjection.service
```

Several of these generate statutory forms (EPF declaration, PF creation, universal digital
form fill). Repointing them touches exactly the output that Section 1 is trying to make
filable, so P3 and S4 should be sequenced by one person, not run in parallel by two.

### 2.2 Order

```
P1 (server-side backfill, additive, reversible)
   └─> P3 (repoint readers to decryptField, service by service, each test-guarded)
          └─> scrub aadhaar_number / pan_number  ← the only destructive step, last
P2 (bank column + backfill + repoint) runs on its own track, same shape
```

The scrub is the last step and should be preceded by a full table backup, not just a
transaction. Nothing before it loses data if reverted.

---

## 3. What was already fixed

For completeness, the two findings from the same audit that did not need a plan:

- **`ce8a513c`** — `hasOrgWideScope()` no longer treats bare `admin` as org-wide, and the
  DPDP §13 restriction guard is now actually mounted (it had zero call sites since it
  shipped on 2026-07-20).
- **`d43ca99f`** — the 17 business-actions endpoints now enforce roles server-side instead
  of relying on the frontend `<Gate>`.
