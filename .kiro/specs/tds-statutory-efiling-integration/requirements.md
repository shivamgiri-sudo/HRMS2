# Requirements Document

## Introduction

This feature replaces the manual-only statutory filing tracker for salary TDS with a system that captures a complete, auditable filing record and generates the government-prescribed files that payroll staff currently have to assemble by hand.

**Scope decision (confirmed with stakeholder):** TRACES does not expose a public e-filing API that arbitrary third-party payroll software can call, so this feature does not perform, and must not claim to perform, programmatic submission of a quarterly TDS return to TRACES or the income-tax e-filing portal. Within that constraint, "real e-filing integration" means:

1. **Structured file generation** — the System generates an FVU-compatible quarterly TDS return text file (Form 24Q under the Income-tax Act, 1961, or Form 138 under the Income-tax Act, 2025, chosen per the financial year being filed) and the accompanying Form 27A control chart, built from actual finalized payroll data, ready for a human to upload to the TRACES/TIN-FC portal.
2. **Complete, structured manual-workflow data** — the System captures the employer's TAN (Tax Deduction and Collection Account Number), captures deposited-challan data as structured, validated fields instead of a free-text string, and reconciles those challans against the OLTAS Challan Status Inquiry (CSI) file the employer downloads from TRACES, instead of relying on a payroll user's typed challan number as the only record of what was actually deposited.

This feature extends the existing payroll TDS pipeline (`taxEngine.service.ts`, `payrollCalculate.service.ts`, `statutory-regime.ts`, the Form 16/130 Part B generation endpoint, and the TDS certificate Part A upload/verify workflow under `tds-certificate-part-a.*`) and the existing statutory filing tracker (`payroll-statutory-filing.routes.ts`, table `statutory_filing_record`, and the `StatutoryFilingTracker.tsx` / `StatutoryCenter.tsx` frontend). It does not rebuild any of these. It does not modify, extend, or route through `backend/src/modules/payroll-compliance/taxDeclaration.service.ts` or `backend/src/modules/payroll-compliance/payrollCalculate.service.ts`, both of which are unused or dead code with no bearing on the live payroll engine.

**Correction to the source audit's terminology:** the audit's scope note refers to "BIN" data. A Book Identification Number (BIN) applies only to government deductors who deposit TDS by book adjustment under Form 24G; a private-sector deductor such as this employer deposits TDS by challan, identified by a Challan Identification Number (CIN) — BSR code, challan tender date, and challan serial number. This document uses CIN, not BIN, throughout.

**Out of scope:** EPF, ESIC, Professional Tax, and LWF filing obligations already tracked in `statutory_filing_record` are unaffected by this feature. Generation or modification of TDS certificate Part A (the TRACES-issued PDF handled by `tds-certificate-part-a.*`) is unaffected; this feature may reference verified challan data from the same financial year but does not alter that upload/verify workflow. Any future authenticated API integration against an employer-specific TRACES/e-filing credential (e.g., an ERI registration) is explicitly out of scope until such a credential is confirmed to exist for this employer.

## Glossary

- **TAN**: Tax Deduction and Collection Account Number — the 10-character alphanumeric identifier (format AAAA99999A) a deductor must quote on every TDS certificate, challan, and quarterly return. Distinct from PAN.
- **Deductor**: The employer entity responsible for deducting and depositing TDS on salary, identified by one or more TANs.
- **Responsible_Person**: The individual named on Form 27A and the quarterly return as accountable for TDS compliance for a given TAN, identified by name, designation, and PAN.
- **CIN**: Challan Identification Number — the combination of BSR code (7 digits), challan tender date, and challan serial number that uniquely identifies a single tax deposit under OLTAS.
- **CSI_File**: Challan Status Inquiry file — a text file downloaded by the deductor from the TRACES/OLTAS portal listing challans deposited against a TAN within a date range, used as the authoritative source for challan verification.
- **Quarterly_Return**: The statutory TDS return for salary payments — Form 24Q under the Income-tax Act, 1961, or Form 138 under the Income-tax Act, 2025 — covering one financial-year quarter (Q1: Apr-Jun, Q2: Jul-Sep, Q3: Oct-Dec, Q4: Jan-Mar).
- **FVU**: File Validation Utility — the NSDL/Protean utility that validates a quarterly return text file's structure before it can be uploaded to TRACES. This feature produces a file intended to pass FVU validation; it does not run the FVU utility itself.
- **Annexure_I**: The challan-details section of a quarterly return file (deposit-level TDS summary for the quarter).
- **Annexure_II**: The deductee/salary-details section of a quarterly return file (per-employee salary, deduction, and tax figures for the financial year, required in Q4 filings).
- **Form_27A**: The physical/digital control chart accompanying a quarterly return file submission, summarizing total deductees, total amount paid, and total tax deducted, signed by the Responsible_Person.
- **TDS_Deposit**: The monthly act of depositing TDS collected in a calendar month with the government, distinct from the Quarterly_Return that reports it.
- **Deductor_Service**: The system component that stores and serves TAN and Responsible_Person data.
- **Challan_Service**: The system component that stores structured challan/CIN records and their reconciliation status.
- **CSI_Import_Engine**: The system component that parses an uploaded CSI_File into structured challan records.
- **Reconciliation_Engine**: The system component that matches structured challan records filed by payroll staff against CSI_File-derived records and reports discrepancies.
- **Return_File_Generator**: The system component that produces an FVU-compatible Quarterly_Return text file and the Form_27A control chart.
- **Statutory_Filing_Tracker**: The existing filing-obligation tracker (`statutory_filing_record` and its routes), extended by this feature.
- **CIN comparison rule**: For reconciliation and duplicate-detection purposes, two CIN values are considered matching when they are identical disregarding letter case and any leading or trailing whitespace.
- **Self-validation tolerance**: When the Return_File_Generator checks a generated Quarterly_Return file's parsed-back total tax deducted against the sum of reconciled challan amounts, a difference of up to ₹1 is tolerated to account for statutory rounding of individual amounts to the nearest rupee; any larger difference is treated as a mismatch.

## Requirements

### Requirement 1: Deductor TAN Capture

**User Story:** As a payroll administrator, I want to record the employer's TAN and the person responsible for TDS compliance, so that Form 16/130, Form 27A, and the quarterly return can carry the legally required deductor identity instead of omitting it.

#### Acceptance Criteria

1. THE Deductor_Service SHALL store, for each TAN, a unique TAN value, the deductor name (up to 200 characters), the registered address (up to 500 characters), and the Responsible_Person's name (up to 150 characters), designation (up to 100 characters), and PAN.
2. WHERE an employer operates more than one TAN across its branches, THE Deductor_Service SHALL allow a TAN record to be optionally associated with one or more branch identifiers.
3. WHERE an employer operates a single TAN for all branches, THE Deductor_Service SHALL allow a TAN record to be created with no branch association, applying it organization-wide.
4. IF a user with payroll administrator authority submits a TAN record whose TAN value does not match the format four letters, five digits, one letter (e.g., AAAA99999A), THEN THE Deductor_Service SHALL reject the submission, SHALL NOT persist the record, and SHALL return a validation error identifying the TAN field as invalid.
5. IF a user with payroll administrator authority submits a TAN record whose Responsible_Person PAN does not match the ten-character PAN format, THEN THE Deductor_Service SHALL reject the submission, SHALL NOT persist the record, and SHALL return a validation error identifying the PAN field as invalid.
6. IF a user without payroll administrator authority attempts to create, modify, or deactivate a TAN record, THEN THE Deductor_Service SHALL deny the request and return an authorization error.
7. WHEN a TAN record is created, modified, or deactivated, THE Deductor_Service SHALL record the action in the sensitive-action audit log with the actor's identity and the fields changed.
8. IF a user with payroll administrator authority submits a TAN record whose TAN value matches an existing active TAN record, THEN THE Deductor_Service SHALL reject the submission, SHALL NOT persist a duplicate record, and SHALL return a validation error identifying the TAN as already in use.
9. WHEN a TAN record is deactivated, THE Deductor_Service SHALL exclude that TAN record from being selectable as an active TAN for any branch or organization scope, while retaining the deactivated record and its history for audit purposes.

### Requirement 2: TAN as a Prerequisite for Statutory Document Generation

**User Story:** As a payroll administrator, I want document generation to refuse when no TAN is on file, so that a Form 16/130 or quarterly return is never issued silently missing a legally required deductor identity.

#### Acceptance Criteria

1. IF a request to generate a Quarterly_Return file or a Form_27A control chart targets a branch or organization scope with no associated active TAN record, THEN THE Return_File_Generator SHALL reject the request, SHALL NOT produce the file or control chart, and SHALL return a response identifying the specific scope lacking an active TAN record.
2. WHEN a request is made to generate Form 16/130 Part B data for an employee whose branch or organization scope has an associated active TAN record, THE System SHALL include the deductor's TAN and the Responsible_Person's name and designation in the generated data.
3. IF no active TAN record exists for an employee's branch or organization scope, THEN THE System SHALL populate the TAN and Responsible_Person fields on that employee's Form 16/130 Part B data with an explicit missing-data indicator instead of a fabricated value or a blank field.
4. IF no active TAN record exists for an employee's branch or organization scope, THEN THE System SHALL include that employee and the affected scope in a data-completeness report accompanying the Form 16/130 Part B generation output.
5. THE Return_File_Generator SHALL NOT produce a Quarterly_Return file or Form_27A control chart containing an empty, null, or placeholder value in place of the TAN.

### Requirement 3: Structured Challan Capture

**User Story:** As a payroll administrator, I want to record a deposited TDS challan as structured, validated fields, so that the deposit is verifiable against TRACES data instead of resting on a free-text challan number.

#### Acceptance Criteria

1. WHEN a user with payroll authority records a TDS_Deposit, THE Challan_Service SHALL require the BSR code, the challan tender date, the challan serial number, and the deposited amount as separate fields.
2. IF a user with payroll authority submits a challan record whose BSR code does not consist of exactly seven digits, THEN THE Challan_Service SHALL reject the submission, SHALL NOT persist the record, and SHALL return a validation error identifying the BSR code field as invalid.
3. IF a user with payroll authority submits a challan record whose challan serial number is not a positive integer of five digits or fewer, THEN THE Challan_Service SHALL reject the submission, SHALL NOT persist the record, and SHALL return a validation error identifying the challan serial number field as invalid.
4. IF a user with payroll authority submits a challan record whose challan tender date falls before the first day of the TDS_Deposit's filing month or after the current date, THEN THE Challan_Service SHALL reject the submission, SHALL NOT persist the record, and SHALL return a validation error identifying the challan tender date field as invalid.
5. IF a user with payroll authority submits a challan record with a deposited amount that is not a positive value between 0.01 and 999,999,999.99 with at most two decimal places, THEN THE Challan_Service SHALL reject the submission, SHALL NOT persist the record, and SHALL return a validation error identifying the deposited amount field as invalid.
6. IF a user with payroll authority submits a challan record with the BSR code, challan tender date, challan serial number, or deposited amount missing or empty, THEN THE Challan_Service SHALL reject the submission, SHALL NOT persist the record, and SHALL return a validation error identifying which field is missing.
7. THE Challan_Service SHALL derive the CIN for a challan record by concatenating the BSR code, the challan tender date formatted as DDMMYYYY, and the challan serial number, in that order.
8. IF a user with payroll authority submits a challan record whose derived CIN matches an existing payroll-staff-entered challan record's CIN, THEN THE Challan_Service SHALL reject the submission, SHALL NOT persist a duplicate record, and SHALL return a validation error identifying the CIN as already recorded.
9. WHEN a challan record is created or modified, THE Challan_Service SHALL record the action in the sensitive-action audit log with the actor's identity, the CIN, the amount, and, for a modification, the prior and updated values of the fields changed.

### Requirement 4: TDS Deposit Due Date Correction

**User Story:** As a payroll administrator, I want the TDS deposit due date for March to follow the statutory rule for that month, so that the filing tracker does not mark a compliant March deposit as overdue.

#### Acceptance Criteria

1. WHEN the Statutory_Filing_Tracker computes the TDS_Deposit due date for a filing month other than March, THE Statutory_Filing_Tracker SHALL set the due date to the 7th day of the calendar month immediately following the filing month, rolling over to the 7th of January of the next calendar year when the filing month is December.
2. WHEN the Statutory_Filing_Tracker computes the TDS_Deposit due date for the filing month of March, THE Statutory_Filing_Tracker SHALL set the due date to the 30th day of April of the same calendar year.
3. IF an existing `statutory_filing_record` row for a March TDS_Deposit has a due date recorded as the 7th of April, THEN THE Statutory_Filing_Tracker SHALL correct that row's due date to the 30th of April of the same calendar year the next time the Statutory_Filing_Tracker performs its due-date recomputation for that row.
4. WHEN the Statutory_Filing_Tracker corrects a `statutory_filing_record` row's due date per Criterion 3, THE Statutory_Filing_Tracker SHALL recompute that row's overdue status by comparing the current date to the corrected 30th of April due date, and SHALL clear any overdue flag that was set on that row based on the incorrect 7th of April due date if the row is not overdue under the corrected due date.

### Requirement 5: Quarterly Return Obligation Tracking

**User Story:** As a payroll administrator, I want the quarterly TDS return tracked as its own filing obligation with its own due date, so that it is not conflated with the monthly TDS deposit obligation.

#### Acceptance Criteria

1. THE Statutory_Filing_Tracker SHALL track a Quarterly_Return obligation as a distinct record from any monthly TDS_Deposit obligation, keyed by TAN, financial year, and quarter rather than by calendar month.
2. WHEN the Statutory_Filing_Tracker initializes obligations for a TAN and a financial-year quarter ending in June, September, or December, THE Statutory_Filing_Tracker SHALL set the Quarterly_Return due date to the 31st day of the month following the quarter's end.
3. WHEN the Statutory_Filing_Tracker initializes obligations for a TAN and the financial-year quarter ending in March, THE Statutory_Filing_Tracker SHALL set the Quarterly_Return due date to the 31st day of May of the same calendar year.
4. THE Statutory_Filing_Tracker SHALL select Form 24Q or Form 138 as the Quarterly_Return's form designation according to the statutory regime resolved for the financial year containing the quarter, using the same act-transition logic already resolved by `statutory-regime.ts`.
5. WHILE a Quarterly_Return obligation for a given TAN and quarter has an associated generated return file, THE Statutory_Filing_Tracker SHALL display that file's generation timestamp on the obligation in the Statutory_Filing_Tracker view.
6. WHILE a Quarterly_Return obligation for a given TAN and quarter has been marked as filed, THE Statutory_Filing_Tracker SHALL display the filed status on the obligation in the Statutory_Filing_Tracker view.
7. IF the Statutory_Filing_Tracker is asked to initialize obligations for a TAN and financial-year quarter for which a Quarterly_Return obligation record already exists, THEN THE Statutory_Filing_Tracker SHALL leave the existing obligation record unchanged and SHALL NOT create a duplicate obligation record.

### Requirement 6: CSI File Import

**User Story:** As a payroll administrator, I want to upload the OLTAS CSI file downloaded from TRACES, so that deposited challans can be verified against TRACES's own record instead of trusting manual entry alone.

#### Acceptance Criteria

1. WHEN a user with payroll authority uploads a CSI_File of up to 10 MB for a TAN and a date range, THE CSI_Import_Engine SHALL parse the file into individual challan records, each carrying a BSR code, challan tender date, challan serial number, and deposited amount.
2. IF an uploaded file exceeds 10 MB, is not in the expected CSI_File text format, or contains a line or field that does not match the expected CSI_File structure, THEN THE CSI_Import_Engine SHALL reject the upload, SHALL NOT persist any parsed challan records from that upload, and SHALL report which line or field failed to parse.
3. IF a parsed CSI_File record's TAN does not match the TAN the upload was submitted under, or a parsed record's challan tender date falls outside the date range the upload was submitted under, THEN THE CSI_Import_Engine SHALL reject the upload, SHALL NOT persist any parsed challan records from that upload, and SHALL report the mismatched TAN or out-of-range date.
4. WHEN a CSI_File is successfully imported, THE CSI_Import_Engine SHALL store the parsed challan records as TRACES-sourced records distinct from payroll-staff-entered challan records, retaining both.
5. IF a CSI_File is uploaded for a TAN and date range for which a TRACES-sourced challan record with the same CIN already exists, THEN THE CSI_Import_Engine SHALL retain the existing TRACES-sourced record unchanged and SHALL NOT create a duplicate TRACES-sourced record for that CIN.
6. WHEN a CSI_File import completes, THE System SHALL record the action in the sensitive-action audit log with the actor's identity, the TAN, the date range, and the count of challan records imported.

### Requirement 7: Challan Reconciliation

**User Story:** As a payroll administrator, I want payroll-entered challans automatically matched against TRACES-sourced challan data, so that a misrecorded or undeposited challan is caught before the quarterly return is filed.

#### Acceptance Criteria

1. IF a payroll-staff-entered challan record and a TRACES-sourced challan record share the same CIN (exact match, disregarding letter case and leading or trailing whitespace) following a CSI_File import, THEN THE Reconciliation_Engine SHALL mark the payroll-staff-entered record as reconciled.
2. IF a payroll-staff-entered challan record's CIN has no matching TRACES-sourced record after a CSI_File import covering its tender date, THEN THE Reconciliation_Engine SHALL mark the record as unmatched and shall surface it on the Statutory_Filing_Tracker view.
3. IF a payroll-staff-entered challan record and its matching TRACES-sourced record share the same CIN but report deposited amounts that differ by any amount, THEN THE Reconciliation_Engine SHALL mark the record as an amount discrepancy, shall report both amounts, and shall retain the record in unreconciled status until the discrepancy is resolved.
4. IF a TRACES-sourced challan record has no corresponding payroll-staff-entered record, THEN THE Reconciliation_Engine SHALL surface it as a deposit with no filed record on the Statutory_Filing_Tracker view.
5. THE Reconciliation_Engine SHALL require every challan associated with a Quarterly_Return to reach reconciled status before that Quarterly_Return may be marked as filed on the Statutory_Filing_Tracker.
6. IF a payroll administrator attempts to mark a Quarterly_Return as filed while one or more of its associated challans have not reached reconciled status, THEN THE Reconciliation_Engine SHALL block the filing action, retain the Quarterly_Return in its current status, and indicate on the Statutory_Filing_Tracker view which challans remain unreconciled.

### Requirement 8: Quarterly Return File Generation

**User Story:** As a payroll administrator, I want an FVU-compatible quarterly return file generated from actual finalized payroll data, so that I upload a system-produced file to TRACES instead of assembling one by hand.

#### Acceptance Criteria

1. WHEN a user with payroll authority requests generation of a Quarterly_Return file for a TAN and a financial-year quarter, THE Return_File_Generator SHALL build the Annexure_I section from the challan records reconciled for that TAN and quarter.
2. WHEN a user with payroll authority requests generation of a Quarterly_Return file, THE Return_File_Generator SHALL build the Annexure_II section from finalized payroll lines for each employee under that TAN's scope for the financial year to date.
3. IF a Quarterly_Return generation request covers a quarter containing one or more unreconciled challans, THEN THE Return_File_Generator SHALL refuse to generate the file and shall report which challans remain unreconciled.
4. IF a Quarterly_Return generation request covers an employee with no PAN on file, THEN THE Return_File_Generator SHALL exclude that employee's Annexure_II row and shall report the employee as excluded for missing PAN, rather than generating a row with a blank PAN field.
5. WHEN a Quarterly_Return file is generated, THE Return_File_Generator SHALL name the output file and internally tag its form designation according to the statutory regime resolved for that financial year (Form 24Q or Form 138).
6. WHEN a Quarterly_Return file is generated, THE Return_File_Generator SHALL make the file available for download by a user with payroll authority for the TAN's scope.
7. IF a Quarterly_Return generation request covers an employee whose payroll for the requested quarter has not been finalized, THEN THE Return_File_Generator SHALL exclude that employee's Annexure_II row and shall report the employee as excluded for unfinalized payroll, rather than generating a row from provisional or partial payroll data.
8. IF the statutory regime cannot be resolved for the financial year of a Quarterly_Return generation request, THEN THE Return_File_Generator SHALL refuse to generate the file and shall report that the statutory regime could not be determined for that financial year.
9. WHEN a Quarterly_Return generation request is submitted for a TAN and quarter for which a Quarterly_Return file was previously generated, THE Return_File_Generator SHALL generate a new file that supersedes the previously generated file, such that only the most recently generated file remains available for download for that TAN and quarter.

### Requirement 9: Generated File Self-Validation

**User Story:** As a payroll administrator, I want the system to check its own generated return file against the figures it was built from, so that a structural or data error is caught before I upload the file to TRACES.

#### Acceptance Criteria

1. WHEN a Quarterly_Return file is generated, THE Return_File_Generator SHALL parse the generated file back into structured records comprising all Annexure_I entries and all Annexure_II entries before offering the file for download.
2. IF the total tax deducted summed from the parsed-back Annexure_I records differs from the sum of reconciled challan amounts used to build the file by more than ₹1 (to allow for statutory rounding of individual amounts to the nearest rupee), THEN THE Return_File_Generator SHALL withhold the file from download, SHALL NOT make the file available for download until the underlying data is corrected and the file is regenerated, and SHALL display an error message to the payroll administrator identifying the parsed-back total and the expected total.
3. IF the parsed-back count of Annexure_II records does not equal the count of employees included from the source payroll data, THEN THE Return_File_Generator SHALL withhold the file from download, SHALL NOT make the file available for download until the underlying data is corrected and the file is regenerated, and SHALL display an error message to the payroll administrator identifying the parsed-back count and the expected count.
4. THE Return_File_Generator SHALL apply the self-validation checks in Acceptance Criteria 2 and 3 to every generated Quarterly_Return file, with no configuration option to skip them.

### Requirement 10: Form 27A Control Chart Generation

**User Story:** As a payroll administrator, I want a Form 27A control chart generated alongside the return file, so that I have the signed summary TRACES requires to accompany the submission.

#### Acceptance Criteria

1. WHEN a Quarterly_Return file is generated for a TAN and quarter, THE Return_File_Generator SHALL generate one accompanying Form_27A control chart, conforming to the layout prescribed by TRACES for Form 27A, reporting: the TAN, the Responsible_Person's name, designation, and PAN, the total count of unique deductees included in that Quarterly_Return file, the total amount paid, and the total tax deducted for that quarter.
2. IF the Responsible_Person's name, designation, or PAN required for the Form_27A control chart is not available at the time generation is requested, THEN THE Return_File_Generator SHALL block generation of the Form_27A control chart, SHALL present an error indication identifying which Responsible_Person detail is missing, and SHALL retain any previously entered data unchanged.
3. THE Return_File_Generator SHALL derive each Form_27A total (total deductees, total amount paid, total tax deducted) from the same reconciled challan and payroll data used to generate the corresponding Quarterly_Return file, such that each Form_27A total is numerically equal to the corresponding total reported in that Quarterly_Return file.
4. IF the challan and payroll data for the quarter has not completed reconciliation, or contains unresolved discrepancies, when generation is requested, THEN THE Return_File_Generator SHALL block generation of both the Form_27A control chart and the Quarterly_Return file, and SHALL present an error indication that reconciliation must be completed before either file can be generated.
5. WHEN a Form_27A control chart is generated, THE Return_File_Generator SHALL make the Form_27A control chart and its accompanying Quarterly_Return file available for download together in a single download action, such that no additional separate request is required to obtain either file.

### Requirement 11: Filing Record Lifecycle Integration

**User Story:** As a payroll administrator, I want the statutory filing tracker to reflect that a return was system-generated and reconciled, so that "filed" means something more than a typed challan number.

#### Acceptance Criteria

1. WHEN a Quarterly_Return file is generated for a TAN and quarter, THE Statutory_Filing_Tracker SHALL link the generated file's identifier to that quarter's filing obligation record, replacing any previously linked file identifier for that same obligation.
2. IF a user with payroll authority requests to mark a Quarterly_Return obligation as filed, and a Quarterly_Return file has been generated for that obligation, and at least one challan is associated with the obligation, and every challan associated with the obligation has reached reconciled status, THEN THE Statutory_Filing_Tracker SHALL mark the obligation as filed.
3. IF a user attempts to mark a Quarterly_Return obligation as filed while no Quarterly_Return file has been generated for it, while no challan is associated with it, or while one or more associated challans have not reached reconciled status, THEN THE Statutory_Filing_Tracker SHALL deny the request and report every unmet condition among these to the user.
4. WHEN a Quarterly_Return obligation is marked as filed, THE Statutory_Filing_Tracker SHALL record an acknowledgement or provisional receipt number of up to 50 characters entered by the user, alongside the existing filed-by and filed-at fields.
5. IF a user attempts to mark a Quarterly_Return obligation as filed without entering an acknowledgement or provisional receipt number, THEN THE Statutory_Filing_Tracker SHALL deny the request and report that the acknowledgement or provisional receipt number is required.
6. IF a user enters an acknowledgement or provisional receipt number exceeding 50 characters when marking a Quarterly_Return obligation as filed, THEN THE Statutory_Filing_Tracker SHALL deny the request and report that the acknowledgement or provisional receipt number exceeds the maximum length.

### Requirement 12: Access Control and Audit

**User Story:** As a compliance-conscious administrator, I want every new TAN, challan, CSI import, and return-generation action restricted to authorized roles and logged, so that changes to statutory filing data are traceable.

#### Acceptance Criteria

1. THE System SHALL restrict creation, modification, and deactivation of TAN records, challan records, and CSI_File imports to users holding one of the existing payroll authority roles (admin, super_admin, payroll_head, payroll, payroll_hr, finance).
2. THE System SHALL restrict generation and download of Quarterly_Return files and Form_27A control charts to users holding one of the existing payroll authority roles for the TAN's associated branch or organization scope.
3. WHEN a Quarterly_Return file or Form_27A control chart is generated or downloaded, THE System SHALL record the action in the sensitive-action audit log with the actor's identity, the TAN, and the financial-year quarter.
4. WHEN a TAN record, challan record, or CSI_File import is created, modified, or deactivated, THE System SHALL record the action in the sensitive-action audit log with the actor's identity, the affected record's identifier, and the type of action performed (creation, modification, or deactivation).
5. IF a user without an authorized role attempts any action covered by this requirement, THEN THE System SHALL deny the request and return an authorization error without exposing TAN, challan, or return data.

### Requirement 13: No Programmatic TRACES Submission

**User Story:** As a payroll administrator, I want the system to be explicit about what it does not do, so that no one mistakes generated files for a filed return.

#### Acceptance Criteria

1. THE System SHALL NOT expose any endpoint, button, scheduled job, background process, or other automated mechanism that submits a Quarterly_Return file to TRACES, the TIN-FC portal, or the income-tax e-filing portal on the employer's behalf.
2. WHEN a Quarterly_Return file and Form_27A control chart are made available for download, THE System SHALL display, alongside the download, a disclaimer stating that the file must be manually uploaded to the TRACES/TIN-FC portal to complete the filing.
3. THE Statutory_Filing_Tracker SHALL retain the existing manual "mark as filed" action, gated by Requirement 11, as the sole mechanism by which a Quarterly_Return obligation transitions to filed status.
4. THE System SHALL NOT provide any application programming interface, bulk-update, or other automated mechanism that sets a Quarterly_Return obligation's status to filed other than the manual "mark as filed" action referenced in Criterion 3.
5. WHILE a Quarterly_Return obligation has not been marked as filed via the manual action referenced in Criterion 3, THE Statutory_Filing_Tracker SHALL NOT display a status label indicating the return has been filed or submitted.
