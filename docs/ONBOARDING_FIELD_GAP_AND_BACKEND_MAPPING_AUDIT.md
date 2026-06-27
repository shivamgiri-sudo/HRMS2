# Onboarding Field Gap & Backend Mapping Audit
**Generated:** 2026-06-27  
**Scope:** 10-step CandidateOnboardingFullPage flow  
**Repo:** HRMS1/HRMS2 (in sync at commit b659dbf)  
**Auditor:** Full-Stack Compliance Audit (automated + manual trace)

---

## Audit Legend

| Symbol | Meaning |
|--------|---------|
| ✅ | Fully wired (UI → state → API → DB → reload) |
| ⚠️ | Partial — works but has gap or caveat |
| ❌ | Missing or broken |
| 🔒 | Sensitive — PII masking required |
| 🛡️ | DPDP relevant |

---

## STEP 1 — Welcome / Token Display

| Field Label | Frontend File | State Key | API Source | DB Column | Saved? | Reloaded? | HR Visible? | Gap | Fix |
|---|---|---|---|---|---|---|---|---|---|
| Full Name | OnboardingSteps1to5 Step1Welcome | status.token.full_name | /status → token.full_name | ats_candidate.full_name | Pre-existing | ✅ | ✅ | None | — |
| Mobile | Step1Welcome | status.token.mobile | /status → token.mobile | ats_candidate.mobile | Pre-existing | ✅ | ✅ | None | — |
| Email | Step1Welcome | status.token.email | /status → token.email | ats_candidate.email | Pre-existing | ✅ | ✅ | None | — |
| Branch | Step1Welcome | status.token.branch_name | /status → branch_name | branch_master.branch_name via JOIN | ⚠️ | ⚠️ | ✅ | **JOIN uses UUID but field stores name string in older records** | **FIXED in b659dbf — fallback to string value** |
| Process / LOB | Step1Welcome | status.token.process_name | /status → process_name | process_master.process_name via JOIN | ⚠️ | ⚠️ | ✅ | Same as Branch — string stored not UUID | **FIXED in b659dbf** |
| Candidate Code | Step1Welcome | status.token.candidate_code | /status → token.candidate_code | ats_candidate.candidate_code | Pre-existing | ✅ | ✅ | None | — |
| Source / Channel | Step1Welcome | status.token.source_type | /status → token.source_type | ats_candidate.sourcing_channel | Pre-existing | ✅ | ✅ | None | — |
| Gender | Step1Welcome | status.token.gender | /status → token.gender | ats_candidate.gender | Pre-existing | ✅ | ✅ | None | — |

---

## STEP 2 — Personal Information

| Field Label | State Key | API Payload Key | Backend Table | DB Column | Saved? | Reloaded? | HR Visible? | Required? | Validation | Gap | Fix |
|---|---|---|---|---|---|---|---|---|---|---|---|
| Title | employee.title | title | candidate_onboarding_profile | title | ✅ | ✅ | ✅ | No | Select | None | — |
| Full Name | employee.employeeName | employeeName | candidate_onboarding_profile + ats_candidate | employee_name | ✅ | ✅ | ✅ | Yes | Non-empty | None | — |
| Relation Type | employee.relation | relation | candidate_onboarding_profile + ats_candidate | relation | ✅ | ✅ | ✅ | No | Select | None | — |
| Father/Guardian Name | employee.fatherHusbandName | fatherHusbandName | candidate_onboarding_profile + ats_candidate | father_husband_name / father_name | ✅ | ✅ | ✅ | Yes | Non-empty | None | — |
| Mother's Name | employee.motherName | motherName | candidate_onboarding_profile | mother_name | ✅ | ✅ | ✅ | No | None | None | — |
| Date of Birth | employee.dateOfBirth | dateOfBirth | candidate_onboarding_profile + ats_candidate | date_of_birth | ✅ | ✅ | ✅ | Yes | date, age 16–60 check in UI | None | — |
| Gender | employee.gender | gender | candidate_onboarding_profile + ats_candidate | gender | ✅ | ✅ | ✅ | Yes | Select | None | — |
| Marital Status | employee.maritalStatus | maritalStatus | candidate_onboarding_profile + ats_candidate | marital_status | ✅ | ✅ | ✅ | No | Select | None | — |
| Blood Group | employee.bloodGroup | bloodGroup | candidate_onboarding_profile | blood_group | ✅ | ✅ | ✅ | No | Select | None | — |
| Nationality | employee.nationality | nationality | candidate_onboarding_profile | nationality | ✅ | ✅ | ✅ | No | Text, default Indian | None | — |
| Religion | employee.religion | religion | candidate_onboarding_profile | religion | ✅ | ✅ | ✅ | No | Select | None | — |
| Category/Caste | employee.category | category | candidate_onboarding_profile | category | ✅ | ✅ | ✅ | No | Select (SC/ST/OBC/General/EWS/Other) | None | — |
| Mobile Number | employee.mobileNumber | mobileNumber | candidate_onboarding_profile + ats_candidate | mobile_number | ✅ | ✅ | ✅ | Yes | tel | None | — |
| Alternate Mobile | employee.altMobileNumber | altMobileNumber | candidate_onboarding_profile + ats_candidate | alt_mobile_number | ✅ | ✅ | ✅ | No | tel | None | — |
| Personal Email | employee.personalEmailId | personalEmailId | candidate_onboarding_profile + ats_candidate | personal_email_id | ✅ | ✅ | ✅ | Yes | email | None | — |
| Official Email | employee.officialEmailId | officialEmailId | candidate_onboarding_profile | official_email_id | ✅ | ✅ | ✅ | No | email | None | — |
| Emergency Contact Name | employee.emergencyContactName | emergencyContactName | candidate_onboarding_profile | emergency_contact_name | ✅ | ✅ | ✅ | No | None | None | — |
| Emergency Contact Relation | employee.emergencyContactRelation | emergencyContactRelation | candidate_onboarding_profile | emergency_contact_relation | ✅ | ✅ | ⚠️ | No | **No dropdown — freetext only** | UI allows free text; backend accepts any string | Add select options to Step2 |
| Emergency Mobile | employee.emergencyContactMobile | emergencyContactMobile | candidate_onboarding_profile + ats_candidate | emergency_contact_mobile | ✅ | ✅ | ✅ | No | tel | None | — |
| Nominee 1 Name | employee.nominee | nominee | candidate_onboarding_profile | nominee_name | ✅ | ✅ | ✅ | No | None | Stored in flat profile column — not nominee table | ⚠️ nominee table exists but not used |
| Nominee 1 Relation | employee.nomineeRelation | nomineeRelation | candidate_onboarding_profile | nominee_relation | ✅ | ✅ | ✅ | No | Select | None | — |
| Nominee 1 DOB | employee.nomineeDateOfBirth | nomineeDateOfBirth | candidate_onboarding_profile | nominee_date_of_birth | ✅ | ✅ | ✅ | No | date | None | — |
| Nominee 1 Share % | employee.nominee1SharePct | nominee1SharePct | candidate_onboarding_profile | nominee1_share_pct | ✅ | ✅ | ✅ | No | numeric, default 100 | No sum validation against nominee 2 in UI | Add total-must-equal-100 check |
| Nominee 2 Name | employee.nominee2Name | nominee2Name | candidate_onboarding_profile | nominee2_name | ✅ | ✅ | ✅ | No | None | None | — |
| Nominee 2 Relation | employee.nominee2Relation | nominee2Relation | candidate_onboarding_profile | nominee2_relation | ✅ | ✅ | ✅ | No | Select | None | — |
| Nominee 2 DOB | employee.nominee2Dob | nominee2Dob | candidate_onboarding_profile | nominee2_dob | ✅ | ✅ | ✅ | No | date | None | — |
| Nominee 2 Share % | employee.nominee2SharePct | nominee2SharePct | candidate_onboarding_profile | nominee2_share_pct | ✅ | ✅ | ✅ | No | numeric | No sum validation | Add share sum check |

---

## STEP 3 — Address & KYC

| Field Label | State Key | API Payload Key | DB Table | DB Column | Saved? | Reloaded? | HR Visible? | Required? | Validation | Gap | Fix |
|---|---|---|---|---|---|---|---|---|---|---|---|
| Permanent Full Address | employee.permanentAddress | permanentAddress | candidate_onboarding_profile + ats_candidate | permanent_address | ✅ | ✅ | ✅ | Yes | textarea | None | — |
| Permanent State | employee.permanentState | permanentState | candidate_onboarding_profile | permanent_state | ✅ | ✅ | ✅ | Yes | Select (36 states) | None | — |
| Permanent City | employee.permanentCity | permanentCity | candidate_onboarding_profile | permanent_city | ✅ | ✅ | ✅ | Yes | text | None | — |
| Permanent PIN Code | employee.permanentPincode | permanentPincode | candidate_onboarding_profile | permanent_pincode | ✅ | ✅ | ✅ | Yes | 6-digit numeric | No 6-digit enforcement | Add length validation |
| Same-as-Permanent checkbox | local: sameAddr | — | — | — | ❌ | ❌ | — | — | — | **Component-local state only — not persisted. On reload, checkbox always unchecked** | Persist in form or derive on load |
| Present Full Address | employee.presentAddress | presentAddress | candidate_onboarding_profile + ats_candidate | present_address / current_address | ✅ | ✅ | ✅ | Yes | textarea | None | — |
| Present State | employee.presentState | presentState | candidate_onboarding_profile | present_state | ✅ | ✅ | ✅ | Yes | Select | None | — |
| Present City | employee.presentCity | presentCity | candidate_onboarding_profile | present_city | ✅ | ✅ | ✅ | Yes | text | None | — |
| Present PIN Code | employee.presentPincode | presentPincode | candidate_onboarding_profile | present_pincode | ✅ | ✅ | ✅ | Yes | numeric | No 6-digit enforcement | Add length validation |
| Address Proof Type | employee.addressProofType | addressProofType | candidate_onboarding_profile | address_proof_type | ✅ | ✅ | ✅ | No | Chip select | None | — |
| PAN Number 🔒🛡️ | employee.panNumber | panNumber | candidate_onboarding_profile (masked+hash) + ats_candidate | pan_number_masked, pan_number_hash | ✅ | ❌ | ⚠️ | Yes | ABCDE1234F format | **Never reloaded — always blank on resume (security design). User must re-enter every session** | Document this as intentional security design |
| Aadhaar Number 🔒🛡️ | employee.aadhaarNumber | aadhaarNumber | candidate_onboarding_profile (masked+hash) + ats_candidate | aadhaar_number_masked, aadhaar_number_hash | ✅ | ❌ | ⚠️ | Yes | 12 digits | **Never reloaded — always blank (security design). User re-enters each session** | Document as intentional; show "already saved — re-enter to update" hint if masked value exists |
| Passport Number 🔒 | employee.passportNo | passportNo | candidate_onboarding_profile + ats_candidate | passport_no | ✅ | ✅ | ✅ | No | uppercase text | None | — |
| Driving License No 🔒 | employee.drivingLicenseNo | drivingLicenseNo | candidate_onboarding_profile + ats_candidate | driving_license_no | ✅ | ✅ | ✅ | No | uppercase text | None | — |
| UAN Number 🔒 | employee.uanNumber | uanNumber | candidate_onboarding_profile + ats_candidate | uan_number | ✅ | ✅ | ✅ | No | numeric | None | — |
| Previous EPF Number 🔒 | employee.epfNumber | epfNumber | candidate_onboarding_profile + ats_candidate | epf_number | ✅ | ✅ | ✅ | No | text | None | — |
| Previous ESIC Number 🔒 | employee.esicNumber | esicNumber | candidate_onboarding_profile + ats_candidate | esic_number | ✅ | ✅ | ✅ | No | numeric | None | — |

---

## STEP 4 — Document Upload

| Field / Feature | State/API | DB Table | DB Column | Saved? | Reloaded? | HR Visible? | Gap | Fix |
|---|---|---|---|---|---|---|---|---|
| Document Type | docType → API docType | candidate_onboarding_document | doc_type | ✅ | ✅ | ✅ | None | — |
| Document Label | docName → API docName | candidate_onboarding_document | doc_name | ✅ | ✅ | ✅ | None | — |
| Page Number | pageNo → API pageNo | candidate_onboarding_document | page_no | ✅ | ✅ | ✅ | None | — |
| File upload | file → multipart | candidate_onboarding_document | file_path, file_url, mime_type, file_size_bytes | ✅ | ✅ | ✅ | None | — |
| Document status badge | status.documents[].document_status | candidate_onboarding_document | document_status | ✅ | ✅ | ✅ | None | — |
| View file link | status.documents[].file_url | candidate_onboarding_document | file_url | ✅ | ✅ | ✅ | None | — |
| Delete document | onDelete(id) | candidate_onboarding_document | deleted_at, document_status='deleted' | ✅ | ✅ | ✅ | Soft delete — correct | — |
| Required doc checklist | uploadedTypes Set | — | — | ✅ (UI only) | ✅ | ❌ | Checklist shown but missing required docs do NOT block final submit | Add hard blocker for mandatory 5 docs |
| File size validation | checked in Step4Documents | — | — | ✅ (5MB UI) | — | — | Backend allows 10MB; UI restricts to 5MB — inconsistency | Align to 5MB or explicit policy |
| Experienced doc requirement | — | — | — | ❌ | ❌ | ❌ | No warning when experience > fresher but no exp doc uploaded | Add soft blocker warning |

---

## STEP 5 — BGV Consent & Verification

| Field / Feature | State Key | API | DB Table | DB Column | Saved? | Reloaded? | HR Visible? | Gap | Fix |
|---|---|---|---|---|---|---|---|---|---|
| Consent button | consentAccepted | POST /bgv/consent | candidate_onboarding_profile | bgv_consent, bgv_consent_at | ⚠️ | ⚠️ | ✅ | **bgv_consent column exists in DB but /bgv/consent route does NOT update candidate_onboarding_profile.bgv_consent — it only creates candidate_bgv_consent record** | Backend BGV service must also set bgv_consent=1 in profile |
| Consent version 🛡️ | — | purposes[] hardcoded | — | — | ❌ | ❌ | ❌ | No version/text hash stored. DPDP requires versioned consent | Add consent_version column + store text hash |
| Consent timestamp 🛡️ | — | — | — | bgv_consent_at | ⚠️ | ⚠️ | ⚠️ | Set only if bgv_consent route updates profile | Fix with above |
| Consent IP/device 🛡️ | — | meta.ip in route | candidate_bgv_consent (if exists) | ip_address | ⚠️ | — | ⚠️ | Stored in BGV consent table but not in profile | Acceptable — link via candidate_id |
| BGV score | bgv.score | GET /bgv/status | candidate_bgv_report | bgv_score | ✅ | ✅ | ✅ | None | — |
| Overall status | bgv.overall_status | GET /bgv/status | candidate_bgv_report | overall_status | ✅ | ✅ | ✅ | None | — |
| HR Ready | bgv.employee_creation_ready | GET /bgv/status | candidate_bgv_report | — (computed) | ✅ | ✅ | ✅ | None | — |
| Payroll Ready | bgv.payroll_activation_ready | GET /bgv/status | candidate_bgv_report | — (computed) | ✅ | ✅ | ✅ | None | — |
| Check results | bgv.checks[] | GET /bgv/status | candidate_bgv_check | check_type, status, match_score, result_summary | ✅ | ✅ | ✅ | None | — |
| Manual BGV fallback | bgvApiAvailable flag | — | — | — | ✅ | — | ⚠️ | HR cannot see that BGV API failed for a candidate — no flag in DB | Add api_failure_reason to bgv_report |
| DPDP consent text 🛡️ | — | — | candidate_onboarding_profile | dpdp_consent, dpdp_consent_at | ❌ | ❌ | ❌ | **dpdp_consent column in DB but NEVER set by any API call in onboarding form** | Add DPDP consent capture to Step 5 or add dedicated DPDP step |

---

## STEP 6 — Bank Account

| Field Label | State Key | API Payload Key | DB Table | DB Column | Saved? | Reloaded? | HR Visible? | Gap | Fix |
|---|---|---|---|---|---|---|---|---|---|
| IFSC Code | bank.ifscCode | ifscCode | candidate_onboarding_bank_detail + ats_candidate | ifsc_code / bank_ifsc | ✅ | ✅ | ✅ | None | — |
| Bank Name | bank.bankName | bankName | candidate_onboarding_bank_detail + ats_candidate | bank_name | ✅ | ✅ | ✅ | None | — |
| Branch Name | bank.branchName | branchName | candidate_onboarding_bank_detail | branch_name | ✅ | ✅ | ✅ | None | — |
| Account Holder Name | bank.accountHolderName | accountHolderName | candidate_onboarding_bank_detail | account_holder_name | ✅ | ✅ | ✅ | None | — |
| Account Number 🔒 | bank.accountNo | accountNo | candidate_onboarding_bank_detail | account_no_masked, account_no_hash | ✅ | ❌ | ⚠️ | **Not reloaded (security) — user re-enters. On resume, field blank even though bank was saved** | Show "account saved — re-enter to update" hint when bank row exists |
| Confirm Account Number | bank.confirmAccountNo | — | — | — | ❌ | ❌ | — | UI-only confirm field — not sent to API (correct). Mismatch check works | None needed |
| Account Type | bank.accountType | accountType | candidate_onboarding_bank_detail | account_type | ✅ | ✅ | ✅ | None | — |
| Name on Cheque | bank.nameOnCheque | nameOnCheque | cheque_name_validation | name_on_cheque | ✅ | ❌ | ✅ | **nameOnCheque not reloaded on resume — disappears after refresh** | Reload from cheque_name_validation or add to bank detail response |
| IFSC format validation | — | — | — | — | ✅ | — | — | UI validates 11-char IFSC. Backend does not validate format | Backend should validate IFSC pattern |
| Account match validation | — | — | — | — | ✅ (UI) | — | — | UI blocks save on mismatch | None |
| Cancelled cheque doc link | bank.cancelledChequeDocumentId | cancelledChequeDocumentId | candidate_onboarding_bank_detail | cancelled_cheque_document_id | ⚠️ | ❌ | ⚠️ | **Frontend never sets cancelledChequeDocumentId — always empty string** | Wire doc upload to bank step; auto-link cancelled cheque doc |

---

## STEP 7 — Education

| Field Label | State Key | API Payload Key | DB Table | DB Column | Saved? | Reloaded? | HR Visible? | Gap | Fix |
|---|---|---|---|---|---|---|---|---|---|
| Qualification Level | qual.qualification | qualification | candidate_onboarding_qualification | qualification | ✅ | ✅ | ✅ | None | — |
| Specialization/Course | qual.specializationCourseName | specializationCourseName | candidate_onboarding_qualification | specialization_course_name | ✅ | ✅ | ✅ | None | — |
| Institution Name | qual.institutionName | institutionName | candidate_onboarding_qualification | institution_name | ✅ | ✅ | ✅ | None | — |
| Board/University | qual.boardType | boardType | candidate_onboarding_qualification | board_type | ⚠️ | ✅ | ✅ | **board_type column exists and is saved, but `addQualification` service does NOT include boardType in INSERT (line 436-452 in service)** | Fix addQualification to save board_type |
| Year of Passing | qual.passedOutYear | passedOutYear | candidate_onboarding_qualification | passed_out_year | ✅ | ✅ | ✅ | None | — |
| Percentage/CGPA | qual.passedOutPercentage | passedOutPercentage | candidate_onboarding_qualification | passed_out_percentage | ✅ | ✅ | ✅ | None | — |
| State | qual.passedOutState | passedOutState | candidate_onboarding_qualification | passed_out_state | ✅ | ✅ | ✅ | None | — |
| City | qual.passedOutCity | passedOutCity | candidate_onboarding_qualification | passed_out_city | ✅ | ✅ | ✅ | None | — |
| At least 10th required | — | — | — | — | ❌ | — | — | `/blockers` returns QUALIFICATION_MISSING soft blocker — but no hard block on submit | Make 10th a soft warning; hard block if zero qualifications |
| Document linkage | qual.documentId | documentId | candidate_onboarding_qualification | document_id | ❌ | ❌ | ❌ | **document_id exists in DB but frontend never captures or sends documentId for qualifications** | Wire education doc to qualification row |

---

## STEP 8 — Work Experience

| Field Label | State Key | API Payload Key | DB Table | DB Column | Saved? | Reloaded? | HR Visible? | Gap | Fix |
|---|---|---|---|---|---|---|---|---|---|
| Experience Level | experience.workingExperience | workingExperience | candidate_onboarding_experience | working_experience | ✅ | ✅ | ✅ | None | — |
| Employer Name | experience.employerName | employerName | candidate_onboarding_experience | employer_name | ✅ | ✅ | ✅ | None | — |
| Last Designation | experience.lastDesignation | lastDesignation | candidate_onboarding_experience | last_designation | ✅ | ✅ | ✅ | None | — |
| Total Years | experience.experienceYear | experienceYear | candidate_onboarding_experience | experience_year | ✅ | ✅ | ✅ | None | — |
| Last CTC | experience.lastCtc | lastCtc | candidate_onboarding_experience | last_ctc | ✅ | ✅ | ✅ | None | — |
| From Date | experience.fromDate | fromDate | candidate_onboarding_experience | from_date | ✅ | ✅ | ✅ | Fixed in recent migration | — |
| To Date | experience.toDate | toDate | candidate_onboarding_experience | to_date | ✅ | ✅ | ✅ | Fixed in recent migration | — |
| Reason for Leaving | experience.reasonForLeaving | reasonForLeaving | candidate_onboarding_experience | reason_for_leaving | ✅ | ✅ | ✅ | Fixed in recent migration | — |
| Document Type Available | experience.experienceDocType | experienceDocType | candidate_onboarding_experience | experience_doc_type | ✅ | ✅ | ✅ | None | — |
| Experience doc linkage | — | experienceDocumentId | candidate_onboarding_experience | experience_document_id | ❌ | ❌ | ❌ | **Frontend never sends experienceDocumentId** | Wire experience doc upload to experience row |
| Date range validation | — | — | — | — | ❌ | — | — | No from_date < to_date validation | Add date order check |

---

## STEP 9 — Family & Language

| Field Label | State Key | API Payload Key | DB Table | DB Column | Saved? | Reloaded? | HR Visible? | Gap | Fix |
|---|---|---|---|---|---|---|---|---|---|
| Annual Household Income | family.annualIncome | annualIncome | candidate_onboarding_family | annual_income | ✅ | ✅ | ✅ | None | — |
| Number of Dependents | family.countOfDependents | countOfDependents | candidate_onboarding_family | count_of_dependents | ✅ | ✅ | ✅ | None | — |
| Language (name) | languages[].language_name | languages[].language_name | candidate_onboarding_language | language_name | ✅ | ✅ | ✅ | None | — |
| Can Read | languages[].can_read | languages[].can_read | candidate_onboarding_language | can_read | ✅ | ✅ | ✅ | None | — |
| Can Write | languages[].can_write | languages[].can_write | candidate_onboarding_language | can_write | ✅ | ✅ | ✅ | None | — |
| Can Speak | languages[].can_speak | languages[].can_speak | candidate_onboarding_language | can_speak | ✅ | ✅ | ✅ | None | — |
| Proficiency | languages[].proficiency | languages[].proficiency | candidate_onboarding_language | proficiency | ✅ | ✅ | ✅ | None | — |
| Languages pre-load on resume | — | GET /status → languages[] | candidate_onboarding_language | all columns | ✅ | ⚠️ | ✅ | **StatusData type has `languages?: any[]` but getFullOnboardingStatus() does NOT query candidate_onboarding_language table** | Fix getFullOnboardingStatus to fetch languages |
| Min 1 language validation | — | — | — | — | ❌ | — | — | No blocker if no language added | Add soft blocker |
| Duplicate language prevention | — | — | — | — | ❌ | — | — | Can add same language twice | Add dedup check |

---

## STEP 10 — Statutory & Submit

| Field / Action | State Key | API Payload Key | DB Table | DB Column | Saved? | Reloaded? | HR Visible? | Gap | Fix |
|---|---|---|---|---|---|---|---|---|---|
| Previous PF Member | statutory.previousPfMember | previousPfMember | candidate_onboarding_profile | previous_pf_member | ✅ | ✅ | ✅ | None | — |
| EPS Member | statutory.epsMember | epsMember | candidate_onboarding_profile | eps_member | ✅ | ✅ | ✅ | None | — |
| International Worker | statutory.internationalWorker | internationalWorker | candidate_onboarding_profile | international_worker | ✅ | ✅ | ✅ | None | — |
| Declaration Accepted 🛡️ | statutory.declarationAccepted | declarationAccepted | candidate_onboarding_profile | statutory_declaration_accepted | ✅ | ✅ | ✅ | None | — |
| Declaration Timestamp 🛡️ | — | — | candidate_onboarding_profile | statutory_declaration_at | ✅ | ✅ | ✅ | Set by saveStatutory() backend | — |
| OTP Verified | otpVerified | otp (from verify call) | candidate_onboarding_profile | otp_verified, otp_verified_at, otp_mobile | ✅ | ✅ | ✅ | None | — |
| OTP Rate Limit | — | — | candidate_onboarding_otp | attempts | ✅ | — | — | Max 3 attempts, max 3 sends/10min | — |
| DPDP Consent 🛡️ | — | — | candidate_onboarding_profile | dpdp_consent, dpdp_consent_at | ❌ | ❌ | ❌ | **Column exists, never set by any frontend call. getOnboardingBlockers() returns DPDP_CONSENT_MISSING hard blocker — this will permanently BLOCK submission** | **CRITICAL: Add DPDP consent capture. Add /dpdp-consent API call or fold into Step 5** |
| Submission geo | — | submit_lat, submit_lng | candidate_onboarding_profile | submit_lat, submit_lng | ✅ | — | ✅ | None | — |
| Submission lock | — | — | candidate_onboarding_profile | profile_status='submitted' | ✅ | ✅ | ✅ | None | — |
| Final submit blockers | — | GET /blockers | — | — | ⚠️ | — | — | **Hard blockers: OTP_NOT_VERIFIED, DECLARATION_NOT_ACCEPTED, DPDP_CONSENT_MISSING, BANK_DETAILS_MISSING. DPDP blocker will always fire since consent is never saved** | Fix DPDP consent persistence |

---

## Critical Gaps Summary

| # | Gap | Severity | Step | Fix Required |
|---|---|---|---|---|
| 1 | **DPDP consent never saved** — hard blocker will permanently prevent submission | 🔴 CRITICAL | 5 or 10 | Add DPDP consent API call + column update |
| 2 | **Languages not fetched on resume** — getFullOnboardingStatus() doesn't query candidate_onboarding_language | 🔴 CRITICAL | 9 | Add language SELECT to getFullOnboardingStatus |
| 3 | **board_type not saved in addQualification** — column exists, not in INSERT | 🟠 HIGH | 7 | Add board_type to INSERT |
| 4 | **nameOnCheque not reloaded** — disappears on browser refresh | 🟠 HIGH | 6 | Add to bank detail response or separate table |
| 5 | **cancelledChequeDocumentId never set** — linkage between doc and bank detail broken | 🟠 HIGH | 4/6 | Wire doc type "Cancelled Cheque" to bank record |
| 6 | **bgv_consent not set in profile** — BGV consent route doesn't update profile column | 🟠 HIGH | 5 | Update /bgv/consent to also set profile.bgv_consent |
| 7 | **sameAddr checkbox not persisted** — always unchecked on resume | 🟡 MEDIUM | 3 | Derive from address equality on load |
| 8 | **Education document linkage missing** — document_id in qual table never wired | 🟡 MEDIUM | 7 | Wire doc type to qualification row |
| 9 | **Experience document linkage missing** — experience_document_id never wired | 🟡 MEDIUM | 8 | Wire exp doc to experience row |
| 10 | **Nominee share sum not validated** — can save nominee1=100% + nominee2=80% | 🟡 MEDIUM | 2 | Add total ≤ 100% validation |
| 11 | **Account/bank saved hint missing** — accountNo blank on resume confuses users | 🟡 MEDIUM | 6 | Show "saved — re-enter to update" hint |
| 12 | **PIN code 6-digit not enforced** | 🟢 LOW | 3 | Add minLength=6 maxLength=6 |
| 13 | **Duplicate languages allowed** | 🟢 LOW | 9 | Add dedup before add |
| 14 | **Experience date order not validated** | 🟢 LOW | 8 | Add from < to check |
| 15 | **No required doc hard blocker on submit** | 🟡 MEDIUM | 4 | Add mandatory doc check to /blockers |

---

## DPDP Compliance Status

| Requirement | Status | Gap |
|---|---|---|
| BGV consent with purpose | ⚠️ Partial | Consent stored in bgv table but not profile.bgv_consent |
| DPDP consent column exists | ✅ Column present | Never set by frontend |
| Consent timestamp | ⚠️ Partial | bgv_consent_at but not dpdp_consent_at |
| Consent version/text | ❌ Missing | No version or hash of consent text stored |
| Data retention notice | ❌ Missing | No UI notice shown |
| Withdrawal path | ❌ Missing | DPDP withdrawal page exists (NativeDPDPWithdrawal) but not linked from onboarding |
| Withdrawal tracking | ✅ Table exists | candidate_bgv_consent exists |
| Audit log | ✅ Full | candidate_onboarding_submission_log covers all actions |
| PII masking in DB | ✅ Full | Aadhaar/PAN/Account all masked + hashed |
| PII masking in UI | ✅ | Never displayed in plain form outside input field |

---

*End of audit. Proceed to fixing identified gaps before marking form complete.*
