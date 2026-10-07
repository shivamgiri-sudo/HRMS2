# Implementation Plan: TDS Statutory E-Filing Integration

## Overview

This plan builds five new backend services (Deductor_Service, Challan_Service,
CSI_Import_Engine, Reconciliation_Engine, Return_File_Generator) and the
Quarterly_Return obligation tracker around the existing payroll TDS pipeline,
fixes the March due-date bug in `payroll-statutory-filing.routes.ts`, wires new
routes into `app.ts`, and surfaces everything in `StatutoryFilingTracker.tsx` /
`StatutoryCenter.tsx`. Work proceeds bottom-up: schema first, then each service
in dependency order (Deductor -> Challan -> CSI/Reconciliation), the isolated
due-date bugfix, obligation tracking, the Return_File_Generator (which depends
on all of the above), route wiring, frontend integration, and a final UAT task.

Backend code is TypeScript (matching the existing `backend/src/modules/payroll/`
codebase); property-based tests use `fast-check` per design.md's Testing
Strategy — `fast-check` is not yet a backend dependency and is added in Task 1.
`backend/src/modules/payroll-compliance/taxDeclaration.service.ts` and
`payrollCalculate.service.ts` are dead code and are not touched by any task
below.

## Tasks

- [x] 1. Add fast-check dev dependency and create SQL migration for all new tables
  - Add `fast-check` to `backend/package.json` devDependencies (pinned exact
    version) and install it
  - Create `backend/sql/migrations/{next}_tds_efiling_integration.sql` (find the
    next unused migration number) containing the `tds_deductor`,
    `tds_deductor_branch`, `tds_challan`, `tds_csi_import_batch`,
    `quarterly_return_obligation`, and `quarterly_return_file` tables exactly as
    specified in design.md's Data Models section (including all keys, FKs, and
    the `uk_tds_deductor_tan_active`, `uk_deductor_branch`,
    `uk_challan_cin_source`, `uk_qro_key` unique constraints)
  - Register the new migration filename in `MIGRATION_MANIFEST` in
    `backend/src/db/runPendingMigrations.ts` and in
    `backend/sql/MIGRATION_MANIFEST.lock.json`'s `released` list, following the
    existing manifest-registration pattern for prior migrations
  - _Requirements: 1.1, 1.2, 1.3, 3.1, 3.7, 5.1, 6.4_

- [ ] 2. Write the March TDS due-date backfill migration
  - [x] 2.1 Create `backend/sql/{next}_correct_march_tds_due_date.sql`
    - One-time backfill: for every `statutory_filing_record` row where
      `filing_type IN ('TDS_24Q','TDS_138')`, `filing_month LIKE '%-03'`, and
      `due_date` is the 7th of April, correct `due_date` to the 30th of April
      of the same calendar year
    - Register this migration in the manifest the same way as Task 1
    - _Requirements: 4.3_

  - [ ]* 2.2 Write an integration test asserting the backfill migration corrects a fixture row
    - Seed a `statutory_filing_record` row with `filing_month = '2026-03'`,
      `filing_type = 'TDS_24Q'`, `due_date = '2026-04-07'`, run the migration,
      assert `due_date` becomes `2026-04-30`
    - _Requirements: 4.3_

- [ ] 3. Checkpoint - Ensure schema migrations apply cleanly
  - Run `npm run migrate` (or the project's migration runner) against a test
    database and confirm both new migrations from Tasks 1 and 2 apply without
    error. Ensure all tests pass, ask the user if questions arise.

- [ ] 4. Implement Deductor_Service core CRUD and validation
  - [ ] 4.1 Create `backend/src/modules/payroll/tds-deductor.service.ts` with input validation
    - Implement `createDeductor`, `updateDeductor`, `deactivateDeductor`,
      `findActiveDeductorForScope`, `listDeductors` per design.md's interface
    - Validate TAN against `AAAA99999A`, Responsible_Person PAN against the
      10-character PAN format, and field length limits (name 200, address 500,
      RP name 150, RP designation 100)
    - Reject duplicate active TAN (409) and format violations (400) without
      persisting a row, naming the specific invalid/duplicate field
    - `findActiveDeductorForScope`: branch-mapped active TAN wins over an
      org-wide active TAN; returns `null` when neither exists
    - Call `writeSensitiveActionLog` (`shared/auditLog.ts`) on every
      create/update/deactivate with actor identity and changed fields
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 1.7, 1.8, 1.9_

  - [ ]* 4.2 Write property test for TAN record round trip and branch scoping
    - **Property 1: TAN record round trip and branch scoping**
    - **Validates: Requirements 1.1, 1.2, 1.3**

  - [ ]* 4.3 Write property test for invalid TAN format rejection
    - **Property 2: Invalid TAN format rejected**
    - **Validates: Requirements 1.4**

  - [ ]* 4.4 Write property test for invalid Responsible_Person PAN format rejection
    - **Property 3: Invalid Responsible_Person PAN format rejected**
    - **Validates: Requirements 1.5**

  - [ ]* 4.5 Write property test for duplicate active TAN rejection
    - **Property 4: Duplicate active TAN rejected**
    - **Validates: Requirements 1.8**

  - [ ]* 4.6 Write property test for deactivation excluding from active scope while preserving history
    - **Property 5: Deactivation excludes from active scope but preserves history**
    - **Validates: Requirements 1.9**

- [ ] 5. Implement Deductor_Service routes and access control
  - [ ] 5.1 Create `backend/src/modules/payroll/tds-deductor.routes.ts`
    - Mount `POST /api/payroll/tds-deductor`, `PATCH /api/payroll/tds-deductor/:id`,
      `POST /api/payroll/tds-deductor/:id/deactivate`, `GET /api/payroll/tds-deductor`
    - Gate all mutating routes (and the list route) with
      `requireRole("admin","super_admin","payroll_head","payroll","payroll_hr","finance")`,
      matching `tds-certificate-part-a.routes.ts`'s pattern
    - Use the shared `h()` error-wrapping helper and the `{ success:false, message }`
      response convention for validation/auth errors
    - _Requirements: 1.6, 12.1, 12.5_

  - [ ]* 5.2 Write unit/integration tests for Deductor_Service routes
    - `POST /api/payroll/tds-deductor` as `payroll_hr` succeeds; as an
      `employee`-only user returns 403 with no TAN fields in the body
    - _Requirements: 1.6, 12.1, 12.5_

  - [ ]* 5.3 Write property test for unauthorized access denial without data leakage (deductor scope)
    - **Property 47: Access control denies unauthorized actors without leaking data**
    - **Validates: Requirements 1.6, 12.1, 12.2, 12.5, 8.6**

- [ ] 6. Implement Form 16/130 Part B TAN-dependency behavior
  - [ ] 6.1 Wire `findActiveDeductorForScope` into the existing Form 16/130 Part B generation path
    - Populate TAN and Responsible_Person name/designation from the resolved
      active deductor when one exists for the employee's branch/org scope
    - When no active TAN resolves, populate those fields with an explicit,
      constant missing-data sentinel (never blank/null/fabricated) and add the
      employee and scope to a data-completeness report accompanying the
      generation output
    - _Requirements: 2.2, 2.3, 2.4_

  - [ ]* 6.2 Write property test for active TAN populating Form 16/130 Part B correctly
    - **Property 7: Active TAN populates Form 16/130 Part B correctly**
    - **Validates: Requirements 2.2**

  - [ ]* 6.3 Write property test for missing-TAN sentinel value
    - **Property 8: Missing TAN produces an explicit sentinel, never a fabricated or blank value**
    - **Validates: Requirements 2.3**

  - [ ]* 6.4 Write property test for completeness-report coverage
    - **Property 9: Missing-TAN employees are always surfaced in the completeness report**
    - **Validates: Requirements 2.4**

- [ ] 7. Checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [ ] 8. Implement Challan_Service structured capture and CIN derivation
  - [ ] 8.1 Create `backend/src/modules/payroll/tds-challan.service.ts` with `deriveCin` and validation
    - Implement `deriveCin(bsrCode, challanTenderDate, challanSerialNumber)` as
      a pure function: concatenation of BSR code + `DDMMYYYY(tenderDate)` +
      serial number, no other transformation
    - Implement `recordChallan`, `updateChallan`, `listChallansForObligation`
    - Validate BSR code (exactly 7 digits), serial number (positive integer,
      <=5 digits), tender date (within `[1st of filingMonth, today]`), amount
      (0.01–999,999,999.99, <=2 decimals), and reject missing required fields,
      each naming the offending field on rejection (400), nothing persisted
    - Reject a submission whose derived CIN matches an existing
      `payroll_entered` challan's CIN for the same deductor (409), nothing
      persisted
    - Call `writeSensitiveActionLog` on create/modify with actor identity, CIN,
      amount, and (for updates) prior/updated values of changed fields
    - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 3.7, 3.8, 3.9_

  - [ ]* 8.2 Write property test for challan structured field round trip
    - **Property 10: Challan structured fields round trip**
    - **Validates: Requirements 3.1**

  - [ ]* 8.3 Write property test for BSR code format validation
    - **Property 11: BSR code format validation**
    - **Validates: Requirements 3.2**

  - [ ]* 8.4 Write property test for challan serial number format validation
    - **Property 12: Challan serial number format validation**
    - **Validates: Requirements 3.3**

  - [ ]* 8.5 Write property test for challan tender date window validation
    - **Property 13: Challan tender date window validation**
    - **Validates: Requirements 3.4**

  - [ ]* 8.6 Write property test for deposited amount format validation
    - **Property 14: Deposited amount format validation**
    - **Validates: Requirements 3.5**

  - [ ]* 8.7 Write property test for missing required field naming
    - **Property 15: Missing required field is named in the rejection**
    - **Validates: Requirements 3.6**

  - [ ]* 8.8 Write property test for deterministic CIN derivation
    - **Property 16: CIN derivation is a deterministic concatenation**
    - **Validates: Requirements 3.7**

  - [ ]* 8.9 Write property test for duplicate CIN rejection among payroll-entered challans
    - **Property 17: Duplicate CIN among payroll-entered challans rejected**
    - **Validates: Requirements 3.8**

- [ ] 9. Implement Challan_Service routes
  - [ ] 9.1 Create `backend/src/modules/payroll/tds-challan.routes.ts`
    - Mount `POST /api/payroll/tds-challan`, `PATCH /api/payroll/tds-challan/:id`,
      `GET /api/payroll/tds-challan?deductorId=&financialYear=&quarter=`
    - Gate with the same `PAYROLL_ROLES` set as Deductor_Service routes
    - _Requirements: 12.1, 12.5_

  - [ ]* 9.2 Write unit/integration tests for Challan_Service routes
    - Role-gated access matrix and a 409 duplicate-CIN response body check
    - _Requirements: 12.1, 12.5_

- [ ] 10. Checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [ ] 11. Implement CSI_Import_Engine parsing
  - [ ] 11.1 Create `backend/src/modules/payroll/tds-csi-import.service.ts` with `parseCsiFile`
    - Parse CSI text into `{ bsrCode, challanTenderDate, challanSerialNumber,
depositedAmount, tan }` records
    - All-or-nothing: any line/field that fails to match the expected
      structure throws `CsiParseError` naming the failing line/field, and
      nothing from the upload is persisted
    - Reject (whole-file) any record whose TAN differs from `expectedTan`, or
      whose tender date falls outside `dateRange`, naming the mismatch
    - _Requirements: 6.1, 6.2, 6.3_

  - [ ]* 11.2 Write property test for CSI file parse round trip
    - **Property 26: CSI file parse round trip**
    - **Validates: Requirements 6.1**

  - [ ]* 11.3 Write property test for malformed/oversized CSI upload atomic rejection
    - **Property 27: Malformed or oversized CSI upload is rejected atomically**
    - **Validates: Requirements 6.2**

  - [ ]* 11.4 Write property test for TAN/date-range mismatch rejecting the whole upload
    - **Property 28: TAN or date-range mismatch rejects the whole upload**
    - **Validates: Requirements 6.3**

- [ ] 12. Implement CSI_Import_Engine persistence, idempotence, and upload route
  - [ ] 12.1 Implement `importCsiFile` in `tds-csi-import.service.ts`
    - Enforce the 10 MB limit via multer (`limits: { fileSize: 10 * 1024 *
1024 }`, matching `tds-certificate-part-a.routes.ts`'s limiter)
    - Call `parseCsiFile`, then persist each record as `source = 'traces_csi'`,
      skipping (not erroring on) any record whose derived CIN already exists
      as a `traces_csi` row for that deductor
    - Record the import batch in `tds_csi_import_batch` (date range, filename,
      counts, actor)
    - Call `writeSensitiveActionLog` with actor identity, TAN, date range, and
      imported count
    - Mount `POST /api/payroll/tds-challan/csi-import` (multipart, same
      `PAYROLL_ROLES` set) from `tds-challan.routes.ts`
    - _Requirements: 6.4, 6.5, 6.6, 12.1, 12.5_

  - [ ]* 12.2 Write property test for payroll-entered/TRACES-sourced separation
    - **Property 29: Payroll-entered and TRACES-sourced challans remain distinct and both retained**
    - **Validates: Requirements 6.4**

  - [ ]* 12.3 Write property test for per-CIN import idempotence
    - **Property 30: CSI import is idempotent per CIN**
    - **Validates: Requirements 6.5**

  - [ ]* 12.4 Write unit test for CSI import of a real (anonymized) sample file layout
    - Assert the expected record count is imported
    - _Requirements: 6.1_

- [ ] 13. Implement Reconciliation_Engine matching and read-side summary
  - [ ] 13.1 Create `backend/src/modules/payroll/tds-reconciliation.service.ts`
    - Implement `normalizeCin` (trim + uppercase) as the single place the
      case/whitespace-insensitive CIN comparison rule lives; import it in
      `tds-challan.service.ts` and `tds-csi-import.service.ts` wherever a CIN
      is compared
    - Implement `reconcileForDeductor`: for every `payroll_entered` challan
      without a terminal status, find a `traces_csi` record with equal
      `normalizeCin`; no match -> `unmatched`; match with equal amounts ->
      `reconciled` (`matched_challan_id` set); match with differing amounts ->
      `amount_discrepancy` (`discrepancy_amount` stored, stays outside
      `reconciled`)
    - Implement `reconciliationSummaryForObligation(deductorId,
financialYearStart, quarter)` returning `allReconciled`, the per-challan
      status list, and `tracesOnlyDeposits` — this is the single read path
      every gate (generation, Form 27A, mark-as-filed) will call
    - Call `reconcileForDeductor` from `importCsiFile` after a successful
      import, for every affected filing month/quarter (update Task 12.1's
      implementation)
    - _Requirements: 7.1, 7.2, 7.3, 7.4, 7.5, 7.6_

  - [ ]* 13.2 Write property test for CIN-normalized matching with amount comparison
    - **Property 32: CIN-normalized reconciliation matching with amount comparison**
    - **Validates: Requirements 7.1, 7.3**

  - [ ]* 13.3 Write property test for surfacing unmatched payroll-entered challans
    - **Property 33: Unmatched payroll-entered challans are surfaced**
    - **Validates: Requirements 7.2**

  - [ ]* 13.4 Write property test for surfacing TRACES deposits with no payroll record
    - **Property 34: TRACES deposits with no payroll record are surfaced**
    - **Validates: Requirements 7.4**

  - [ ]* 13.5 Write property test for the reconciliation gate enumerating every unmet condition
    - **Property 35: The reconciliation gate blocks every downstream action until every challan is reconciled, and names every unmet condition**
    - **Validates: Requirements 7.5, 7.6, 8.3, 10.4, 11.2, 11.3**
    - Note: only the gate's own enumeration behavior is testable at this
      point; full exercise of all three call sites completes once
      Return_File_Generator and obligation mark-as-filed exist (Tasks 17, 19)

- [ ] 14. Checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [ ] 15. Fix the March TDS deposit due-date bug in payroll-statutory-filing.routes.ts
  - [ ] 15.1 Update `defaultDueDate()` in `backend/src/modules/payroll/payroll-statutory-filing.routes.ts`
    - For `TDS_24Q`/`TDS_138`, branch on filing month: March returns
      `${yr}-04-30`; every other month (including the December -> January
      rollover) keeps the existing 7th-of-next-month logic
    - _Requirements: 4.1, 4.2_

  - [ ] 15.2 Extend the existing GET list route's status computation to self-heal incorrect March due dates
    - When the route's in-memory recomputation encounters a
      `statutory_filing_record` row for a March TDS_Deposit whose stored due
      date is the 7th of April, correct `due_date` in the database to the 30th
      of April of the same year, then evaluate `overdue` against the corrected
      due date (clearing any overdue flag that only held under the incorrect
      date)
    - _Requirements: 4.3, 4.4_

  - [ ]* 15.3 Write pinning unit test for the March due-date fix
    - `defaultDueDate("2026-03", "TDS_24Q")` returns `2026-04-30`, mirroring
      the existing pinning-test style (e.g. `pf_wage_limit`'s regression test)
    - _Requirements: 4.1, 4.2_

  - [ ]* 15.4 Write property test for TDS deposit due-date computation
    - **Property 18: TDS deposit due-date computation**
    - **Validates: Requirements 4.1, 4.2**

  - [ ]* 15.5 Write property test for correcting existing incorrect March due dates on recomputation
    - **Property 19: Existing incorrect March due dates are corrected on recomputation**
    - **Validates: Requirements 4.3**

  - [ ]* 15.6 Write property test for overdue-status consistency with the current due date
    - **Property 20: Overdue status is always consistent with the current due date**
    - **Validates: Requirements 4.4**

- [ ] 16. Implement Quarterly_Return obligation tracking service and routes
  - [ ] 16.1 Create `backend/src/modules/payroll/tds-quarterly-obligation.service.ts`
    - Implement `initializeQuarterlyObligation(deductorId, financialYearStart,
quarter)`: due date is the last day of the month following quarter end
      for Q1/Q2/Q3, 31 May of the same calendar year for Q4; form designation
      via `statutoryRegimeForFinancialYear(financialYearStart)`; `INSERT
IGNORE` on `(deductor_id, financial_year_start, quarter)` for
      idempotence, matching the existing `initialize/:month` route's pattern
    - Implement `markObligationFiled(obligationId, acknowledgementNumber,
actorUserId)`: call `reconciliationSummaryForObligation` (from Task
      13.1) and deny (enumerating every unmet condition) unless a
      `quarterly_return_file` is linked, at least one challan is associated,
      every associated challan is reconciled, and
      `acknowledgementNumber` is present and <=50 chars; on success set
      `status='filed'`, `filed_by`, `filed_at`, store the acknowledgement
      number verbatim
    - _Requirements: 5.1, 5.2, 5.3, 5.4, 5.7, 11.2, 11.3, 11.4, 11.5, 11.6_

  - [ ] 16.2 Create `backend/src/modules/payroll/tds-quarterly-obligation.routes.ts`
    - Mount `POST /api/payroll/tds-quarterly-return-obligation/initialize`,
      `GET /api/payroll/tds-quarterly-return-obligation?deductorId=&financialYear=`,
      `PATCH /api/payroll/tds-quarterly-return-obligation/:id/mark-filed`
    - Gate `mark-filed` with the same role set as the existing `mark-filed`
      route (`admin`, `super_admin`, `finance`, `payroll_head`); gate
      initialize/list with the full `PAYROLL_ROLES` set
    - _Requirements: 12.1, 12.2, 12.5_

  - [ ]* 16.3 Write property test for the obligation key being structurally distinct from the monthly obligation
    - **Property 21: Quarterly_Return obligation key is structurally distinct from the monthly obligation**
    - **Validates: Requirements 5.1**

  - [ ]* 16.4 Write property test for Quarterly_Return due-date computation
    - **Property 22: Quarterly_Return due-date computation**
    - **Validates: Requirements 5.2, 5.3**

  - [ ]* 16.5 Write property test for consistent form-designation resolution
    - **Property 23: Form designation is resolved consistently everywhere it appears**
    - **Validates: Requirements 5.4, 8.5, 10.1**
    - Note: full exercise (return file + Form 27A tagging) completes once
      Return_File_Generator exists (Task 17)

  - [ ]* 16.6 Write property test for obligation initialization idempotence
    - **Property 25: Obligation initialization is idempotent**
    - **Validates: Requirements 5.7**

  - [ ]* 16.7 Write property test for acknowledgement/receipt number validation on mark-as-filed
    - **Property 46: Acknowledgement/receipt number validation on mark-as-filed**
    - **Validates: Requirements 11.4, 11.5, 11.6**

- [ ] 17. Checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [ ] 18. Implement Return_File_Generator: Annexure building and generation gate
  - [ ] 18.1 Create `backend/src/modules/payroll/tds-return-file-generator.service.ts` skeleton and generation gate
    - Implement the entry of `generateQuarterlyReturn(deductorId,
financialYearStart, quarter, actorUserId)`: call
      `findActiveDeductorForScope`-equivalent TAN resolution, then
      `reconciliationSummaryForObligation` (the reconciliation gate); refuse
      (nothing persisted) when no active TAN, reconciliation incomplete
      (enumerating every unreconciled challan), the statutory regime cannot be
      resolved for `financialYearStart`, or Responsible_Person
      name/designation/PAN is missing
    - _Requirements: 2.1, 2.5, 8.3, 8.6, 8.8_

  - [ ] 18.2 Implement Annexure I and Annexure II builders
    - Annexure I: one row per `reconciled` `payroll_entered` challan for the
      deductor+quarter (BSR code, tender date, serial number, amount, CIN)
    - Annexure II: one row per employee under the TAN's branch scope with a
      finalized `salary_prep_run`/`salary_prep_line` for the financial year to
      date, reusing `CLOSED_RUN_STATUSES`/`run-status.ts`'s case-insensitive
      check; exclude (and report in `excludedEmployees`) any employee with an
      empty `resolvePii(pan_number_encrypted, pan_number)` result
      (`missing_pan`) or no finalized line for the quarter
      (`payroll_not_finalized`)
    - _Requirements: 8.1, 8.2, 8.4, 8.7_

  - [ ]* 18.3 Write property test for Annexure I built from exactly the reconciled challans
    - **Property 36: Annexure I is built from exactly the reconciled challans**
    - **Validates: Requirements 8.1**

  - [ ]* 18.4 Write property test for Annexure II inclusion/exclusion rules
    - **Property 37: Annexure II inclusion and exclusion rules**
    - **Validates: Requirements 8.2, 8.4, 8.7**

  - [ ]* 18.5 Write property test for unresolvable statutory regime refusing generation with a specific reason
    - **Property 38: Unresolvable statutory regime refuses generation with a specific reason**
    - **Validates: Requirements 8.8**

  - [ ]* 18.6 Write property test for missing active TAN blocking generation without a placeholder
    - **Property 6: Missing active TAN blocks generation and never yields a placeholder**
    - **Validates: Requirements 2.1, 2.5**

- [ ] 19. Implement FVU-style file generation and self-validation parse-back
  - [ ] 19.1 Implement the BH/CD/DD/FT file generator in `tds-return-file-generator.service.ts`
    - Emit the pipe-delimited `BH|...`, `CD|...`, `DD|...`, `FT|...` structure
      exactly as specified in design.md's "FVU-compatible file layout" section
    - Tag the file's form designation via
      `statutoryRegimeForFinancialYear(financialYearStart).quarterlyReturnForm`
    - _Requirements: 8.5_

  - [ ] 19.2 Implement `parseQuarterlyReturnFile` as the structural inverse of the generator
    - Parse `BH`/`CD`/`DD`/`FT` records back into `ParsedReturnFile` (challans,
      deductees, trailer totals), same record-type prefixes and field order as
      the generator
    - _Requirements: 9.1_

  - [ ] 19.3 Implement `selfValidate` and wire it unconditionally into `generateQuarterlyReturn`
    - `generateQuarterlyReturn` always calls `parseQuarterlyReturnFile` on its
      own output and `selfValidate` against the reconciled-challan sum and
      finalized-employee count, before persisting anything — no `if` gate, no
      configuration flag
    - Tax-total check: withhold the file (no vault entry, no token) and report
      both parsed-back and expected totals when the difference exceeds ₹1;
      otherwise proceed
    - Deductee-count check: withhold the file and report both counts on
      mismatch; otherwise proceed
    - _Requirements: 9.2, 9.3, 9.4_

  - [ ]* 19.4 Write property test for self-validation parse-back reproducing source Annexure entries
    - **Property 40: Self-validation parse-back reproduces the source Annexure entries**
    - **Validates: Requirements 9.1**

  - [ ]* 19.5 Write property test for the self-validation tax-total tolerance check
    - **Property 41: Self-validation tax-total tolerance check**
    - **Validates: Requirements 9.2**

  - [ ]* 19.6 Write property test for the self-validation deductee-count check
    - **Property 42: Self-validation deductee-count check**
    - **Validates: Requirements 9.3**

- [ ] 20. Checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [ ] 21. Implement Form 27A control chart generation
  - [ ] 21.1 Implement Form 27A generation in `tds-return-file-generator.service.ts`
    - Generate the Form 27A chart in the same call as the return file, from
      the same reconciled/finalized data already assembled (never
      independently re-derived), containing TAN, Responsible_Person
      name/designation/PAN, total deductee count, total amount paid, total tax
      deducted
    - Block generation of both artifacts (before any file is written, existing
      Deductor_Service record left untouched) when any Responsible_Person
      field is missing, identifying which field
    - _Requirements: 10.1, 10.2, 10.3_

  - [ ]* 21.2 Write property test for Form 27A content and totals agreeing with the return file
    - **Property 43: Form 27A content and totals agree with the Quarterly_Return file**
    - **Validates: Requirements 10.1, 10.3**

  - [ ]* 21.3 Write property test for missing Responsible_Person detail blocking Form 27A
    - **Property 44: Missing Responsible_Person detail blocks Form 27A and preserves existing data**
    - **Validates: Requirements 10.2**

- [ ] 22. Implement document-vault storage, supersession, and combined download
  - [ ] 22.1 Wire vault registration and single-response download tokens
    - Register both generated files via `registerUpload()`
      (`document-vault/documentVault.service.ts`) with
      `category: "quarterly_return_file"` / `"form_27a_chart"`,
      `accessLevel: "payroll"`; issue download tokens via `issueDownloadToken()`
    - Persist a `quarterly_return_file` row only after self-validation passes;
      on a prior file existing for the obligation, set its `superseded_at` and
      point the obligation's `current_file_id` at the new file
    - Return both `quarterlyReturnDownloadUrl` and `form27aDownloadUrl` in a
      single `GenerateResult` response
    - Update `quarterly_return_obligation.current_file_id` (linking replaces
      any previously linked file id for that obligation)
    - Call `writeSensitiveActionLog` on generation and on download with actor
      identity, TAN, and financial-year quarter
    - _Requirements: 8.6, 8.9, 10.5, 11.1, 12.2, 12.3_

  - [ ]* 22.2 Write property test for regeneration always superseding the prior file
    - **Property 39: Regeneration always supersedes the prior file, at most one current file per obligation**
    - **Validates: Requirements 8.9, 11.1**

  - [ ]* 22.3 Write property test for the return file and Form 27A always being offered together
    - **Property 45: Quarterly_Return file and Form 27A are always offered together**
    - **Validates: Requirements 10.5**

  - [ ]* 22.4 Write property test for every sensitive action producing a matching audit entry
    - **Property 31: Every sensitive action produces a matching audit entry**
    - **Validates: Requirements 1.7, 3.9, 6.6, 12.3, 12.4**

  - [ ]* 22.5 Write unit test for document-vault registration category/access-level and download round trip
    - Assert `category: "quarterly_return_file"`, `accessLevel: "payroll"`,
      and that the returned download URL round-trips through the existing
      token-consuming file route
    - _Requirements: 8.6_

- [ ] 23. Implement Return_File_Generator routes
  - [ ] 23.1 Create `backend/src/modules/payroll/tds-return-file-generator.routes.ts`
    - Mount `POST /api/payroll/tds-quarterly-return/:deductorId/:financialYear/:quarter/generate`
      and `GET /api/payroll/tds-quarterly-return/:deductorId/:financialYear/:quarter`
    - Gate with the `PAYROLL_ROLES` set, scoped to the TAN's branch/org scope
      via `hasScopedAccess`
    - Include the manual-upload disclaimer text alongside the generate
      response body
    - _Requirements: 12.2, 12.5, 13.2_

  - [ ]* 23.2 Write unit test asserting "at least one challan" is a distinct unmet condition from "all reconciled"
    - `generateQuarterlyReturn` for a quarter with zero associated challans is
      refused by the reconciliation gate with the "at least one challan"
      condition, distinct from "all reconciled"
    - _Requirements: 7.6, 11.3_

  - [ ]* 23.3 Write example-based tests for the manual-upload disclaimer
    - Assert the disclaimer is present and non-empty on the generate response
    - _Requirements: 13.2_

  - [ ]* 23.4 Write property test for access control denying unauthorized actors on generation/download
    - **Property 47: Access control denies unauthorized actors without leaking data** (full exercise, generation/download scope)
    - **Validates: Requirements 1.6, 12.1, 12.2, 12.5, 8.6**

  - [ ]* 23.5 Write property test for reconciliation gate enumeration across all three call sites
    - **Property 35: The reconciliation gate blocks every downstream action until every challan is reconciled, and names every unmet condition** (full exercise: generate, Form 27A, mark-as-filed)
    - **Validates: Requirements 7.5, 7.6, 8.3, 10.4, 11.2, 11.3**

  - [ ]* 23.6 Write property test for consistent form-designation resolution (full exercise)
    - **Property 23: Form designation is resolved consistently everywhere it appears** (full exercise across obligation, return file, Form 27A)
    - **Validates: Requirements 5.4, 8.5, 10.1**

- [ ] 24. Checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [ ] 25. Implement static architecture assertions for no-programmatic-submission guarantees
  - [ ] 25.1 Write a small fixed integration/static check enumerating routes on the new routers
    - Assert no route registered by `tds-deductor.routes.ts`,
      `tds-challan.routes.ts`, `tds-quarterly-obligation.routes.ts`, or
      `tds-return-file-generator.routes.ts` calls out to any
      TRACES/TIN-FC/e-filing network endpoint, and that no route other than
      `PATCH /:id/mark-filed` sets `status = 'filed'`
    - _Requirements: 13.1, 13.3, 13.4_

  - [ ]* 25.2 Write property test for filed status displayed only after the manual mark-as-filed action
    - **Property 48: Filed status is displayed only after the manual mark-as-filed action**
    - **Validates: Requirements 13.5**

- [ ] 26. Wire all new routers into app.ts
  - [ ] 26.1 Register the four new routers in `backend/src/app.ts`
    - Import and mount `tdsDeductorRouter`, `tdsChallanRouter`,
      `tdsQuarterlyObligationRouter`, `tdsReturnFileGeneratorRouter` following
      the existing import/mount pattern used for `tdsCertificatePartARouter`
      and `payrollStatutoryFilingRouter`
    - _Requirements: 12.1, 12.2_

  - [ ]* 26.2 Write a route-contract test confirming all new endpoints are reachable and role-gated
    - Extend the existing route-contract test suite
      (`src/platform/__tests__/route-contract.test.ts` pattern) to cover the
      new endpoints
    - _Requirements: 12.1, 12.2, 12.5_

- [ ] 27. Checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [ ] 28. Integrate Deductor, Challan, and CSI import UI into StatutoryCenter.tsx
  - [ ] 28.1 Add a Deductor (TAN) management panel to `StatutoryCenter.tsx`
    - Form to create/update/deactivate a TAN record with branch selection,
      calling the Task 5 routes; list view of active/inactive TANs
    - _Requirements: 1.1, 1.2, 1.3, 1.6_

  - [ ] 28.2 Add a challan entry and CSI import panel to `StatutoryCenter.tsx`
    - Structured challan entry form (BSR code, tender date, serial number,
      amount) calling the Task 9 routes; CSI file upload control calling the
      Task 12 upload route; display reconciliation status per challan
      (`reconciled`/`unmatched`/`amount_discrepancy`) and the "deposit with no
      filed record" list from `reconciliationSummaryForObligation`
    - _Requirements: 3.1, 6.1, 7.2, 7.4_

  - [ ]* 28.3 Write a component/integration test for the deductor and challan panels
    - Verify form submission calls the expected endpoints and renders
      validation errors returned by the API
    - _Requirements: 1.4, 1.5, 3.2, 3.3, 3.4, 3.5, 3.6_

- [ ] 29. Integrate Quarterly_Return obligation display and generation into StatutoryFilingTracker.tsx
  - [ ] 29.1 Add a Quarterly_Return obligation section to `StatutoryFilingTracker.tsx`
    - Fetch and render obligations from
      `GET /api/payroll/tds-quarterly-return-obligation`, distinct from the
      existing monthly `statutory_filing_record` rows already shown; display
      due date, form designation, generation timestamp (if a file has been
      generated), and filed status only once `markObligationFiled` has
      succeeded
    - _Requirements: 5.5, 5.6, 13.5_

  - [ ] 29.2 Add "Generate Quarterly Return" and "Mark as Filed" actions
    - Generate action calls the Task 23 generate route, surfaces the combined
      download links (return file + Form 27A) and the manual-upload
      disclaimer in one response/UI action, and displays any reconciliation
      gate / self-validation / missing-TAN error with every unmet condition
      listed
    - "Mark as Filed" dialog collects the acknowledgement/receipt number
      (<=50 chars) and calls the Task 16 mark-filed route, surfacing every
      unmet-condition message on denial
    - _Requirements: 8.3, 9.2, 9.3, 10.4, 10.5, 11.2, 11.3, 11.4, 11.5, 11.6, 13.2_

  - [ ]* 29.3 Write a component/integration test for the obligation section and generate/mark-filed actions
    - Verify the filed-status label never renders before a successful
      mark-as-filed call, and that the disclaimer renders alongside the
      download links
    - _Requirements: 13.2, 13.5_

- [ ] 30. Checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [ ] 31. Final end-to-end UAT sign-off
  - Run the complete flow against the actual dev/staging environment (not
    mocked fixtures): TAN setup -> challan entry -> CSI import -> reconciliation
    -> quarterly return + Form 27A generation -> self-validation -> mark-as-filed
  - Confirm Requirement 4's March due-date fix against real existing
    `statutory_filing_record` data in that environment (a March TDS_Deposit row
    previously carrying the incorrect 7-April due date reads as 30-April and is
    not flagged overdue if compliant under the corrected date)
  - Record and report any defect found during this pass; do not close this task
    until the full flow completes without a defect blocking any step
  - _Requirements: 1.1-1.9, 2.1-2.5, 3.1-3.9, 4.1-4.4, 5.1-5.7, 6.1-6.6, 7.1-7.6, 8.1-8.9, 9.1-9.4, 10.1-10.5, 11.1-11.6, 12.1-12.5, 13.1-13.5_

## Notes

- Tasks marked with `*` are optional test sub-tasks and can be skipped for a
  faster MVP; they are never implemented by the automated task-execution agent
  when postfixed `*`.
- Every non-test task references the specific requirement sub-clauses it
  satisfies; property-test sub-tasks reference the design document's property
  number and the requirement clauses that property validates.
- `backend/src/modules/payroll-compliance/taxDeclaration.service.ts` and
  `payrollCalculate.service.ts` are not referenced by any task above — they
  remain untouched dead code, per the explicit exclusion for this feature.
- Checkpoints (Tasks 3, 7, 10, 14, 17, 20, 24, 27, 30) are placed after each
  major component so failures are caught close to their source before the next
  component builds on top of them.
- Task 31 is the only task that runs against a real dev/staging environment
  rather than test fixtures/mocks, and is the sole UAT sign-off gate for the
  whole feature.

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["2.1", "4.1", "8.1", "11.1", "13.1", "15.1"] },
    {
      "id": 1,
      "tasks": [
        "2.2",
        "4.2",
        "4.3",
        "4.4",
        "4.5",
        "4.6",
        "5.1",
        "8.2",
        "8.3",
        "8.4",
        "8.5",
        "8.6",
        "8.7",
        "8.8",
        "8.9",
        "11.2",
        "11.3",
        "11.4",
        "13.2",
        "13.3",
        "13.4",
        "15.2",
        "15.3",
        "15.4",
        "15.5",
        "15.6",
        "16.1"
      ]
    },
    { "id": 2, "tasks": ["5.2", "5.3", "6.1", "9.1", "12.1", "13.5", "16.2"] },
    {
      "id": 3,
      "tasks": [
        "6.2",
        "6.3",
        "6.4",
        "9.2",
        "12.2",
        "12.3",
        "12.4",
        "16.3",
        "16.4",
        "16.5",
        "16.6",
        "16.7",
        "18.1"
      ]
    },
    { "id": 4, "tasks": ["18.2"] },
    { "id": 5, "tasks": ["18.3", "18.4", "18.5", "18.6", "19.1"] },
    { "id": 6, "tasks": ["19.2"] },
    { "id": 7, "tasks": ["19.3"] },
    { "id": 8, "tasks": ["19.4", "19.5", "19.6", "21.1"] },
    { "id": 9, "tasks": ["21.2", "21.3", "22.1"] },
    { "id": 10, "tasks": ["22.2", "22.3", "22.4", "22.5", "23.1"] },
    { "id": 11, "tasks": ["23.2", "23.3", "23.4", "23.5", "23.6", "25.1"] },
    { "id": 12, "tasks": ["25.2", "26.1"] },
    { "id": 13, "tasks": ["26.2"] },
    { "id": 14, "tasks": ["28.1"] },
    { "id": 15, "tasks": ["28.2", "29.1"] },
    { "id": 16, "tasks": ["28.3", "29.2"] },
    { "id": 17, "tasks": ["29.3"] },
    { "id": 18, "tasks": ["31"] }
  ]
}
```
