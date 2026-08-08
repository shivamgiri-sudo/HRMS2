# Duplicate identity: SOFIYA SULTAN — findings and merge plan

**Status: PLAN ONLY. Nothing in this document has been executed.**
Investigated 2026-08-08 against live `mas_hrms`. Raised by an e-sign link complaint;
the link was fine, the identity is not.

---

## 1. What exists

One human being holds three `employees` rows, all sharing the personal address
`sofiyasultan57@gmail.com`.

| Record | `employees.id` | Status | DOJ | Login email | Roles |
|---|---|---|---|---|---|
| **MAS60905** | `e0e85e3f-…0ab410` | `resigned` | 2025-11-13 | personal gmail | `employee` |
| **MAS62457** | `ebf1d02c-…0ab410` | `active` | 2026-04-01 | `sofiya.sultan@teammas.co.in` | `employee`, **`hr`**, `interviewer`, `recruiter` |
| **MAS63086** | `4d2f850c-…c9414` | `preboarding` | 2026-08-05 | none (`user_id` NULL) | none |

Plus two `ats_candidate` rows: `MAS60905` (Applied/Inactive) and `MAS62457`
(`payroll_validated`, `employee_code = MAS63086` — note the row coded 62457 is the
one that produced employee 63086).

## 2. The data is almost perfectly disjoint

Row counts across 57 tables carrying an `employee_id`:

| Record | Shape of its data | Volume |
|---|---|---|
| MAS60905 | payroll history only — `salary_prep_line_component` 49, `salary_prep_line` 6, `legacy_payslip_snapshot` 6, salary assignment/increment/job-history 1 each | ~70 rows |
| MAS62457 | **the live working identity** — location 636, geofence 562, roster 296, attendance 77, biometric 71, KPI 21, leave, bank detail, tax declaration, LMS, reporting hierarchy | ~1,700 rows |
| MAS63086 | onboarding artefacts only — joining-doc audit 961, field values 214, files 19, checklist 9, tokens 2, e-sign kit 1, EPF profile 1, statutory 1, IT provisioning 4 | ~1,200 rows |

MAS63086 has **zero** attendance, **zero** payroll, **zero** roster.

## 3. The finding

**MAS62457 is a currently-employed person, and MAS63086 should never have been created.**

The evidence is `attendance_daily_record` for MAS62457: **77 days spanning
2026-05-08 → 2026-08-06**, and `employee_daily_login` last seen **2026-08-04**.
She was at work, and logged into HRMS, on and around the very day a *new joiner*
record was minted for her.

The sequence on 2026-08-04: a walk-in registration (`q_token NOI-20260804-019`,
`walk_in_date 2026-08-04`) created an ATS candidate for an existing active
employee; that candidate reached `payroll_validated` and its conversion minted
employee `MAS63086` with DOJ 2026-08-05, then generated a full joining kit and
e-sign chase. This is the ATS re-onboarding someone it already employs — the same
class of problem recorded in the ATS-holds-employees finding, where 29,926 of
37,562 `ats_candidate` rows are legacy employee records.

**Consequence already observed.** Because MAS62457 is `active` and holds an `hr`
role, `getHrUsersForBranch()` returns her as NOIDA-2 branch HR. She therefore
received 29 internal HR escalations naming *a different employee's* unsigned BAMS
Declaration, delivered to her personal Gmail. Fixing the mail volume (done,
`cc1d03f4`) does not fix this: it is a consequence of the duplicate, not of the
worker.

## 4. What must NOT be done

1. **Do not delete or merge MAS60905.** It carries settled payroll history.
   Payroll arithmetic here is read-only — quantify, never "correct".
2. **Do not delete MAS62457.** It is the live employment: attendance to
   2026-08-06, bank detail, tax declaration, leave ledger, roster, RBAC roles.
3. **Do not re-point `employee_id` across these records.** The three sets are
   disjoint by lifecycle; repointing would merge a settled payroll history into a
   live employment and corrupt both.
4. **Do not simply delete MAS63086 either** until question (a) below is answered —
   its 1,200 onboarding rows include a signed-document trail and an EPF profile.

## 5. Open questions for HR — these decide everything

**(a) Is MAS63086 a genuine new engagement, or a mistaken re-registration?**
The data says mistaken: she never stopped working under MAS62457. But if she was
genuinely rehired into a new role on 2026-08-05 (the ATS row offers *Team Leader*
at 16,588), then the correct fix is the opposite — MAS62457 should be closed with
an exit date and MAS63086 becomes the live record. **Only HR can answer this.**

**(b) Should MAS62457 hold `hr`, `recruiter` and `interviewer` at all?**
Independently of the duplicate. If yes, her HR notifications should go to
`sofiya.sultan@teammas.co.in`, not the personal Gmail.

## 6. Recommended sequence, once (a) is answered

### If MAS63086 is a mistaken re-registration (what the evidence supports)

1. **Stop the chase first** — revoke the outstanding JOINING_KIT token for
   MAS63086 so the e-sign reminders and the kit stop. One row, reversible:
   `UPDATE employee_joining_document_public_token SET token_status='revoked' WHERE employee_id='4d2f850c-…' AND token_status='active';`
2. Set `employees.employment_status` for MAS63086 to a non-active, non-preboarding
   value so it leaves onboarding dashboards. **Do not delete the row** — the
   joining-document audit trail must survive.
3. Mark the ATS candidate row (`dc7f6ff7-…`) as a duplicate via its existing
   `duplicate_of` column, pointing at the MAS60905 candidate row.
4. Leave MAS62457 and MAS60905 untouched.
5. Re-run the counts in §2 afterwards and confirm MAS62457's 1,700 rows are
   unchanged — the check that the "merge" moved nothing it shouldn't.

### If it is a genuine rehire

Do **not** merge. Two employment spells for one person is legitimate; give
MAS62457 an exit date so only one record is `active` at a time, and let MAS63086
complete onboarding. The duplicate-HR-mail problem is then solved by (b).

## 7. Guardrail worth adding either way

Nothing stopped an active employee being converted into a new employee. A check at
candidate→employee conversion — same Aadhaar hash, or same personal email, already
attached to an `active` employee — would have blocked this at source. The candidate
row already carries `aadhar_number_hash`, so the lookup is cheap.

---

*Companion fix already deployed (`cc1d03f4`, 2026-08-08): the e-sign mail storm
(1,863 messages) and the hostless `href="/profile"` in every `system_event` mail.
That work is unrelated to this identity question and does not depend on it.*
