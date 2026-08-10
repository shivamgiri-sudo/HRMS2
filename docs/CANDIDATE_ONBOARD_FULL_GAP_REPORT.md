# Candidate Onboarding Full Gap Report
Generated: 2026-06-24

## Summary
| Category | Count |
|---|---|
| Sections audited | 11 (S0–S10) |
| Fields — Covered | 94 |
| Fields — Partial | 6 |
| Fields — Missing | 14 |
| Routes missing | 2 (OTP send/verify, autosave) |
| DB columns missing | 8 |
| Mobile responsive | YES (all sections) |
| Autosave wired | PARTIAL (progress only; no field-level autosave route) |
| OTP | NOT PRESENT |

---

## Field Gap Table

| Section | Required Field | Frontend Field | Backend Field | DB Column | Status | Mobile UX | Validation | Autosave | Fix Required | Priority |
|---|---|---|---|---|---|---|---|---|---|---|
| Personal | Full name | employee_name | employeeName | employee_name | ✅ Covered | ✅ | ✅ | ✅ | — | — |
| Personal | Father/Guardian name | father_husband_name | fatherHusbandName | father_husband_name | ✅ Covered | ✅ | ✅ | ✅ | — | — |
| Personal | Mother name | — | — | — | ❌ Missing | — | — | — | Add field | P1 |
| Personal | Guardian name (separate) | — | — | — | ❌ Missing | — | — | — | Add field | P1 |
| Personal | Date of birth | date_of_birth | dateOfBirth | date_of_birth | ✅ Covered | ✅ | ✅ | ✅ | — | — |
| Personal | Gender | gender | gender | gender | ✅ Covered | ✅ | ✅ | ✅ | — | — |
| Personal | Marital status | marital_status | maritalStatus | marital_status | ✅ Covered | ✅ | ✅ | ✅ | — | — |
| Personal | Blood group | blood_group | bloodGroup | blood_group | ✅ Covered | ✅ | ✅ | ✅ | — | — |
| Personal | Mobile number | mobile_number | mobileNumber | mobile_number | ✅ Covered | ✅ | ✅ | ✅ | — | — |
| Personal | Alternate mobile | alt_mobile_number | altMobileNumber | alt_mobile_number | ✅ Covered | ✅ | — | ✅ | — | — |
| Personal | Email | personal_email_id | personalEmailId | personal_email_id | ✅ Covered | ✅ | ✅ | ✅ | — | — |
| Personal | Emergency contact name | — | — | — | ❌ Missing | — | — | — | Add field | P1 |
| Personal | Emergency contact number | emergency_contact_mobile | — | emergency_contact_mobile | ⚠️ Partial | — | — | — | Wire to frontend | P1 |
| Personal | Emergency relation | — | — | — | ❌ Missing | — | — | — | Add field | P2 |
| Personal | Nationality | — | — | — | ❌ Missing | — | — | — | Add field | P2 |
| Personal | Religion | — | — | — | ❌ Missing | — | — | — | Add field | P3 |
| Personal | Category | — | — | — | ❌ Missing | — | — | — | Add field | P3 |
| Address | Present address | present_address | presentAddress | present_address | ✅ Covered | ✅ | ✅ | ✅ | — | — |
| Address | Present state (free text) | present_state | presentState | present_state | ⚠️ Partial | ✅ | — | ✅ | Add state_id | P1 |
| Address | Present state ID | — | — | — | ❌ Missing | — | — | — | Add column | P1 |
| Address | Present city | present_city | presentCity | present_city | ✅ Covered | ✅ | ✅ | ✅ | — | — |
| Address | Present pincode | present_pincode | presentPincode | present_pincode | ✅ Covered | ✅ | ✅ | ✅ | — | — |
| Address | Permanent address | permanent_address | permanentAddress | permanent_address | ✅ Covered | ✅ | ✅ | ✅ | — | — |
| Address | Permanent state (free text) | permanent_state | permanentState | permanent_state | ⚠️ Partial | ✅ | — | ✅ | Add state_id | P1 |
| Address | Permanent state ID | — | — | — | ❌ Missing | — | — | — | Add column | P1 |
| Address | Permanent city | permanent_city | permanentCity | permanent_city | ✅ Covered | ✅ | ✅ | ✅ | — | — |
| Address | Address proof type | — | — | — | ❌ Missing | — | — | — | Add field | P2 |
| Identity | Aadhaar number | aadhaar_number_masked | aadhaarNumber | aadhaar_number_masked | ✅ Covered | ✅ | ✅ | ✅ | — | — |
| Identity | PAN number | pan_number | panNumber | pan_number_masked | ✅ Covered | ✅ | ✅ | ✅ | — | — |
| Identity | UAN | uan_number | uanNumber | uan_number | ✅ Covered | ✅ | ✅ | ✅ | — | — |
| Identity | ESIC number | esic_number | esicNumber | esic_number | ✅ Covered | ✅ | ✅ | ✅ | — | — |
| Identity | Passport number | passport_number | passportNumber | passport_no | ✅ Covered | ✅ | — | ✅ | — | — |
| Identity | Driving licence | dl_number | dlNumber | driving_license_no | ✅ Covered | ✅ | — | ✅ | — | — |
| Identity | Voter ID | voter_id | (BGV field) | — | ⚠️ Partial | — | — | — | Wire to profile | P2 |
| Bank | Bank name | bank_name | bankName | bank_name | ✅ Covered | ✅ | ✅ | ✅ | — | — |
| Bank | Account holder name | account_holder_name | accountHolderName | account_holder_name | ✅ Covered | ✅ | ✅ | ✅ | — | — |
| Bank | Account number | account_no | accountNo | account_no_masked | ✅ Covered | ✅ | ✅ | ✅ | — | — |
| Bank | Confirm account number | — | — | — | ❌ Missing | — | — | — | Add confirm field | P1 |
| Bank | IFSC | ifsc_code | ifscCode | ifsc_code | ✅ Covered | ✅ | ✅ | ✅ | — | — |
| Bank | Bank branch name | branch_name | branchName | branch_name | ✅ Covered | ✅ | ✅ | ✅ | — | — |
| Bank | Account type | account_type | accountType | account_type | ✅ Covered | ✅ | ✅ | ✅ | — | — |
| Education | Qualification | qualification | qualification | qualification | ✅ Covered | ✅ | ✅ | ✅ | — | — |
| Education | Board/university | board_type | boardType | board_type | ✅ Covered | ✅ | — | — | — | — |
| Education | Institute name | institution_name | institutionName | institution_name | ✅ Covered | ✅ | — | — | — | — |
| Education | Passing year | passed_out_year | passedOutYear | passed_out_year | ✅ Covered | ✅ | ✅ | — | — | — |
| Education | Percentage/CGPA | passed_out_percentage | passedOutPercentage | passed_out_percentage | ✅ Covered | ✅ | — | — | — | — |
| Education | Education mode | — | — | — | ❌ Missing | — | — | — | Add field | P3 |
| Experience | Fresher/experienced | working_experience | workingExperience | working_experience | ✅ Covered | ✅ | ✅ | ✅ | — | — |
| Experience | Employer name | employer_name | employerName | employer_name | ✅ Covered | ✅ | — | ✅ | — | — |
| Experience | Designation | last_designation | lastDesignation | last_designation | ✅ Covered | ✅ | — | ✅ | — | — |
| Experience | From date | — | — | — | ❌ Missing | — | — | — | Add field | P2 |
| Experience | To date | — | — | — | ❌ Missing | — | — | — | Add field | P2 |
| Experience | Last drawn salary | last_ctc | lastCtc | last_ctc | ✅ Covered | ✅ | — | ✅ | — | — |
| Experience | Reason for leaving | — | — | — | ❌ Missing | — | — | — | Add field | P2 |
| Language | Language name | — | — | — | ❌ Missing | — | — | — | Add section | P1 |
| Language | Can read | — | — | — | ❌ Missing | — | — | — | Add column | P1 |
| Language | Can write | — | — | — | ❌ Missing | — | — | — | Add column | P1 |
| Language | Can speak | — | — | — | ❌ Missing | — | — | — | Add column | P1 |
| Family | Annual income | annual_income | annualIncome | annual_income | ✅ Covered | ✅ | — | ✅ | — | — |
| Family | Count of dependents | count_of_dependents | countOfDependents | count_of_dependents | ✅ Covered | ✅ | — | ✅ | — | — |
| Family | Family member details | — | — | — | ❌ Missing | — | — | — | Add multi-row | P2 |
| Nominee | Nominee name | nominee_name | nomineeName | nominee_name | ✅ Covered | ✅ | — | ✅ | — | — |
| Nominee | Nominee relation | nominee_relation | nomineeRelation | nominee_relation | ✅ Covered | ✅ | — | ✅ | — | — |
| Nominee | Nominee DOB | nominee_date_of_birth | nomineeDateOfBirth | nominee_date_of_birth | ✅ Covered | ✅ | — | ✅ | — | — |
| Nominee | Nominee share % | nominee1_share_pct | nominee1SharePct | nominee1_share_pct | ⚠️ Partial | ✅ | — | — | Wire to frontend | P1 |
| Statutory | Previous PF member | pf_eligible | pfEligible | pf_eligible | ⚠️ Partial | ✅ | — | ✅ | Add boolean | P1 |
| Statutory | EPS member | — | — | — | ❌ Missing | — | — | — | Add column | P1 |
| Statutory | International worker | — | — | — | ❌ Missing | — | — | — | Add column | P2 |
| Statutory | Previous PF account no | epf_number | epfNumber | epf_number | ✅ Covered | ✅ | — | ✅ | — | — |
| Statutory | Declaration checkbox | — | — | — | ❌ Missing | — | — | — | Add frontend | P1 |
| Consent | DPDP consent | consent flow (S0) | bgv_consent table | candidate_bgv_consent | ✅ Covered | ✅ | ✅ | — | — | — |
| Consent | BGV consent | consent flow (S0) | bgv_consent table | candidate_bgv_consent | ✅ Covered | ✅ | ✅ | — | — | — |
| Auth | OTP verification | — | — | — | ❌ Missing | — | — | — | Add OTP routes | P1 |
| Autosave | Field-level autosave | useAutoSave (client) | — | — | ⚠️ Partial | — | — | — | Add /autosave route | P1 |

---

## Missing DB Columns — Migration Required

File: `backend/sql/289_candidate_onboarding_full_field_parity.sql`

| Table | Column | Type | Notes |
|---|---|---|---|
| candidate_onboarding_profile | mother_name | VARCHAR(255) | — |
| candidate_onboarding_profile | emergency_contact_name | VARCHAR(255) | — |
| candidate_onboarding_profile | emergency_contact_relation | VARCHAR(100) | — |
| candidate_onboarding_profile | nationality | VARCHAR(100) | — |
| candidate_onboarding_profile | religion | VARCHAR(100) | — |
| candidate_onboarding_profile | category | VARCHAR(100) | SC/ST/OBC/General |
| candidate_onboarding_profile | present_state_id | CHAR(36) | FK state_master |
| candidate_onboarding_profile | permanent_state_id | CHAR(36) | FK state_master |
| candidate_onboarding_profile | address_proof_type | VARCHAR(50) | — |
| candidate_onboarding_profile | eps_member | TINYINT(1) | — |
| candidate_onboarding_profile | international_worker | TINYINT(1) | — |
| candidate_onboarding_profile | previous_pf_member | TINYINT(1) | Replaces pf_eligible string |
| candidate_onboarding_profile | statutory_declaration_accepted | TINYINT(1) | — |
| candidate_onboarding_profile | statutory_declaration_at | DATETIME | — |
| candidate_onboarding_profile | otp_verified | TINYINT(1) DEFAULT 0 | — |
| candidate_onboarding_profile | otp_verified_at | DATETIME | — |
| candidate_onboarding_language | (new table) | — | language proficiency rows |
| candidate_onboarding_experience | from_date | DATE | — |
| candidate_onboarding_experience | to_date | DATE | — |
| candidate_onboarding_experience | reason_for_leaving | VARCHAR(500) | — |

---

## Missing Routes

| Method | Route | Priority |
|---|---|---|
| POST | `/api/ats/onboarding-full/otp/send` | P1 |
| POST | `/api/ats/onboarding-full/otp/verify` | P1 |
| POST | `/api/ats/onboarding-full/autosave` | P1 |
| GET | `/api/ats/onboarding-full/draft/:candidateId` | P2 |

---

## Real Integration Gap (Setu)

| Feature | Current | Target | Setu Product |
|---|---|---|---|
| PAN verification | Mock | Setu PAN Verify API | `pan/verify` |
| Aadhaar offline | Mock | Setu Aadhaar XML/OTP | `aadhaar/generate-otp`, `aadhaar/verify-otp` |
| Bank penny drop | Mock | Setu Penny Drop API | `bank-account-verification/penny-drop` |
| e-Sign | None | Setu eSign | `esign/create-request` |
| DigiLocker | Mock HTML page | Setu DigiLocker Pull | `digilocker/pull` |

---

## Overall Status: PARTIAL

- Mobile responsive: ✅
- Full field parity: ❌ (14 fields missing)
- Autosave route: ❌
- OTP: ❌
- Real integrations: ❌ (all mock)
- DB migration needed: ✅
- Language section: ❌ (completely absent)
