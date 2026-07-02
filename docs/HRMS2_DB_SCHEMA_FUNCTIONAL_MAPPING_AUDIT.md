# HRMS2 DB Schema ↔ Functional Mapping Audit
**Date**: 2026-06-24  
**Scope**: Candidate onboarding (migrations 289–296), dashboard analytics (290), incentive workflow (291), TAT (294), name-match (295), resignation/exit (296)

Legend: **Mapped** = UI → API payload → backend variable → DB column all verified. **Missing** = shown in UI / sent in payload but not saved to DB. **Broken** = route/variable mismatch blocks save. **Unused** = DB column exists with no UI or API write path.

---

## 1. Candidate Onboarding — Personal Fields

| Business Field | Frontend Field | API Payload Key | Backend Variable | DB Table | DB Column | Save API | Fetch API | Status |
|---|---|---|---|---|---|---|---|---|
| Title | `title` | `title` | `input.title` | `candidate_onboarding_profile` | `title` | POST /employee-details | GET /status | **Mapped** |
| Full Name | `employeeName` | `employeeName` | `input.employeeName` | `candidate_onboarding_profile` | `employee_name` | POST /employee-details | GET /status | **Mapped** |
| Relation | `relation` | `relation` | `input.relation` | `candidate_onboarding_profile` | `relation` | POST /employee-details | GET /status | **Mapped** |
| Father/Husband Name | `fatherHusbandName` | `fatherHusbandName` | `input.fatherHusbandName` | `candidate_onboarding_profile` | `father_husband_name` | POST /employee-details | GET /status | **Mapped** |
| Mother Name | `motherName` | `motherName` | `input.motherName` | `candidate_onboarding_profile` | `mother_name` | POST /employee-details | GET /status | **Mapped** (added in migration 289) |
| Gender | `gender` | `gender` | `input.gender` | `candidate_onboarding_profile` | `gender` | POST /employee-details | GET /status | **Mapped** |
| Marital Status | `maritalStatus` | `maritalStatus` | `input.maritalStatus` | `candidate_onboarding_profile` | `marital_status` | POST /employee-details | GET /status | **Mapped** |
| Date of Birth | `dateOfBirth` | `dateOfBirth` | `input.dateOfBirth` | `candidate_onboarding_profile` | `date_of_birth` | POST /employee-details | GET /status | **Mapped** |
| Blood Group | `bloodGroup` | `bloodGroup` | `input.bloodGroup` | `candidate_onboarding_profile` | `blood_group` | POST /employee-details | GET /status | **Mapped** |
| Mobile Number | `mobileNumber` | `mobileNumber` | `input.mobileNumber` | `candidate_onboarding_profile` | `mobile_number` | POST /employee-details | GET /status | **Mapped** |
| Alt Mobile | `altMobileNumber` | `altMobileNumber` | `input.altMobileNumber` | `candidate_onboarding_profile` | `alt_mobile_number` | POST /employee-details | GET /status | **Mapped** |
| Personal Email | `personalEmailId` | `personalEmailId` | `input.personalEmailId` | `candidate_onboarding_profile` | `personal_email_id` | POST /employee-details | GET /status | **Mapped** |
| Official Email | `officialEmailId` | `officialEmailId` | `input.officialEmailId` | `candidate_onboarding_profile` | `official_email_id` | POST /employee-details | GET /status | **Mapped** |
| Emergency Contact Name | `emergencyContactName` | `emergencyContactName` | `input.emergencyContactName` | `candidate_onboarding_profile` | `emergency_contact_name` | POST /employee-details | GET /status | **Mapped** (added in migration 289) |
| Emergency Contact Relation | `emergencyContactRelation` | `emergencyContactRelation` | `input.emergencyContactRelation` | `candidate_onboarding_profile` | `emergency_contact_relation` | POST /employee-details | GET /status | **Mapped** |
| Emergency Contact Mobile | `emergencyContactMobile` | `emergencyContactMobile` | `input.emergencyContactMobile` | `candidate_onboarding_profile` | `emergency_contact_mobile` | POST /employee-details | GET /status | **Mapped** |
| Nationality | `nationality` | `nationality` | `input.nationality` | `candidate_onboarding_profile` | `nationality` | POST /employee-details | GET /status | **Mapped** |
| Religion | `religion` | `religion` | `input.religion` | `candidate_onboarding_profile` | `religion` | POST /employee-details | GET /status | **Mapped** |
| Category (SC/ST/OBC) | `category` | `category` | `input.category` | `candidate_onboarding_profile` | `category` | POST /employee-details | GET /status | **Mapped** |
| Guardian Name | — | — | — | `candidate_onboarding_profile` | *(absent)* | — | — | **Missing** — no DB column, no UI field, no API key. Add `guardian_name VARCHAR(255)` if needed. |

---

## 2. Candidate Address Fields

| Business Field | Frontend Field | API Payload Key | Backend Variable | DB Table | DB Column | Save API | Fetch API | Status |
|---|---|---|---|---|---|---|---|---|
| Permanent Address | `permanentAddress` | `permanentAddress` | `input.permanentAddress` | `candidate_onboarding_profile` | `permanent_address` | POST /employee-details | GET /status | **Mapped** |
| Permanent State (text) | `permanentState` | `permanentState` | `input.permanentState` | `candidate_onboarding_profile` | `permanent_state` | POST /employee-details | GET /status | **Mapped** |
| Permanent City | `permanentCity` | `permanentCity` | `input.permanentCity` | `candidate_onboarding_profile` | `permanent_city` | POST /employee-details | GET /status | **Mapped** |
| Permanent Pincode | `permanentPincode` | `permanentPincode` | `input.permanentPincode` | `candidate_onboarding_profile` | `permanent_pincode` | POST /employee-details | GET /status | **Mapped** |
| Present Address | `presentAddress` | `presentAddress` | `input.presentAddress` | `candidate_onboarding_profile` | `present_address` | POST /employee-details | GET /status | **Mapped** |
| Present State (text) | `presentState` | `presentState` | `input.presentState` | `candidate_onboarding_profile` | `present_state` | POST /employee-details | GET /status | **Mapped** |
| Present City | `presentCity` | `presentCity` | `input.presentCity` | `candidate_onboarding_profile` | `present_city` | POST /employee-details | GET /status | **Mapped** |
| Present Pincode | `presentPincode` | `presentPincode` | `input.presentPincode` | `candidate_onboarding_profile` | `present_pincode` | POST /employee-details | GET /status | **Mapped** |
| Address Proof Type | `addressProofType` | `addressProofType` | `input.addressProofType` | `candidate_onboarding_profile` | `address_proof_type` | POST /employee-details | GET /status | **Mapped** (added in migration 289) |
| Permanent State FK | — | — | — | `candidate_onboarding_profile` | `permanent_state_id` | — | — | **Unused** — column added in migration 289 but no API write path. Fix: accept `permanentStateId` in payload and write to this column. |
| Present State FK | — | — | — | `candidate_onboarding_profile` | `present_state_id` | — | — | **Unused** — same issue as above. |

---

## 3. Bank / Statutory Fields (UAN, ESIC, EPF)

| Business Field | Frontend Field | API Payload Key | Backend Variable | DB Table | DB Column | Save API | Fetch API | Status |
|---|---|---|---|---|---|---|---|---|
| Bank Name | `bankName` | `bankName` | `input.bankName` | `candidate_onboarding_bank_detail` | `bank_name` | POST /bank-details | GET /status | **Mapped** |
| Branch Name | `branchName` | `branchName` | `input.branchName` | `candidate_onboarding_bank_detail` | `branch_name` | POST /bank-details | GET /status | **Mapped** |
| Account Holder Name | `accountHolderName` | `accountHolderName` | `input.accountHolderName` | `candidate_onboarding_bank_detail` | `account_holder_name` | POST /bank-details | GET /status | **Mapped** |
| Account No | `accountNo` | `accountNo` | `maskAccount(accountNo)` | `candidate_onboarding_bank_detail` | `account_no_masked` + `account_no_hash` | POST /bank-details | GET /status | **Mapped** (masked/hashed) |
| Confirm Account No | `confirmAccountNo` | `confirmAccountNo` | *(not consumed)* | — | — | — | — | **Missing** — UI field exists for UX validation only; backend does not cross-check. Acceptable but note in test plan. |
| IFSC Code | `ifscCode` | `ifscCode` | `input.ifscCode` | `candidate_onboarding_bank_detail` | `ifsc_code` | POST /bank-details | GET /status | **Mapped** |
| Account Type | `accountType` | `accountType` | `input.accountType` | `candidate_onboarding_bank_detail` | `account_type` | POST /bank-details | GET /status | **Mapped** |
| UAN Number | `uanNumber` | `uanNumber` | `input.uanNumber` | `candidate_onboarding_profile` | `uan_number` | POST /employee-details | GET /status | **Mapped** |
| EPF Number | `epfNumber` | `epfNumber` | `input.epfNumber` | `candidate_onboarding_profile` | `epf_number` | POST /employee-details | GET /status | **Mapped** |
| ESIC Number | `esicNumber` | `esicNumber` | `input.esicNumber` | `candidate_onboarding_profile` | `esic_number` | POST /employee-details | GET /status | **Mapped** |
| EPS Member | `epsMember` | `epsMember` | `input.epsMember` | `candidate_onboarding_profile` | `eps_member` | POST /statutory | GET /status | **Mapped** (migration 289) |
| International Worker | `internationalWorker` | `internationalWorker` | `input.internationalWorker` | `candidate_onboarding_profile` | `international_worker` | POST /statutory | GET /status | **Mapped** |
| Previous PF Member | `previousPfMember` | `previousPfMember` | `input.previousPfMember` | `candidate_onboarding_profile` | `previous_pf_member` | POST /statutory | GET /status | **Mapped** |
| Statutory Declaration | `declarationAccepted` | `declarationAccepted` | `input.declarationAccepted` | `candidate_onboarding_profile` | `statutory_declaration_accepted` + `statutory_declaration_at` | POST /statutory | GET /status | **Mapped** |

---

## 4. Family / Nominee Fields

| Business Field | Frontend Field | API Payload Key | Backend Variable | DB Table | DB Column | Save API | Fetch API | Status |
|---|---|---|---|---|---|---|---|---|
| Nominee 1 Name | `nominee` | `nominee` | `input.nominee` | `candidate_onboarding_profile` | `nominee_name` | POST /employee-details | GET /status | **Mapped** |
| Nominee 1 Relation | `nomineeRelation` | `nomineeRelation` | `input.nomineeRelation` | `candidate_onboarding_profile` | `nominee_relation` | POST /employee-details | GET /status | **Mapped** |
| Nominee 1 DOB | `nomineeDateOfBirth` | `nomineeDateOfBirth` | `input.nomineeDateOfBirth` | `candidate_onboarding_profile` | `nominee_date_of_birth` | POST /employee-details | GET /status | **Mapped** |
| Nominee 1 Share % | `nominee1SharePct` | `nominee1SharePct` | `input.nominee1SharePct` | `candidate_onboarding_profile` | `nominee1_share_pct` | POST /employee-details | GET /status | **Mapped** |
| Nominee 2 Name | `nominee2Name` | `nominee2Name` | `input.nominee2Name` | `candidate_onboarding_profile` | `nominee2_name` | POST /employee-details | GET /status | **Mapped** |
| Nominee 2 Relation | `nominee2Relation` | `nominee2Relation` | `input.nominee2Relation` | `candidate_onboarding_profile` | `nominee2_relation` | POST /employee-details | GET /status | **Mapped** |
| Nominee 2 DOB | `nominee2Dob` | `nominee2Dob` | `input.nominee2Dob` | `candidate_onboarding_profile` | `nominee2_dob` | POST /employee-details | GET /status | **Mapped** |
| Nominee 2 Share % | `nominee2SharePct` | `nominee2SharePct` | `input.nominee2SharePct` | `candidate_onboarding_profile` | `nominee2_share_pct` | POST /employee-details | GET /status | **Mapped** |
| Annual Income | `annualIncome` | `annualIncome` | `input.annualIncome` | `candidate_onboarding_family` | `annual_income` | POST /family | GET /status | **Mapped** |
| Count of Dependents | `countOfDependents` | `countOfDependents` | `input.countOfDependents` | `candidate_onboarding_family` | `count_of_dependents` | POST /family | GET /status | **Mapped** |
| Family Details (extended) | — | — | — | `candidate_onboarding_family` | *(no additional columns)* | — | — | **Missing** — table only has `annual_income` + `count_of_dependents`. No spouse name, children count, parent details. Add columns if extended family capture is required. |

---

## 5. Language Fields

| Business Field | Frontend Field | API Payload Key | Backend Variable | DB Table | DB Column | Save API | Fetch API | Status |
|---|---|---|---|---|---|---|---|---|
| Language Name | `language_name` | `languages[].language_name` | `lang.language_name` | `candidate_onboarding_language` | `language_name` | POST /languages | GET /status | **Mapped** |
| Can Read | `can_read` | `languages[].can_read` | `lang.can_read` | `candidate_onboarding_language` | `can_read` | POST /languages | GET /status | **Mapped** |
| Can Write | `can_write` | `languages[].can_write` | `lang.can_write` | `candidate_onboarding_language` | `can_write` | POST /languages | GET /status | **Mapped** |
| Can Speak | `can_speak` | `languages[].can_speak` | `lang.can_speak` | `candidate_onboarding_language` | `can_speak` | POST /languages | GET /status | **Mapped** |
| Proficiency | `proficiency` | `languages[].proficiency` | `lang.proficiency` | `candidate_onboarding_language` | `proficiency` | POST /languages | GET /status | **Mapped** |

---

## 6. Document Metadata Fields

| Business Field | Frontend Field | API Payload Key | Backend Variable | DB Table | DB Column | Save API | Fetch API | Status |
|---|---|---|---|---|---|---|---|---|
| Doc Type | `docType` (form) | `docType` | `input.docType` | `candidate_onboarding_document` | `doc_type` | POST /documents | GET /status | **Mapped** |
| Doc Name | `docName` | `docName` | `input.docName` | `candidate_onboarding_document` | `doc_name` | POST /documents | GET /status | **Mapped** |
| Page No | `pageNo` | `pageNo` | `input.pageNo` | `candidate_onboarding_document` | `page_no` | POST /documents | GET /status | **Mapped** |
| File URL | *(returned)* | — | `fileUrl` | `candidate_onboarding_document` | `file_url` | POST /documents | GET /status | **Mapped** |
| Document Status | — | — | — | `candidate_onboarding_document` | `document_status` | *(BGV review only)* | GET /status | **Unused** from candidate side — only HR/BGV reviewer updates this. Acceptable by design. |
| Verification Method | — | — | — | `candidate_onboarding_document` | `verification_method` | *(BGV only)* | GET /status | **Unused** from candidate side. Acceptable. |
| Board Type | `boardType` | `boardType` | *(not read)* | `candidate_onboarding_qualification` | *(absent)* | POST /qualification | — | **Missing** — UI field `boardType` sent in payload but service does not read it and no DB column exists. Fix: add `board_type VARCHAR(50)` and write `input.boardType`. |
| Institution Name | `institutionName` | `institutionName` | *(not read)* | `candidate_onboarding_qualification` | *(absent)* | POST /qualification | — | **Missing** — same as above. Fix: add `institution_name VARCHAR(255)` column. |

---

## 7. DPDP / BGV Consent Fields

| Business Field | Frontend Field | API Payload Key | Backend Variable | DB Table | DB Column | Save API | Fetch API | Status |
|---|---|---|---|---|---|---|---|---|
| BGV Consent Grant | `consentAccepted` | `purposes[]` | `input.purposes` | `candidate_bgv_consent` | `purpose_json`, `consent_status` | POST /api/ats/bgv/consent | GET /api/ats/bgv/status | **Mapped** |
| Consent Version | — | — | *(hardcoded absent)* | `candidate_bgv_consent` | `consent_version` | POST /api/ats/bgv/consent | GET /api/ats/bgv/status | **Broken** — service inserts `consent_version` as the `consent_text_hash` parameter positionally (line 84 of bgv-verification.service.ts). Column order mismatch: INSERT lists `(id, candidate_id, consent_version, consent_text_hash, ...)` but values array is `[uuid, candidateId, consentTextHash, purposes_json, ...]` — `consent_version` gets a SHA-256 hash string, not a semver. Fix: separate version string (e.g. `"1.0"`) from hash. |
| DPDP Withdrawal Request | — | — | — | `dpdp_consent_withdrawal` | `scope_json`, `withdrawal_reason` | *(no UI route yet)* | *(no UI route yet)* | **Missing** — table and migration 293 exist but no frontend page or API route exposes withdrawal submission to the candidate. Fix: add `POST /api/dpdp/withdraw` and a withdrawal page. |
| OTP Verified | `otpVerified` (state) | `otp` | `record.otp_hash` verify | `candidate_onboarding_profile` | `otp_verified`, `otp_verified_at` | POST /otp/verify | GET /status (via `sp.otp_verified`) | **Mapped** |

---

## 8. Name Match / Consistency Matrix Fields

| Business Field | Frontend Field | API Payload Key | Backend Variable | DB Table | DB Column | Save API | Fetch API | Status |
|---|---|---|---|---|---|---|---|---|
| Overall Name Match Status | — | — | — | `candidate_name_match_summary` | `overall_status` | *(no write route in onboarding-full)* | *(no candidate-facing fetch)* | **Unused** from onboarding flow — tables from migration 295 exist but population logic is absent. Fix: call name-consistency.routes.ts computation after profile submit. |
| Name Match Detail Per Source | — | — | — | `candidate_name_match_detail` | `source_name`, `match_score`, `is_match` | *(no auto-population on submit)* | *(HR admin only)* | **Missing** — submit flow (`submitFullOnboarding`) does not trigger name comparison computation. Fix: trigger name-match after `profile_status = 'submitted'`. |
| Name Override Approval | — | — | — | `candidate_name_override_audit` | `override_type`, `reason` | *(no route exists)* | — | **Unused** — table exists; no HR UI route exposed. |
| `blocks_employee_code` flag | — | — | — | `candidate_name_match_summary` | `blocks_employee_code` | *(no gate in submit/convert flow)* | — | **Broken** — column defaults to `1` (blocking) but `submitFullOnboarding` and candidate-to-employee conversion do not check this flag before issuing employee code. Fix: add gate check in convert service. |

---

## 9. Dashboard Metrics Fields

| Business Field | Frontend Field | API Payload Key | Backend Variable | DB Table | DB Column | Save API | Fetch API | Status |
|---|---|---|---|---|---|---|---|---|
| Metric Code | *(admin config)* | `metric_code` | — | `dashboard_metric_catalog` | `metric_code` | *(admin seed / migration 290)* | GET /api/dashboard/metrics | **Mapped** (seed in migration 290) |
| Metric Snapshot Value | *(dashboard tile)* | — | — | `dashboard_metric_snapshot` | `value`, `previous_value`, `trend` | *(no compute job/route)* | *(no fetch route)* | **Missing** — snapshot table exists but no background job or API route writes computed values. Tiles show stale/zero data. Fix: add a cron or on-demand compute endpoint. |
| Role–Dashboard Config | *(role-based tiles)* | — | — | `dashboard_role_metric_config` | `role_code`, `metric_code` | *(admin config UI absent)* | *(no fetch route)* | **Missing** — table seeded via migration but no admin config UI or API route for CRUD. Fix: add `GET/POST /api/admin/dashboard-config`. |

---

## 10. Incentive Batch / Approval Fields

| Business Field | Frontend Field | API Payload Key | Backend Variable | DB Table | DB Column | Save API | Fetch API | Status |
|---|---|---|---|---|---|---|---|---|
| Batch Ref | *(upload form)* | `batch_ref` | — | `incentive_upload_batch` | `batch_ref` | *(no route yet)* | *(no route yet)* | **Missing** — tables from migration 291 exist but no backend routes implemented. Fix: create `POST /api/payroll/incentive/upload` and `GET /api/payroll/incentive/batches`. |
| Approval Chain | *(approval UI)* | — | — | `incentive_upload_batch` | `approval_chain` (JSON) | *(no route)* | *(no route)* | **Missing** — same as above. |
| Approval Step Status | *(approver action)* | `status`, `remarks` | — | `incentive_approval_step` | `status`, `remarks`, `decided_at` | *(no route)* | *(no route)* | **Missing** |
| Payroll Register Finalized | *(finance view)* | — | — | `incentive_payroll_register` | `finalized_by`, `finalized_at` | *(no route)* | *(no route)* | **Missing** — page codes registered in migration 291 (`PAYROLL_INCENTIVE_UPLOAD`, `PAYROLL_INCENTIVE_APPROVALS`, `PAYROLL_INCENTIVE_REGISTER`) but no backend routes exist. |

---

## 11. TAT Task Fields

| Business Field | Frontend Field | API Payload Key | Backend Variable | DB Table | DB Column | Save API | Fetch API | Status |
|---|---|---|---|---|---|---|---|---|
| TAT Rule Config | *(admin config)* | — | — | `tat_matrix_master` | `task_type`, `default_tat_hours` | *(seeded in migration 294)* | GET /api/tat/matrix | **Mapped** (seed only; no admin CRUD route) |
| TAT Instance (task clock) | *(work inbox)* | `entity_type`, `entity_id` | — | `task_tat_instance` | `due_at`, `status`, `current_escalation_level` | *(no create route)* | *(no fetch route)* | **Missing** — no route creates TAT instances on trigger events (e.g. profile submitted). Fix: create `POST /api/tat/instance` called from submit/joining flows. |
| Escalation Log | *(notifications)* | — | — | `task_escalation_log` | `escalation_level`, `triggered_at` | *(no worker)* | *(no route)* | **Missing** — escalation evaluation job does not exist. Fix: add a scheduled worker that checks `task_tat_instance.due_at` and logs escalations. |
| Work Item | *(work inbox)* | `item_type`, `title` | — | `work_item` | `status`, `assigned_to_user_id` | *(no create route)* | *(no fetch route)* | **Missing** — `work_item` table from migration 290 has no write or read API routes. Fix: implement `POST /api/work-items` and `GET /api/work-items?assignedTo=me`. |

---

## 12. Resignation / Exit Fields

| Business Field | Frontend Field | API Payload Key | Backend Variable | DB Table | DB Column | Save API | Fetch API | Status |
|---|---|---|---|---|---|---|---|---|
| Resignation Discussion | *(manager UI)* | `discussion_type`, `outcome` | — | `resignation_discussion` | `outcome`, `employee_sentiment`, `remarks` | *(no route)* | *(no route)* | **Missing** — tables from migration 296 exist; page codes `RESIGNATION_COMMAND_CENTER` and `RESIGNATION_MY_REQUEST` registered but no backend routes implemented. |
| Discussion Note | *(discussion timeline)* | `note`, `is_confidential` | — | `resignation_discussion_note` | `note`, `is_confidential` | *(no route)* | *(no route)* | **Missing** |
| Retention Offer | *(retention UI)* | `offer_type`, `offer_details` | — | `retention_offer` | `offer_type`, `offer_details`, `employee_response` | *(no route)* | *(no route)* | **Missing** — `exit_request_id` FK implies `employee_exit_request` table is assumed to exist from earlier migrations; verify it exists. |
| Exit Request Parent | *(resignation form)* | — | — | `employee_exit_request` | *(assumed from prior migrations)* | *(verify)* | *(verify)* | **Broken** — `resignation_discussion.exit_request_id` FK will fail at insert if `employee_exit_request` table does not exist in current schema. Verify migration 267/268 created this table before applying 296. |

---

## Summary of Issues by Priority

| Priority | Issue | Fix Required |
|---|---|---|
| P1 | `consent_version` column gets SHA-256 hash instead of version string — BGV consent record corrupted | Fix `saveBgvConsentByToken` INSERT param order |
| P1 | `blocks_employee_code=1` default in `candidate_name_match_summary` never checked before employee code creation | Add gate in `ats.convert.service.ts` |
| P1 | `resignation_discussion.exit_request_id` FK may fail if `employee_exit_request` does not exist | Verify prior migration; add FK guard |
| P2 | `board_type` and `institution_name` sent by UI but dropped silently — qualification data incomplete | Add columns + read in `addQualification` |
| P2 | `present_state_id` and `permanent_state_id` columns added but never written | Accept `presentStateId`/`permanentStateId` in `/employee-details` payload |
| P2 | Name-match computation not triggered on submit — `blocks_employee_code` never evaluated | Call name-consistency service after submit |
| P2 | Dashboard metric snapshots never computed — tiles return zero | Implement compute job or on-demand endpoint |
| P3 | Incentive batch / approval / register — all three tables have zero API routes | Implement payroll incentive route module |
| P3 | TAT instances never created on trigger events | Add TAT instance creation to submit/joining |
| P3 | `work_item` table has no read/write API routes | Implement work-inbox route module |
| P3 | DPDP withdrawal table exists with no candidate-facing route | Add withdrawal submission endpoint + page |
| P3 | Resignation discussion module fully absent (routes) | Implement resignation-discussion route module |
| Low | `guardian_name` — no column, no UI, no API | Add only if business requires it |
| Low | `confirmAccountNo` not server-side validated | Add cross-check in `saveBankDetails` |
