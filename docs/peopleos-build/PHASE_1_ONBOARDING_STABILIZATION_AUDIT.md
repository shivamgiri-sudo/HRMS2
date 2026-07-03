# Phase 1 Audit — Onboarding Full + HR Request Stabilization

**Date:** 2026-07-03
**Branch:** `fix/onboarding-full-hr-request-mobile-ui-stabilization`
**Audit Scope:** Candidate onboarding (10-step flow), HR onboarding request management, BGV verification, offer/approval pipeline

---

## 1. Frontend — Candidate Onboarding Flow

### 1.1 Critical Issues

| # | File | Lines | Issue | Priority |
|---|------|-------|-------|----------|
| C01 | `CandidateOnboardingFullPage.tsx` | 24 | Token exposed in URL query param `?token=` — visible in browser history, referrer headers, server logs | **Fix immediately** |
| C02 | `useOnboardingFull.ts` | 178 | Token passed as GET query param to `/status?token=...` — logged verbatim in server access logs | **Fix immediately** |
| C03 | `useOnboardingFull.ts` | 483-488 | Razorpay IFSC lookup called directly from browser — DPDP data minimization violation, no audit trail | **Proxy via backend** |
| C04 | `OnboardingSteps1to5.tsx` | 833-836 | Direct file URL in `href={d.file_url}` — no auth check, URL shareable | **Replace with signed/preview URL** |
| C05 | `useOnboardingFull.ts` | 511-523 | Step advances even when save fails — data integrity hole | **Block advance on save failure** |

### 1.2 High Issues

| # | File | Lines | Issue | Priority |
|---|------|-------|-------|----------|
| H01 | `useOnboardingFull.ts` | 304-309 | Autosave timer not cleaned up on unmount — memory leak + stale state update | **Add cleanup** |
| H02 | `useOnboardingFull.ts` | 307, 312, 349, 361, 372, 385, 398, 522, 539 | 9 instances of `.catch(() => {})` — critical errors silently swallowed | **Log + user feedback** |
| H03 | `OnboardingSteps1to5.tsx` | 13-135 | Form primitives duplicated in both step files — ~120 lines copy-pasted | **Extract to shared file** |
| H04 | `OnboardingSteps1to5.tsx` | 686 | BGV consent failure silently accepted locally — server never records consent | **Show error, don't fake consent** |
| H05 | `OnboardingSteps1to5.tsx` | 252-266 | Minor candidate warning (DPDP §9) is informational only — no submission block | **Block submission without guardian consent** |
| H06 | `OnboardingSteps6to10.tsx` | 252-253 | Date order error shown but doesn't block save | **Add to disabled condition** |
| H07 | `OnboardingMobileShell.tsx` | 131 | Step chips navigate without saving current step — data loss | **Autosave before navigation** |

### 1.3 Medium Issues

- TypeScript `any` casts throughout (`catch (e: any)`, `as any`, `as string[]`)
- Non-null assertions on potentially null objects (`s.bank!`, `status!.documents`)
- No retry on initial load failure — full page refresh required
- DigiLocker redirect without return-URL handling
- Hardcoded Indian states, document types, salary bands — not configurable
- PII displayed on welcome screen (mobile, email, DOB)
- No OTP error if mobile changes mid-flow
- Geo-capture on submit without specific consent prompt

---

## 2. Frontend — HR Onboarding Pages

### 2.1 Critical Issues

| # | File | Lines | Issue | Priority |
|---|------|-------|-------|----------|
| C06 | `NativeHROnboardingRequests.tsx` | 549-563 | Unmasked PII in profile review: Aadhaar, PAN, full bank account, Voter ID, DL, UAN, ESIC | **Mask immediately** |
| C07 | `NativeATSOnboardingBridge.tsx` | 156-157 | Mobile + email in list view for all candidates | **Mask in table** |
| C08 | `NativePayrollHRValidation.tsx` | 309 | Missing import: `formatISTDate()` — ReferenceError at runtime | **Add import** |
| C09 | `NativeBGVVerificationCenter.tsx` | 397, 410 | Missing import: `formatISTDate()` — ReferenceError at runtime | **Add import** |

### 2.2 High Issues

| # | File | Lines | Issue | Priority |
|---|------|-------|-------|----------|
| H08 | All 5 HR pages | — | **No frontend role/authorization check** — none import `useAuth` | **Add role gating** |
| H09 | `NativeHROnboardingRequests.tsx` | 136, 159, 164, 283, 287, 325 | Silent catch blocks — API failures invisible | **Show user feedback** |
| H10 | `NativeHROnboardingRequests.tsx` | 291, 294 | Only validates DOJ and CTC; required fields not validated | **Add full validation** |
| H11 | `NativePayrollHRValidation.tsx` | 182-197 | Required fields (company, designation, department, etc.) not validated | **Add pre-submit validation** |
| H12 | `NativePayrollHRValidation.tsx` | 362 | Form `grid-cols-2` no mobile breakpoint — unreadable on small screens | **Add responsive breakpoint** |
| H13 | `NativeBranchHeadApproval.tsx` | 48, 60, 70 | Uses `alert()` for all errors — blocking, unstyled | **Replace with inline errors** |
| H14 | `NativeBGVVerificationCenter.tsx` | 128-136 | `loadCandidate()` Promise.all without try/catch | **Add error boundary** |

### 2.3 Medium Issues

- Master data loading (8 parallel API calls) no loading indicator in PayrollHRValidation
- Hardcoded fallback salary bands that can go stale
- No confirmation dialog before approve/reject actions
- No empty state for filtered results in ATSOnboardingBridge
- Vendor email/phone fields no format validation in BGVVerificationCenter
- Auto-dismiss notification without manual dismiss button

---

## 3. Backend — Candidate Onboarding API

### 3.1 Critical Issues

| # | File | Lines | Issue | Priority |
|---|------|-------|-------|----------|
| B-C01 | `onboarding-full.service.ts` | 515-557 | `submitFullOnboarding` performs 12+ writes with **no transaction** — partial writes on crash | **Wrap in transaction** |
| B-C02 | `onboarding-full.service.ts` | 166-175 | `saveEmployeeDetails` three independent writes **no transaction** — data inconsistency | **Wrap in transaction** |
| B-C03 | `onboarding-full.service.ts` | 601-618 | `listFullOnboardingRequests` returns ALL records — **no row-scope enforcement** | **Add scope filtering** |
| B-C04 | `onboarding-full.routes.ts` | 255-257 | `/requests` endpoint no scope filter — any HR sees all candidates | **Enforce branch/process scope** |

### 3.2 High Issues

| # | File | Lines | Issue | Priority |
|---|------|-------|-------|----------|
| B-H01 | `onboarding-full.routes.ts` | 61-300 | **No rate limiting** on public token-based write endpoints | **Add rate limiting** |
| B-H02 | `onboarding-full.service.ts` | 666-670 | `saveLanguages` DELETE then INSERT no transaction — data loss on failure | **Add transaction** |
| B-H03 | `onboarding-full.service.ts` | 648-658 | `syncOnboardingStatus` three updates no transaction — race condition | **Add transaction** |
| B-H04 | `onboarding-full.service.ts` | 621-627 | `getFullOnboardingByCandidate` uses `SELECT *` from 6 tables — new columns auto-exposed | **Whitelist columns** |
| B-H05 | `onboarding-full.service.ts` | 328 | `.catch(() => {})` on third UPDATE — schema version hack | **Remove, fix schema** |
| B-H06 | `onboarding-full.service.ts` | 81-84 | `validateOnboardingToken` returns raw PII (mobile, email, DOB) | **Minimize returned fields** |
| B-H07 | `onboarding-full.routes.ts` | 44-58 | Multer stores to disk but only checks file extension — magic byte spoofing possible | **Add content validation** |

### 3.3 Medium Issues

- API response format inconsistency: `{ success, data }` vs `{ ok, data }` vs `{ error }` across files
- Inline SQL in route handlers instead of service functions
- Hardcoded 40/40 basic/HRA salary band fallback
- Inline business logic duplicated in route (send-onboarding-link)
- Two competing frontend URL fallbacks (`localhost:8085` vs `localhost:5173`)
- Hardcoded 10-step max in step index clamps

---

## 4. Backend — HR Onboarding + Offer API

### 4.1 Critical Issues

| # | File | Lines | Issue | Priority |
|---|------|-------|-------|----------|
| B-C05 | `ats.onboarding.service.ts` | 243-361 | `saveOffer` 3+ writes no transaction — partial write state | **Wrap in transaction** |
| B-C06 | `ats.onboarding.service.ts` | 237-275 | `saveOffer` accepts arbitrary `offerData` with no schema validation | **Add full validation** |

### 4.2 High Issues

| # | File | Lines | Issue | Priority |
|---|------|-------|-------|----------|
| B-H08 | `ats.onboarding.service.ts` | 133-157 | `validateToken` does not check `candidate.active_status` | **Add active_status filter** |
| B-H09 | `ats.onboarding.service.ts` | 173-210 | `submitProfile` two writes no transaction | **Add transaction** |
| B-H10 | `ats.onboarding.service.ts` | 772-793 | `rejectOffer` four writes no transaction | **Add transaction** |
| B-H11 | `ats.onboarding.service.ts` | 368-384 | `listPendingApprovals` returns father_name and DOB to branch head | **Remove sensitive fields** |
| B-H12 | `ats.onboarding.service.ts` | 388-410 | `approveOffer` SELECT before transaction — stale data race | **Move SELECTs into transaction** |
| B-H13 | `ats.onboarding.routes.ts` | 126-168 | Inline business logic duplicates service function | **Delegate to service** |

### 4.3 Medium Issues

- Hardcoded employee code formats (4 permutations)
- Fire-and-forget email sending without retry mechanism
- Hardcoded frontend URL fallback

---

## 5. Backend — BGV Verification API

### 5.1 Critical Issues

| # | File | Lines | Issue | Priority |
|---|------|-------|-------|----------|
| B-C07 | `bgv-verification.service.ts` | 46-74 | `createOrUpdateCheck` ON DUPLICATE KEY only updates `updated_at` — BGV checks NEVER updated on re-verification | **Fix UPDATE columns** |
| B-C08 | `bgv-verification.service.ts` | 46-74 | No unique constraint on `(candidate_id, check_type, provider_request_id)` — duplicates accumulate silently | **Add unique constraint** |
| B-C09 | `bgv-verification.service.ts` | 342-355 | `providerCallback` trusts all webhook fields directly — status set fraudulently if HMAC bypassed | **Validate status enum** |

### 5.2 High Issues

| # | File | Lines | Issue | Priority |
|---|------|-------|-------|----------|
| B-H14 | `bgv-verification.routes.ts` | 47-114 | **No rate limiting** on PII verification endpoints (PAN, bank, UAN, Aadhaar) | **Add rate limiting** |
| B-H15 | `bgv-verification.routes.ts` | 119-121 | Webhook HMAC silently skipped in non-production without BGV_WEBHOOK_SECRET | **Enforce in all envs** |
| B-H16 | `bgv-verification.service.ts` | 160-168 | Raw third-party provider responses stored verbatim in `result_json` — unredacted PII in DB | **Redact PII before store** |
| B-H17 | `bgv-verification.service.ts` | 188-205 | Raw bank account numbers transmitted to BGV provider — no contractual guarantee of deletion | **Document risk** |
| B-H18 | `bgv-verification.service.ts` | 95-113 | `getBgvStatusForCandidate` uses `SELECT *` — raw provider responses returned to candidate | **Whitelist columns** |
| B-H19 | `bgv-verification.routes.ts` | 243-314 | 70+ lines of inline SQL in route handler for report save | **Extract to service** |

### 5.3 Medium Issues

- PAN format not validated before provider API call (cost savings)
- TOCTOU race on bank detail lookup
- Aadhaar offline and education verification don't log API requests (audit gap)
- Provider config changes not audit-logged
- Duplicate `/queue` and `/candidates` endpoints
- rawBody fallback re-serializes JSON for HMAC — key ordering issues

---

## 6. Database Schema Issues

### 6.1 Critical

| # | Table | Issue | Priority |
|---|-------|-------|----------|
| D-C01 | `candidate_onboarding_profile` | **No CREATE TABLE found in any migration** — table exists but cannot be recreated from migrations | **Find + document or create migration** |
| D-C02 | All onboarding tables | **No foreign key constraints** on `candidate_id` — orphan records can accumulate | **Add FK constraints in new migration** |

### 6.2 High

| # | Issue | Details |
|---|-------|---------|
| D-H01 | **Massive table fragmentation** — 3 offer tables, 4-5 BGV tables, 5 document storage concepts | Consolidate or alias in new migration |
| D-H02 | **200+ columns added via 50+ ALTER TABLE migrations** — no cohesive redesign | Document column inventory |
| D-H03 | **Missing indexes** on critical FKs: `ats_candidate.email`, `ats_candidate.applied_for_process`, `ats_candidate.applied_for_branch`, `ats_employment_offer.candidate_id`, `ats_offer.candidate_id` | Add in new migration |
| D-H04 | **PII inconsistency** — `ats_candidate` stores aadhar_number (plaintext, misspelled), `candidate_onboarding_profile` has aadhaar_number_masked + hash | Migrate to hash-only pattern |
| D-H05 | `ats_onboarding_request.status` ENUM too limited (`pending, in_progress, offer_submitted, approved, rejected`) — missing `onboarding_link_sent`, `profile_in_progress`, `profile_submitted`, `hr_review`, etc. | Extend ENUM |

### 6.3 Medium

- Many tables use `CHAR(36) PK` without `DEFAULT (UUID())` — inserts must generate UUID in app code
- No `soft_delete` / `deleted_at` on onboarding tables
- No file size/MIME type/checksum on `ats_candidate_documents`
- `ats_bgv_verification` uses INT AUTO_INCREMENT instead of UUIDs
- `ats_offer_approval` no unique constraint on `(offer_id, approver_id)` — duplicate approvals possible
- `ats_onboarding_bridge` no index on `status`

---

## 7. Security Summary

### 7.1 PII Exposure (Highest Priority)

| Point | Status | Fix |
|-------|--------|-----|
| Token in URL query param | Active | Move to POST body or Authorization header |
| HR profile review panel | Active | Mask all Aadhaar, PAN, bank, UAN, ESIC, passport |
| Candidate list view mobile/email | Active | Mask in list, reveal on detail view |
| Raw BGV provider results in DB | Active | Redact PII before storing result_json |
| SELECT * from all onboarding tables | Active | Whitelist columns per endpoint |
| Mobile, email, DOB returned by validateToken | Active | Minimize returned fields |

### 7.2 Auth / Authorization Gaps

| Point | Status | Fix |
|-------|--------|-----|
| No frontend role check on any HR page | Active | Add useAuth + role guard |
| No row-scope on listFullOnboardingRequests | Active | Filter by user's branch/process |
| No active_status check on token validation | Active | Add filter |
| Recruiters can see BGV queue | Active | Restrict by permission |

### 7.3 Data Integrity

| Point | Status | Fix |
|-------|--------|-----|
| 12+ writes in submit no transaction | Active | Wrap all in transaction |
| Step advances on save failure | Active | Block advance |
| Error swallowing in 9+ locations | Active | Log + user feedback |

---

## 8. API Response Format Standardization

**Current fragmentation:**
- `onboarding-full.routes.ts`: `{ success: true, data: ... }`
- `ats.onboarding.routes.ts`: `{ ok: true, data: ... }` + `{ error: '...' }` + `{ success: false, message: '...' }`
- `bgv-verification.routes.ts`: mixed patterns

**Target:** `{ success, data?, message?, errors? }` everywhere.

---

## 9. Immediate Action Items (Phase 2)

1. **Extract form primitives** from OnboardingSteps1to5.tsx and OnboardingSteps6to10.tsx into shared file
2. **Fix missing formatISTDate imports** in NativePayrollHRValidation.tsx and NativeBGVVerificationCenter.tsx
3. **Add frontend role gating** to all 5 HR pages
4. **Mask PII** in NativeHROnboardingRequests.tsx profile panel
5. **Add rate limiting** to public token-based endpoints
6. **Fix BGV createOrUpdateCheck** — add unique constraint + update all columns on conflict
7. **Add transactions** to submitFullOnboarding, saveLanguages, saveNominees, saveFamily
8. **Replace .catch(() => {})** with proper error handling
9. **Remove token from query params** — use POST body or Authorization header
10. **Add content validation** to file upload
