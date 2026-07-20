# DPDP Existing State Audit
**Branch:** feature/dpdp-privacy-hardening  
**Baseline commit:** 2a0dd8d7  
**Audit date:** 2026-07-20  
**Backend build baseline:** PASS (tsc --noEmitOnError false, zero errors)  
**Frontend build baseline:** FAIL pre-existing — `src/components/ai/CommandPalette.tsx:263` (unrelated to DPDP)

---

## 1. Existing DPDP Capabilities

| Capability | Status | Notes |
|---|---|---|
| Consent recording | Implemented | `data_consent` table, `/api/privacy/consent` routes |
| Consent withdrawal (simple) | Implemented | `withdrawConsent()` sets `withdrawn_at` |
| Consent text versioning | Implemented | `consent_text_version` table with approval workflow |
| Data rights requests (access/correction/erasure/nomination/grievance) | Implemented (partial) | DB model complete; access request returns hardcoded summary, not real data |
| DPDP withdrawal workflow | Implemented | `dpdp_consent_withdrawal` + `dpdp_processing_hold` tables |
| Breach logging | Implemented | `data_breach_log` table with 72h SLA tracking columns |
| Retention policies | Implemented (config only) | `data_retention_policy` table with 8 seeded policies; no enforcement worker |
| Erasure (anonymization) | Implemented | `dpdpErasure.service.ts` handles `employees`, `employee_emergency_contact`, `employee_nominee` |
| Data restriction guard | Implemented but FAILS OPEN | `dpdpRestrictionGuard.ts` — DB error calls `next()` |
| Processor registry | Tables created | `data_processor_registry` seeded with 7 processors, all `dpa_signed=0` |
| Nominee registry | Table created | `dpdp_nominee_registry` — no API routes yet |
| Candidate DPDP consent | Implemented | `candidate_dpdp_consent_log` table + onboarding flow |
| AI redaction | Implemented | `ai-redaction.service.ts`, `ai-safety.service.ts` — pattern-based |
| Breach SLA cron | Defined but NOT WIRED | `dpdp-breach-sla.cron.ts` never imported in `server.ts` |
| Compliance dashboard | Implemented (partial) | 3 of 5 checklist items hardcoded `true` |
| Retention enforcement worker | NOT IMPLEMENTED | No worker; policies are config only |
| Field-level encryption | NOT IMPLEMENTED | PAN/Aadhaar stored masked or plaintext; no at-rest encryption |

---

## 2. Privacy API Inventory

### `/api/privacy` (privacyRouter — `privacy.routes.ts`)

| Method | Path | Auth | Gaps |
|---|---|---|---|
| GET | `/consent/my-consents` | requireAuth | None |
| GET | `/consent/all` | requireAuth + requireRole(admin,hr,dpo) | SELECT * |
| GET | `/consent/stats` | requireAuth + requireRole(admin,hr,dpo) | None |
| POST | `/consent` | requireAuth | Client controls version/hash — not server-authoritative |
| POST | `/consent/withdraw` | requireAuth + logSensitiveAction | None |
| POST | `/rights/access` | requireAuth | Returns hardcoded summary, not real data |
| POST | `/rights/correction` | requireAuth | None |
| POST | `/rights/erasure` | requireAuth + logSensitiveAction | None |
| GET | `/rights/my-requests` | requireAuth | SELECT * |
| GET | `/rights/requests` | requireAuth + requireRole(admin,hr,dpo) | SELECT * |
| PATCH | `/rights/requests/:id` | requireAuth + requireRole(admin,hr,dpo) + logSensitiveAction | None |
| GET | `/retention/policies` | requireAuth + requireRole(admin,hr,dpo) | SELECT * |
| PUT | `/retention/policies/:entityType` | requireAuth + requireRole(admin) + logSensitiveAction | None |
| GET | `/config` | requireAuth + requireRole(admin,hr,dpo) | SELECT * |
| PUT | `/config/:key` | requireAuth + requireRole(admin) + logSensitiveAction | None |
| GET | `/breaches` | requireAuth + requireRole(admin,hr) | **SELECT *** |
| POST | `/breaches` | requireAuth + requireRole(admin,hr) | None |
| PATCH | `/breaches/:id` | requireAuth + requireRole(admin,hr) | **No audit log** |
| GET | `/consent-versions` | requireAuth + requireRole(admin,hr) | None |
| POST | `/consent-versions` | requireAuth + requireRole(admin) | None |
| PATCH | `/consent-versions/:id/review` | requireAuth + requireRole(admin) | None |
| PATCH | `/consent-versions/:id/approve` | requireAuth + requireRole(admin) | None |
| PATCH | `/consent-versions/:id/activate` | requireAuth + requireRole(admin) | **No audit log** |

### `/api/privacy` (dpdpWithdrawalRouter — `dpdp-withdrawal.routes.ts`)

| Method | Path | Auth | Gaps |
|---|---|---|---|
| POST | `/dpdp-withdrawal/request` | requireAuth | None |
| GET | `/dpdp-withdrawal/my-requests` | requireAuth | None |
| GET | `/dpdp-withdrawal` | requireAuth + requireRole(hr,admin,compliance,dpo) | Role "compliance" inconsistent with privacyRouter's "dpo" |
| GET | `/dpdp-withdrawal/:id` | requireAuth | Uses `getUserRoleContext` (live DB) — OK; but not `requireRole` |
| POST | `/dpdp-withdrawal/:id/start-review` | requireAuth + requireRole(hr,admin,compliance) | Missing "dpo" |
| POST | `/dpdp-withdrawal/:id/approve` | requireAuth + requireRole(hr,admin,compliance,dpo) | None |
| POST | `/dpdp-withdrawal/:id/reject` | requireAuth + requireRole(hr,admin,compliance,dpo) | None |
| POST | `/dpdp-withdrawal/:id/release-hold` | requireAuth + requireRole(hr,admin) | None |
| GET | `/dpdp-withdrawal/:id/audit` | requireAuth | Ownership check via getById — OK |

**Route shadowing:** Both routers mounted at `/api/privacy` in `app.ts` lines 390–391. `dpdpWithdrawalRouter` registered first → its withdrawal routes take precedence. Any duplicate paths in `privacy.routes.ts` are dead code.

---

## 3. Frontend Page Inventory

| Page | Path | Gate | API endpoints called |
|---|---|---|---|
| `NativeDPDPCompliance.tsx` | `/compliance/dpdp` | WorkforcePageGate DPDP_COMPLIANCE | 20 endpoints across all privacy tabs |
| `NativeDPDPWithdrawal.tsx` | `/privacy/dpdp-withdrawal` | WorkforcePageGate DPDP_WITHDRAWAL | GET my-requests, POST request |
| `NativeDPDPWithdrawalAdmin.tsx` | `/compliance/dpdp-withdrawal-admin` | WorkforcePageGate DPDP_WITHDRAWAL_ADMIN | GET list, POST start-review/approve/reject, GET audit |

---

## 4. Tables Inventory

| Table | Source Migration | Purpose |
|---|---|---|
| `data_consent` | 030 | Records consent per principal per purpose |
| `data_rights_request` | 030 | Access/correction/erasure/nomination/grievance requests |
| `data_retention_policy` | 030 | Retention period configuration per entity type |
| `dpdp_config` | 030 | Grievance officer, policy URLs, feature flags |
| `consent_text_version` | 032 | Versioned consent text with legal review workflow |
| `data_breach_log` | 031 + 336 | Breach incidents with SLA tracking columns |
| `dpdp_consent_withdrawal` | 293 + 300 | Withdrawal requests with holds and restriction flags |
| `dpdp_withdrawal_audit_log` | 293 | Audit trail per withdrawal request |
| `dpdp_processing_hold` | 293 + 300 | Active processing holds per entity |
| `dpdp_nominee_registry` | 336 | Nominee registration (no API routes yet) |
| `data_processor_registry` | 336 | Third-party processor/vendor registry |
| `candidate_dpdp_consent_log` | 271 | Candidate-specific consent during onboarding |
| `sensitive_action_log` | 015 + 218 + 237 | Sensitive operation audit log |
| `audit_action_log` | 218 | General audit log |
| `audit_log` | 218 | Alias of audit_action_log |

---

## 5. Existing Roles in Privacy Context

| Role | Access Level |
|---|---|
| `employee` | Own consents, own rights requests, own withdrawal (via WorkforcePageGate DPDP_WITHDRAWAL) |
| `hr` | All privacy data scoped to their branch/process |
| `admin` | All privacy management |
| `dpo` | Full compliance access (used in privacyRouter) |
| `compliance` | Used in dpdpWithdrawalRouter — inconsistent with `dpo` |
| `super_admin` | Break-glass full access |
| `payroll_head` | Audit log access (payroll modules only) |

---

## 6. Consent System State

- 5 active consent text versions seeded: employment, recruitment, payroll, communication, lms
- `text_hash` in seeded records = `SHA2('seed_string', 256)` — NOT hash of actual consent text; tamper-detection broken for seeded rows
- `recordConsent()` trusts client-submitted `consent_text_version` and `consent_text_hash` — not server-authoritative
- No deduplication: a principal can record multiple active consents for the same purpose

---

## 7. Withdrawal Workflow State

**Implemented states:** `submitted`, `in_review`, `approved`, `rejected`, `hold_released`  
**Missing states:** `acknowledged`, `awaiting_information`, `partially_approved`, `implementation_pending`, `implemented`, `closed`

**Audit events currently logged:**  
`submitted`, `review_started`, `approved`, `rejected`, `hold_released`

**Missing audit events from master prompt requirements:**  
`DPDP_WITHDRAWAL_ACKNOWLEDGED`, `DPDP_WITHDRAWAL_VIEWED`, `DPDP_WITHDRAWAL_ASSIGNED`, `DPDP_WITHDRAWAL_INFORMATION_REQUESTED`, `DPDP_WITHDRAWAL_INFORMATION_PROVIDED`, `DPDP_PROCESSING_HOLD_APPLIED` (distinct from review_started), `DPDP_PROCESSING_HOLD_ENFORCED`, `DPDP_WITHDRAWAL_PARTIALLY_APPROVED`, `DPDP_WITHDRAWAL_IMPLEMENTATION_STARTED`, `DPDP_WITHDRAWAL_MODULE_ACTION_COMPLETED`, `DPDP_WITHDRAWAL_DATA_RESTRICTED`, `DPDP_WITHDRAWAL_DATA_ANONYMIZED`, `DPDP_WITHDRAWAL_DATA_DELETED`, `DPDP_WITHDRAWAL_THIRD_PARTY_NOTICE_SENT`, `DPDP_PROCESSING_HOLD_RELEASED` (logged but no separate event), `DPDP_WITHDRAWAL_CLOSED`, `DPDP_WITHDRAWAL_EXPORTED`, `DPDP_WITHDRAWAL_AUDIT_VIEWED`

**Missing fields on `dpdp_consent_withdrawal`:**  
`reference_number`, `requester_ip`, `requester_ua`, `notice_version`, `data_categories`, `implementation_completed_at`, `closed_at`, `final_decision_by`, `sla_due_at`, `assigned_to`

---

## 8. Breach Module State

- Table: `data_breach_log` — fully structured
- SLA columns (alert_sent_at_1h/48h/71h) added in migration 336
- Breach SLA cron (`dpdp-breach-sla.cron.ts`) — **NOT IMPORTED IN server.ts**
- `PATCH /breaches/:id` — **no `logSensitiveAction` call** — breach status updates are unaudited
- `GET /breaches` uses `SELECT *` — returns all columns
- No role-based field restriction on breach detail

---

## 9. Document Security State

- File storage: local filesystem under `/uploads/`
- `document_vault_inventory` table tracks access_level: `public | internal | pii | payroll | confidential`
- `GET /api/files/:category/:filename` — accepts Bearer JWT **OR** download token
- **`access_level` is NEVER CHECKED at download time** — any authenticated user who knows a UUID filename can download any file regardless of sensitivity
- `employee-photos/` subdirectory is intentionally public (no auth)
- Download tokens: single-use, 15-min expiry, SHA-256 backed — well implemented
- Soft-delete respected at token consumption

---

## 10. Audit Coverage Map

| Operation | Audit log | Notes |
|---|---|---|
| Consent withdrawal | `logSensitiveAction(CONSENT_WITHDRAW)` | OK |
| Erasure request | `logSensitiveAction(ERASURE_REQUEST)` | OK |
| Rights request update | `logSensitiveAction(RIGHTS_REQUEST_UPDATE)` | OK |
| Retention policy update | `logSensitiveAction(RETENTION_POLICY_UPDATE)` | OK |
| DPDP config update | `logSensitiveAction(DPDP_CONFIG_UPDATE)` | OK |
| **Breach status update** | **MISSING** | No audit on PATCH /breaches/:id |
| **Consent version activation** | **MISSING** | No audit on PATCH /consent-versions/:id/activate |
| Withdrawal submission | `dpdp_withdrawal_audit_log` | OK |
| Withdrawal review | `dpdp_withdrawal_audit_log` | OK |
| Withdrawal approve/reject | `dpdp_withdrawal_audit_log` | OK |
| Hold release | `dpdp_withdrawal_audit_log` | OK |
| Document download | `logDocumentAccess()` | OK — but called before auth check |
| Audit log export | `logSensitiveAction(AUDIT_LOG_EXPORTED)` | OK |
| AI prompt | `ai_prompt_audit_log` | Stored as SHA-256 hash |
| Employee PAN update | `logSensitiveAction` via `auditProfileChange` | OK — but raw PAN written to DB first |

---

## 11. Retention Configuration

8 seeded policies in `data_retention_policy`:

| Entity | Days | Action |
|---|---|---|
| ats_candidate | 365 | anonymize |
| employees | 2920 (8yr) | archive |
| salary_prep_run | 2920 | archive |
| leave_request | 1825 (5yr) | archive |
| wfm_attendance_session | 1825 | archive |
| portal_otp | 1 | delete |
| data_breach_log | 2920 | archive |

**No enforcement worker exists.** These are config entries only. No records are ever actually anonymized, deleted, or archived by the system automatically.

---

## 12. Duplicate Implementations

1. **Dual withdrawal route mounts:** `dpdpWithdrawalRouter` and `privacyRouter` both mounted at `/api/privacy` — withdrawal paths in `privacy.routes.ts` are shadowed and unreachable
2. **`audit_action_log` created in migrations 218 and 220** — idempotent due to `IF NOT EXISTS`, but redundant
3. **`dpdp_processing_hold.hold_reason` declared in both 293 and 300** — guarded, non-destructive

---

## 13. Schema Mismatches

1. `consent_text_version.text_hash` seeded with `SHA2('seed_string', 256)` not the hash of the actual consent text
2. Migration `126_ats_candidate_pii_hash_columns.sql` NOT in MIGRATION_MANIFEST — PII hash columns on `ats_candidate` may not exist on all environments
3. Migration `999_grant_employee_resignation_dpdp.sql` NOT in MIGRATION_MANIFEST — employee role may lack `DPDP_WITHDRAWAL` page access
4. `dpdp_withdrawal_audit_log` missing `from_status`, `to_status` entries for most transitions (columns exist but service does not populate them)

---

## 14. Security Gaps (Severity Ranked)

| # | Severity | Gap | File | Line |
|---|---|---|---|---|
| 1 | CRITICAL | Document vault `access_level` never enforced at download | `files.routes.ts` | ~85 |
| 2 | CRITICAL | `dpdpRestrictionGuard` fails open on DB error | `dpdpRestrictionGuard.ts` | 61–64 |
| 3 | CRITICAL | Raw PAN written to `employees.pan_number` without masking | `employee.profile.service.ts` | 398–399 |
| 4 | CRITICAL | Duplicate DPDP withdrawal routes — second set is dead | `app.ts` | 390–391 |
| 5 | HIGH | `AI_ENCRYPTION_KEY` falls back to `NODE_ENV` string | `ai-provider-config.service.ts` | 22–28 |
| 6 | HIGH | `admin` equated to `super_admin` in hasRole/isSuperAdmin | `accessGuard.ts`, `roleResolver.ts` | various |
| 7 | HIGH | Breach SLA cron defined but never wired into server.ts | `server.ts`, `dpdp-breach-sla.cron.ts` | N/A |
| 8 | HIGH | SELECT * on data_breach_log, consents, rights, retention, config | `privacy.routes.ts`, `privacy.service.ts` | various |
| 9 | HIGH | SELECT * on employees after update | `employee.controller.ts` | 94 |
| 10 | HIGH | Migration 126 not in MANIFEST | `runPendingMigrations.ts` | N/A |
| 11 | HIGH | consent_text_version text_hash seeds are wrong | `032_consent_text_versions.sql` | N/A |
| 12 | MEDIUM | No audit on PATCH /breaches/:id | `privacy.routes.ts` | ~240 |
| 13 | MEDIUM | No audit on PATCH /consent-versions/:id/activate | `privacy.routes.ts` | ~310 |
| 14 | MEDIUM | Role "compliance" vs "dpo" inconsistency | Multiple files | N/A |
| 15 | MEDIUM | Compliance checklist hardcoded true | `NativeDPDPCompliance.tsx` | 1522–1527 |
| 16 | MEDIUM | Client-side JWT role decode in withdrawal admin | `NativeDPDPWithdrawalAdmin.tsx` | 113–124 |
| 17 | MEDIUM | Audit CSV export may contain raw old/new PII values | `audit.log.routes.ts` | N/A |
| 18 | MEDIUM | Missing withdrawal audit events (13 of 22 missing) | `dpdp-withdrawal.service.ts` | N/A |
| 19 | MEDIUM | Access request returns hardcoded summary (not real data) | `privacy.service.ts` | 172–186 |
| 20 | LOW | hold_reason duplicate column declaration in migrations | `293_*.sql`, `300_*.sql` | N/A |
| 21 | LOW | Migration 999 not in MANIFEST | `runPendingMigrations.ts` | N/A |
| 22 | LOW | POST /explain AI route has no entity ownership check | `ai-insights.routes.ts` | N/A |

---

## 15. Production Migration Risks

1. **Migration 126 missing from MANIFEST** — if PII hash columns were never created, ATS onboarding service writes to non-existent columns (silent failure in non-production)
2. **All 7 registered processors have `dpa_signed=0`** — legal gap, not a schema risk
3. **consent_text_version hash fix** — migration that updates seeded `text_hash` values will UPDATE existing rows; must be idempotent and only update rows where hash matches the old seed value
4. **`dpdp_consent_withdrawal` additive columns** — migration 370 uses `ADD COLUMN IF NOT EXISTS` — safe for re-run

---

## 16. Recommended Remediation (Phased)

Per implementation plan at `C:\Users\ADMIN\.claude\plans\master-prompt-hrms2-dazzling-hellman.md`:

- **Immediate (no flag needed):** fail-closed restriction guard, PAN masking on write, AI key fallback fix, breach SLA cron wiring, duplicate route removal, missing audit logs
- **Flag-gated:** document vault access_level enforcement (`DPDP_DOCUMENT_AUTH_ENABLED`), field projection (`DPDP_FIELD_PROJECTION_ENABLED`), processing hold enforcement (`DPDP_PROCESSING_HOLD_ENFORCEMENT`)
- **After approval:** retention enforcement, encryption migration of existing PAN rows
