# Onboarding Downstream Wiring Report
**Generated:** 2026-06-27  
**Source:** ONBOARDING_FIELD_GAP_AND_BACKEND_MAPPING_AUDIT.md + code inspection

---

## Personal Data → HR Review + Employee Profile

| Data Group | Source Step | Saved Table | Used In Page | Used In API | Status | Gap | Fix |
|---|---|---|---|---|---|---|---|
| Full Name, DOB, Gender, Blood Group, Marital Status | Step 2 | candidate_onboarding_profile + ats_candidate | NativeHROnboardingRequests, Employee Profile | /ats/onboarding-full/candidate/:id | ✅ Wired | None | — |
| Father/Mother/Nominee Names | Step 2 | candidate_onboarding_profile | Employee Profile (nominee tab) | /ats/onboarding-full/candidate/:id → approveOffer → employee_nominee table | ⚠️ Partial | Nominee saved to flat profile; approveOffer creates employee_nominee rows from nominee_name/nominee_relation/nominee_date_of_birth up to 2 entries | Acceptable — nominee table populated at offer approval |
| Emergency Contact | Step 2 | candidate_onboarding_profile | HR onboarding requests | /candidate/:id | ✅ | None | — |
| Mobile / Email | Step 2 | candidate_onboarding_profile + ats_candidate | All HR pages | All routes | ✅ | None | — |

---

## Address/KYC → HR Review + BGV + Statutory Profile

| Data Group | Source Step | Saved Table | Used In Page | Status | Gap | Fix |
|---|---|---|---|---|---|---|
| Permanent Address | Step 3 | candidate_onboarding_profile + ats_candidate | HR review, employee profile, BGV address check | ✅ | None | — |
| Present Address | Step 3 | candidate_onboarding_profile + ats_candidate | HR review, employee profile | ✅ | None | — |
| Address Proof Type | Step 3 | candidate_onboarding_profile | HR review | ✅ | None | — |
| PAN (masked+hash) 🔒 | Step 3 | candidate_onboarding_profile + ats_candidate | Payroll HR validation, BGV center | ✅ | Never shown in plain text outside candidate input | — |
| Aadhaar (masked+hash) 🔒 | Step 3 | candidate_onboarding_profile + ats_candidate | BGV center, HR review | ✅ | Never shown in plain text | — |
| Passport/DL/UAN/EPF/ESIC | Step 3 | candidate_onboarding_profile + ats_candidate | HR review, statutory tab | ✅ | None | — |

---

## Documents → Document Verification + BGV + HR Review

| Data Group | Source Step | Saved Table | Used In Page | Status | Gap | Fix |
|---|---|---|---|---|---|---|
| All uploaded documents | Step 4 | candidate_onboarding_document | NativeBGVVerificationCenter (docs[]), NativeDocumentVerification, HR review | ✅ | None | — |
| Document status badges | Step 4 | candidate_onboarding_document.document_status | BGV center, HR review | ✅ | None | — |
| File URLs | Step 4 | candidate_onboarding_document.file_url | HR downloads, BGV review | ✅ | None | — |
| Cancelled cheque linkage | Step 4 | candidate_onboarding_bank_detail.cancelled_cheque_document_id | Payroll HR validation | ⚠️ | Was never wired — **Fixed in this session** (auto-link on cheque/passbook upload) | Fixed |

---

## BGV Status → BGV Center + HR/Payroll Validation

| Data Group | Source Step | Saved Table | Used In Page | Status | Gap | Fix |
|---|---|---|---|---|---|---|
| BGV consent | Step 5 | candidate_bgv_consent + candidate_onboarding_profile.bgv_consent | NativeBGVVerificationCenter | ⚠️ | bgv_consent column was never set — **Fixed in this session** | Fixed |
| BGV score | Step 5 | candidate_bgv_report.bgv_score | NativeBGVVerificationCenter, NativeHROnboardingRequests | ✅ | None | — |
| BGV check results | Step 5 | candidate_bgv_check | NativeBGVVerificationCenter | ✅ | None | — |
| DPDP consent | Step 5 | candidate_onboarding_profile.dpdp_consent | getOnboardingBlockers() hard blocker | ⚠️ | Was never set — **Fixed: grantConsent() now sets dpdp_consent=1 + bgv_consent=1** | Fixed |
| Vendor dispatch | HR action | candidate_bgv_dispatch | NativeBGVVerificationCenter vendor panel | ✅ | None | — |

---

## Bank Details → Payroll Validation + Employee Statutory/Bank Profile

| Data Group | Source Step | Saved Table | Used In Page | Status | Gap | Fix |
|---|---|---|---|---|---|---|
| Bank name, IFSC, account (masked) | Step 6 | candidate_onboarding_bank_detail + ats_candidate | NativePayrollHRValidation, employee bank profile | ✅ | None | — |
| Account holder name | Step 6 | candidate_onboarding_bank_detail | Payroll HR validation | ✅ | None | — |
| Name on cheque | Step 6 | candidate_onboarding_bank_detail.name_on_cheque | Payroll HO queue (cheque_name_validation) | ⚠️ | Was not stored; mismatch queue had no record — **Fixed: nameOnCheque now saved in bank_detail row** | Fixed |
| Account type | Step 6 | candidate_onboarding_bank_detail | Payroll HR | ✅ | None | — |
| Cancelled cheque doc | Step 4 | candidate_onboarding_bank_detail.cancelled_cheque_document_id | Payroll HR | ⚠️ | Fixed | Fixed |

---

## Education → HR Review + Employee Profile

| Data Group | Source Step | Saved Table | Used In Page | Status | Gap | Fix |
|---|---|---|---|---|---|---|
| Qualification, year, percentage | Step 7 | candidate_onboarding_qualification | NativeHROnboardingRequests, Employee profile | ✅ | None | — |
| Board/University | Step 7 | candidate_onboarding_qualification.board_type | HR review | ⚠️ | Was not in INSERT — **Fixed** | Fixed |
| Institution name | Step 7 | candidate_onboarding_qualification.institution_name | HR review | ⚠️ | Was not in INSERT — **Fixed** | Fixed |
| Document linkage | Step 7 | candidate_onboarding_qualification.document_id | HR review | ❌ | Frontend never sets documentId | Low priority — HR can cross-reference uploaded docs |

---

## Experience → HR Review + BGV/Manual Verification

| Data Group | Source Step | Saved Table | Used In Page | Status | Gap | Fix |
|---|---|---|---|---|---|---|
| Employer, designation, CTC | Step 8 | candidate_onboarding_experience | NativeHROnboardingRequests, BGV (employment check) | ✅ | None | — |
| From/To dates | Step 8 | candidate_onboarding_experience.from_date, to_date | HR review, BGV | ✅ | Fixed in migration 289 + backend service | — |
| Reason for leaving | Step 8 | candidate_onboarding_experience.reason_for_leaving | HR review | ✅ | Fixed | — |
| Experience doc type | Step 8 | candidate_onboarding_experience.experience_doc_type | HR review | ✅ | None | — |

---

## Family/Nominee → HR Profile + Statutory/PF

| Data Group | Source Step | Saved Table | Used In Page | Status | Gap | Fix |
|---|---|---|---|---|---|---|
| Annual income, dependents | Step 9 | candidate_onboarding_family | HR review | ✅ | None | — |
| Languages | Step 9 | candidate_onboarding_language | Employee profile, process allocation | ⚠️ | Was not fetched on resume — **Fixed** | Fixed |

---

## Statutory → Payroll HR + Employee Statutory Tab

| Data Group | Source Step | Saved Table | Used In Page | Status | Gap | Fix |
|---|---|---|---|---|---|---|
| Previous PF, EPS, International worker | Step 10 | candidate_onboarding_profile | NativePayrollHRValidation, employee statutory | ✅ | None | — |
| Declaration + timestamp | Step 10 | candidate_onboarding_profile.statutory_declaration_accepted / statutory_declaration_at | Compliance audit | ✅ | None | — |
| OTP verified + mobile | Step 10 | candidate_onboarding_profile.otp_verified / otp_mobile | HR audit | ✅ | None | — |
| Submit geolocation | Step 10 | candidate_onboarding_profile.submit_lat / submit_lng | HR investigation (if needed) | ✅ | None | — |

---

## Summary: Wiring Status After This Session's Fixes

| Category | Before Fix | After Fix |
|---|---|---|
| DPDP consent blocking submit | ❌ Never set | ✅ Set via BGV consent call |
| BGV consent in profile | ❌ Never set | ✅ Set via BGV consent call |
| Languages on resume | ❌ Lost on refresh | ✅ Fetched from DB |
| Board/University in education | ❌ Not saved | ✅ Saved in INSERT |
| Institution name in education | ❌ Not saved | ✅ Saved in INSERT |
| Name on cheque reload | ❌ Lost on refresh | ✅ Saved in bank_detail |
| Cancelled cheque linkage | ❌ Never set | ✅ Auto-set on cheque upload |
| Nominee DOB empty string crash | ❌ HTTP 500 | ✅ safeDate() normalises to null |
| sameAddr checkbox on resume | ❌ Always unchecked | ✅ Derived from address equality |
| Duplicate language prevention | ❌ Duplicates allowed | ✅ Dedup check before add |
| Share % sum validation | ❌ None | ✅ Warning + save block |
| PIN code 6-digit validation | ❌ None | ✅ Error shown |
| Experience date order | ❌ None | ✅ Error shown |
| Bank saved hint on resume | ❌ Confusing blank form | ✅ "Bank saved — re-enter to update" |
