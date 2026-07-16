# ATS Candidate Assessment Engine

This module adds a pre-employment assessment layer between candidate registration and the HR interview. It is intentionally isolated from the existing candidate registration, ATS queue, interview decision, selection, onboarding, BGV, provisioning, and employee-conversion flows.

## Safety defaults

- Development branch: `feat/ats-candidate-assessment-engine`
- Draft PR only; no change has been merged into `main`.
- `ATS_ASSESSMENT_ENABLED` defaults to `false`.
- No existing queue, candidate, interview, offer, or onboarding status is introduced or changed.
- Assessment status is stored only in assessment-owned tables.
- Existing registration, queue, interview, selection, and onboarding routes remain unchanged.
- Assessment results are advisory and do **not** overwrite existing ATS interview fields.
- One complete assessment attempt is enforced by the database cycle key, candidate-row locking, and server-side status checks.
- A maximum of two typing attempts is enforced transactionally and by a unique database key.

## Test-environment activation

```env
ATS_ASSESSMENT_ENABLED=true
ATS_ASSESSMENT_TOKEN_SECRET=<long-random-secret>
```

`ATS_ASSESSMENT_TOKEN_SECRET` is mandatory when the feature is enabled in production.

## Portal URLs

Candidate assessment kiosk:

```text
/api/ats-ext/assessment
```

Recruiter / HR assessment control portal:

```text
/api/ats-ext/assessment-admin
```

Assessment template builder:

```text
/api/ats-ext/assessment-admin/template-builder
```

Legacy template-builder URL:

```text
/api/ats-ext/assessment-template-builder
```

The legacy URL redirects to the canonical template-builder route for backward compatibility.

The candidate uses the existing queue token and registered mobile number. Process and role cannot be selected or overridden by the candidate. HRMS resolves them from the candidate record or an approved assessment mapping.

## Candidate journey

1. Candidate completes the existing HRMS registration.
2. Existing candidate and queue-token creation remain unchanged.
3. Candidate opens the assessment kiosk during waiting time.
4. Queue token and registered mobile number are verified.
5. HRMS resolves an approved process-role template.
6. Candidate starts one timed assessment attempt.
7. Answers auto-save.
8. Backoffice, document, and email templates include a typing test.
9. Candidate may use up to two typing attempts; the better submitted result is used.
10. Objective sections are scored automatically.
11. Written case studies or email drafting enter manual review.
12. Recruiter / HR can view the result before or during the interview.

The ATS queue status remains `waiting`, `called`, `in_interview`, `completed`, or `no_show` exactly as before. Assessment progress is a separate state.

## Typing behaviour

During typing, the candidate sees only aggregate live information:

- elapsed time
- remaining time
- gross WPM
- overall estimated accuracy
- character count

The screen does not highlight or identify any correct, incorrect, missing, or extra character or word while the candidate is typing. Detailed word-level feedback appears only after the typing attempt is submitted.

The server calculates final typing results using:

- gross WPM based on five characters per word
- edit-distance-based accuracy
- net WPM after error penalty
- aligned correct, substituted, missing, and extra word feedback
- configured process-role speed and accuracy benchmarks

## Assessment coverage

Processes:

- Inbound Call Centre
- Outbound Call Centre
- Backoffice
- Document Assessment
- Email Handling

Roles:

- Executive
- Team Leader
- Quality Auditor

The built-in catalog contains 15 process-role templates. Each template contains ten questions covering communication, comprehension, compliance, process judgment, role-specific capability, and practical case scenarios. Typing is mandatory for Backoffice, Document Assessment, and Email Handling.

## Staff capabilities

Authenticated recruiters, HR, managers, QA, and authorised administrators can:

- view dashboard metrics
- search and filter candidate assessment attempts
- view section and typing results
- inspect integrity events
- view a candidate assessment summary
- assign an approved template to a registered candidate
- complete written-answer manual review
- view and activate/deactivate templates
- synchronize the built-in template catalog
- create process/branch/role/experience mappings
- cancel an unstarted assignment with a reason

Key APIs:

```text
GET  /api/ats-ext/assessment-admin/dashboard
GET  /api/ats-ext/assessment-admin/attempts
GET  /api/ats-ext/assessment-admin/attempts/:attemptId
POST /api/ats-ext/assessment-admin/attempts/:attemptId/review
GET  /api/ats-ext/assessment-admin/candidates/:candidateId/summary
POST /api/ats-ext/assessment-admin/candidates/:candidateId/assign
GET  /api/ats-ext/assessment-admin/templates
POST /api/ats-ext/assessment-admin/templates/sync-defaults
GET  /api/ats-ext/assessment-admin/mappings
POST /api/ats-ext/assessment-admin/mappings
```

## Database

Migration:

```text
backend/sql/408_ats_candidate_assessment_engine.sql
```

Assessment-owned tables:

- `ats_assessment_template`
- `ats_assessment_mapping`
- `ats_candidate_assessment`
- `ats_assessment_response`
- `ats_typing_test_attempt`
- `ats_assessment_audit_log`

No existing ATS business table is altered by migration 408.

## Rollback

Set:

```env
ATS_ASSESSMENT_ENABLED=false
```

All assessment routes become inactive while the existing ATS registration, queue, interview, selection, and onboarding journeys continue normally. The additive assessment tables may remain without participating in existing ATS queries.
