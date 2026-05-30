# PeopleOS Slice 01 — Employee ID Generation + Pre-Joining Onboarding Autofill

**Date:** 30-May-2026  
**Status:** Mandatory first controlled implementation slice after visible demo repair.  
**Scope:** ATS → Pre-Joining Portal → Employee Master conversion.  
**Rule:** Build this slice separately. Do not mix with roster, payroll, gamification, DPDP full build or client portal expansion.

---

## 1. Why this slice comes first

PeopleOS must not create broken or duplicate employee identities. Employee ID generation and onboarding data capture are foundational because all later modules depend on clean employee identity:

- payroll;
- roster;
- attendance;
- assets;
- LMS mapping;
- document verification;
- performance;
- incentives;
- DPDP consent/audit;
- employee journey stat card.

If employee identity is wrong, every downstream module becomes unreliable.

---

## 2. Target End-to-End Journey

```text
Candidate registered in ATS
→ Candidate selected / offer initiated
→ Candidate opens pre-joining portal
→ Candidate validates identity through Candidate ID / mobile / email / OTP
→ System fetches existing ATS data
→ Candidate uploads resume PDF/image OR clicks photo of resume
→ Resume parser extracts available details
→ System auto-fills onboarding form
→ Candidate reviews, corrects and submits
→ Document verification/compliance runs
→ Offer acknowledgement captured
→ HR validates onboarding package
→ Employee ID generated from configured rule
→ Candidate converted to employee
→ Employee portal activated
→ Employee journey event and stat snapshot updated
```

---

## 3. Employee ID Generation Requirement

Employee ID must be generated through a configurable master, not hardcoded.

### 3.1 Employee ID Rule Master

Create/extend a master for employee-code rules.

Suggested table:

```sql
employee_id_rule_master
```

Required fields:

| Column | Purpose |
|---|---|
| `id` | UUID primary key |
| `rule_code` | Human-readable rule key |
| `branch_id` | Optional branch scope |
| `client_id` | Optional client scope |
| `process_id` | Optional process scope |
| `lob_id` | Optional LOB scope |
| `cost_centre_id` | Optional cost centre scope |
| `prefix` | Example: `MAS`, `IDC`, `MCN` |
| `number_length` | Example: 5 or 6 digits |
| `current_sequence` | Last used number |
| `reset_policy` | never/yearly/monthly/branch-wise if needed |
| `effective_from` | Rule start date |
| `effective_to` | Rule end date |
| `active_status` | Active/inactive |
| `created_by` / `updated_by` | Audit |

### 3.2 Employee ID generation logic

```text
Input: candidate_id + target branch/process/LOB/cost-centre/designation
→ Resolve active rule by most specific scope:
   cost centre > LOB > process > client > branch > global
→ Lock sequence safely
→ Generate next code
→ Validate uniqueness in employees.employee_code
→ Insert generated code into employee_id_generation_log
→ Use employee_code only during final candidate-to-employee conversion
```

### 3.3 Required safeguards

- No duplicate employee code.
- Sequence must be transaction-safe.
- Employee ID should not be generated before HR final validation.
- Cancelled/no-show candidates must not consume final employee code unless business wants reserved IDs.
- If code generation fails, conversion must fail safely.
- All generated IDs must be logged.

Suggested table:

```sql
employee_id_generation_log
```

Fields:

| Column | Purpose |
|---|---|
| `id` | UUID |
| `rule_id` | Employee ID rule used |
| `candidate_id` | Source candidate |
| `employee_id` | Created employee if conversion completed |
| `generated_employee_code` | Generated code |
| `generation_status` | reserved/used/cancelled/failed |
| `generated_at` | Timestamp |
| `generated_by` | User/service |
| `remarks` | Reason/error |

---

## 4. Pre-Joining Portal Requirement

Pre-joining portal is not the normal employee portal yet. It is a candidate/new-joiner controlled portal that allows onboarding completion before employee activation.

### 4.1 Access method

Candidate should access through:

```text
/prejoining/:token
```

or

```text
/prejoining/login
```

Supported validation:
- Candidate ID + registered mobile/email.
- OTP or secure token.
- Expiring magic link from offer/onboarding communication.

### 4.2 Pre-filled fields from ATS

Auto-fetch from ATS candidate record:

| Field group | Source |
|---|---|
| Name | ATS candidate |
| Mobile | ATS candidate |
| Email | ATS candidate |
| Branch | ATS candidate/interview result |
| Process | ATS selected process |
| Role/designation | Offer/interview result |
| Recruiter/source | ATS candidate |
| Interview outcomes | ATS stage logs |
| Offer details | Offer table |
| BGV status | ATS/BGV table |

### 4.3 Candidate manually completes

Candidate should complete/validate:

- full legal name;
- father/mother/spouse name where required;
- date of birth;
- gender;
- current address;
- permanent address;
- emergency contact;
- education;
- experience;
- bank details where permitted;
- PAN/UAN/PF/ESIC details where required;
- prior employer details;
- declaration/consent;
- document uploads.

All sensitive fields must follow DPDP data-minimisation and masking rules.

---

## 5. Resume Upload / Resume Photo Parsing Requirement

Candidate must be able to:

1. upload resume PDF/DOC/image;
2. click photo of resume from mobile camera;
3. let parser extract details;
4. review and correct the extracted details;
5. submit only after candidate validation.

### 5.1 Resume parser flow

```text
resume file/photo captured
→ upload to approved storage
→ parser/OCR extraction job created
→ extracted fields stored as draft only
→ confidence score shown
→ candidate validates/corrects
→ final submitted profile saved
```

### 5.2 Suggested tables

```sql
prejoining_profile_draft
resume_parse_job
resume_parse_extracted_field
prejoining_submission
```

`prejoining_profile_draft` fields:
- `id`
- `candidate_id`
- `draft_status`
- `source_candidate_id`
- `prefill_payload_json`
- `candidate_edit_payload_json`
- `validation_status`
- `submitted_at`

`resume_parse_job` fields:
- `id`
- `candidate_id`
- `file_ref`
- `file_type`
- `parser_provider`
- `job_status`
- `confidence_score`
- `raw_text_ref`
- `created_at`
- `completed_at`

`resume_parse_extracted_field` fields:
- `id`
- `parse_job_id`
- `field_key`
- `field_value`
- `confidence_score`
- `candidate_confirmed_flag`
- `candidate_corrected_value`

`prejoining_submission` fields:
- `id`
- `candidate_id`
- `final_payload_json`
- `consent_id`
- `submitted_at`
- `review_status`
- `reviewed_by`
- `reviewed_at`

### 5.3 Important rules

- Parsed data is never final automatically.
- Candidate must validate extracted values.
- HR/compliance can see raw/parsed differences.
- Any parser provider must be pluggable.
- Do not store raw resume images/text in MySQL; store file refs and metadata only.
- Sensitive fields require masking and access audit.

---

## 6. Candidate-to-Employee Conversion Logic

Conversion must be a controlled backend workflow.

```text
prejoining_submission.review_status = approved
AND candidate_compliance_status not blocked
AND offer_acknowledgement accepted where required
AND BGV gate passed/allowed by process rule
→ generate employee_code
→ create employees record
→ create employee_cost_centre_history
→ create employee_journey_event
→ create employee_stat_snapshot
→ activate employee portal account
```

### 6.1 Do not create duplicate employee records

Before conversion, check:
- candidate ID already converted;
- mobile/email duplicate employee;
- government ID/PAN/UAN duplicate where legally allowed and available;
- previous employee/rejoin mapping.

### 6.2 Rejoin logic

If candidate is ex-employee:
- follow rehire eligibility/cooling rules;
- preserve old employee journey;
- create new stint if business rule requires;
- never overwrite historical employment data.

---

## 7. Auto-fill Mapping

| Target field | Priority source order |
|---|---|
| Full name | Candidate validated value > resume parsed > ATS candidate |
| Mobile | ATS verified mobile > candidate validated mobile |
| Email | ATS verified email > candidate validated email |
| Address | candidate validated > resume parsed > blank |
| Education | candidate validated > resume parsed > ATS |
| Experience | candidate validated > resume parsed > ATS |
| Skills | candidate validated > resume parsed |
| Branch | offer/interview result > ATS selected branch |
| Process | offer/interview result > ATS applied process |
| LOB | offer/process mapping > HR assignment |
| Cost Centre | LOB/process rule > HR assignment |
| Designation | offer/designation mapping > interview result |
| Reporting Manager | process/LOB/cost-centre assignment rule > HR assignment |

---

## 8. DPDP Controls in This Slice

Mandatory:
- privacy notice before data capture;
- consent ledger entry for pre-joining data collection;
- separate consent for resume parsing/photo capture;
- separate consent for document verification/e-sign where required;
- data inventory entries for each new personal-data column/table;
- sensitive read/export audit;
- retention policy for candidate records and resumes;
- masking for document, Aadhaar/PAN/bank/payroll fields;
- delete/anonymise candidate data where legally required and allowed.

---

## 9. Implementation Package Boundary

Build this slice only:

### Include
- Employee ID rule master migration/API/tests.
- Employee ID generation service with transaction-safe sequence.
- Pre-joining profile draft APIs.
- Resume parse job abstraction and metadata tables.
- Candidate-to-employee conversion mapping service.
- Public/pre-joining frontend page skeleton.
- Candidate validation UI for parsed/autofilled data.
- Journey event creation for conversion.

### Exclude for this slice
- Full roster logic engine.
- Full payroll processing.
- Full DPDP compliance control tower.
- Full communication engine.
- Full gamification.
- Full client portal expansion.

---

## 10. Acceptance Criteria

The slice is complete only when:

1. candidate can open pre-joining portal;
2. ATS data pre-fills profile;
3. resume upload/photo parse job can store extracted draft fields;
4. candidate can validate/correct and submit;
5. HR can approve submission;
6. employee ID generates from rule master;
7. employee record is created once;
8. employee cost-centre assignment is created;
9. employee journey event is written;
10. employee stat snapshot is refreshed;
11. tests pass;
12. no SQL is executed without approval;
13. no secrets are committed;
14. no live external systems are modified.
