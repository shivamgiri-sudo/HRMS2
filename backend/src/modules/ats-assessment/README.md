# ATS Candidate Assessment Engine

This module is intentionally isolated from the existing candidate registration, ATS queue, interview decision, selection, and onboarding flows.

## Safety defaults

- Development branch: `feat/ats-candidate-assessment-engine`
- `ATS_ASSESSMENT_ENABLED` defaults to `false`.
- No existing queue or candidate lifecycle status is introduced or changed.
- Assessment status is stored only in `ats_candidate_assessment`.
- One complete assessment attempt is enforced in MySQL and in the service.
- A maximum of two typing attempts is enforced in MySQL and in the service.
- Existing registration and interview routes remain unchanged.

## Enable in a test environment

```env
ATS_ASSESSMENT_ENABLED=true
ATS_ASSESSMENT_TOKEN_SECRET=<long-random-secret>
```

Candidate kiosk URL:

```text
/api/ats-ext/assessment
```

Candidate authentication uses the existing queue token plus the registered mobile number. The module creates or reuses the assessment lazily and does not change `ats_queue_token.queue_status`.

## Staff APIs

Authenticated HR/recruiter roles can read:

```text
GET /api/ats-ext/assessment-admin/candidates/:candidateId/summary
GET /api/ats-ext/assessment-admin/attempts
```

Admin/HR can resync the built-in 15 templates:

```text
POST /api/ats-ext/assessment-admin/templates/sync-defaults
```

## Typing behaviour

During typing, the candidate sees only aggregate live information:

- elapsed time
- gross WPM
- estimated accuracy
- character count

No character or word is marked correct/incorrect during the attempt. Detailed correct, incorrect, missing, and extra word feedback is returned only after the typing attempt is submitted.

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

The catalog creates 15 process-role templates with communication/comprehension, process judgement, leadership or quality scenarios, and typing where required.

## Rollback

Set `ATS_ASSESSMENT_ENABLED=false`. Existing ATS functionality continues normally. The additive tables can remain in place and do not participate in existing queue, interview, or onboarding queries.
