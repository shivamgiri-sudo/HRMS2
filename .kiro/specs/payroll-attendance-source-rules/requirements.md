# Requirements Document

## Introduction

Salary days for an employee are currently built from one of two kinds of attendance evidence — the
biometric feed (COSEC) or dialler productivity reporting — and which one applies is decided by
configuration that does not match how the business actually operates. All figures in this document
were measured 2026-08-29 against `mas_hrms` (MySQL 8.0.42) over the public interface, with July 2026
as the analysis month.

The live system decides the source in two places that do not agree with each other:

- `attendance_rule_config` (30 rows, all active) carries `attendance_source`
  `enum('dialler','biometric')` scoped by designation, process and branch, effective-dated, resolved
  by a specificity score of designation=4, process=2, branch=1 with `LIMIT 1`. It carries no cost
  centre, no department and no employment-profile column. It also carries the day-classification
  thresholds `full_day_minutes`, `half_day_minutes` and `grace_minutes`.
- `apr_eligibility_config` (65 rows) carries no source column at all and **no effective dating at
  all**. It answers a yes/no question — is this employee judged on dialler productivity — scoped by
  designation, department and process, with a *different* specificity weighting (process=4,
  department=2, designation=1).

`attendanceEngineService.processEmployee()` then combines the two with a logical OR
(`configuredAprEmployee || hasScopedDiallerRule`), so the more specific of the two stores cannot say
"no".

Nine defects are now measured rather than predicted:

1. **Non-deterministic resolution is live in production.** Two active `attendance_rule_config` rows
   constrain no dimension at all and disagree on source: `arc-global-001` (`biometric`, 540/270,
   effective_from 2026-06-01) and `arc-apr-ops-exec` (`dialler`, 480/240, effective_from
   2026-06-13). They carry equal specificity and are separated only by `ORDER BY ... LIMIT 1` with no
   tiebreak. The same employee and date can therefore yield different salary days between two runs
   today. The remaining 28 rows are designation-scoped biometric rules, one per Executive-family
   designation, 540/240, effective_from 2026-01-01.
2. **APR eligibility over-reaches, and the correction was reversed.**
   `backend/sql/1127_scope_apr_eligibility_by_process.sql` seeded 60 active process-scoped rows (4
   Executive designations x 15 processes). However `apr-elig-ops-executive` is **active with
   `process_id` NULL**, its notes reading "REACTIVATED 2026-08-28: admin directive —
   designation+department only, no process filter. All Ops Executives on APR regardless of process."
   Both the process-scoped rules and the process-NULL rule are active simultaneously, so the 1127
   scoping is nullified. Active `apr_eligibility_config` rules now match 832 active employees, of
   whom **445 (53%) have never appeared in the APR feed at all** — worse than the 472-of-828 that
   1127 recorded.
3. **A duplicate master-data row silently halves policy reach.** Two separate `department_master`
   rows exist for Operations: `'OPERATIONS'` (897 active employees) and `'Operations'` (148). A rule
   keyed on one `department_id` covers only one of them. This is the same defect class that migration
   1082 already recorded once.
4. **Zero is not absent.** In July 2026, on the 29,271 `attendance_daily_record` rows with
   `attendance_source='biometric'`, `dialler_minutes` is NULL on 26,215, **zero on 3,016, and
   positive on only 40 (0.14%)**. A stored `dialler_minutes = 0` is a filler, not a measured zero,
   and is indistinguishable from "no data" without consulting the productivity feed.
5. **APR corroboration cannot be read from `attendance_daily_record`.** Because positive dialler
   minutes exist on 40 of 29,271 biometric-source days, corroboration must read the productivity
   feed directly. Absent APR evidence is the common case, not the exception.
6. **Mismatch is already endemic and the queue is switched off.** July 2026 holds 42,181
   `attendance_daily_record` rows across 1,682 employees with `mismatch_flag = 1` on **14,891 rows
   (35%)**, while `attendance_feature_config` carries `mismatch_workflow_enabled = 0` and
   `payroll_lock_on_unresolved_mismatch = 0`.
7. **The daily productivity aggregation is arithmetically broken.** `apr` holds 48,912 rows over
   36,594 distinct employee-days keyed (ReportDate, UserID, campaign_id) across 78 campaign values.
   **8,638 employee-days (23.6%) carry more than one dialler or campaign row**, and summing net login
   across them — the aggregation this spec previously specified — produces 3,603 employee-days over
   10 hours, 2,505 over 12 hours and **218 over 24 hours, with a maximum of 6,282.8 minutes (104.7
   hours) in a single day**. These are concurrent logins to different campaigns, not sequential
   shifts (MAS60586 on 2026-04-08: CHAT 00:57:43 + EMAIL 09:07:02 + INBOUND 09:03:53 + OUTBOUND
   07:28:16 = 26h36m summed). An inflating aggregation defeats a control whose entire purpose is to
   catch inflated attendance.
8. **Manual upload is already live and completely unattributed.** `apr.source` is
   `enum('sync','manual')`; 3,810 manual rows across 224 users landed between 2026-08-01 and
   2026-08-25. **Every manual row carries `campaign_id = 'MANUAL_UPLOAD'`** — a single sentinel, so
   the originating dialler system is not recorded anywhere. Those rows carry 0 distinct
   `process_name` and 0 distinct `branch_name`. `apr.upload_batch_id` has **0 distinct values across
   all 46,163 rows**, so there is no audit trail of who uploaded which file. `apr_manual_upload`
   exists with the right shape and holds **0 rows** — a dead path. `campaign_master` holds **0 rows**,
   so all 78 campaign values are unmanaged free text.
9. **Only one dialler is integrated, and its identity column is unused.** `dialer_session_log` holds
   1,365 rows over 64 employees with **`dialer_name` NULL on every row**, exactly one
   `integration_key` (`'dialer_1'`) and one `source_system`
   (`'dialer_db.vicidial_agent_log_249'`) — a single ViciDial instance. Yet in July 2026 this feed
   decided more days than `apr` did (7,366 rows versus 5,186). Three productivity feeds are already
   in play (`apr`/sync, `apr`/manual, `dialer_session_log`) with no common source registry.

This feature therefore: replaces the two overlapping configuration stores with one effective-dated,
deterministically resolved attendance-source rule set keyed on cost centre, branch, process,
department, designation and employment profile; makes the resolved source the single input to payable
days; registers every dialler system as a first-class source and lets a branch WFM user upload its
report with full attribution; defines exactly one canonical productive-minutes figure per employee
per date that cannot exceed a calendar day; keeps productivity evidence as a non-blocking
corroboration layer with a configurable minimum-productive-hours threshold; detects the punch-in /
leave-the-floor / punch-out fraud pattern that biometric alone cannot see; presents every
productivity metric per dialler alongside the biometric duration for the same day on one screen; and
routes every variance through a two-party review by the WFM reviewer and the employee's reporting
manager without ever letting an unreviewed variance halt a payroll run.

Scope boundary: this feature decides **which feed builds salary days, how productivity evidence is
sourced and aggregated, and how a variance is reviewed**. It does not change how payable days convert
into gross pay. It does not change the minute values that classify a single day as present, half day
or absent — but it does relocate where those values are held. Those thresholds live on
`attendance_rule_config` (`full_day_minutes`, `half_day_minutes`, `grace_minutes`) and on
`attendance_feature_config` (`biometric_half_day_floor_minutes = 270`,
`netlogin_half_day_floor_minutes = 240`) today. Because `attendance_rule_config` is retired by this
feature, those three per-rule columns move into a separate effective-dated Day_Threshold_Rule store
resolved by the same six Rule_Dimensions and the same candidacy and tie-breaking logic as the
Attendance_Source_Rule store, seeded with the existing values. The new Attendance_Source_Rule store
carries the Attendance_Source only.

## Glossary

- **Attendance_Source_Resolver**: The component that returns exactly one attendance source for a
  given employee and calendar date, together with the identity of the rule that decided it.
- **Attendance_Source**: The feed class that determines payable days for a date. Permitted values are
  `biometric` and `dialler`, matching `attendance_rule_config.attendance_source`
  `enum('dialler','biometric')` and `attendance_daily_record.attendance_source`. The value `apr` does
  not exist anywhere in the schema and is not introduced.
- **Attendance_Source_Rule**: One effective-dated configuration row stating an Attendance_Source for
  a combination of Rule_Dimension values.
- **Rule_Dimension**: One of the six attributes an Attendance_Source_Rule may constrain: cost centre
  (`employees.cost_centre_id` -> `cost_centre_master.id`), branch (`branch_id` ->
  `branch_master.id`), process (`process_id` -> `process_master.id`), department (`department_id` ->
  `department_master.id`), designation (`designation_id` -> `designation_master.id`) and
  Employment_Profile. A dimension left unset on a rule matches every value of that dimension.
  Location and line of business are excluded: `employees.location_id` and `employees.lob_id` are NULL
  for all 1,123 active employees.
- **Employment_Profile**: The employment classification held on `employees.profile_type`, a nullable
  varchar with **no foreign key** — the value set is free text, in practice VOICE (574) and NON-VOICE
  (331) with 196 NULL and ten residual values of 5 or fewer. It is distinct from designation and
  distinct from `employees.employment_type` (ONROLL / MGMT. TRAINEE / OffRoll), which is a contract
  type and is not the business's profile axis. "Executive" as used by the business refers to
  designation, not to Employment_Profile.
- **System_Default_Rule**: The single Attendance_Source_Rule that constrains no Rule_Dimension and
  therefore matches every employee. Its Attendance_Source is `biometric`.
- **Day_Threshold_Rule**: One effective-dated configuration row stating the day-classification minute
  values `full_day_minutes`, `half_day_minutes` and `grace_minutes` for a combination of Rule_Dimension
  values. Held in a store separate from the Attendance_Source_Rule store, resolved by the same
  candidacy and tie-breaking rules stated in Requirement 2.
- **Specificity_Count**: The number of Rule_Dimensions an Attendance_Source_Rule constrains.
- **Dimension_Priority_Order**: The fixed ordered list used to break ties between rules of equal
  Specificity_Count: cost centre, then process, then branch, then department, then designation, then
  Employment_Profile.
- **Biometric_Feed**: The COSEC-sourced punch data from which biometric minutes for a date are
  derived, surfaced as `attendance_daily_record.biometric_minutes` with `clock_in_time` and
  `clock_out_time`.
- **Dialler_Source**: One registered external productivity system, identified by a stable identifier
  and a display name, carrying an ingestion mode of either integrated pull or manual upload, an owning
  branch scope and an owning process scope each of which may be unset, and the declared
  Metric_Availability that Dialler_Source supplies. An employee may hold sessions on several
  Dialler_Sources on one date.
- **Productivity_Feed**: Any store holding Dialler_Source session data. Three exist today: `apr` with
  `source = 'sync'`, `apr` with `source = 'manual'`, and `dialer_session_log`.
- **Metric_Availability**: The declared per-Dialler_Source statement of which productivity metrics
  that source supplies. An integrated `apr` sync supplies calls, wait, talk, dispo, pause, AHT, login
  and logout times, net login and the break categories BIO, LUNCH, QA, DISMX and TRAINING. An
  `apr_manual_upload` row supplies only calls handled, AHT seconds, login minutes, bio minutes, lunch
  minutes, QA minutes and training minutes, and therefore supplies no talk, wait, dispo, pause or
  logout time.
- **Upload_Batch**: One manual submission of a Dialler_Source report, identified by an upload batch
  identifier and carrying the uploading user, the stated Dialler_Source, branch, process and date
  range, the file identity, the accepted row count, the rejected row count and a reason for each
  rejection.
- **Column_Mapping**: A stored, per-Dialler_Source association between the column headers a vendor's
  report file uses and this system's target Upload fields (employee code, report date, login
  minutes, and the optional metrics of that Dialler_Source's declared Metric_Availability),
  maintained by a Rule_Administrator so a manually uploaded source whose file layout differs from
  the base template can be accepted without a code change. A Column_Mapping is versioned; amending
  it applies from that point forward only.
- **Canonical_Productive_Minutes**: The single productive-minutes figure for one employee on one
  calendar date, derived by the aggregation rule of Requirement 18 from every registered
  Dialler_Source contribution for that date, bounded to at most 1,440 minutes. This is the only
  productive-minutes figure any other requirement may read.
- **APR_Net_Minutes**: Synonym for Canonical_Productive_Minutes retained for continuity with the
  existing engine vocabulary. It is **not** `Net_Login` summed across campaigns; that summation is
  forbidden by Requirement 18 because it produces 218 employee-days over 24 hours and a maximum of
  6,282.8 minutes.
- **Biometric_Minutes**: Total minutes between first and last biometric punch attributable to one
  employee on one date, as already computed by the attendance engine.
- **APR_Corroboration_Threshold**: The configurable minimum Canonical_Productive_Minutes expected for
  a date, used only to corroborate biometric-sourced attendance. Default 480 minutes (decision A2).
- **Variance_Tolerance**: The configurable minimum excess of Biometric_Minutes over
  Canonical_Productive_Minutes that, combined with a shortfall against the
  APR_Corroboration_Threshold, raises a Variance_Record. Default 60 minutes (decision A2).
- **Variance_Record**: One reviewable item raised for one employee and one date where biometric and
  productivity evidence disagree beyond Variance_Tolerance.
- **Variance_Risk_Score**: The ranking value carried by a Variance_Record, equal to the excess of
  Biometric_Minutes over Canonical_Productive_Minutes for that employee and date. Variance_Records are
  ranked by Variance_Risk_Score descending when the Dual_Review_Ceiling is applied.
- **Dual_Review_Ceiling**: The configurable maximum count of Variance_Records queued for Dual_Review
  in one branch and one Pay_Month, excluding Floor_Absence_Pattern occurrences, which are always
  queued. Default 100 (decision A2).
- **Queued_For_Dual_Review**: The state of a Variance_Record that has been presented to its reviewers.
- **Recorded_Not_Queued**: The state of a Variance_Record that was raised and retained but fell outside
  the Dual_Review_Ceiling. Such a Variance_Record remains retrievable, is counted in the variance
  exception report and the pre-close reconciliation view, and is never discarded.
- **Floor_Absence_Pattern**: The fraud pattern in which an employee registers biometric punches
  spanning a full shift while Canonical_Productive_Minutes for that date fall below the
  Floor_Absence_Pattern_Ceiling and productivity evidence for that date is present rather than
  absent.
- **Floor_Absence_Pattern_Ceiling**: The configurable Canonical_Productive_Minutes value below which a
  full-length biometric day is treated as a Floor_Absence_Pattern occurrence. Default 60 minutes.
- **WFM_Reviewer**: A user holding the workforce-management review grant for the employee's scope.
- **WFM_Uploader**: A branch workforce-management user holding the grant to submit an Upload_Batch for
  the branches within that user's resolved scope.
- **Reporting_Manager**: The employee named in `employees.reporting_manager_id` for the employee
  under review. This column is NULL for 1 of 1,123 active employees; `employees.manager_id` (NULL for
  394) is not used.
- **Dual_Review**: The requirement that both a WFM_Reviewer and the Reporting_Manager record an
  outcome on a Variance_Record before that Variance_Record is treated as reviewed.
- **Variance_Review_Queue**: The component that presents Variance_Records to their reviewers, records
  each Review_Outcome, and holds the review state of each Variance_Record.
- **Review_Outcome**: One of `apr_accepted`, `apr_disputed`, or `adjustment_requested`.
- **Payable_Days**: The days figure the payroll calculator uses as the numerator when prorating
  monthly gross pay, held on `salary_prep_line.final_payable_days` (decimal).
- **Payroll_Cut_Off**: The moment a payroll run's attendance inputs are frozen for a pay month.
- **Pay_Month**: The calendar month a payroll run pays for.
- **Attendance_Provenance_Record**: The stored evidence, for one employee and one date, of which
  Attendance_Source was used, which Attendance_Source_Rule decided it, which Dialler_Sources
  contributed, and what each feed reported.
- **Rule_Audit_Log**: The immutable record of every create, amend and deactivate action on an
  Attendance_Source_Rule, on a Dialler_Source registration and on an Upload_Batch.
- **Rule_Administrator**: A user permitted to create, amend or deactivate an Attendance_Source_Rule or
  a Dialler_Source registration.
- **Override_Approver**: A user permitted to change Payable_Days for a reviewed date.
- **Consolidated_Productivity_View**: The single screen specified by Requirement 19 that presents, for
  one employee and a date range, per-Dialler_Source productivity metrics, Canonical_Productive_Minutes
  and the biometric duration for the same day.

## Requirements

### Requirement 1: Single Effective-Dated Attendance Source Rule Store

**User Story:** As a payroll head, I want one place that states which feed builds salary days for a
given cost centre, branch, process, department, designation and employment profile, so that I can
see and change the rule without reasoning about two configuration tables that disagree.

#### Acceptance Criteria

1. THE Attendance_Source_Resolver SHALL read Attendance_Source_Rules from exactly one rule store.
2. THE rule store SHALL require each Attendance_Source_Rule to carry an Attendance_Source whose value
   is `biometric` or `dialler`.
3. THE migration of Requirement 15 SHALL retain the existing `enum('dialler','biometric')` value set on
   `attendance_rule_config.attendance_source` and `attendance_daily_record.attendance_source`
   unchanged, SHALL perform no enum rename migration, and SHALL introduce no third value; the value
   `apr` is absent from every enum in the schema today and is introduced nowhere (decision A9).
4. THE rule store SHALL permit each Attendance_Source_Rule to leave any of the six Rule_Dimensions
   unset and to constrain any of them to one value.
5. THE rule store SHALL exclude location and line of business as Rule_Dimensions, because
   `employees.location_id` and `employees.lob_id` hold no value for any of the 1,123 active employees.
6. THE rule store SHALL require each Attendance_Source_Rule to carry an effective-from date, and
   SHALL permit an effective-to date.
7. WHEN a Rule_Administrator submits an Attendance_Source_Rule whose effective-to date precedes its
   effective-from date, THE rule store SHALL reject the submission and state which two dates conflict.
8. WHEN a Rule_Administrator submits an Attendance_Source_Rule that constrains cost centre, branch,
   process, department or designation to an identifier absent from that dimension's master table
   (`cost_centre_master`, `branch_master`, `process_master`, `department_master`,
   `designation_master`), THE rule store SHALL reject the submission and name the unresolved
   identifier.
9. WHEN a Rule_Administrator submits an Attendance_Source_Rule that constrains Employment_Profile,
   THE rule store SHALL validate the submitted value against a controlled value list held in
   configuration rather than against a master table, because `employees.profile_type` carries no
   foreign key and its values are free text.
10. THE rule store SHALL contain exactly one System_Default_Rule at all times.
11. WHEN a Rule_Administrator submits a request that would deactivate the System_Default_Rule, THE
    rule store SHALL reject the request and state that a System_Default_Rule is mandatory.
12. WHEN a Rule_Administrator submits an Attendance_Source_Rule whose six Rule_Dimension values and
    effective-date window are identical to those of an active Attendance_Source_Rule, THE rule store
    SHALL reject the submission and identify the existing rule.
13. WHEN a Rule_Administrator submits a second Attendance_Source_Rule that constrains no
    Rule_Dimension, THE rule store SHALL reject the submission and name the existing
    System_Default_Rule, because two unconstrained active rows disagreeing on source exist in
    `attendance_rule_config` today (`arc-global-001` biometric and `arc-apr-ops-exec` dialler).
14. THE Attendance_Source_Rule store SHALL carry the Attendance_Source and SHALL NOT carry the
    day-classification thresholds `full_day_minutes`, `half_day_minutes` or `grace_minutes`; those
    three values SHALL be held as Day_Threshold_Rules in a separate effective-dated store, resolved for
    an employee and date by the same candidacy and tie-breaking rules stated in Requirement 2 over the
    same six Rule_Dimensions, and administered through the screen of acceptance criterion 12.7
    (decision: secondary decision 1).
15. THE Day_Threshold_Rule store SHALL contain exactly one Day_Threshold_Rule that constrains no
    Rule_Dimension, and SHALL reject any request that would leave that store without one, so that every
    employee and date resolves to exactly one set of day-classification thresholds.
16. WHEN the attendance engine classifies a date, THE attendance engine SHALL read `full_day_minutes`,
    `half_day_minutes` and `grace_minutes` from the Day_Threshold_Rule resolved for that employee and
    date, and SHALL NOT read them from the Attendance_Source_Rule store.

### Requirement 2: Deterministic Rule Resolution

**User Story:** As a payroll head, I want the same employee and date to resolve to the same
attendance source on every run, so that salary days are reproducible and defensible in an audit.

#### Acceptance Criteria

1. WHEN the Attendance_Source_Resolver is asked for an employee and a date, THE
   Attendance_Source_Resolver SHALL return exactly one Attendance_Source and exactly one deciding
   Attendance_Source_Rule identifier.
2. THE Attendance_Source_Resolver SHALL consider an Attendance_Source_Rule a candidate for an
   employee and a date only when the rule is active, the date falls within the rule's effective-date
   window, and every Rule_Dimension the rule constrains equals the employee's corresponding value on
   that date.
3. WHEN two or more Attendance_Source_Rules are candidates, THE Attendance_Source_Resolver SHALL
   select the candidate with the highest Specificity_Count.
4. WHEN two or more candidates share the highest Specificity_Count, THE Attendance_Source_Resolver
   SHALL identify the first Rule_Dimension in Dimension_Priority_Order that is constrained by some
   but not all of those candidates, and SHALL retain only the candidates constraining that
   Rule_Dimension.
5. WHEN candidates remain indistinguishable after applying Dimension_Priority_Order, THE
   Attendance_Source_Resolver SHALL select the candidate with the latest effective-from date, and
   among those the candidate with the latest creation timestamp, and among those the candidate with
   the lowest rule identifier in ascending byte order.
6. FOR ALL combinations of employee attribute values and dates, resolution SHALL return a result,
   because the System_Default_Rule constrains no Rule_Dimension and is therefore always a candidate
   (total coverage property).
7. FOR ALL employees and dates, two consecutive resolutions performed against an unchanged rule store
   SHALL return the same Attendance_Source and the same deciding rule identifier (determinism
   property).
8. IF an employee has no value recorded for a Rule_Dimension on the date being resolved, THEN THE
   Attendance_Source_Resolver SHALL treat every rule that constrains that Rule_Dimension as a
   non-candidate and SHALL record that the dimension was unresolved.
9. WHERE a Rule_Administrator requests a resolution preview for a stated employee and date, THE
   Attendance_Source_Resolver SHALL return the selected rule, every other candidate rule, and the
   comparison step at which each rejected candidate was eliminated.
10. WHERE two or more master rows of one Rule_Dimension denote the same business unit, THE rule store
    SHALL permit an Attendance_Source_Rule to constrain that dimension to a set of identifiers rather
    than to one identifier, because `department_master` holds both `'OPERATIONS'` (897 active
    employees) and `'Operations'` (148) and a rule constraining one identifier reaches only 897 of
    the 1,045 Operations employees.
11. WHEN an Attendance_Source_Rule constrains a Rule_Dimension whose master data contains another row
    with a name equal to the constrained row's name under case-insensitive comparison, THE rule
    administration screen SHALL state the count of active employees held on each such row before the
    rule is saved.

### Requirement 3: Historical Stability of Resolved Sources

**User Story:** As a payroll head, I want a rule change to apply from its effective date forward
only, so that a correction made today does not silently restate salary days for a month already
paid.

#### Acceptance Criteria

1. WHEN a Rule_Administrator creates or amends an Attendance_Source_Rule, THE rule store SHALL
   require an effective-from date and a stated change reason.
2. IF a Rule_Administrator submits an Attendance_Source_Rule whose effective-from date falls within a
   Pay_Month that has reached Payroll_Cut_Off, THEN THE rule store SHALL reject the submission and
   name the affected Pay_Month.
3. FOR ALL dates preceding a rule amendment's effective-from date, resolution SHALL return the same
   Attendance_Source and deciding rule identifier before and after the amendment (historical
   invariance property).
4. WHEN an Attendance_Source_Rule takes effect and dates in an open Pay_Month resolve to a different
   Attendance_Source than previously recorded, THE Attendance_Source_Resolver SHALL list every
   affected employee and date for reprocessing rather than reprocess them automatically.
5. THE Attendance_Provenance_Record SHALL retain the deciding rule identifier for each processed date
   after that rule is deactivated.

### Requirement 4: Payable Days Built From The Resolved Source

**User Story:** As a payroll head, I want salary days for a period built from the feed the rule
resolved, so that pay reflects the stated policy for that cost centre rather than a fallback.

#### Acceptance Criteria

1. WHEN attendance for an employee and date is processed, THE attendance engine SHALL classify the
   date using the minutes reported by the Attendance_Source that the Attendance_Source_Resolver
   returned for that employee and date.
2. WHERE the resolved Attendance_Source is `biometric`, THE attendance engine SHALL classify the date
   from Biometric_Minutes.
3. WHERE the resolved Attendance_Source is `dialler`, THE attendance engine SHALL classify the date
   from Canonical_Productive_Minutes as defined by Requirement 18.
4. THE payroll calculator SHALL derive Payable_Days for a Pay_Month, held on
   `salary_prep_line.final_payable_days`, solely from the daily classifications produced under
   acceptance criteria 4.1 through 4.3, from approved leave, holiday and week-off entitlements, and
   from reviewed adjustments recorded under Requirement 8.
5. THE payroll calculator SHALL treat `salary_prep_line.attendance_data_source`
   `enum('ADR','SESSION_FALLBACK','NO_DATA')` as a record of which store was read and SHALL NOT
   overload it to carry the resolved Attendance_Source, which is a different concept.
6. IF the resolved Attendance_Source reports no minutes for a date and the other feed reports minutes
   for that date, THEN THE attendance engine SHALL classify the date as requiring review, SHALL record
   the minutes both feeds reported, and SHALL apply no leave-without-pay value until the review
   completes.
7. WHERE the resolved Attendance_Source is `dialler` and no registered Dialler_Source has carried a
   record for the employee within the 30 days preceding the date, THE attendance engine SHALL classify
   the date as requiring review rather than as an absence.
8. FOR ALL employees and Pay_Months, Payable_Days SHALL be greater than or equal to zero and less than
   or equal to the count of days the employee was active in that Pay_Month (bounds invariant).

### Requirement 5: Productivity Corroboration Without Blocking

**User Story:** As a WFM head, I want the dialler reports to validate biometric-built attendance
without being able to stop pay, so that productivity evidence is visible to reviewers while a missing
or disputed dialler record never withholds an employee's salary.

#### Acceptance Criteria

1. WHEN the resolved Attendance_Source is `biometric`, THE attendance engine SHALL read
   Canonical_Productive_Minutes for the date from the aggregation of Requirement 18 over the
   registered Productivity_Feeds, and SHALL NOT read `attendance_daily_record.dialler_minutes` for
   this purpose.
2. THE attendance engine SHALL treat `attendance_daily_record.dialler_minutes = 0` as absent
   productivity evidence rather than as a measured zero, because on July 2026 biometric-source days
   that column is NULL on 26,215 rows, zero on 3,016 rows and positive on only 40 of 29,271 rows
   (0.14%), and the stored zeros are indistinguishable from absent data.
3. THE attendance engine SHALL represent productivity evidence for a date as exactly one of present
   with a value, or absent, and SHALL NOT represent absence as a zero value at any data-access
   boundary.
4. THE APR_Corroboration_Threshold SHALL be configurable per combination of the six Rule_Dimensions
   using the same candidacy and tie-breaking rules stated in Requirement 2.
5. WHERE no APR_Corroboration_Threshold is configured for an employee and date, THE attendance engine
   SHALL apply 480 minutes.
6. WHEN the resolved Attendance_Source is `biometric`, THE attendance engine SHALL determine the
   date's classification from Biometric_Minutes alone, and SHALL apply the APR_Corroboration_Threshold
   only to raising a Variance_Record.
7. WHEN the resolved Attendance_Source is `biometric` and no registered Dialler_Source holds a record
   for the date, THE attendance engine SHALL retain the biometric classification and SHALL record that
   productivity evidence was absent, treating absence as the expected case rather than an exception.
8. IF a configured APR_Corroboration_Threshold is not a finite number greater than zero, THEN THE
   attendance engine SHALL apply 480 minutes, SHALL record the rejected value, and SHALL raise an
   administrator-visible configuration warning.
9. FOR ALL employees and dates, the corroboration decision SHALL depend only on
   Canonical_Productive_Minutes and Biometric_Minutes and SHALL NOT depend on which Dialler_Source
   supplied the productivity evidence (source-neutrality property).

### Requirement 6: Variance Detection

**User Story:** As a WFM reviewer, I want the system to identify the days where biometric says a
full shift but productivity says materially less work, so that I review the days that matter instead
of scanning every record.

#### Acceptance Criteria

1. WHEN the resolved Attendance_Source is `biometric`, productivity evidence for the date is present,
   Canonical_Productive_Minutes fall below the APR_Corroboration_Threshold, and Biometric_Minutes
   exceed Canonical_Productive_Minutes by at least the Variance_Tolerance, THE attendance engine SHALL
   raise a Variance_Record for that employee and date.
2. THE Variance_Tolerance SHALL be configurable per combination of the six Rule_Dimensions using the
   same candidacy and tie-breaking rules stated in Requirement 2, and SHALL default to 60 minutes.
3. WHEN a Variance_Record is raised, THE attendance engine SHALL record on that Variance_Record the
   employee identifier, the date, Biometric_Minutes, Canonical_Productive_Minutes, the per-
   Dialler_Source contributions that produced Canonical_Productive_Minutes, the applied
   APR_Corroboration_Threshold, the applied Variance_Tolerance, the resolved Attendance_Source, the
   deciding Attendance_Source_Rule identifier and the Variance_Risk_Score.
4. WHEN the resolved Attendance_Source is `dialler`, Biometric_Minutes exceed
   Canonical_Productive_Minutes by at least the Variance_Tolerance, and the date is classified as an
   absence or a half day, THE attendance engine SHALL raise a Variance_Record for that employee and
   date.
5. WHEN attendance for an employee and date is reprocessed and an unreviewed Variance_Record already
   exists for that employee and date, THE attendance engine SHALL update that Variance_Record rather
   than raise a second one (idempotence property).
6. FOR ALL employees and dates where both feeds report minutes within the Variance_Tolerance of each
   other, THE attendance engine SHALL raise no Variance_Record (no-false-positive property).
7. WHERE a date is classified as approved leave, holiday or week off, THE attendance engine SHALL
   raise no Variance_Record for that date.
8. WHEN a Variance_Record carries a Floor_Absence_Pattern occurrence for its employee and date, THE
   attendance engine SHALL set that Variance_Record to Queued_For_Dual_Review irrespective of the
   Dual_Review_Ceiling and irrespective of the count already queued for that branch and Pay_Month,
   because only about 40 July 2026 employee-days pair a full biometric day with genuinely positive but
   low productivity and every such day is a genuine case (always-queue guarantee).
9. WHEN Variance_Records that carry no Floor_Absence_Pattern occurrence exist for one branch and one
   Pay_Month, THE attendance engine SHALL rank them by Variance_Risk_Score descending and SHALL set to
   Queued_For_Dual_Review the highest-ranked candidates up to the Dual_Review_Ceiling, and SHALL set
   every remaining candidate to Recorded_Not_Queued.
10. THE Dual_Review_Ceiling SHALL be configurable per branch and Pay_Month and SHALL default to 100,
    because 2,566 of 4,933 comparable July 2026 employee-days flag at a 480-minute
    APR_Corroboration_Threshold with a 60-minute Variance_Tolerance — roughly 5,100 Dual_Review
    decisions a month concentrated on 218 employees — while 100 items per branch per month is clearable
    by a branch WFM_Reviewer and the corresponding Reporting_Managers before Payroll_Cut_Off.
11. THE attendance engine SHALL retain every Recorded_Not_Queued Variance_Record with the same fields
    acceptance criterion 6.3 requires of a queued Variance_Record, SHALL keep it retrievable, and SHALL
    count it in the variance exception report of Requirement 13 and in the pre-close reconciliation view
    of acceptance criterion 9.5.
12. THE variance exception report of Requirement 13 SHALL state, for a stated Pay_Month and branch, the
    count of raised Variance_Records, the count Queued_For_Dual_Review, the count Recorded_Not_Queued
    and the applied Dual_Review_Ceiling, so that the ranking is visible rather than silent.
13. FOR ALL branches and Pay_Months, the count of raised Variance_Records SHALL equal the count
    Queued_For_Dual_Review plus the count Recorded_Not_Queued, so that no candidate Variance_Record is
    discarded by the Dual_Review_Ceiling (no-discard property).
14. FOR ALL branches and Pay_Months, every Queued_For_Dual_Review Variance_Record that carries no
    Floor_Absence_Pattern occurrence SHALL hold a Variance_Risk_Score greater than or equal to the
    Variance_Risk_Score of every Recorded_Not_Queued Variance_Record for that branch and Pay_Month
    (ranking monotonicity property).

### Requirement 7: Dual Review By WFM And Reporting Manager

**User Story:** As a WFM head, I want each flagged day reviewed by both the WFM reviewer and the
employee's reporting manager, so that a productivity dispute is settled by the two parties who hold
the evidence rather than by one of them alone.

#### Acceptance Criteria

1. WHEN a Variance_Record is set to Queued_For_Dual_Review under acceptance criterion 6.8 or 6.9, THE
   Variance_Review_Queue SHALL present that Variance_Record to the WFM_Reviewers whose scope contains
   the employee and to the employee's Reporting_Manager; a Recorded_Not_Queued Variance_Record SHALL be
   retrievable and reportable but SHALL NOT be presented for Dual_Review.
2. THE Variance_Review_Queue SHALL present, for each Variance_Record, the Biometric_Minutes, the
   Canonical_Productive_Minutes, the per-Dialler_Source contributions, the biometric punch times, the
   applied APR_Corroboration_Threshold and the resolved Attendance_Source.
3. WHEN a WFM_Reviewer or a Reporting_Manager records a Review_Outcome, THE Variance_Review_Queue SHALL
   store the outcome, the recording user, the recording timestamp and a reviewer comment.
4. WHEN a reviewer records a Review_Outcome of `apr_disputed` or `adjustment_requested`, THE
   Variance_Review_Queue SHALL require a reviewer comment of at least 20 characters.
5. WHEN both a WFM_Reviewer and the Reporting_Manager have recorded a Review_Outcome for a
   Variance_Record, THE Variance_Review_Queue SHALL mark that Variance_Record reviewed.
6. IF the employee has no Reporting_Manager recorded, THEN THE Variance_Review_Queue SHALL route the
   Variance_Record to the employee's branch workforce-management point of contact in place of the
   Reporting_Manager and SHALL record that substitution on the Variance_Record; this path applies to 1
   of 1,123 active employees and is therefore genuine but rare.
7. IF the recording user is the employee named on the Variance_Record, THEN THE Variance_Review_Queue
   SHALL reject the Review_Outcome and state that self-review is not permitted.
8. WHILE a Variance_Record remains unreviewed and the count of whole days since it was presented is at
   least the configured escalation age, THE Variance_Review_Queue SHALL notify the pending reviewer's
   next escalation level once per configured escalation interval.
9. WHERE the configured escalation age is absent, THE Variance_Review_Queue SHALL apply three whole
   days.
10. WHEN two reviewers record conflicting Review_Outcomes for one Variance_Record, THE
    Variance_Review_Queue SHALL mark that Variance_Record contested and SHALL route that
    Variance_Record to the Override_Approver for the employee's branch.
11. THE Variance_Review_Queue SHALL extend the existing `payroll_attendance_conflict_review` structure
    (268 rows; single `reviewed_by`, single `manager_user_id`, `status`
    `enum('open','notified','reviewed','no_issue','regularization_required')`, no SLA fields) with a
    second reviewer identity and timestamp, the Review_Outcome vocabulary of `apr_accepted` /
    `apr_disputed` / `adjustment_requested`, a contested state, the escalation age and interval fields,
    the Variance_Risk_Score and the queue state of Queued_For_Dual_Review or Recorded_Not_Queued, because
    that structure records one reviewer and one status today and cannot represent a Dual_Review.
12. THE migration of Requirement 15 SHALL map the existing `payroll_attendance_conflict_review`
    contents — `dialler_missing_adr` 209 reviewed, `biometric_penalty_dialler_supports_better` 39
    notified, `dialler_penalty_biometric_supports_better` 20 notified — onto the Variance_Record and
    Review_Outcome vocabulary, or SHALL state which rows are closed without migration and why.

### Requirement 8: Review Outcomes And Adjustment Authority

**User Story:** As a payroll head, I want a clear separation between recording a reviewer's opinion
of the productivity record and changing what an employee is paid, so that only an authorised approver
can move salary days and every movement carries a justification.

#### Acceptance Criteria

1. WHEN a Review_Outcome of `apr_accepted` or `apr_disputed` is recorded, THE Variance_Review_Queue
   SHALL leave the date's classification, leave-without-pay value and Payable_Days unchanged.
2. WHEN a Review_Outcome of `adjustment_requested` is recorded, THE Variance_Review_Queue SHALL create
   an adjustment request stating the requested classification and the requesting reviewer's
   justification.
3. WHEN an Override_Approver approves an adjustment request, THE attendance engine SHALL apply the
   approved classification to that employee and date and SHALL record the approving user, the
   timestamp, the justification and the superseded classification.
4. IF a user without the Override_Approver grant submits an approval of an adjustment request, THEN
   THE system SHALL reject the submission and record the refused attempt.
5. IF an adjustment request names the same user as both requesting reviewer and approving user, THEN
   THE system SHALL reject the approval and state that a separate approver is required.
6. IF an adjustment request targets a date within a Pay_Month that has reached Payroll_Cut_Off, THEN
   THE system SHALL reject the approval and direct the requester to the arrear adjustment path for
   that Pay_Month.
7. FOR ALL approved adjustments, the recorded superseded classification SHALL equal the classification
   that resolution and daily processing produced before the adjustment was applied (reversibility
   property).

### Requirement 9: Payroll Cut-Off Behaviour For Pending Reviews

**User Story:** As a payroll head, I want an unreviewed variance to be visible and carried forward
rather than to hold up a run, so that a pending review never delays an entire branch's salary.

#### Acceptance Criteria

1. WHEN a Pay_Month reaches Payroll_Cut_Off and Variance_Records for dates in that Pay_Month remain
   unreviewed, THE payroll calculator SHALL derive Payable_Days from the resolved Attendance_Source and
   SHALL complete the run.
2. WHEN a Pay_Month reaches Payroll_Cut_Off with unreviewed Variance_Records, THE payroll calculator
   SHALL mark each affected salary line as paid with an unreviewed variance and SHALL record the count
   of unreviewed dates on that line.
3. WHEN a Pay_Month reaches Payroll_Cut_Off with unreviewed Variance_Records, THE
   Variance_Review_Queue SHALL retain each unreviewed Variance_Record and SHALL present it as carried
   forward from that Pay_Month.
4. WHEN a Variance_Record for a Pay_Month that has reached Payroll_Cut_Off is reviewed and an
   adjustment is approved, THE payroll calculator SHALL raise an arrear or recovery entry for the
   difference in the earliest open Pay_Month.
5. THE pre-close reconciliation view SHALL state, for a Pay_Month and branch, the count of
   Variance_Records raised, the count Queued_For_Dual_Review, the count Recorded_Not_Queued, the count
   reviewed, the count unreviewed and the count contested before Payroll_Cut_Off is reached.
6. WHERE the `attendance_feature_config` flag `payroll_lock_on_unresolved_mismatch` is set to 1 for a
   branch, THE payroll calculator SHALL refuse to reach Payroll_Cut_Off for that branch while
   Queued_For_Dual_Review Variance_Records for that branch remain unreviewed and SHALL name the count of
   unreviewed Variance_Records.
7. THE migration of Requirement 15 SHALL set `attendance_feature_config.mismatch_workflow_enabled` to 1
   when this feature is released, so that the Variance_Review_Queue is active on release, because that
   flag is 0 today while `mismatch_flag = 1` stands on 14,891 of 42,181 July 2026
   `attendance_daily_record` rows (35%) with no queue presenting them (decision: secondary decision 2).
8. THE migration of Requirement 15 SHALL set
   `attendance_feature_config.payroll_lock_on_unresolved_mismatch` to 0 when this feature is released, so
   that an unreviewed Variance_Record never blocks a payroll run by default, and SHALL retain the
   blocking behaviour of acceptance criterion 9.6 as an opt-in a branch may enable (decision: secondary
   decision 2).
9. WHERE `mismatch_workflow_enabled` is 0, THE attendance engine SHALL continue to raise and record
   Variance_Records and SHALL present none for Dual_Review, so that enabling the flag does not require
   backfilling detection.
10. WHEN a Variance_Record for a Pay_Month that has reached Payroll_Cut_Off is reviewed and no
    adjustment is approved, THE payroll calculator SHALL leave that Pay_Month's Payable_Days unchanged
    and SHALL retain the unreviewed-variance mark recorded under acceptance criterion 9.2 as historical
    fact (decision A3).

### Requirement 10: Floor Absence Pattern Detection

**User Story:** As a chief executive, I want the system to surface employees whose biometric record
shows a full shift while their productivity record shows almost none, so that a punch made outside
the floor cannot convert into a paid day unexamined.

#### Acceptance Criteria

1. WHEN Biometric_Minutes for a date reach the full-day minute threshold, productivity evidence for
   that date is present, and Canonical_Productive_Minutes for that date fall below the
   Floor_Absence_Pattern_Ceiling, THE fraud pattern detector SHALL record a Floor_Absence_Pattern
   occurrence for that employee and date.
2. THE fraud pattern detector SHALL read Canonical_Productive_Minutes and the per-Dialler_Source
   contributions from the aggregation of Requirement 18, and SHALL NOT read
   `attendance_daily_record.dialler_minutes`.
3. THE fraud pattern detector SHALL treat `attendance_daily_record.dialler_minutes = 0` as no evidence
   and SHALL record no Floor_Absence_Pattern occurrence on the strength of that value, because a
   detector reading it naively would fire on 3,056 July 2026 employee-days (Biometric_Minutes at or
   above 540 with `dialler_minutes = 0`) that are almost certainly filler zeros, plus 10,373 further
   days where the column is NULL, against only 40 July 2026 employee-days that pair Biometric_Minutes
   at or above 540 with a genuinely positive Canonical_Productive_Minutes of 60 or less.
4. WHERE no Floor_Absence_Pattern_Ceiling is configured for an employee and date, THE fraud pattern
   detector SHALL apply 60 minutes.
5. WHEN an employee's biometric record for a date consists of exactly two punches separated by at
   least the full-day minute threshold and every registered Dialler_Source holding a record for that
   date reports productive time below the Floor_Absence_Pattern_Ceiling, THE fraud pattern detector
   SHALL record a Floor_Absence_Pattern occurrence and SHALL state the two-punch pattern as the
   reason.
6. WHEN a Floor_Absence_Pattern occurrence is recorded, THE fraud pattern detector SHALL raise a
   Variance_Record for that employee and date.
7. WHEN the count of Floor_Absence_Pattern occurrences for one employee within a rolling window
   reaches the configured repeat threshold, THE fraud pattern detector SHALL mark the employee a
   repeat occurrence subject and SHALL notify the employee's branch head and the WFM head.
8. WHERE no repeat threshold or rolling window is configured, THE fraud pattern detector SHALL apply
   three occurrences within 30 days.
9. THE fraud pattern detector SHALL retain every Floor_Absence_Pattern occurrence after the associated
   Variance_Record is reviewed.
10. WHERE no registered Dialler_Source has carried a record for an employee within the 30 days
    preceding the date, THE fraud pattern detector SHALL record no Floor_Absence_Pattern occurrence
    for that date.
11. FOR ALL employees and dates where productivity evidence is absent, THE fraud pattern detector
    SHALL record no Floor_Absence_Pattern occurrence (no-evidence-no-finding property).

### Requirement 11: Attendance Provenance And Audit Trail

**User Story:** As an auditor, I want to see for any paid day which feed decided it, which rule
selected that feed, and who changed anything afterwards, so that the salary register can be proved
rather than asserted.

#### Acceptance Criteria

1. WHEN attendance for an employee and date is processed, THE attendance engine SHALL write an
   Attendance_Provenance_Record carrying the resolved Attendance_Source, the deciding
   Attendance_Source_Rule identifier, Biometric_Minutes, Canonical_Productive_Minutes, the identifier
   and contributed minutes of each Dialler_Source that participated, the applied
   APR_Corroboration_Threshold, the resulting classification and the processing timestamp.
2. WHEN a Rule_Administrator creates, amends or deactivates an Attendance_Source_Rule or a
   Dialler_Source registration, THE Rule_Audit_Log SHALL record the acting user, the timestamp, the
   prior field values, the new field values and the stated change reason.
3. THE Rule_Audit_Log SHALL reject any request to modify or delete an existing log entry.
4. WHEN a Review_Outcome, adjustment request, adjustment approval, adjustment rejection or Upload_Batch
   submission is recorded, THE Rule_Audit_Log SHALL record the acting user, the acting role, the
   timestamp and the affected employee and date.
5. WHERE a payroll run is finalised, THE Attendance_Provenance_Record for every date contributing to
   that run's Payable_Days SHALL remain retrievable and unchanged.
6. FOR ALL employees and Pay_Months, the count of dates carrying an Attendance_Provenance_Record SHALL
   equal the count of dates contributing to that employee's Payable_Days for that Pay_Month
   (provenance completeness property).
7. FOR ALL Attendance_Provenance_Records, the sum of the recorded per-Dialler_Source contributions
   SHALL reconcile to the recorded Canonical_Productive_Minutes under the aggregation rule of
   Requirement 18 (aggregation traceability property).

### Requirement 12: Rule Administration Interface

**User Story:** As a payroll head, I want a screen where I can see, add and retire the attendance
source rules and test them against a real employee, so that I can set policy per cost centre without
a database change.

#### Acceptance Criteria

1. THE rule administration screen SHALL list every Attendance_Source_Rule with its six Rule_Dimension
   values, Attendance_Source, effective-date window, active state and Specificity_Count.
2. THE rule administration screen SHALL support filtering the rule list by each of the six
   Rule_Dimensions, by Attendance_Source and by active state.
3. WHEN a Rule_Administrator submits a new Attendance_Source_Rule, THE rule administration screen SHALL
   display the count of currently active employees the rule would match and the count whose resolved
   Attendance_Source the rule would change.
4. THE rule administration screen SHALL provide a resolution preview that accepts an employee
   identifier and a date and displays the outcome specified in acceptance criterion 2.9.
5. WHEN a Rule_Administrator deactivates an Attendance_Source_Rule, THE rule administration screen SHALL
   display the count of currently active employees whose resolved Attendance_Source would change and
   SHALL require confirmation before applying the deactivation.
6. THE rule administration screen SHALL display the Rule_Audit_Log entries for a selected
   Attendance_Source_Rule.
7. THE rule administration screen SHALL support configuring the APR_Corroboration_Threshold, the
   Variance_Tolerance, the Floor_Absence_Pattern_Ceiling, the repeat threshold, the rolling window and
   the Day_Threshold_Rule values `full_day_minutes`, `half_day_minutes` and `grace_minutes` against the
   same six Rule_Dimensions, and SHALL support configuring the Dual_Review_Ceiling per branch.
8. THE rule administration screen SHALL support registering, amending and deactivating a
   Dialler_Source as specified by Requirement 16.
9. WHEN a Rule_Administrator submits an Attendance_Source_Rule that constrains cost centre, THE rule
   administration screen SHALL identify every active Attendance_Source_Rule that constrains process and
   whose matched active-employee population intersects the submitted rule's matched active-employee
   population, SHALL state for each whether its Attendance_Source differs from the submitted rule's
   Attendance_Source, and SHALL display a warning naming each differing rule before the submission is
   saved, because `cost_centre_master` carries `branch_id`, `department_id`, `process_id`, `client_id`
   and `lob_id`, so a cost centre already implies a process and a cost-centre-scoped rule can therefore
   encode intent that contradicts a process-scoped rule over an overlapping population while winning the
   tie-break under Dimension_Priority_Order (decision A1).
10. WHEN the rule administration screen displays the warning of acceptance criterion 12.9, THE rule
    administration screen SHALL state the count of active employees in the intersecting population and
    SHALL require the Rule_Administrator to confirm the submission before it is saved.

### Requirement 13: Review Queue And Reporting Interfaces

**User Story:** As a WFM reviewer and as a reporting manager, I want a queue of the days needing my
decision and a report of the exceptions in my scope, so that I can clear reviews before payroll
closes.

#### Acceptance Criteria

1. THE Variance_Review_Queue screen SHALL list the Variance_Records within the signed-in user's scope
   and SHALL indicate for each whether that user's own Review_Outcome is outstanding.
2. THE Variance_Review_Queue screen SHALL support filtering by Pay_Month, branch, process, cost centre,
   Dialler_Source, review state, queue state of Queued_For_Dual_Review or Recorded_Not_Queued, and
   carried-forward state.
3. THE Variance_Review_Queue screen SHALL support recording one Review_Outcome across a selected set of
   Variance_Records in a single action, with one comment applied to the set.
4. THE variance exception report SHALL aggregate Variance_Records by cost centre, branch, process and
   designation for a stated Pay_Month, reporting the count raised, the count Queued_For_Dual_Review, the
   count Recorded_Not_Queued, the count queued as a Floor_Absence_Pattern occurrence under acceptance
   criterion 6.8, the applied Dual_Review_Ceiling, and the counts reviewed, unreviewed, contested and
   adjusted, so that the count raised equals the count Queued_For_Dual_Review plus the count
   Recorded_Not_Queued on every reported grouping.
5. THE variance exception report SHALL support export to a spreadsheet file carrying the same rows and
   columns the screen displays.
6. THE pre-close reconciliation view SHALL list, for a stated Pay_Month, each employee whose salary line
   carries an unreviewed variance, with the count of unreviewed dates and the resolved
   Attendance_Source.
7. WHEN a Variance_Record is marked contested, THE Variance_Review_Queue screen SHALL display the
   conflicting Review_Outcomes and their reviewer comments together.
8. THE Variance_Review_Queue screen SHALL state, for a stated Pay_Month and branch, the count of
   Variance_Records outstanding and the count of whole days remaining until Payroll_Cut_Off, so that a
   reviewer can see whether the queue can be cleared in the time available.

### Requirement 14: Access Control And Segregation Of Duties

**User Story:** As an information security owner, I want rule configuration, variance review and
payable-day override held by separate grants, so that no single user can both write the rule and
approve the money it produces.

#### Acceptance Criteria

1. THE system SHALL restrict creating, amending and deactivating an Attendance_Source_Rule to users
   holding the Rule_Administrator grant.
2. THE system SHALL restrict recording a Review_Outcome to users holding the WFM_Reviewer grant for the
   employee's scope and to the employee's Reporting_Manager.
3. THE system SHALL restrict approving an adjustment request to users holding the Override_Approver
   grant for the employee's branch.
4. WHEN a user requests any Variance_Record list, THE system SHALL return only the Variance_Records for
   employees within that user's resolved business scope.
5. IF a user holding the Rule_Administrator grant submits an approval of an adjustment request for a
   date whose deciding Attendance_Source_Rule that same user created or amended, THEN THE system SHALL
   reject the submission and state the segregation-of-duties conflict.
6. WHEN a user without the required grant requests a rule administration, review, upload or override
   action, THE system SHALL refuse the action, return no employee data, and record the refused attempt
   with the acting user and the requested action.
7. THE system SHALL expose the rule administration screen, the Variance_Review_Queue screen, the
   variance exception report, the pre-close reconciliation view, the Upload_Batch submission screen and
   the Consolidated_Productivity_View as separately grantable page permissions.
8. THE system SHALL restrict submitting an Upload_Batch to users holding the WFM_Uploader grant, and
   SHALL restrict the branches an Upload_Batch may name to the branches within that user's resolved
   scope.

### Requirement 15: Migration From The Existing Configuration Stores

**User Story:** As a payroll head, I want the move from today's configuration tables and unattributed
data to the new rule store to be reviewable before it changes anyone's pay, so that the over-reach
already found in production is corrected deliberately rather than repeated.

#### Acceptance Criteria

1. THE migration SHALL produce one proposed Attendance_Source_Rule for each of the 30 active rows in
   `attendance_rule_config` and each of the 61 active rows in `apr_eligibility_config`, preserving that
   row's Rule_Dimension values, Attendance_Source and effective-date window.
2. WHERE a source row carries no effective-from date, THE migration SHALL assign the effective-from date
   of the first day of the Pay_Month in which the migration is applied, and SHALL list every such row,
   because `apr_eligibility_config` carries no effective-dating column at all and all 65 of its rows are
   therefore undated.
3. THE migration SHALL resolve the two active unconstrained `attendance_rule_config` rows
   `arc-global-001` (`biometric`) and `arc-apr-ops-exec` (`dialler`) into exactly one
   System_Default_Rule, SHALL state which source that rule carries, and SHALL list every active employee
   whose resolved Attendance_Source changes as a result.
4. THE migration SHALL state the disposition of `apr-elig-ops-executive`, the process-NULL row
   reactivated on 2026-08-28 whose notes read "designation+department only, no process filter", against
   the 60 process-scoped rows seeded by `backend/sql/1127_scope_apr_eligibility_by_process.sql`, because
   both are active simultaneously and the process-NULL row nullifies the 1127 scoping.
5. THE migration SHALL list every one of the 445 active employees who are matched by an active
   `apr_eligibility_config` rule of the 832 matched in total and who have never appeared in any
   Productivity_Feed, and SHALL require an explicit decision for each before a `dialler`
   Attendance_Source is proposed for that employee.
6. THE migration SHALL require the two `department_master` rows `'OPERATIONS'` (897 active employees) and
   `'Operations'` (148) to have been merged into one `department_master` row, with every affected
   `employees.department_id` repointed to the surviving row, as a mandatory gate before the proposed rule
   set may be approved, and SHALL refuse the approval action of acceptance criterion 15.11 while both
   rows remain active (decision A10).
7. THE rule store SHALL retain the set-valued Rule_Dimension constraint of acceptance criterion 2.10
   permanently after the merge required by acceptance criterion 15.6 is complete, as the standing defence
   against a recurrence of duplicate master rows denoting one business unit, because migration 1082
   already recorded this defect class once (decision A10).
8. WHEN the migration is applied, THE migration SHALL create one Day_Threshold_Rule for each distinct
   combination of `full_day_minutes`, `half_day_minutes`, `grace_minutes` and Rule_Dimension values held
   on the 30 active `attendance_rule_config` rows, preserving each row's effective-date window, and SHALL
   seed the unconstrained Day_Threshold_Rule required by acceptance criterion 1.15 from the
   `attendance_feature_config` values `biometric_half_day_floor_minutes = 270` and
   `netlogin_half_day_floor_minutes = 240` (decision: secondary decision 1).
9. THE migration SHALL produce, for every currently active employee, the `full_day_minutes`,
   `half_day_minutes` and `grace_minutes` the existing engine applies today and the values the proposed
   Day_Threshold_Rule store resolves, and SHALL list every employee for whom the two differ, so that the
   relocation of the thresholds is not a silent change to day classification.
10. THE migration SHALL produce a reconciliation report stating, for every currently active employee, the
    Attendance_Source the existing engine resolves today and the Attendance_Source the proposed rule set
    resolves, and SHALL list every employee for whom the two differ.
11. THE migration SHALL require an explicit approval action before the proposed rule set becomes the
    active rule store.
12. WHEN the proposed rule set is approved, THE migration SHALL retain the source rows in a deactivated
    state rather than delete them.
13. FOR ALL currently active employees whose proposed resolution matches their existing resolution, the
    applied migration SHALL leave the resolved Attendance_Source unchanged (no-silent-change property).
14. WHEN the migration is applied, THE migration SHALL list every employee and open-Pay_Month date
    requiring reprocessing rather than reprocess them automatically.
15. THE migration SHALL list every currently active employee for whom any of the six Rule_Dimensions
    holds no value, covering 34 employees with no `cost_centre_id` (3.0%), 75 with no `process_id`
    (6.7%), 196 with no `profile_type` (17.5%), 1 with no `department_id`, 1 with no `designation_id` and
    1 with no `reporting_manager_id`, out of 1,123 active employees, because such an employee cannot be
    matched by a rule constraining that dimension.
16. THE migration SHALL register each existing Productivity_Feed as a Dialler_Source under Requirement
    16, covering the single integrated ViciDial instance (`integration_key = 'dialer_1'`,
    `source_system = 'dialer_db.vicidial_agent_log_249'`), the 78 free-text `apr.campaign_id` values, and
    the manual submissions carrying the `'MANUAL_UPLOAD'` sentinel.
17. THE migration SHALL attribute or quarantine the 3,810 existing `apr` rows carrying
    `source = 'manual'`, `campaign_id = 'MANUAL_UPLOAD'`, empty `process_name`, empty `branch_name` and
    NULL `upload_batch_id`, and SHALL state for each whether a Dialler_Source, branch and process could
    be determined.
18. WHEN the migration is applied, THE system SHALL write every subsequent manual submission to
    `apr_manual_upload` with a populated `upload_batch_id`, and SHALL reject any manual write to `apr`
    that carries no Dialler_Source and no Upload_Batch attribution, because `apr_manual_upload` holds 0
    rows today while 3,810 unattributed manual rows sit in `apr`.
19. THE migration SHALL populate `campaign_master`, which holds 0 rows today, with one row per registered
    campaign carrying its owning Dialler_Source and process, and SHALL list every one of the 78
    `apr.campaign_id` values for which no owner could be determined.
20. THE migration SHALL list the 56 distinct `apr.UserID` values, of the 727 present, that resolve to no
    row in `employees`, and SHALL state the disposition of the productivity data held against them.
21. WHEN the migration is applied, THE migration SHALL set
    `attendance_feature_config.mismatch_workflow_enabled` to 1 and
    `attendance_feature_config.payroll_lock_on_unresolved_mismatch` to 0, as required by acceptance
    criteria 9.7 and 9.8.

### Requirement 16: Dialler Source Registry

**User Story:** As a WFM head, I want every dialler system an employee logs in to registered by name
with the metrics it can supply, so that a productivity figure can always be traced to the system that
produced it instead of arriving as unlabelled free text.

#### Acceptance Criteria

1. THE Dialler_Source registry SHALL hold, for each Dialler_Source, a stable identifier, a display name,
   an ingestion mode of `integrated_pull` or `manual_upload`, the declared Metric_Availability, an active
   state and an effective-date window, and SHALL permit an owning branch scope and an owning process
   scope each to be either one identifier or unset, where unset means the Dialler_Source serves every
   branch or every process.
2. WHEN a Rule_Administrator submits a Dialler_Source whose identifier equals that of an existing
   Dialler_Source, THE registry SHALL reject the submission and identify the existing Dialler_Source.
3. WHEN a Rule_Administrator submits a Dialler_Source whose declared Metric_Availability names a metric
   absent from the controlled metric list, THE registry SHALL reject the submission and name the
   unrecognised metric.
4. THE system SHALL require every row ingested into a Productivity_Feed to resolve to exactly one active
   Dialler_Source, resolving `dialer_session_log` rows through `dialer_name` and `integration_key`, and
   `apr` rows through `campaign_id` by way of `campaign_master`.
5. IF a Productivity_Feed row cannot be resolved to an active Dialler_Source, THEN THE system SHALL
   reject that row, SHALL record the unresolved identifier and the rejecting Upload_Batch or integration
   run, and SHALL exclude the row from Canonical_Productive_Minutes.
6. THE registry SHALL require `dialer_session_log.dialer_name` to hold a registered Dialler_Source
   identifier on every newly ingested row, because that column is NULL on all 1,365 existing rows while
   exactly one `integration_key` (`'dialer_1'`) and one `source_system`
   (`'dialer_db.vicidial_agent_log_249'`) are present, so the multiple diallers the business operates are
   entirely unrepresented in data today.
7. THE registry SHALL require every `apr.campaign_id` value to resolve to a row in `campaign_master`
   carrying an owning Dialler_Source and process, because `campaign_master` holds 0 rows today and the 78
   distinct `campaign_id` values in `apr` are unmanaged free text with no owning process or dialler.
8. THE registry SHALL reject `'MANUAL_UPLOAD'` as a Dialler_Source identifier and SHALL require every
   manual submission to name a registered Dialler_Source, because all 3,810 existing manual `apr` rows
   carry that single sentinel and the originating dialler system is therefore unrecorded.
9. WHEN a Rule_Administrator deactivates a Dialler_Source, THE registry SHALL retain every historical
   contribution attributed to that Dialler_Source and SHALL continue to present each such contribution
   on the Consolidated_Productivity_View.
10. FOR ALL rows contributing to Canonical_Productive_Minutes on any date, the attributed
    Dialler_Source SHALL be resolvable to exactly one registry row (source attribution totality
    property).
11. THE registry SHALL present a coverage report stating, per Dialler_Source and Pay_Month, the count of
    contributing employee-days, the count of contributing rows and the ingestion mode, so that the three
    feeds in play today are visible as distinct sources: in July 2026 `dialer_session_log.session_date`
    decided 7,366 `attendance_daily_record` rows against 5,186 for `apr.ReportDate`.
12. WHERE a Dialler_Source's ingestion mode is `manual_upload`, THE registry SHALL permit a
    Rule_Administrator to define and amend a Column_Mapping for that Dialler_Source, associating each
    expected source-file column header with exactly one target Upload field, and SHALL require the
    mandatory Upload fields — employee code, report date, login minutes — to be mapped before that
    Dialler_Source may accept a submission, so that a report whose column layout differs from the base
    template is a configuration change rather than a code change.
13. WHERE a Dialler_Source's report format supplies distinguishable login and logout times, THE registry
    SHALL permit those columns to be mapped to `Login_Time` and `Logout_Time`, so that the interval-union
    rule of Requirement 18 can govern that Dialler_Source's contributions instead of the max_contribution
    secondary rule that otherwise applies to every source lacking a logout column.
14. WHEN a Rule_Administrator amends a Dialler_Source's Column_Mapping, THE registry SHALL apply the
    amended mapping to submissions from that point forward only, and SHALL retain the mapping version
    under which each already-accepted row was parsed.

### Requirement 17: WFM Manual Upload With Attribution

**User Story:** As a branch WFM person, I want to upload the dialler reports my branch pulls by hand
and have the system record exactly what I uploaded and for whom, so that manually sourced productivity
data carries the same attribution as an integrated feed.

#### Acceptance Criteria

1. WHEN a WFM_Uploader submits a dialler report, THE system SHALL require the submission to name one
   registered Dialler_Source with ingestion mode `manual_upload`, one branch, one process and a date
   range, and SHALL create one Upload_Batch.
2. WHEN an Upload_Batch is created, THE system SHALL record the uploading user, the submission timestamp,
   the upload batch identifier, the file name, a content digest of the file, the accepted row count, the
   rejected row count and a reason for each rejected row.
3. THE system SHALL write every accepted row to `apr_manual_upload` carrying a populated
   `upload_batch_id`, and SHALL reject any write that carries no upload batch identifier, because
   `apr.upload_batch_id` has 0 distinct values across all 46,163 existing rows and there is therefore no
   audit trail of who uploaded which file.
4. THE system SHALL require an accepted row to supply, at minimum, an employee code, a report date and
   login minutes, and SHALL treat calls handled, AHT seconds, bio minutes, lunch minutes, QA minutes and
   training minutes as optional, because `apr_manual_upload` carries no talk, wait, dispo, pause or
   logout column and a manual upload therefore cannot supply those metrics.
5. IF a submitted row carries an employee code that resolves to no row in `employees`, THEN THE system
   SHALL reject that row and SHALL name the unresolved employee code on the Upload_Batch, because 56 of
   the 727 distinct `apr.UserID` values present today resolve to no employee.
6. IF a submitted row names a Dialler_Source, employee and date for which an accepted row already exists
   in a prior Upload_Batch that has not been superseded, THEN THE system SHALL reject that row as a
   duplicate submission and SHALL name the prior upload batch identifier.
7. WHEN a WFM_Uploader submits an Upload_Batch declared as a re-upload of a prior Upload_Batch, THE
   system SHALL supersede every accepted row of the prior Upload_Batch, SHALL retain the prior
   Upload_Batch and its rows in a superseded state, and SHALL exclude superseded rows from
   Canonical_Productive_Minutes.
8. IF an Upload_Batch names a branch outside the submitting WFM_Uploader's resolved scope, THEN THE
   system SHALL reject the Upload_Batch and SHALL record the refused attempt.
9. IF an Upload_Batch names a date within a Pay_Month that has reached Payroll_Cut_Off, THEN THE system
   SHALL accept the Upload_Batch, SHALL exclude its rows from that Pay_Month's Payable_Days, and SHALL
   route any resulting difference through the arrear path of acceptance criterion 9.4.
10. THE system SHALL reject any manual write to `apr` that carries no Dialler_Source attribution and no
    upload batch identifier, so that the unattributed path that produced the 3,810 existing
    `'MANUAL_UPLOAD'` rows with empty `process_name` and empty `branch_name` is closed.
11. FOR ALL Upload_Batches, the accepted row count plus the rejected row count SHALL equal the submitted
    row count (upload accounting property).
12. FOR ALL accepted rows, the Upload_Batch, Dialler_Source, branch, process and uploading user SHALL
    remain retrievable after the Upload_Batch is superseded (upload provenance retention property).
13. THE Upload_Batch history screen SHALL list, for a stated branch and date range, every Upload_Batch
    with its Dialler_Source, uploading user, timestamp, accepted and rejected counts and superseded
    state.
14. WHEN a WFM_Uploader submits a report file, THE system SHALL parse it using the submitting
    Dialler_Source's declared Column_Mapping rather than a fixed column order, SHALL present a preview
    of at least the first ten parsed rows, and SHALL require the WFM_Uploader to confirm the preview
    before any row is accepted.
15. IF a submitted report file's headers do not match every mandatory target field in the submitting
    Dialler_Source's declared Column_Mapping, THEN THE system SHALL reject the Upload_Batch before
    processing any row and SHALL name every unmatched or missing mandatory header.

### Requirement 18: Canonical Daily Productivity Aggregation

**User Story:** As a payroll head, I want exactly one productive-minutes figure per employee per day
that cannot exceed a day, so that a control designed to catch inflated attendance is not itself built
on inflated arithmetic.

#### Acceptance Criteria

1. THE system SHALL derive exactly one Canonical_Productive_Minutes value for one employee and one
   calendar date from every non-superseded, Dialler_Source-attributed contribution for that employee and
   date across every registered Productivity_Feed.
2. THE system SHALL bound Canonical_Productive_Minutes to at most 1,440 minutes for any employee and
   date.
3. THE system SHALL NOT derive Canonical_Productive_Minutes by summing net login across concurrent
   sessions on different Dialler_Sources or campaigns, because 8,638 of 36,594 employee-days (23.6%)
   carry more than one such row and naive summation produces 3,603 employee-days over 10 hours, 2,505
   over 12 hours and 218 over 24 hours, with a maximum of 6,282.8 minutes (104.7 hours) in one day.
4. THE system SHALL derive Canonical_Productive_Minutes as the total duration of the union of
   non-overlapping session intervals constructed from the `Login_Time` and `Logout_Time` of every
   contributing row for that employee and date, counting any instant covered by two or more overlapping
   intervals exactly once; this is the primary aggregation rule and it is not configurable (decision A8).
5. THE system SHALL treat a contributing row as supplying a usable interval only where both `Login_Time`
   and `Logout_Time` are present and `Logout_Time` is later than `Login_Time`, and SHALL record any
   contributing row failing that requirement with a stated exclusion reason.
6. WHEN any contributing row for an employee and date supplies no usable interval, THE system SHALL
   derive Canonical_Productive_Minutes for that employee and date as the maximum single contribution for
   that date instead of the union of intervals, and SHALL record that the secondary rule was applied;
   this is the mandatory secondary rule, it is not configurable, and it applies to every employee-date
   holding at least one `apr_manual_upload` contribution because `apr_manual_upload` carries no logout
   column at all (decision A8).
7. THE system SHALL record, for each employee and date, which of the two rules of acceptance criteria
   18.4 and 18.6 produced the recorded Canonical_Productive_Minutes.
8. WHERE a contributing session spans midnight, THE system SHALL apportion that session's minutes across
   the two calendar dates the session covers rather than attribute the whole session to either date.
9. THE system SHALL retain each per-Dialler_Source contribution individually and SHALL make each
   retrievable alongside Canonical_Productive_Minutes, so that the Consolidated_Productivity_View can
   present the breakdown.
10. THE system SHALL represent Canonical_Productive_Minutes for an employee and date as absent where no
    attributed contribution exists, and SHALL NOT represent that state as zero.
11. FOR ALL employees and dates, Canonical_Productive_Minutes SHALL be less than or equal to 1,440
    minutes (daily bound property).
12. FOR ALL employees and dates holding at least one contribution, Canonical_Productive_Minutes SHALL be
    greater than or equal to the largest single contribution for that employee and date (no-shrinkage
    property).
13. FOR ALL employees and dates, two consecutive derivations performed over an unchanged set of
    contributions SHALL return the same Canonical_Productive_Minutes and the same recorded producing rule
    (recomputation stability property).
14. FOR ALL employees and dates, Canonical_Productive_Minutes SHALL be less than or equal to the sum of
    the per-Dialler_Source contributions for that employee and date (no-inflation property).
15. WHEN the derivation logic of acceptance criteria 18.4 through 18.7 is amended by a release, THE system
    SHALL list every employee and open-Pay_Month date whose Canonical_Productive_Minutes would change for
    reprocessing rather than reprocess them automatically, and SHALL reject the amendment's application to
    any Pay_Month that has reached Payroll_Cut_Off.

### Requirement 19: Consolidated Productivity And Attendance View

**User Story:** As a WFM person, I want one screen showing an employee's login hours, talk time and
everything else we used to see in the BPO reports for each dialler they log in to, next to the
biometric duration for the same day, so that I can judge the day from one place instead of
cross-reading several reports.

#### Acceptance Criteria

1. WHEN a user requests the Consolidated_Productivity_View for an employee identifier and a date range,
   THE system SHALL present one row per calendar date in the range for which any evidence exists.
2. THE Consolidated_Productivity_View SHALL present, for each date and each contributing Dialler_Source,
   the login time, the logout time, the net login minutes, the talk time, the wait time, the dispo time,
   the pause time, the AHT, the calls handled, and the break categories BIO, LUNCH, QA, TRAINING and
   DISMX.
3. THE Consolidated_Productivity_View SHALL present, for each date, the Canonical_Productive_Minutes and
   the aggregation rule that produced it.
4. THE Consolidated_Productivity_View SHALL present, for each date, the biometric duration from
   `attendance_daily_record.biometric_minutes` together with the first punch `clock_in_time` and the last
   punch `clock_out_time`.
5. THE Consolidated_Productivity_View SHALL present, for each date, the resolved Attendance_Source, the
   deciding Attendance_Source_Rule identifier, the resulting attendance classification, and any
   Variance_Record or Floor_Absence_Pattern occurrence recorded for that date with its review state.
6. WHERE a metric is absent from a Dialler_Source's declared Metric_Availability, THE
   Consolidated_Productivity_View SHALL present that metric as unavailable for that Dialler_Source and
   SHALL present no numeric value for that metric, because a manual upload to `apr_manual_upload` cannot
   supply talk, wait, dispo, pause or logout time.
7. WHERE a metric is present in a Dialler_Source's declared Metric_Availability and that Dialler_Source
   holds no value for that metric on a date, THE Consolidated_Productivity_View SHALL present that metric
   as not reported, distinctly from unavailable and distinctly from zero.
8. THE Consolidated_Productivity_View SHALL present, for each contributing row, the ingestion mode and,
   where the mode is `manual_upload`, the Upload_Batch identifier and the uploading user.
9. THE Consolidated_Productivity_View SHALL support export to a spreadsheet file carrying the same rows,
   columns and unavailability markers the screen displays.
10. WHEN a user requests the Consolidated_Productivity_View for an employee outside that user's resolved
    business scope, THE system SHALL refuse the request, return no employee data, and record the refused
    attempt, consistent with Requirement 14.
11. THE Consolidated_Productivity_View SHALL support requesting a whole branch and process for a stated
    date, presenting one row per employee with the same columns.
12. FOR ALL dates presented, the sum of the per-Dialler_Source contributions displayed SHALL reconcile to
    the displayed Canonical_Productive_Minutes under the aggregation rule of Requirement 18 (display
    reconciliation property).
13. FOR ALL employees and date ranges, the metrics the view presents for a Dialler_Source SHALL be a
    subset of that Dialler_Source's declared Metric_Availability (declared-metric containment property).

## Settled Decisions

Every decision needed to make these requirements testable is settled. Each entry below states the
decision, the reason and the evidence it rests on. The A1 to A10 identifiers are retained so existing
references remain valid. Two further decisions that arose from retiring `attendance_rule_config` are
recorded after A10.

- **A1 — Dimension_Priority_Order. SETTLED: cost centre, process, branch, department, designation,
  Employment_Profile.** Reason: `cost_centre_master` carries `branch_id`, `department_id`, `process_id`,
  `client_id` and `lob_id`, so a cost centre already implies branch, department and process and is
  therefore the most specific real axis available (E10). Granularity is workable: `cost_centre_master`
  holds 937 rows but only 30 distinct cost centres carry any active employee (BSS/BO/NOIDA-2/576 264,
  BSS/OB/AHMH-JD/465 155, BSS/IB/Noida/647 111, BSS/OB/Noida/592 105, BSS/OB/AHMH-JD/919 84, then a long
  tail to 1). Neither of the two conflicting weightings in the existing code
  (designation=4/process=2/branch=1 in the attendance rule query, process=4/department=2/designation=1 in
  the APR eligibility query) is adopted. Consequence accepted and mitigated: because a cost centre
  implies a process, a cost-centre-scoped rule can encode intent that contradicts a process-scoped rule
  over an overlapping population while still winning the tie-break, so acceptance criteria 12.9 and 12.10
  require the rule administration screen to name every contradicting process-scoped rule and the size of
  the intersecting population, and to require confirmation, before such a rule is saved. Evidence: E1,
  E10.
- **A2 — Thresholds and review volume. SETTLED: thresholds stay at 480 and 60; exhaustive Dual_Review is
  abandoned in favour of always-queue plus a ranked ceiling.** The APR_Corroboration_Threshold remains
  480 minutes and the Variance_Tolerance remains 60 minutes, because 480 is the business's stated
  eight-hour policy and is the number that already appears on its reports; changing the threshold to
  manage queue size would restate the policy to fit an implementation constraint. The queue is sized
  instead:
  - Every Floor_Absence_Pattern occurrence is Queued_For_Dual_Review irrespective of the ceiling
    (criterion 6.8), because only about 40 July 2026 employee-days pair a full biometric day with
    genuinely positive but low productivity and each one is a genuine case (E7).
  - Every other Variance_Record is ranked by Variance_Risk_Score — the excess of Biometric_Minutes over
    Canonical_Productive_Minutes — descending, and queued up to a Dual_Review_Ceiling configurable per
    branch and Pay_Month, defaulting to 100 (criteria 6.9, 6.10).
  - Candidates beyond the ceiling are Recorded_Not_Queued: retained with the full field set, retrievable,
    counted in the variance exception report and the pre-close reconciliation view, and never silently
    discarded (criteria 6.11, 6.12, 6.13, 9.5, 13.4).
  Rationale: 2,566 of 4,933 comparable July 2026 employee-days flag at 480/60 (E8), which is roughly
  5,100 Dual_Review decisions a month concentrated on 218 employees and will not clear before
  Payroll_Cut_Off. A ceiling of 100 per branch per Pay_Month is clearable by a branch WFM_Reviewer and the
  corresponding Reporting_Managers, and ranking by unexplained gap puts the largest gaps first. Evidence:
  E7, E8.
- **A3 — Cut-off with pending review. SETTLED: pay on the resolved source, mark the line, carry the
  variance forward, settle any later approved adjustment as an arrear in the earliest open Pay_Month.**
  `payroll_lock_on_unresolved_mismatch` ships as 0, so an unreviewed Variance_Record never blocks a
  payroll run, matching the instruction that productivity evidence must not be a blocker. The blocking
  behaviour of criterion 9.6 remains available behind that flag for a branch that opts in. Recorded in
  criteria 9.1 through 9.4, 9.6, 9.8 and 9.10. Evidence: E9.
- **A4 — What a review may change. SETTLED as written.** Recording `apr_accepted` or `apr_disputed`
  annotates the Variance_Record only and moves no money (criterion 8.1). Payable_Days move solely through
  an adjustment request approved by a separate Override_Approver, with the rule-author-cannot-approve
  check of criterion 14.5 and the same-user check of criterion 8.5. Evidence: E9.
- **A5 — "Executive profile". SETTLED by measurement.** Employment_Profile maps to
  `employees.profile_type`, not to `employees.employment_type`. `profile_type` holds VOICE 574,
  NON-VOICE 331, NULL 196 and ten residual values of 5 or fewer, so the business's profile axis is
  essentially VOICE / NON-VOICE. `employment_type` (ONROLL 961, MGMT. TRAINEE 153, NULL 8, OffRoll 1) is
  a contract type. `employee_category` is `'permanent'` for all 1,123 active employees and carries no
  discriminating information. "Executive" remains a designation: within department `'OPERATIONS'`,
  designation EXECUTIVE holds 977 active employees split VOICE 529 / NON-VOICE 259 / NULL 189, and every
  other Operations designation is small (TEAM LEADER 36, DATA-ANALYST 7, ASSISTANT MANAGER 7, DY. MANAGER
  7, RTM 4, SR. MANAGER 3, remainder 1 each). Note that the 189 Operations Executives with NULL
  `profile_type` cannot be matched by any rule constraining Employment_Profile, and that `profile_type`
  carries no foreign key, which is why criterion 1.9 validates it against a controlled list. Evidence: E1,
  E3, E4.
- **A6 — Direction of the 2026-08-07 ruling. SETTLED: the resolved Attendance_Source governs.** The ruling
  that a dialler-covered Operations Executive is judged on dialler productivity alone with no biometric
  fallback is superseded for any employee whose resolved Attendance_Source is `biometric`; for such an
  employee productivity evidence corroborates and never classifies (criteria 5.6, 5.7). A dialler-resolved
  employee stays on Canonical_Productive_Minutes (criterion 4.3). Evidence: E2, E5.
- **A7 — Missing dimension values. SETTLED by measurement; earlier figures were stale.** Of 1,123 active
  employees: `cost_centre_id` NULL on 34 (3.0%), `process_id` NULL on 75 (6.7%), `profile_type` NULL on
  196 (17.5%), `branch_id` NULL on 0, `department_id` NULL on 1, `designation_id` NULL on 1,
  `reporting_manager_id` NULL on 1, `employment_type` NULL on 8. The previously stated 185 and 144 of
  1,125 are superseded. `location_id` and `lob_id` are NULL for all 1,123 and are dropped as dimensions
  by criterion 1.5. Criterion 2.8 makes an employee with a missing value fall through to a less specific
  rule rather than be matched by accident, and criterion 15.15 surfaces the population so master data can
  be corrected first. Evidence: E3.
- **A8 — Canonical daily aggregation. SETTLED: union of non-overlapping session intervals, with the
  maximum single contribution as the mandatory secondary rule.** Reason: the union is the only rule that
  is both bounded by the calendar day and faithful to genuinely sequential cross-dialler work. Summing
  is rejected — it produces 218 employee-days over 24 hours and a maximum of 6,282.8 minutes, and 3,552
  of the 8,638 multi-row employee-days exceed their largest single session by 60 minutes or more with an
  average excess of 124.5 minutes, so capping at 1,440 would leave the impossible days sitting at exactly
  1,440 rather than correct them (E11). Maximum-single-contribution alone is rejected as the primary rule
  because it discards genuinely sequential work across campaigns and understates a day worked across two
  diallers in succession. It is retained as the secondary rule, applied per employee-date whenever any
  contributing row lacks a usable ordered interval — which includes every `apr_manual_upload` row, since
  that table carries no logout column at all (E14). The producing rule is recorded per employee and date
  (criterion 18.7). Recorded in criteria 18.4 through 18.7. Real multi-session days for reference:
  MAS60586 on 2026-04-08 across CHAT 00:57:43 + EMAIL 09:07:02 + INBOUND 09:03:53 + OUTBOUND 07:28:16
  (26h36m summed); MAS63067 on 2026-08-06 across ABANDON, KANNADA, KERALA, TAMIL and TELUGU; MAS60804 on
  2026-06-01 across KANNADA, KERALA, TAMIL and TELUGU (16h30m summed). These are concurrent logins to
  different campaigns, not sequential shifts. Evidence: E11, E14.
- **A9 — Attendance_Source value set. SETTLED: `dialler` and `biometric`, with no rename migration.** The
  existing `enum('dialler','biometric')` on both `attendance_rule_config.attendance_source` and
  `attendance_daily_record.attendance_source` is adopted unchanged. Reason: a rename would touch both
  tables, 126,044 `attendance_daily_record` rows and every dependent query for no behavioural gain. The
  value `apr` exists in no enum in the schema and is introduced nowhere. Recorded in criterion 1.3.
  Evidence: E2, E6.
- **A10 — Duplicate Operations department. SETTLED: both remedies, not either.** The two
  `department_master` rows `'OPERATIONS'` (897 active employees) and `'Operations'` (148) must be merged
  into one row, with every affected `employees.department_id` repointed, as a hard gate before the
  proposed rule set may be approved (criterion 15.6 is mandatory, not alternative). The set-valued
  Rule_Dimension constraint of criterion 2.10 is additionally retained permanently as the standing
  defence against recurrence (criterion 15.7). Reason: left alone, a rule keyed on one identifier
  silently reaches 897 of 1,045 Operations employees, and this is the same defect class migration 1082
  already recorded once, so removing today's instance without keeping the defence would invite the next
  one. Evidence: E4.
- **Secondary decision 1 — day-classification thresholds. SETTLED: they move to a separate
  effective-dated Day_Threshold_Rule store.** The Attendance_Source_Rule store carries the
  Attendance_Source only. `full_day_minutes`, `half_day_minutes` and `grace_minutes` move out of
  `attendance_rule_config` into a Day_Threshold_Rule store resolved by the same six Rule_Dimensions and
  the same candidacy and tie-breaking rules as Requirement 2, administered through the screen of
  criterion 12.7. Reason: `attendance_rule_config` is retired by this feature and those three columns
  ride on it, so they need a home; keeping them on the source rule would force a rule administrator to
  restate day thresholds every time source policy changes, and the two policies change on different
  cadences. The `attendance_feature_config` values `biometric_half_day_floor_minutes = 270` and
  `netlogin_half_day_floor_minutes = 240` become the seeded defaults of the new store. Recorded in
  criteria 1.14, 1.15, 1.16, 12.7, 15.8 and 15.9. Evidence: E2, E9.
- **Secondary decision 2 — release flag values. SETTLED: `mismatch_workflow_enabled` ships as 1 and
  `payroll_lock_on_unresolved_mismatch` ships as 0.** Reason: the detection side is worthless if nothing
  presents it — `mismatch_flag = 1` stands on 14,891 of 42,181 July 2026 rows (35%) with the queue
  switched off — while locking payroll on an unreviewed variance contradicts the instruction that
  productivity evidence must not block pay. Recorded in criteria 9.7, 9.8 and 15.21. Evidence: E6, E9.

## Evidence

All figures measured 2026-08-29 against `mas_hrms` (MySQL 8.0.42) over the public interface. Analysis
month is July 2026, the most recent complete month. Active employee population is 1,123.

### E1 — Rule dimension storage

| Dimension | Column | Master table | Notes |
| --- | --- | --- | --- |
| Cost centre | `employees.cost_centre_id` char, nullable | `cost_centre_master.id` (FK) | First-class; a non-FK `cost_center_code` varchar also exists |
| Branch | `employees.branch_id` | `branch_master.id` (FK) | Name column `branch_name` |
| Process | `employees.process_id` | `process_master.id` (FK) | Name column `process_name` |
| Department | `employees.department_id` | `department_master.id` (FK) | Name column `dept_name`; no `departments` table, no `department_name` column |
| Designation | `employees.designation_id` | `designation_master.id` (FK) | Name column `designation_name` |
| Employment profile | `employees.profile_type` varchar, nullable | none | **No foreign key — free text** |
| Location | `employees.location_id` | — | NULL for all 1,123 active employees; unusable |
| LOB | `employees.lob_id` | — | NULL for all 1,123 active employees; unusable |
| Manager | `employees.reporting_manager_id` | — | NULL for 1 of 1,123; `manager_id` NULL for 394 and not used |

`employment_type` (ONROLL 961, MGMT. TRAINEE 153, NULL 8, OffRoll 1) is a contract type, not the
business's profile. `cost_centre_master` carries `branch_id`, `department_id`, `process_id`, `client_id`
and `lob_id`, so cost centre already implies branch, department and process.

### E2 — Existing configuration stores

`attendance_rule_config`: 30 rows, all active. Columns id, rule_name, scope_type, designation_id,
process_id, branch_id, attendance_source, full_day_minutes, half_day_minutes, grace_minutes,
effective_from, effective_to, notes, active_status, created_by, created_at, updated_at.

| Fact | Measurement |
| --- | --- |
| `attendance_source` value set | `enum('dialler','biometric')` — no `apr` value anywhere in the schema |
| Day thresholds carried on the same row | `full_day_minutes`, `half_day_minutes`, `grace_minutes` — declared out of scope but coupled |
| Missing dimensions | no cost_centre_id, no department_id, no profile column |
| Unconstrained active rows | 2, disagreeing on source: `arc-global-001` biometric 540/270 from 2026-06-01; `arc-apr-ops-exec` dialler 480/240 from 2026-06-13 |
| Tiebreak between them | none — `ORDER BY ... LIMIT 1`. Non-determinism is live in production now |
| Remaining rows | 28 designation-scoped biometric rules, one per Executive-family designation, 540/240, from 2026-01-01 |

`apr_eligibility_config`: 65 rows. Columns id, rule_name, designation_id, department_id, process_id,
active_status, notes, created_by, created_at, updated_at.

| Fact | Measurement |
| --- | --- |
| Effective dating | **none at all** — no column |
| Source column | **none** |
| Active process-scoped rows | 60 (4 Executive designations x 15 processes), seeded by migration 1127 |
| Active process-NULL row | `apr-elig-ops-executive`, notes "REACTIVATED 2026-08-28: admin directive — designation+department only, no process filter. All Ops Executives on APR regardless of process." |
| Consequence | The 1127 scoping is nullified; both rule sets are active simultaneously. The earlier claim that 1127 is "deliberately unregistered and blocked pending sign-off" is out of date |
| Deactivated rows | 4 (`apr-elig-ops-exec`, `--backend`, `--field`, `--voice`) |

### E3 — Null coverage across 1,123 active employees

| Column | NULL count | Share |
| --- | --- | --- |
| `location_id` | 1,123 | 100% |
| `lob_id` | 1,123 | 100% |
| `profile_type` | 196 | 17.5% |
| `process_id` | 75 | 6.7% |
| `cost_centre_id` | 34 | 3.0% |
| `employment_type` | 8 | 0.7% |
| `department_id` | 1 | 0.1% |
| `designation_id` | 1 | 0.1% |
| `reporting_manager_id` | 1 | 0.1% |
| `branch_id` | 0 | 0% |

Supersedes the stale 185 / 144-of-1,125 figures previously carried in assumption A7.

### E4 — Real value sets

| Fact | Measurement |
| --- | --- |
| `profile_type` | VOICE 574, NON-VOICE 331, NULL 196, HARDWARE ENGINEER 5, TRAINING AND DEVELOPMENT 4, BUSINESS DEVELOPMENT 3, FACILITY MGMT. 3, FINANCE 2, RECRUITMENT 2, ACCOUNTS 1, SOFTWARE ENGINEER 1, HR GENERALISTIC 1 |
| `employee_category` | `'permanent'` for all 1,123 — no discriminating information |
| Duplicate Operations departments | `department_master` holds `'OPERATIONS'` (897 active) and `'Operations'` (148) as separate rows. A rule keyed on one `department_id` reaches only one. Same defect class migration 1082 recorded once |
| Operations Executives | 977 active: VOICE 529, NON-VOICE 259, NULL 189. The 189 with NULL `profile_type` cannot be matched by any profile-constraining rule |
| Other Operations designations | TEAM LEADER 36, DATA-ANALYST 7, ASSISTANT MANAGER 7, DY. MANAGER 7, RTM 4, SR. MANAGER 3, remainder 1 each |

### E5 — APR coverage and current over-reach

| Fact | Measurement |
| --- | --- |
| Employees matched by active `apr_eligibility_config` rules | 832 |
| Of those, never present in the APR feed | **445 (53%)** — worse than the 472-of-828 recorded by migration 1127, because the process-NULL rule was reactivated 2026-08-28 |
| APR distinct users by month | 2026-08 490, 2026-07 277, 2026-06 329, 2026-05 342, 2026-04 357, 2026-03 322, against 1,123 active employees |

### E6 — `attendance_daily_record` already carries much of the proposed provenance

Existing columns: attendance_source `enum('dialler','biometric')`, source_system, source_record_date,
source_reference, dialler_minutes, biometric_minutes, biometric_status, apr_status, mismatch_flag,
mismatch_resolved_at / _by / _reason, raw_minutes, attendance_status
`enum('present','half_day','absent','leave_approved','holiday','week_off','unreconciled','missing_punch','week_off_worked')`,
lwp_value, late_mark, late_by_minutes, rule_config_id, regularization_id, override_by, override_reason,
is_locked, processed_at, old_attendance_status, old_lwp_value, status_change_reason, status_changed_by,
status_changed_at.

July 2026: 42,181 rows, 1,682 employees; `biometric_minutes` present 24,329; `dialler_minutes` present
15,831; **`mismatch_flag = 1` on 14,891 rows (35%)**.

| July 2026 `source_system` / source | Rows |
| --- | --- |
| `wfm_attendance_session` / biometric | 18,932 |
| `cosec_policy_absence` / biometric | 8,757 |
| `dialer_session_log.session_date` / dialler | 7,366 |
| `apr.ReportDate` / dialler | 5,186 |
| NULL / biometric | 1,196 |
| `ncosec_fixed` / biometric | 203 |
| `apr.inferred_night_shift_window` / dialler | 196 |
| `payroll_gap_absence` / biometric | 131 |
| `attendance_override` | 86 dialler + 31 biometric |
| `apr_no_activity` / dialler | 49 |

July 2026 status mix: present 15,821; missing_punch 9,851; absent 8,876; half_day 7,458; week_off 116;
week_off_worked 54; leave_approved 5.

### E7 — Zero is not absent, and APR cannot corroborate biometric today

| July 2026 population | Rows | `biometric_minutes` | `dialler_minutes` |
| --- | --- | --- | --- |
| `attendance_source = 'biometric'` | 29,271 | NULL 10,318 / zero 0 / positive 18,953 | NULL 26,215 / **zero 3,016** / **positive 40** |
| `attendance_source = 'dialler'` | 12,910 | NULL 7,534 / positive 5,376 | NULL 135 / zero 7,392 / positive 5,383 |

Consequences:

- On biometric-source days a positive productivity figure exists on **40 of 29,271 days (0.14%)**.
  Corroboration is almost entirely unavailable from `attendance_daily_record` and must read the
  productivity feeds through the canonical aggregation of Requirement 18. Absent productivity evidence
  is the common case, not the exception. Enforced by criteria 5.1 and 5.7.
- `dialler_minutes = 0` is a filler, not a measured zero. The 3,016 zero rows are indistinguishable from
  "no data" without consulting the feed, so the absent-versus-zero distinction is load-bearing and must
  be enforced at the data-access boundary. Enforced by criteria 5.2, 5.3 and 18.9.
- Naive floor-absence detection would fire on **3,056** July employee-days (biometric at or above 540
  with `dialler_minutes = 0`) that are almost certainly filler zeros, plus **10,373** more where
  `dialler_minutes` is NULL. Only **40** July employee-days pair biometric at or above 540 with a
  genuinely positive but low (60 minutes or less) productivity figure. Expected true-positive volume is
  small. Enforced by criteria 10.2, 10.3 and 10.11.

### E8 — Reviewer workload is the binding design constraint

Population where variance comparison is meaningful (both feeds strictly positive), July 2026: **4,933
employee-days across 218 employees**.

| Threshold (tolerance 60) | Flagged employee-days | Share of 4,933 |
| --- | --- | --- |
| 480 minutes | **2,566** | 52% |
| 450 minutes | 1,759 | 36% |
| 420 minutes | 1,368 | 28% |

Distribution within the population: productivity under 420 minutes 1,482; under 450 minutes 1,886; under
480 minutes 2,717. At 480/60, Dual_Review means about 2,566 items and roughly 5,100 human decisions per
month concentrated on 218 employees, which will not clear before Payroll_Cut_Off. This is the binding
constraint on Requirements 6, 7 and 13.

### E9 — Existing review and payroll structures

| Structure | Measurement |
| --- | --- |
| `payroll_attendance_conflict_review` | 268 rows. Columns id, conflict_key, employee_id, issue_date, issue_type, status `enum('open','notified','reviewed','no_issue','regularization_required')`, manager_user_id, reviewed_by, reviewed_at, review_note, created_at, updated_at. **Single reviewer field — no two-party review, no accept/dispute vocabulary, no SLA** |
| Its contents | `dialler_missing_adr` 209 reviewed; `biometric_penalty_dialler_supports_better` 39 notified; `dialler_penalty_biometric_supports_better` 20 notified |
| Mismatch review | no separate table; mismatch state lives on `attendance_daily_record` |
| `salary_prep_line` | 130,331 rows. Payable days is `final_payable_days` decimal. Also paid_working_days, eligible_weekoff_days, eligible_holiday_days, active_calendar_days, working_days, present_days, leave_days, lwp_days, lwp_deduction, needs_recalculation, recalculation_reason, calculation_notes json, `attendance_data_source` `enum('ADR','SESSION_FALLBACK','NO_DATA')` |
| `attendance_data_source` | records which store was read, not which feed decided the day. **Not the field for Attendance_Source; must not be overloaded** |
| `salary_prep_line_adjustment` | exists, 0 rows |
| `attendance_feature_config` | 7 key/value rows: biometric_half_day_floor_minutes 270, netlogin_half_day_floor_minutes 240, **mismatch_workflow_enabled 0 (existing mismatch queue is OFF)**, **payroll_lock_on_unresolved_mismatch 0**, doj_holiday_exclusion_enabled 1, missing_punch_notification_enabled 1, week_off_worked_wfm_review_required 1 |

### E10 — Cost centre granularity

`cost_centre_master` holds 937 rows but only **30 distinct cost centres carry any active employee**:
BSS/BO/NOIDA-2/576 264, BSS/OB/AHMH-JD/465 155, BSS/IB/Noida/647 111, BSS/OB/Noida/592 105,
BSS/OB/AHMH-JD/919 84, then a long tail to 1. `cost_centre_master` carries branch_id, department_id,
process_id, client_id and lob_id, so cost centre already implies branch, department and process. This
supports cost centre leading Dimension_Priority_Order, and it also means a cost-centre-scoped rule and a
process-scoped rule can encode contradictory intent about the same population.

### E11 — The current daily aggregation is arithmetically broken

| Fact | Measurement |
| --- | --- |
| `apr` size | 48,912 rows over 36,594 distinct employee-days, keyed (ReportDate, UserID, campaign_id), 78 distinct `campaign_id` |
| Rows per employee-day | 1 row 27,956 days; 2 rows 7,806; 3 rows 735; 4 rows 95; 5 rows 2 |
| Multi-row employee-days | **8,638 (23.6%)** |
| Result of summing net login | 3,603 employee-days over 10 hours; 2,505 over 12 hours; **218 over 24 hours — physically impossible** |
| Maximum summed day | **6,282.8 minutes (104.7 hours)** |
| Excess over largest single session | 3,552 of the 8,638 multi-row days exceed it by 60+ minutes; average excess 124.5 minutes |

Real concurrent-session examples: MAS60586 on 2026-04-08 across CHAT 00:57:43 + EMAIL 09:07:02 + INBOUND
09:03:53 + OUTBOUND 07:28:16 (26h36m summed); MAS63067 on 2026-08-06 across ABANDON / KANNADA / KERALA /
TAMIL / TELUGU; MAS60804 on 2026-06-01 across KANNADA / KERALA / TAMIL / TELUGU (16h30m summed). These
are concurrent logins to different campaigns or diallers, not sequential shifts, so summing inflates
productive time and defeats a control whose purpose is to catch inflated attendance.

### E12 — Manual upload already happens, and it is completely unattributed

| Fact | Measurement |
| --- | --- |
| `apr.source` | `enum('sync','manual')`. sync 42,353 rows / 503 users / 2026-03-13 to 2026-08-29. manual 3,810 rows / 224 users / 2026-08-01 to 2026-08-25 |
| Manual `campaign_id` | **`'MANUAL_UPLOAD'` on all 3,810 rows** — a single sentinel. The originating dialler system is recorded nowhere |
| Manual attribution | 0 distinct `process_name`, 0 distinct `branch_name` (all empty), 1 distinct `uploaded_by` |
| `apr.upload_batch_id` | **0 distinct values across the table; 46,163 rows NULL.** No audit trail of who uploaded which file |
| `apr_manual_upload` | Correct shape (id, employee_code, process_id, campaign_id, report_date, calls_handled, aht_seconds, login_minutes, bio_minutes, lunch_minutes, qa_minutes, training_minutes, uploaded_by, upload_batch_id, created_at) and **0 rows** — a dead path; manual data went straight into `apr` |
| `campaign_master` | **0 rows**, so the 78 `apr.campaign_id` values are unmanaged free text with no owning process or dialler |

### E13 — Only one dialler is integrated, and its identity column is unused

| Fact | Measurement |
| --- | --- |
| `dialer_session_log` | 1,365 rows, 64 employees, 2026-05-27 to 2026-08-28. Columns id, employee_code, employee_id, session_date, integration_key, dialer_name, login_minutes, process_name, branch_name, run_id, source_system, imported_by, created_at |
| `dialer_name` | **NULL on every row** |
| `integration_key` | exactly one: `'dialer_1'` |
| `source_system` | exactly one: `'dialer_db.vicidial_agent_log_249'` — a single ViciDial instance |
| Materiality | July 2026 ADR shows `dialer_session_log.session_date` on 7,366 rows against `apr.ReportDate` on 5,186 |
| Consequence | The schema anticipates multiple named diallers and records none. Three productivity feeds are in play (`apr`/sync, `apr`/manual, `dialer_session_log`) with no common source registry |

### E14 — The BPO metrics the consolidated view needs already exist

`apr` columns: ReportDate, UserID, campaign_id, Calls (int), WAIT_TIME, TALK_TIME, DISPO_TIME,
PAUSE_TIME, AHT, Login_Time, Logout_Time, Net_Login, LOGIN, BIO, LUNCH, QA, DISMX, TRAINING — all
TIME-typed except Calls — plus employee_name, process_name, branch_name, reporting_manager, cost_centre
(denormalised varchars), source, uploaded_by, upload_batch_id.

`apr_manual_upload` covers a narrower set: calls_handled, aht_seconds, login_minutes, bio_minutes,
lunch_minutes, qa_minutes, training_minutes. **A manual upload therefore cannot supply talk time, wait
time, dispo time, pause time or logout time**, which is why the consolidated view must show metric
availability per source rather than assume a uniform schema.

The biometric side for the same day comes from `attendance_daily_record.biometric_minutes` with
`clock_in_time` and `clock_out_time`.

`apr.UserID` joins to `employees.employee_code`: 727 distinct APR UserIDs, 671 match an employee, **56
resolve to no employee**.
