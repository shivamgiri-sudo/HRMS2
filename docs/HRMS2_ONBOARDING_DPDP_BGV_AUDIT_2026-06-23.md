# HRMS2 Onboarding DPDP/BGV Audit

Date: 2026-06-23

## Executive Summary

HRMS2 already has several onboarding building blocks: ATS candidate selection, onboarding token generation, a candidate onboarding V2 wizard, persisted profile/bank/education/family/experience/document tables, BGV checks, BGV vendor dispatch, payroll HR validation, branch-head offer approval, DPDP/privacy admin tables, and employee-code sequencing.

The current implementation is not yet the requested candidate onboarding engine. The largest gaps are mobile OTP entry, secure candidate sessions, field-level autosave with offline/resume/conflict behavior, master-driven document checklist, purpose-wise DPDP consent before data collection, candidate-facing data rights, final readiness gating, and signed/encrypted document storage. Current candidate onboarding is primarily token-link based, with public token APIs under `/api/ats/onboarding-full/*` and `/api/ats/bgv/*`.

No functional code changes have been made in this audit. This document is the required implementation gate before building.

## Current Architecture

### Frontend

- Candidate entry routes:
  - `/onboard` -> `CandidateOnboardingPage`
  - `/onboard-full` -> `CandidateOnboardingFullPage`
  - `CandidateOnboardingV2` exists but is not wired in `App.tsx` as a direct route in the current route table.
- V2 wizard:
  - `src/pages/CandidateOnboardingV2.tsx` renders sections `S0` to `S10`.
  - It uses token query param, loads status/BGV in `useOnboardingV2`, and saves through section-level POST APIs.
  - It has sidebar progress and a visible `Saving...` state.
- Older full form:
  - `src/pages/CandidateOnboardingFullPage.tsx` still resembles a joining-form flow and includes doc type/name/page upload.
  - This conflicts with the requested smart document-card journey.
- Candidate portal:
  - `CandidatePortalLogin`/`CandidatePortalDashboard` exists with separate candidate portal auth, not the requested OTP-only onboarding entry.

### Backend APIs

- Public ATS routes are mounted before `requireAuth` in `backend/src/modules/ats/ats.routes.ts`.
- Candidate onboarding APIs:
  - `GET /api/ats/onboarding-full/validate-token`
  - `GET /api/ats/onboarding-full/status`
  - `POST /api/ats/onboarding-full/employee-details`
  - `POST /api/ats/onboarding-full/bank-details`
  - `POST /api/ats/onboarding-full/qualification`
  - `POST /api/ats/onboarding-full/family`
  - `POST /api/ats/onboarding-full/experience`
  - `POST /api/ats/onboarding-full/documents`
  - `POST /api/ats/onboarding-full/progress`
  - `POST /api/ats/onboarding-full/submit`
- BGV candidate APIs:
  - `POST /api/ats/bgv/consent`
  - `GET /api/ats/bgv/status`
  - `POST /api/ats/bgv/verify/pan`
  - `POST /api/ats/bgv/verify/bank`
  - `POST /api/ats/bgv/verify/aadhaar-offline`
  - `POST /api/ats/bgv/verify/address-doc`
  - `POST /api/ats/bgv/verify/education`
  - `POST /api/ats/bgv/verify/court`
  - `POST /api/ats/bgv/digilocker/start`
- HR/BGV routes:
  - BGV queue, candidate BGV details, manual review, waiver, vendor dispatch, vendor result update.
- Payroll HR routes:
  - Existing salary validation and candidate-to-offer path.
- Employee conversion:
  - Direct convert is blocked and says employee creation happens after offer approval.

### Database

Relevant current tables/migrations include:

- ATS/onboarding:
  - `ats_candidate`
  - `ats_onboarding_bridge`
  - `ats_onboarding_request`
  - `ats_employment_offer`
  - `ats_offer_approval`
  - `candidate_onboarding_profile`
  - `candidate_onboarding_bank_detail`
  - `candidate_onboarding_qualification`
  - `candidate_onboarding_family`
  - `candidate_onboarding_experience`
  - `candidate_onboarding_document`
  - `candidate_onboarding_submission_log`
- BGV:
  - `candidate_bgv_consent`
  - `candidate_bgv_check`
  - `candidate_bgv_report`
  - `candidate_bgv_verification_event`
  - `candidate_bgv_api_request_log`
  - `candidate_bank_verification`
  - `candidate_digilocker_session`
  - `candidate_bgv_vendor_dispatch`
- Candidate portal:
  - `ats_candidate_portal_access`
  - `ats_onboarding_tasks`
  - `ats_candidate_documents`
  - `ats_onboarding_task_templates`
- DPDP:
  - `data_consent`
  - `data_rights_request`
  - `data_retention_policy`
  - `dpdp_config`
  - `consent_text_version`

## Affected Files

- Frontend:
  - `src/App.tsx`
  - `src/pages/CandidateOnboardingV2.tsx`
  - `src/pages/CandidateOnboardingFullPage.tsx`
  - `src/components/onboarding-v2/useOnboardingV2.ts`
  - `src/components/onboarding-v2/useAutoSave.ts`
  - `src/components/onboarding-v2/sections/*`
  - `src/pages/NativeHROnboardingRequests.tsx`
  - `src/pages/NativeBGVVerificationCenter.tsx`
  - `src/pages/NativePayrollHRValidation.tsx`
  - `src/pages/NativeDPDPCompliance.tsx`
- Backend:
  - `backend/src/modules/ats/ats.routes.ts`
  - `backend/src/modules/ats/onboarding-full.routes.ts`
  - `backend/src/modules/ats/onboarding-full.service.ts`
  - `backend/src/modules/ats/bgv-verification.routes.ts`
  - `backend/src/modules/ats/bgv-verification.service.ts`
  - `backend/src/modules/ats/bgv-provider.adapter.ts`
  - `backend/src/modules/ats/payroll-hr.routes.ts`
  - `backend/src/modules/ats/payroll-hr.service.ts`
  - `backend/src/modules/ats/branch-head-approval.*`
  - `backend/src/modules/privacy/privacy.routes.ts`
  - `backend/src/modules/privacy/privacy.service.ts`
  - `backend/src/modules/communication/*`
  - `backend/src/modules/employees/employee.service.ts`

## Gap Matrix

| Old joining form field/document/process | Existing HRMS2 field/table/component/API | Status | Required frontend fix | Required backend/API fix | Required DB change | Required validation | Required DPDP control | Required BGV/API control | Candidate UX impact | Payroll/statutory impact | Regression risk | Priority |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| Mobile OTP before onboarding | Token query param in V2/full page; no candidate OTP tables | Missing | Add OTP-first entry step before privacy/data | Add `/candidate/onboarding/start/send-otp/verify-otp/resume/logout/refresh-session` | Add `candidate_onboarding_sessions`, `candidate_otp_logs`, `candidate_onboarding_tokens`, progress/session indexes | OTP expiry, resend, failed attempt, IP/mobile rate limits | Do not expose personal data before OTP | Session token bound to candidate/onboarding/device | Candidate can resume securely without password | Prevent wrong candidate payroll data | High | P0 |
| Save/exit/resume exact step | `current_step_idx`; section POSTs | Partial | Add save status, resume banner, offline queue, pending sync UI | PATCH field/section APIs with versioning and validation summaries | Add `candidate_autosave_events`, `candidate_validation_errors`, version columns | Save invalid drafts without final approval | Log source/device/IP for changes | Detect concurrent devices | Prevent data loss | Reduces HR correction load | High | P0 |
| Joining Form upload | Older doc upload can accept arbitrary doc type/name | Incorrect | Remove Joining Form from upload checklist; show generated PDF after submit | Generate joining summary PDF from final data | Add generated document metadata/status | Verify all required fields before generation | Legal basis/consent recorded | Include generated form in HR pack only | Removes candidate confusion | Better statutory file completeness | Medium | P0 |
| Consent Form upload | BGV consent separate; DPDP employee consent separate | Incorrect | Purpose-wise privacy notice before form | Public candidate DPDP consent APIs tied to onboarding session | Extend `data_consent` or create `candidate_dpdp_consent_log` with purpose versions | Required purposes cannot be skipped unless lawful basis recorded | Notice version, purpose, withdrawal history | Gate BGV/penny/eKYC by active purpose consent | Clear trust and compliance | Blocks payroll if required consent absent | High | P0 |
| Title/name/father/gender/marital/DOB/blood | `candidate_onboarding_profile`; V2 personal section | Partial | Add helper text and live validation | Backend validation on save and submit | Add validation error table/status | Name chars, age, dropdown masters | Purpose notice for identity/payroll | Name match across PAN/Aadhaar/bank | Fewer rejections | Employee master quality | Medium | P0 |
| Permanent/present address/state/city/pincode | Profile table; address section | Partial | Master dropdowns, same-address, address proof linkage | Pincode/state/city validation and address verification endpoint | Prefer normalized `candidate_address_details` or extend profile | Pincode 6, length, state/city dependency | Purpose: address/BGV/statutory | Address proof OCR/vendor/manual fallback | Simpler data entry | BGV gate for employee code | Medium | P0 |
| PAN | Mask/hash in profile; PAN verify API | Partial | PAN live format and duplicate feedback | Duplicate checks against candidate/employee; vendor status lifecycle | Add/check verification status and attempt log | PAN regex, duplicate, locked after verify | Purpose: PAN/payroll/statutory | Vendor/API plus manual fallback | Prevent late failures | Mandatory payroll readiness | High | P0 |
| Aadhaar | Mask/hash; offline/DigiLocker routes | Partial | Aadhaar masking explanation; DigiLocker path | Aadhaar Verhoeff/last4 validation and secure storage | Encryption/storage metadata; view audit | 12 digit, masked display, optional Verhoeff | Sensitive DPDP notice and withdrawal impact | Aadhaar offline/eKYC/manual fallback | Better trust | KYC readiness | High | P0 |
| Bank details | Bank table, penny-drop mock | Partial | Confirm account no, IFSC lookup, clear fail actions | Store attempt limits and fallback required state | Add `candidate_bank_verification` alignment and exception table | IFSC, account match, name match | Consent for penny drop | Penny drop retry/failure/manual approval | Prevent salary delay | Critical payroll gate | High | P0 |
| Education | Qualification table; verify education API | Partial | Multi-entry education with proof card | Link education proof doc to qualification; vendor/manual flow | Add highest qualification and document mapping | Year not future, percent 0-100 | Purpose: education verification | Vendor status and fallback | Less HR follow-up | BGV readiness | Medium | P1 |
| Experience | Experience table; employment check auto-created | Partial | Conditional fresher/experienced path | Enforce proof only if experienced | Add previous employer/tenure fields as needed | Years logical vs age | Purpose: employment verification | Vendor/manual employment verification | Avoid irrelevant fields for freshers | Employee classification | Medium | P1 |
| Family/dependents/nominees | Family and nominee fields | Partial | Separate nominee/family section | Backend validation for shares/DOB | Normalize nominee table if multiple nominees | Share total, relation, DOB | Purpose: benefits/statutory | Not BGV unless policy | Better benefits setup | Gratuity/benefits readiness | Low | P2 |
| Smart document checklist | Current upload requires doc type/name/page; no document master | Missing | Document cards with status/count/actions | Document master API and upload policy | Add `onboarding_document_master`, document status log | Type/size/count/status by master | Purpose per document | Verification method per document | Major UX improvement | Completeness gate | High | P0 |
| Resume from ATS | `resume_url` in `ats_candidate`; not first-class in checklist | Partial | Show ATS resume as already available | Import/link ATS resume into onboarding docs | Add source/provenance columns if absent | File availability and candidate preview | Recruitment-to-employment purpose transition | Use only if consent/lawful basis | Avoid re-upload | HR file completeness | Medium | P1 |
| Code of Conduct/NDA/eSign | Not integrated in V2 | Missing | Add declarations/eSign step | eSign adapter/fallback upload | eSign document status/log table | Signature status before final approval | eSign purpose consent | eSign provider logs | Clear declaration flow | Joining file readiness | Medium | P1 |
| EPF declaration | Statutory fields exist | Partial | Conditional statutory declaration | Digital EPF declaration workflow | Add declaration status/version | PF/ESI/UAN validation | Statutory purpose | Not BGV | Avoid paper forms | Critical statutory readiness | Medium | P1 |
| Field validation summary | Basic client forms; no centralized validation summary | Partial | Inline and step status errors | `/validation-summary` and submit gate | `candidate_validation_errors` | Frontend + backend parity | Store invalid draft safely | Blocks specific verifications | Candidate fixes earlier | Prevent bad employee master | Medium | P0 |
| BGV auto-initiate after final submit | `triggerBgvAfterOnboardingSubmit` creates checks | Partial | Candidate tracker after submit | Policy-based orchestrator, not static check list | Add policy table for client/process/role checks | Required data present before trigger | Check consent per purpose | Address/court/edu/experience rules and vendor fallback | Transparent tracker | Employee code gate | High | P0 |
| Manual vendor fallback | BGV vendor dispatch exists | Partial | Expose fallback queue and candidate simple status | Generalize for PAN/bank/statutory/payroll HR roles | Add `manual_submission` or align dispatch table | Vendor/reference/result required | Least data sharing | Alternate API/email/export/log | Candidate not stuck | Payroll/BGV exceptions traceable | Medium | P1 |
| Candidate privacy/data rights | Employee/authenticated privacy APIs exist | Missing for onboarding candidate | Add Privacy & Data Rights candidate page | Public candidate-session privacy routes with OTP confirmation | Candidate principal mapping and request workflow | OTP confirm for withdrawal | Request ID, pause affected workflow | Pause BGV/vendor if consent withdrawn | Candidate control | Blocks readiness if critical | High | P0 |
| Document security | Files stored under local `/uploads/onboarding` public URL | Incorrect | Preview via signed URL only | Signed URL service, audit every view/download | File hash, scan status, encrypted path, retention metadata | File type/size/hash/malware hook | Minimize sensitive exposure | Vendor package only required docs | Safer previews | Reduces compliance risk | High | P0 |
| Role access to sensitive docs | Some scoped BGV routes; broad HR/recruiter review | Partial | Mask by role in HR/BGV/payroll views | Role-specific document authorization | Document role access policy | Default mask Aadhaar/PAN/bank | View/download audit | BGV role sees only needed docs | Trust/security | Least privilege | High | P0 |
| Employee code readiness gate | Offer approval creates employee; BGV score shown but not full gate | Partial/Incorrect | Show readiness checklist to HR/payroll/BGV | Central readiness engine blocking code generation | Add readiness status table/log | All mandatory gates | Consents/withdrawals checked | BGV decision and exceptions checked | Prevent premature join | Critical payroll/statutory correctness | High | P0 |
| Candidate reminders | Communication templates exist | Partial | Candidate pending action notifications | Reminder scheduler by action state | Reminder log/preferences | Frequency caps | Communication consent | Trigger for BGV additional docs | Better completion | Faster joining | Medium | P2 |
| Retention/deletion | DPDP retention tables exist | Partial | Candidate erasure status UI | Scheduler for abandoned/declined/rejected onboarding | Add per-document retention metadata | Legal hold checks | Erasure/audit evidence | Vendor deletion/closure tracking | Compliance confidence | Avoid deleting active employee data | High | P1 |

## Risk Areas

- Public token routes currently expose onboarding APIs without OTP session validation.
- Local upload URLs are stored and returned directly; sensitive documents should use signed expiring URLs and audit logging.
- Consent is split between `candidate_bgv_consent` and generic `data_consent`; onboarding does not yet capture the requested purpose-wise DPDP consent before data collection.
- Current submit gate only requires profile and bank rows; it does not enforce all mandatory fields/documents/verification/readiness gates.
- V2 and full-page onboarding coexist, which can confuse routing and regression behavior.
- Some SQL migrations contain duplicate/alias columns (`passport_no` vs `passport_number`, `driving_license_no` vs `dl_number`) that need a compatibility plan.
- BGV checks are partly policy-agnostic; static checks may over-trigger or under-trigger by company/client/process/role.

## Migration Plan

1. Add OTP/session foundation behind new candidate onboarding APIs while keeping existing token routes backward compatible.
2. Add document master and seed records; keep existing uploaded document table, then migrate existing documents to master-backed document keys.
3. Add autosave/progress/version tables and optimistic locking fields; expose PATCH field/section endpoints.
4. Add purpose-wise DPDP consent logs and candidate data-rights APIs tied to OTP session.
5. Add readiness engine tables and status computation; initially read-only, then enforce employee-code gate after validation.
6. Replace public document URLs with signed preview/download API while keeping old file paths internally.
7. Gradually route `/onboard-full` to the V2 OTP wizard once parity tests pass.

## Rollback Plan

- Keep all current token routes operational until the new OTP/session route is proven.
- Add new tables/columns without dropping or renaming current columns.
- Put new OTP, document master, DPDP candidate rights, and readiness gate behind feature flags.
- For any failed release, disable flags and route candidates back to existing `/onboard-full?token=...`.
- Preserve old upload paths during signed URL transition; do not delete files until signed preview is stable.
- Employee-code gate enforcement should ship in monitor-only mode first, then blocking mode after HR/payroll acceptance.

## Recommended Implementation Slices

1. P0 foundation: OTP session, token/session middleware, route wiring, tests.
2. P0 autosave: field/section PATCH, versioning, offline queue UI, validation summary.
3. P0 privacy: notice, purpose-wise consent, withdrawal/data-rights candidate page.
4. P0 documents: document master, smart cards, secure upload metadata, signed preview.
5. P0 readiness: central readiness gate and monitor-only HR/payroll/BGV dashboards.
6. P1 BGV orchestration: policy-based checks, vendor fallback normalization, candidate tracker.
7. P1/P2 polish: reminders, retention scheduler, joining PDF, eSign/statutory declarations.

## Regression Test Focus

- ATS candidate selection and onboarding bridge token generation.
- Offer creation, branch-head approval, and employee creation path.
- Existing `/onboard-full?token=` candidates.
- BGV candidate verification routes and HR BGV queue.
- Payroll HR validation and salary start date behavior.
- Candidate document upload and retrieval.
- DPDP admin privacy routes.
- Role access to HR/BGV/payroll screens.
