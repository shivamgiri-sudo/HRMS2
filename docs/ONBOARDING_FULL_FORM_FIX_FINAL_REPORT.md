# Onboarding Full Form Fix — Final Report
**Date:** 2026-06-27  
**Engineer:** Full-Stack Compliance Audit Session  
**Repo:** HRMS1 (mirrors HRMS2 main, commit b659dbf +)

---

## 1. Audit Report Created
`docs/ONBOARDING_FIELD_GAP_AND_BACKEND_MAPPING_AUDIT.md` — Full 10-step field-by-field trace:
Frontend File → State Key → API Payload Key → Backend Table → DB Column → Saved? → Reloaded? → HR Visible? → Gap → Fix

---

## 2. Total Fields Audited
**~75 user-facing fields** across 10 steps, plus ~40 backend-only system columns.

---

## 3. Fields Fully Wired Before This Fix Session
~55 of 75 fields were already fully wired (UI → state → API → DB → reload → HR visible).

---

## 4. Fields Fixed (15 gaps resolved)

| # | Gap | Severity | Fix Applied |
|---|---|---|---|
| 1 | DPDP consent (dpdp_consent) never saved — hard blocker on submit | 🔴 CRITICAL | bgv-verification.service.ts: grantConsent() now also sets dpdp_consent=1 + dpdp_consent_at |
| 2 | BGV consent (bgv_consent) not stamped in profile | 🔴 CRITICAL | Same as above — bgv_consent=1 now set in profile on consent grant |
| 3 | Languages not fetched on resume — getFullOnboardingStatus missing language query | 🔴 CRITICAL | onboarding-full.service.ts: added SELECT from candidate_onboarding_language |
| 4 | nominee_date_of_birth empty string crashed DB (NOT NULL column) | 🔴 CRITICAL | safeDate() helper added; empty strings → null on all date fields |
| 5 | board_type not in addQualification INSERT | 🟠 HIGH | Added board_type + institution_name to qualification INSERT |
| 6 | nameOnCheque not saved in bank_detail — lost on resume | 🟠 HIGH | Added name_on_cheque column to bank INSERT + reload in hook |
| 7 | cancelledChequeDocumentId never set — cheque-bank linkage broken | 🟠 HIGH | uploadDoc() auto-links cancelled_cheque doc to bank_detail record |
| 8 | Branch/process showing "—" due to UUID vs string JOIN mismatch | 🟠 HIGH | validateOnboardingToken() fallback: if not UUID, use raw string value |
| 9 | sameAddr checkbox always unchecked on resume | 🟡 MEDIUM | Derived from address equality in useState initializer |
| 10 | Nominee share sum not validated — could be >100% | 🟡 MEDIUM | Warning shown + save blocked if nominee2 present and total ≠ 100% |
| 11 | "Account saved" not indicated on resume | 🟡 MEDIUM | "Bank saved — re-enter to update" hint shown when bankName set but accountNo blank |
| 12 | PIN code 6-digit not enforced | 🟢 LOW | Inline error shown for non-6-digit PIN |
| 13 | Duplicate language allowed | 🟢 LOW | Dedup check before add |
| 14 | Experience date order not validated | 🟢 LOW | "From date must be before To date" error shown |
| 15 | advanceStep wired to wrong step numbers after 10-step restructure | 🟡 MEDIUM | Step 6 → saveBank, Step 8 + 9 → saveExperience |

---

## 5. Fields Not Applicable / Intentional Design
- PAN / Aadhaar / Account No never reloaded — security design, documented as intentional
- confirmAccountNo not sent to API — UI-only confirm, correct
- candidateBGV manual fallback — non-blocking by design
- sameAddr not stored in DB — derived on load from address equality

---

## 6. Frontend Files Changed
| File | Changes |
|---|---|
| src/components/onboarding-full/useOnboardingFull.ts | nameOnCheque reload, cancelledChequeDoc auto-link, language reload from status, advanceStep step numbers, bgvApiAvailable flag |
| src/components/onboarding-full/OnboardingSteps1to5.tsx | sameAddr derived from equality, PIN validation, nominee share sum warning + save block, bank saved hint, pinOk() helper |
| src/components/onboarding-full/OnboardingSteps6to10.tsx | Duplicate lang prevention, at-least-one-skill guard, date-order validation, F component error prop added, isFresher fresher string match |
| src/pages/CandidateOnboardingFullPage.tsx | Route fixed: /onboard-full → CandidateOnboardingFullPage (new form) |
| src/App.tsx | Route swap: /onboard-full = new form, /onboard-full-legacy = old V2 |

---

## 7. Backend Files Changed
| File | Changes |
|---|---|
| backend/src/modules/ats/onboarding-full.service.ts | getFullOnboardingStatus: add language query; addQualification: add board_type + institution_name; saveBankDetails: add name_on_cheque; validateOnboardingToken: branch/process name fallback; safeDate() helper; date fields use safeDate() |
| backend/src/modules/ats/bgv-verification.service.ts | saveBgvConsentByToken: also UPDATE profile bgv_consent=1 + dpdp_consent=1 |

---

## 8. Migration Added
`backend/sql/309_onboarding_field_persistence_and_dpdp_fix.sql`
- Fix NOT NULL on nominee_date_of_birth / nominee2_dob (was crashing save)
- Add name_on_cheque to candidate_onboarding_bank_detail
- Add board_type + institution_name to candidate_onboarding_qualification (safe add)
- Safe-add dpdp_consent, bgv_consent, present_state, permanent_state to profile
- Index on candidate_onboarding_language
- page_catalog entries

---

## 9. Database Tables/Columns Changed
| Table | Column | Change |
|---|---|---|
| candidate_onboarding_bank_detail | name_on_cheque | Added (safe) |
| candidate_onboarding_qualification | board_type, institution_name | Added (safe) |
| candidate_onboarding_qualification | (was missing from INSERT) | Fixed in service |
| candidate_onboarding_profile | nominee_date_of_birth, nominee2_dob | NULL constraint fixed |
| candidate_onboarding_profile | dpdp_consent, bgv_consent | Added (safe, idempotent) |

---

## 10. Downstream Pages Wired
All wiring confirmed in `docs/ONBOARDING_DOWNSTREAM_WIRING_REPORT.md`:
- NativeHROnboardingRequests ✅
- NativeBGVVerificationCenter ✅
- NativePayrollHRValidation ✅
- NativePayrollHOQueues ✅ (cheque mismatch queue now populated)
- Employee profile (via approveOffer transaction) ✅

---

## 11. DPDP Fixes
- bgv_consent + dpdp_consent now set on profile when candidate gives BGV consent
- Consent stored in candidate_bgv_consent with version 'BGV-DPDP-v1', IP, user-agent
- Consent timestamp (bgv_consent_at, dpdp_consent_at) populated
- DPDP withdrawal link: NativeDPDPWithdrawal route exists — not yet linked from onboarding form (Phase 2)
- Consent version text hash: stored as consentTextHash in candidate_bgv_consent

---

## 12. Document Checklist Fixes
- Required document list shown to candidate from step 1 (document checklist preview)
- Step 4 shows collapsed checklist with REQUIRED / optional badges
- Cancelled cheque upload auto-links to bank detail record
- Required doc hard blocker: getOnboardingBlockers() returns BANK_DETAILS_MISSING — indirect enforcement

---

## 13. BGV Fixes
- BGV API failure: bgvApiAvailable flag; consent captured locally; "Manual BGV by Payroll HR" shown
- bgv_consent column stamped in profile after consent
- dpdp_consent_missing hard blocker now resolved for candidates who give BGV consent

---

## 14. Bank Validation Fixes
- Account number confirm mismatch blocks save
- IFSC format validation inline
- Name on cheque saved and reloaded
- Name mismatch → cheque_name_validation queue (Payroll HO) — non-blocking for candidate
- "Bank previously saved" hint on resume

---

## 15. Final Submit Validation Fixes
- OTP_NOT_VERIFIED: hard blocker ✅
- DECLARATION_NOT_ACCEPTED: hard blocker ✅
- DPDP_CONSENT_MISSING: now resolved by giving BGV consent ✅
- BANK_DETAILS_MISSING: hard blocker ✅
- QUALIFICATION_MISSING: soft blocker (warning only) ✅

---

## 16. Backend Build Result
```
npm run build (tsc) — EXIT 0
Pre-existing type errors in unrelated modules (mssql, nodemailer, twilio — missing @types packages)
Zero new errors in changed files
```

---

## 17. Frontend Build Result
```
npm run build (vite) — EXIT 0
CandidateOnboardingFullPage chunk built cleanly
All 10 step components compiled
```

---

## 18. Static Smoke Result
```
npx tsc --noEmit (frontend) — EXIT 0, zero new errors
```

---

## 19. Test Plan Created
`docs/ONBOARDING_FULL_FORM_TEST_PLAN.md`  
82 test cases across 14 categories:
Token validation, Welcome display, Personal save/reload, Address/KYC, Documents,
BGV consent, Bank details, Education, Experience, Family/Language, Statutory/Submit,
HR downstream, DPDP compliance, Security.

---

## 20. Remaining Blockers / Next Steps

| Item | Priority | Notes |
|---|---|---|
| Apply migration 309 to production DB | 🔴 REQUIRED | NOT NULL fix for nominee_date_of_birth will unblock Step 2 save for all candidates |
| Deploy backend + frontend to server | 🔴 REQUIRED | Need git commit + push + server rebuild |
| Test real end-to-end OTP verification | 🟠 HIGH | Requires SMS/WhatsApp delivery working on server |
| Wire DPDP withdrawal link from onboarding | 🟡 MEDIUM | NativeDPDPWithdrawal page exists, not linked from form |
| Education document linkage | 🟡 MEDIUM | document_id in qualification table never set from frontend |
| Required doc hard blocker on submit | 🟡 MEDIUM | Currently soft — no hard block for missing Aadhaar/PAN docs |
| Consent version UI display | 🟢 LOW | Show version 'BGV-DPDP-v1' text to candidate |

---

## 21. Final Status

```
ONBOARDING_WIRED_BUILD_PARTIAL

Reason: All critical and high gaps fixed. Frontend + backend builds pass.
Remaining blockers:
  1. migration 309 not yet applied to production DB (nominee_date_of_birth crash still live on server)
  2. Changes not yet pushed/deployed to server
  3. OTP delivery requires live server test

Status upgrades to ONBOARDING_FULLY_WIRED_AND_BUILD_PASS after:
  1. git commit + push
  2. Server: git pull + npm run build (both) + apply migration 309
  3. Live OTP test passes
```
