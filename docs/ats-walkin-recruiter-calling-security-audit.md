# ATS Walk-in Recruiter Calling Security Audit

## Page to API mapping

- `/interview-registration` uses `POST /api/ats/registration/submit-enhanced`, recruiter/bootstrap helpers, and candidate upload endpoints.
- `/ats/walkin-queue` uses `GET /api/ats/queue/live`, `POST /api/ats/queue/call-next`, `POST /api/ats/queue/update-status`, and `POST /api/ats/queue/mark-no-show`.
- `/display/waiting-room` expects public safe APIs under `/api/ats/queue/public-display`, `/display-stream`, and `/branches`.
- `/ats/recruiter/my-candidates` uses `/api/ats/recruiter/my-candidates`, `/daily-stats`, `/submission-history`, and `POST /api/ats-full-parity/recruiter-submission`.
- `/ats/onboarding-bridge` uses `GET /api/ats/onboarding-bridge` plus onboarding token actions under `/api/ats/onboarding`.
- `/ats/command-center` uses ATS command/dashboard APIs and must reconcile to `ats_candidate`, `ats_queue_token`, `ats_interview_submission`, onboarding, BGV, and calling activity.
- `/ats/candidate-master` uses candidate APIs and must enrich from queue, assignment, interview, onboarding, BGV, employee conversion, file metadata, and audit tables.
- New `/ats/recruiter/calling-entry` and `/ats/recruiter/calling-dashboard` use `/api/ats/calling-activity`.

## API to service mapping

- Candidate registration currently flows through `registration.enhanced.routes.ts` and `atsService.createCandidate`.
- Queue screens flow through `queue.routes.ts`, `queue.enhanced.service.ts`, and legacy token helpers in `ats.queue.service.ts`.
- Recruiter workspace flows through `ats.routes.ts` and `ats-full-parity/recruiterInterview.service.ts`.
- Onboarding bridge flows through `ats.controller.ts` and `ats.service.ts`.
- File upload currently lives in `ats.routes.ts`; secure file serving will use `GET /api/files/candidate/:fileId`.
- Calling activity requires a new small ATS service/router because this is native HRMS data, not interview submission data.

## Service to table mapping

- `ats_candidate`: candidate identity, source/referral, branch/process, latest queue/interview/onboarding snapshots.
- `ats_queue_token`: queue token, arrival time, wait timing, queue status, branch, recruiter/interviewer linkage.
- `ats_recruiter_assignment_log`: recruiter assignment, transfer, notification, and audit trace.
- `ats_interview_submission`: canonical recruiter interview submission and final decision record.
- `ats_interview_submission_audit`: submission audit snapshots.
- `ats_onboarding_bridge`, `ats_onboarding_request`, `ats_employment_offer`, `ats_offer_approval`: selected-candidate onboarding and offer lifecycle.
- `ats_recruiter_calling_activity`: native replacement for recruiter Google Sheet.
- `ats_candidate_file` and `ats_candidate_file_access_audit`: private candidate document metadata and access audit.

## Broken contract list

- Waiting room frontend calls public queue endpoints that were not registered.
- Walk-in queue route/page code differs between `ATS_WALKIN_QUEUE` and older `ATS_WAITING_QUEUE`.
- Registration creates candidates and sometimes queue tokens, but duplicate same-day/token handling is not consistently transactional.
- Candidate registration success response does not expose full queue confirmation fields expected by the business flow.
- Backend onboarding bridge access did not include `super_admin`.
- Candidate upload stores public `/uploads/candidates/...` URLs as the primary reference.
- Recruiter interview submission lacks second-round interviewer and client-round manual interviewer fields in validation, persistence, audit, and snapshots.
- Native recruiter calling activity has no HRMS table/API/page yet.

## Migration plan

- Add one guarded migration `343_ats_walkin_recruiter_calling_security.sql`.
- Extend existing ATS tables only where columns/indexes are missing.
- Create justified new tables for calling activity/imports, secure file metadata/access audit, and interviewer eligibility.
- Seed page catalog/access for calling entry/dashboard.
- Keep legacy public URL columns temporarily for compatibility while introducing secure metadata.

## Reconciliation plan

- Walk-in Queue and Waiting Room Display will both read `ats_queue_token`.
- Wait time derives from `ats_queue_token.arrival_time`, not frontend submit time.
- Recruiter workspace reads assigned candidates from `ats_candidate` plus queue-token status.
- Command center/dashboard counts must use the same source tables and filters as queue, recruiter, onboarding, and calling pages.
