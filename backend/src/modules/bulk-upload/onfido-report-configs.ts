/**
 * Onfido process raw-data report formats.
 *
 * The Onfido process runs two queues (DOC = document extraction/EWYS, POA = Proof
 * of Address), each exporting two kinds of report from Onfido's IMS: a volume/AHT
 * raw export and a QC/quality-audit export, plus a client-escalation export
 * (CRE/CRQ) for the DOC queue. Real column headers vary release to release (see
 * CRE vs CRQ, POA Raw Format vs POA Trial Raw below) so each version gets its own
 * table rather than guessing which one is "the" live format.
 *
 * Every table stores the FULL row as `raw_data` JSON, keyed by the exact source
 * header string — nothing is dropped or renamed. A handful of columns are also
 * pulled out and indexed for the KPI/Quality/Operations dashboard (Phase 3); the
 * `extract` map below is the single source of truth both the table DDL and the
 * import service read from.
 */

export type OnfidoFieldExtract = {
  /** DB column name for the indexed/extracted field. */
  column: string;
  /** Exact source header this is read from (must match a header in `headers`). */
  header: string;
  /** How to coerce the raw string value before insert. */
  type: "string" | "date" | "int" | "float" | "bool_yes_no";
};

export type OnfidoReportConfig = {
  /** upload_template_master.upload_type_code */
  uploadTypeCode: string;
  /** Human label shown in the Bulk Upload Hub. */
  uploadTypeName: string;
  /** Frontend IMPORT_RPC_BY_TYPE / backend KNOWN_IMPORT_RPCS key. */
  rpcName: string;
  /** Destination table in onfido_db. */
  table: string;
  description: string;
  /** Exact column headers as they appear in the source file (order preserved). */
  headers: string[];
  /** Header used as the natural dedup key (UNIQUE KEY in the table). Omit when
   *  `dedupHeaders` (composite key) is used instead. */
  dedupHeader?: string;
  dedupColumn: string;
  /**
   * For a source with no single natural per-row identity column (a monthly HR fact
   * table, not a per-task export with an IMS URL) — the dedup value is instead the
   * "|"-joined values of these headers (e.g. ["Emp ID", "Date"]), and `dedupHeader`
   * above is unused. `dedupColumn` still names the (synthetic) column that value is
   * stored in, same as the single-header case.
   */
  dedupHeaders?: string[];
  extract: OnfidoFieldExtract[];
};

const DOC_RAW_HEADERS = [
  "Date", "Task Information Task Completed Time", "Task Information Analyst Email",
  "Task Information Task Type Old", "URLs Continuous Processor Task URL",
  "IMS Client IMS Client Name", "Task Information Task Manual Processing Time (secs)",
  "Document Classification- Production + DORCH Document Type Full Name",
  "Task Information Task Queue Time (secs)", "Report Information Report Sub Result",
  "Task Information Task is escalated (Yes / No)", "Task Information Task Completed Minute",
  "Report Information Report Overall Result", "IDs Report ID",
  "Report Type Client SLA (minutes)", "BPO Organisation BPO Organisation",
  "Report Information Has Driving Licence Information Option (Yes / No)",
  "IMS Client Process Special Characters (Yes / No)", "Task Information Escalated By Email",
  "Task Information Task Escalated Time", "Task Type Short Name", "Week", "Month", "Slot",
  "TL Name", "AM Name", "QA Name", "AON", "Batch", "DOL", "Queue Status",
  "ETM TL Name", "ETM AM Name", "Processor Resigion",
];

const DOC_QUALITY_HEADERS = [
  "Task Complete Date", "Analyst Partners ID", "Task Type", "Continuous Processor Task URL",
  "IMS Client Name", "Task Manual Processing Time Filter (sec)", "Docupedia - Full Document Name",
  "Task Queue Time Filter (sec)", "Sub-Result", "Task Is Escalated (Yes / No)",
  "Task Completed Minute", "Overall Result", "QC Tool URL",
  "Was there a Classification Error ? ( Yes/No )", "Error Category", "Error Breakdown", "Reason",
  "Shapes & Template", "Auditors", "Special Characters", "Error Type", "QC Complite Date",
  "Class. NO", "Class. Yes", "Ext. NO", "Ext. Yes", "Raw Add.Ext. No", "Raw Add.Ext. Yes",
  "Raw.Ext. No", "Raw.Ext. Yes", "Lab EWYS NO", "Lab EWYS YES", "Ext_Valid NO", "Ext_Valid YES",
  "Raw_Ext_Valid NO", "Raw_Ext_Valid YES", "Ext_Consis NO", "Ext_Consis YES",
  "Raw_Ext_Consis NO", "Raw_Ext_Consis YES", "Ext IQ. NO", "Ext IQ. Yes", "Raw.Ext IQ. No",
  "Raw.Ext IQ. Yes", "Raw_Add_IQ.No", "Raw_Add_IQ.Yes", "Consistency NO", "Consistency Yes",
  "Special Characters Audits", "Special Characters Error", "Special Characters audits Error",
  "Classification", "Extraction", "Raw Add. Extraction", "Raw. Extraction", "Lab EWYS",
  "Ext_Validation", "Raw_ Ext_Validation", "Ext  Consistency", "Raw_Ext  Consistency", "Ext.IQ",
  "Raw.Ext IQ", "Raw_Add_IQ", "Consistency", "Total Audits", "Total Error", "Month", "Week",
  "Batch", "TL' Name", "AM's Name", "QA Name", "DOL", "Total Days", "AON", "Queue",
  "Task Type 2", "Dashboard Update", "Dispute Raised", "Accepted/Rejected", "Location", "Slot",
  "Extraction Ref", "Extraction Ref Value", "Refrence Tool Adhare&Not Adhare", "Dispute Status",
];

const CR_ESCALATION_HEADERS_BASE = [
  "Report Completed Date", "Qc Updated Date", "Qc Updated Week", "Error Month", "Error WC",
  "Month", "IMS report URL", "Analyst Email", "Report Sub-Result", "QC Sub-Result",
  "IMS Client Name", "Document Type Full Name", "QC Report URL",
  "Fraud Assessment Task Organisation", "Status", "Error Category", "Error Breakdown",
  "Old Error Breakdown", "Reason", "Task Type", "Error",
];
const CR_ESCALATION_HEADERS_MID = [
  "Report List of Consider Engine Sub-Breakdowns", "Report List of Consider Sub-Breakdowns",
  "ODP EA", "ODP AS", "FD EA", "FD AS", "PFI EA", "PFI AS", "FONTS EA", "FONTS AS", "DT EA",
  "DT AS", "SF EA", "SF AS", "ODP Error", "FD Error", "PFI Error", "Font Error", "DT Error",
  "SF Error", "EA",
];

// CRE has two extra columns (AHT, Quarterly) between the base and mid blocks that CRQ lacks.
const CRE_HEADERS = [
  ...CR_ESCALATION_HEADERS_BASE, "AHT", "Quarterly", ...CR_ESCALATION_HEADERS_MID,
  "TL", "AM", "QA", "QA TL", "AON", "Location",
];
const CRQ_HEADERS = [
  ...CR_ESCALATION_HEADERS_BASE, ...CR_ESCALATION_HEADERS_MID,
  "TL' Name", "AM'A Name", "QA's Name", "QA TL's Name", "AON", "Location",
];

const POA_RAW_HEADERS = [
  "IDsCheckUUID", "ReportReportCreatedTime", "ReportReportCompletedTime", "IDsReportUUID",
  "ReportReportCompletedMonth", "ReportCompletedDate", "IDsReportID", "URLsIMSreportURL",
  "URLsQCReportURL", "ClientIMSIMSClientName", "DocumentClassificationDocumentTypeFullName",
  "ClientIMSAccountType", "ClientIMSStudioEnabledYesNo", "CheckAPIVersion", "CheckDocumentSource",
  "ReportPropertiesProofofAddressDocumentType", "ReportPropertiesProofofAddressIssuingCountry",
  "ReportReportResult", "BreakdownResultsProofofAddressDocumentClassificationBreakdownResult",
  "BreakdownResultsProofofAddressSupportedDocumentSubbreakdownResult",
  "BreakdownResultsProofofAddressValidDocumentDateSubbreakdownResult",
  "BreakdownResultsProofofAddressInvalidCountryResult",
  "BreakdownResultsProofofAddressInvalidDocumentTypeResult",
  "BreakdownResultsProofofAddressPossibleFraudResult",
  "BreakdownResultsProofofAddressUnsupportedAlphabetResult",
  "BreakdownResultsProofofAddressDataComparisonBreakdownResult",
  "BreakdownResultsProofofAddressAddressSubbreakdownResult",
  "BreakdownResultsProofofAddressFirstNameSubbreakdownResult",
  "BreakdownResultsProofofAddressLastNameSubbreakdownResult",
  "BreakdownResultsProofofAddressImageIntegrityBreakdownResult",
  "TasksInformationProofofAddressTaskAnalystEmail", "ManualProcessingTimeInSec",
  "Tasks - Information Proof of Address Task URL", "Report % Report TaT < 10m",
  "Report % Report TaT < 20m", "Report % Report TaT < 30m", "Sum", "SLA", "WC", "TLName", "AM",
  "QA Name", "BSTSlot", "IST Slot", "Month", "AON", "Location", "Allocation",
  "English/Non English", "Data Type", "Task Queue", "Total Time",
];

const POA_TRIAL_HEADERS = [
  "Client - IMS IMS Client Name", "Client - IMS Self Service Trial (Yes / No)",
  "Client - IMS AWS Region Name", "Client - IMS Studio Enabled (Yes / No)",
  "Client - IMS Document Automation Configuration", "Report Report Completed Date",
  "Report Report Type", "Client - IMS Account Type", "Check API Version",
  "Report Report Result", "Breakdown Results - Proof of Address Data Comparison Breakdown Result",
  "Breakdown Results - Proof of Address Document Classification Breakdown Result",
  "Breakdown Results - Proof of Address Image Integrity Breakdown Result",
  "Breakdown Results - Proof of Address Source Integrity Breakdown Result",
  "Tasks - Information Proof of Address Task Organisation",
  "Tasks - Information Proof of Address Task Analyst Email",
  "Tasks - Information Proof of Address Task Manual Processing Time In Sec",
  "Tasks - Information Proof of Address Task Source Original Task ID", "URLs IMS report URL",
  "Report Number of Reports", "Report % Report TaT < 10m", "Report % Report TaT < 30m",
  "TL Name", "AM Name", "Auditor Name", "Status", "Reason", "2nd level", "Comments",
  "English/Non-English", "Issuer Name (As per analyst)", "Week", "Month", "Sum", "SLA",
  "Total Task", "Audits", "Error",
];

const POA_QUALITY_HEADERS = [
  "IDs Check UUID", "Report Report Created Time", "Report Report Completed Time",
  "IDs Report UUID", "Report Report Completed Month", "Report Report Completed Date",
  "URLsIMSreportURL", "IDsReportID", "URLs QC Report URL", "Client - IMS IMS Client Name",
  "Document Classification Document Type Full Name", "Client - IMS Account Type",
  "Client - IMS Studio Enabled (Yes / No)", "Check API Version", "Check Document Source",
  "Report Properties Proof of Address Document Type",
  "Report Properties Proof of Address Issuing Country", "Report Report Result",
  "Breakdown Results - Proof of Address Document Classification Breakdown Result",
  "Breakdown Results - Proof of Address Supported Document Sub-breakdown Result",
  "Breakdown Results - Proof of Address Valid Document Date Sub-breakdown Result",
  "Breakdown Results - Proof of Address Invalid Country Result",
  "Breakdown Results - Proof of Address Invalid Document Type Result",
  "Breakdown Results - Proof of Address Possible Fraud Result",
  "Breakdown Results - Proof of Address Unsupported Alphabet Result",
  "Breakdown Results - Proof of Address Data Comparison Breakdown Result",
  "Breakdown Results - Proof of Address Address Sub-breakdown Result",
  "Breakdown Results - Proof of Address First Name Sub-breakdown Result",
  "Breakdown Results - Proof of Address Last Name Sub-breakdown Result",
  "Breakdown Results - Proof of Address Image Integrity Breakdown Result",
  "Tasks - Information Proof of Address Task Analyst Email",
  "Tasks - Information Proof of Address Task Manual Processing Time In Sec",
  "Tasks - Information Proof of Address Task URL", "Report % Report TaT < 10m",
  "Report % Report TaT < 20m", "Report % Report TaT < 30m", "Name", "Status", "Reason",
  "2nd level", "Comments", "English/Non-English", "Issuer Name (As per QCer)",
  "Issuer Name (As per analyst)", "Document Type", "Audit Type", "AHT Slot", "Error",
  "No Error", "Total QC", "Classification Error", "Extraction Error", "Data Comparison Error",
  "TL", "AM", "QA", "Designation", "Location", "WC", "Month", "Dashboard update date",
  "Dispute Raise", "Dispute Accept", "Dispute Status", "Task Queue",
];

export const ONFIDO_REPORT_CONFIGS: OnfidoReportConfig[] = [
  {
    uploadTypeCode: "ONFIDO_DOC_RAW",
    uploadTypeName: "Onfido - DOC Raw Data (Volume/AHT)",
    rpcName: "import_onfido_doc_raw_batch",
    table: "onfido_doc_raw",
    description: "Onfido DOC/EWYS queue per-task volume & AHT export, enriched with TL/AM/QA/batch.",
    headers: DOC_RAW_HEADERS,
    // Owner rule: the unique identity across every report is its IMS URL — a daily
    // whole-month re-upload with corrected values must UPDATE the matching row, not
    // duplicate it. report_id (below) stays as a plain reference field.
    dedupHeader: "URLs Continuous Processor Task URL",
    dedupColumn: "ims_url",
    extract: [
      { column: "ims_url", header: "URLs Continuous Processor Task URL", type: "string" },
      { column: "report_id", header: "IDs Report ID", type: "string" },
      { column: "report_date", header: "Date", type: "date" },
      { column: "analyst_email", header: "Task Information Analyst Email", type: "string" },
      { column: "tl_name", header: "TL Name", type: "string" },
      { column: "am_name", header: "AM Name", type: "string" },
      { column: "qa_name", header: "QA Name", type: "string" },
      { column: "overall_result", header: "Report Information Report Overall Result", type: "string" },
      { column: "ims_client_name", header: "IMS Client IMS Client Name", type: "string" },
      { column: "batch_label", header: "Batch", type: "string" },
      { column: "month_label", header: "Month", type: "string" },
      { column: "manual_processing_time_secs", header: "Task Information Task Manual Processing Time (secs)", type: "int" },
      { column: "queue_time_secs", header: "Task Information Task Queue Time (secs)", type: "int" },
      { column: "is_escalated", header: "Task Information Task is escalated (Yes / No)", type: "bool_yes_no" },
    ],
  },
  {
    uploadTypeCode: "ONFIDO_DOC_QUALITY",
    uploadTypeName: "Onfido - DOC Quality Audit (Internal Dashboard)",
    rpcName: "import_onfido_doc_quality_batch",
    table: "onfido_doc_quality_raw",
    description: "Onfido DOC/EWYS internal QC audit export — classification/extraction/consistency/IQ error breakdowns.",
    headers: DOC_QUALITY_HEADERS,
    // Owner rule: dedupe on IMS URL everywhere. qc_tool_url is a different URL (the QC
    // tool, not the IMS task) — kept as a plain reference field, not the dedup key.
    dedupHeader: "Continuous Processor Task URL",
    dedupColumn: "ims_url",
    extract: [
      { column: "ims_url", header: "Continuous Processor Task URL", type: "string" },
      { column: "qc_tool_url", header: "QC Tool URL", type: "string" },
      { column: "task_complete_date", header: "Task Complete Date", type: "date" },
      { column: "analyst_email", header: "Analyst Partners ID", type: "string" },
      { column: "tl_name", header: "TL' Name", type: "string" },
      { column: "am_name", header: "AM's Name", type: "string" },
      { column: "qa_name", header: "QA Name", type: "string" },
      { column: "overall_result", header: "Overall Result", type: "string" },
      { column: "batch_label", header: "Batch", type: "string" },
      { column: "month_label", header: "Month", type: "string" },
      { column: "total_audits", header: "Total Audits", type: "int" },
      { column: "total_error", header: "Total Error", type: "int" },
    ],
  },
  {
    uploadTypeCode: "ONFIDO_DOC_ESCALATION_CRE",
    uploadTypeName: "Onfido - DOC Client Escalation (CRE Dashboard)",
    rpcName: "import_onfido_cre_batch",
    table: "onfido_doc_escalation_cre_raw",
    description: "Onfido DOC queue client-reported error/fraud-assessment breakdown (CRE format).",
    headers: CRE_HEADERS,
    dedupHeader: "IMS report URL",
    dedupColumn: "ims_report_url",
    extract: [
      { column: "ims_report_url", header: "IMS report URL", type: "string" },
      { column: "report_completed_date", header: "Report Completed Date", type: "date" },
      { column: "analyst_email", header: "Analyst Email", type: "string" },
      { column: "tl_name", header: "TL", type: "string" },
      { column: "am_name", header: "AM", type: "string" },
      { column: "qa_name", header: "QA", type: "string" },
      { column: "report_sub_result", header: "Report Sub-Result", type: "string" },
      { column: "qc_sub_result", header: "QC Sub-Result", type: "string" },
      { column: "ims_client_name", header: "IMS Client Name", type: "string" },
      { column: "error_category", header: "Error Category", type: "string" },
      { column: "error_breakdown", header: "Error Breakdown", type: "string" },
      { column: "month_label", header: "Month", type: "string" },
    ],
  },
  {
    uploadTypeCode: "ONFIDO_DOC_ESCALATION_CRQ",
    uploadTypeName: "Onfido - DOC Client Escalation (CRQ Dashboard)",
    rpcName: "import_onfido_crq_batch",
    table: "onfido_doc_escalation_crq_raw",
    description: "Onfido DOC queue client-reported error/fraud-assessment breakdown (CRQ format, earlier column set than CRE).",
    headers: CRQ_HEADERS,
    dedupHeader: "IMS report URL",
    dedupColumn: "ims_report_url",
    extract: [
      { column: "ims_report_url", header: "IMS report URL", type: "string" },
      { column: "report_completed_date", header: "Report Completed Date", type: "date" },
      { column: "analyst_email", header: "Analyst Email", type: "string" },
      { column: "tl_name", header: "TL' Name", type: "string" },
      { column: "am_name", header: "AM'A Name", type: "string" },
      { column: "qa_name", header: "QA's Name", type: "string" },
      { column: "report_sub_result", header: "Report Sub-Result", type: "string" },
      { column: "qc_sub_result", header: "QC Sub-Result", type: "string" },
      { column: "ims_client_name", header: "IMS Client Name", type: "string" },
      { column: "error_category", header: "Error Category", type: "string" },
      { column: "error_breakdown", header: "Error Breakdown", type: "string" },
      { column: "month_label", header: "Month", type: "string" },
    ],
  },
  {
    uploadTypeCode: "ONFIDO_POA_RAW",
    uploadTypeName: "Onfido - POA Raw Data (Volume/TaT)",
    rpcName: "import_onfido_poa_raw_batch",
    table: "onfido_poa_raw",
    description: "Onfido Proof-of-Address queue per-report volume & TaT/SLA export.",
    headers: POA_RAW_HEADERS,
    // Owner rule: dedupe on IMS URL. IDsCheckUUID stays as a plain reference field.
    dedupHeader: "URLsIMSreportURL",
    dedupColumn: "ims_url",
    extract: [
      { column: "ims_url", header: "URLsIMSreportURL", type: "string" },
      { column: "check_uuid", header: "IDsCheckUUID", type: "string" },
      { column: "report_completed_date", header: "ReportCompletedDate", type: "date" },
      { column: "analyst_email", header: "TasksInformationProofofAddressTaskAnalystEmail", type: "string" },
      { column: "tl_name", header: "TLName", type: "string" },
      { column: "am_name", header: "AM", type: "string" },
      { column: "qa_name", header: "QA Name", type: "string" },
      { column: "overall_result", header: "ReportReportResult", type: "string" },
      { column: "manual_processing_time_secs", header: "ManualProcessingTimeInSec", type: "int" },
      { column: "month_label", header: "Month", type: "string" },
    ],
  },
  {
    uploadTypeCode: "ONFIDO_POA_TRIAL_RAW",
    uploadTypeName: "Onfido - POA Trial Raw Data",
    rpcName: "import_onfido_poa_trial_batch",
    table: "onfido_poa_trial_raw",
    description: "Onfido Proof-of-Address queue trial/early-format raw export (fewer columns than POA Raw Format).",
    headers: POA_TRIAL_HEADERS,
    // Owner rule: dedupe on IMS URL. source_task_id stays as a plain reference field.
    dedupHeader: "URLs IMS report URL",
    dedupColumn: "ims_url",
    extract: [
      { column: "ims_url", header: "URLs IMS report URL", type: "string" },
      { column: "source_task_id", header: "Tasks - Information Proof of Address Task Source Original Task ID", type: "string" },
      { column: "report_completed_date", header: "Report Report Completed Date", type: "date" },
      { column: "analyst_email", header: "Tasks - Information Proof of Address Task Analyst Email", type: "string" },
      { column: "tl_name", header: "TL Name", type: "string" },
      { column: "am_name", header: "AM Name", type: "string" },
      { column: "auditor_name", header: "Auditor Name", type: "string" },
      { column: "overall_result", header: "Report Report Result", type: "string" },
      { column: "month_label", header: "Month", type: "string" },
    ],
  },
  {
    uploadTypeCode: "ONFIDO_POA_QUALITY",
    uploadTypeName: "Onfido - POA Quality Audit Dashboard",
    rpcName: "import_onfido_poa_quality_batch",
    table: "onfido_poa_quality_raw",
    description: "Onfido Proof-of-Address queue internal QC audit export — breakdown results, error/no-error counts.",
    headers: POA_QUALITY_HEADERS,
    // Owner rule: dedupe on IMS URL — but in this specific file "URLsIMSreportURL" and
    // "IDsReportID" are swapped relative to their names (confirmed live across every
    // row: "URLsIMSreportURL" holds a bare numeric id, "IDsReportID" holds the actual
    // "http://ims.onfido.com/..." URL), so the real IMS URL is read from "IDsReportID"
    // despite the header text. check_uuid stays as a plain reference field.
    dedupHeader: "IDsReportID",
    dedupColumn: "ims_url",
    extract: [
      { column: "ims_url", header: "IDsReportID", type: "string" },
      { column: "check_uuid", header: "IDs Check UUID", type: "string" },
      { column: "report_completed_date", header: "Report Report Completed Date", type: "date" },
      { column: "analyst_email", header: "Tasks - Information Proof of Address Task Analyst Email", type: "string" },
      { column: "tl_name", header: "TL", type: "string" },
      { column: "am_name", header: "AM", type: "string" },
      { column: "qa_name", header: "QA", type: "string" },
      { column: "overall_result", header: "Report Report Result", type: "string" },
      { column: "month_label", header: "Month", type: "string" },
      // Error rate = SUM(error_count) / (SUM(error_count) + SUM(no_error_count)) — the
      // file's own per-row Error/No Error columns, not derived from overall_result.
      { column: "error_count", header: "Error", type: "int" },
      { column: "no_error_count", header: "No Error", type: "int" },
      // Sub-components of the overall error rate — owner-specified formula: each is
      // SUM(<this column>) / SUM(total_qc), the same denominator the overall rate uses.
      { column: "total_qc", header: "Total QC", type: "int" },
      { column: "classification_error", header: "Classification Error", type: "int" },
      { column: "extraction_error", header: "Extraction Error", type: "int" },
      { column: "data_comparison_error", header: "Data Comparison Error", type: "int" },
    ],
  },
];

// "External Dashboard" — the richest of the 8 formats: one row per audited task,
// carrying IMS Client + Docupedia document-type + full TL/AM/QA/QA-TL hierarchy +
// per-task-type flags (Classification/Extraction/Add. Extraction/Raw. Extraction/
// Manual FAR/Manual FRR) together in the same row. This is what the old dashboard's
// AM-wise, TL-wise, client-wise, document-type-wise and analyst ranking cross-tabs
// were built from — DOC_QUALITY only ever carried 2 aggregate numbers per row.
const DOC_EXTERNAL_AUDIT_HEADERS = [
  "Report Completed Date", "W/C", "Months", "Analyst Email", "Task Type", "IMS URL",
  "Task IMS link", "IMS Client Name", "Task Manual Processing Time Filter (sec)",
  "Docupedia - Full Document Name", "Sub-Result", "Document QC QC Sub-Result", "QC Tool URL",
  "Status (YES/NO)", "Error Category", "Error Breakdown", "Reason", "Comments",
  "Document QA Updated Date", "Ext. NO", "Ext. Yes", "Add.Ext. No", "Add.Ext. Yes",
  "Raw.Ext. No", "Raw.Ext. Yes", "Manual FAR. No", "Manual FAR. Yes", "Manual FRR. No",
  "Manual FRR. Yes", "Class. No", "Class. Yes", "Extraction", "Manual FAR", "Add. Extraction",
  "Raw. Extraction", "Classification", "Manual FRR", "Batch", "Live Date", "Live Days", "AON",
  "Location", "TL Name", "AM", "QA Name", "QA TL", "Queue Status",
];

export const ONFIDO_DOC_EXTERNAL_AUDIT_CONFIG: OnfidoReportConfig = {
  uploadTypeCode: "ONFIDO_DOC_EXTERNAL_AUDIT",
  uploadTypeName: "Onfido - DOC External Audit Dashboard",
  rpcName: "import_onfido_external_audit_batch",
  table: "onfido_doc_external_audit_raw",
  description: "Onfido DOC queue per-task external audit export — IMS client, Docupedia document type, full TL/AM/QA hierarchy and per-task-type flags in one row.",
  headers: DOC_EXTERNAL_AUDIT_HEADERS,
  dedupHeader: "IMS URL",
  dedupColumn: "ims_url",
  extract: [
    { column: "ims_url", header: "IMS URL", type: "string" },
    { column: "report_date", header: "Report Completed Date", type: "date" },
    { column: "analyst_email", header: "Analyst Email", type: "string" },
    { column: "tl_name", header: "TL Name", type: "string" },
    { column: "am_name", header: "AM", type: "string" },
    { column: "qa_name", header: "QA Name", type: "string" },
    { column: "qa_tl_name", header: "QA TL", type: "string" },
    { column: "has_error", header: "Status (YES/NO)", type: "bool_yes_no" },
    { column: "ims_client_name", header: "IMS Client Name", type: "string" },
    { column: "docupedia_document_name", header: "Docupedia - Full Document Name", type: "string" },
    { column: "month_label", header: "Months", type: "string" },
    { column: "manual_processing_time_secs", header: "Task Manual Processing Time Filter (sec)", type: "int" },
    { column: "error_category", header: "Error Category", type: "string" },
    { column: "error_breakdown", header: "Error Breakdown", type: "string" },
    { column: "batch_label", header: "Batch", type: "string" },
    { column: "queue_status", header: "Queue Status", type: "string" },
    { column: "classification_flag", header: "Classification", type: "int" },
    { column: "extraction_flag", header: "Extraction", type: "int" },
    { column: "add_extraction_flag", header: "Add. Extraction", type: "int" },
    { column: "raw_extraction_flag", header: "Raw. Extraction", type: "int" },
    { column: "manual_far_flag", header: "Manual FAR", type: "int" },
    { column: "manual_frr_flag", header: "Manual FRR", type: "int" },
  ],
};
ONFIDO_REPORT_CONFIGS.push(ONFIDO_DOC_EXTERNAL_AUDIT_CONFIG);

// ── ETM Tracker workbook: DOC ETM / POA ETM (per-task, with real escalation-by-email
// columns) and DOC Task Skip (unassigned/skipped tasks) — three more per-task raw
// exports, same "one row = one task" shape as the other DOC/POA formats above.

const DOC_ETM_HEADERS = [
  "Date", "Task Information Task Completed Time", "Task Information Analyst Email",
  "Task Information Task Type Old", "URLs Continuous Processor Task URL",
  "IMS Client IMS Client Name", "Task Information Task Manual Processing Time (secs)",
  "Document Classification- Production + DORCH Document Type Full Name",
  "Task Information Task Queue Time (secs)", "Report Information Report Sub Result",
  "Task Information Task is escalated (Yes / No)", "Task Information Task Completed Minute",
  "Report Information Report Overall Result", "IDs Report ID",
  "Report Type Client SLA (minutes)", "BPO Organisation BPO Organisation",
  "Report Information Has Driving Licence Information Option (Yes / No)",
  "IMS Client Process Special Characters (Yes / No)", "Task Information Escalated By Email",
  "Task Information Task Escalated Time", "Week", "Month", "TL Name", "AM Name", "QA Name",
  "AON", "Location", "Report ID Couvt", "US EU", "Slot", "Coman", "Coman Count",
];

export const ONFIDO_DOC_ETM_CONFIG: OnfidoReportConfig = {
  uploadTypeCode: "ONFIDO_DOC_ETM",
  uploadTypeName: "Onfido - DOC ETM (Escalated Task Management)",
  rpcName: "import_onfido_doc_etm_batch",
  table: "onfido_doc_etm_raw",
  description: "Onfido DOC queue per-task export carrying who a task was escalated to/by and when — the ETM Tracker workbook's DOC ETM sheet.",
  headers: DOC_ETM_HEADERS,
  dedupHeader: "URLs Continuous Processor Task URL",
  dedupColumn: "ims_url",
  extract: [
    { column: "ims_url", header: "URLs Continuous Processor Task URL", type: "string" },
    { column: "report_id", header: "IDs Report ID", type: "string" },
    { column: "report_date", header: "Date", type: "date" },
    { column: "analyst_email", header: "Task Information Analyst Email", type: "string" },
    { column: "tl_name", header: "TL Name", type: "string" },
    { column: "am_name", header: "AM Name", type: "string" },
    { column: "qa_name", header: "QA Name", type: "string" },
    { column: "overall_result", header: "Report Information Report Overall Result", type: "string" },
    { column: "ims_client_name", header: "IMS Client IMS Client Name", type: "string" },
    { column: "document_type", header: "Document Classification- Production + DORCH Document Type Full Name", type: "string" },
    { column: "manual_processing_time_secs", header: "Task Information Task Manual Processing Time (secs)", type: "int" },
    { column: "queue_time_secs", header: "Task Information Task Queue Time (secs)", type: "int" },
    { column: "is_escalated", header: "Task Information Task is escalated (Yes / No)", type: "bool_yes_no" },
    // The field the earlier ONFIDO_DOC_RAW/ONFIDO_DOC_EXTERNAL_AUDIT imports had no
    // source for — who a task was escalated to, and when.
    { column: "escalated_by_email", header: "Task Information Escalated By Email", type: "string" },
    { column: "escalated_time", header: "Task Information Task Escalated Time", type: "date" },
    { column: "month_label", header: "Month", type: "string" },
    { column: "aon_bucket", header: "AON", type: "string" },
    { column: "location", header: "Location", type: "string" },
    { column: "slot", header: "Slot", type: "int" },
  ],
};
ONFIDO_REPORT_CONFIGS.push(ONFIDO_DOC_ETM_CONFIG);

const POA_ETM_HEADERS = [
  "Date", "Task Information Task Completed Time", "Task Information Analyst Email",
  "Task Information Task Type Old", "URLs Continuous Processor Task URL",
  "IMS Client IMS Client Name", "Task Information Task Manual Processing Time (secs)",
  "Document Classification- Production + DORCH Document Type Full Name",
  "Task Information Task Queue Time (secs)", "Report Information Report Sub Result",
  "Task Information Task is escalated (Yes / No)", "Task Information Task Completed Minute",
  "Report Information Report Overall Result", "IDs Report ID",
  "Report Type Client SLA (minutes)", "BPO Organisation BPO Organisation",
  "Report Information Has Driving Licence Information Option (Yes / No)",
  "IMS Client Process Special Characters (Yes / No)", "Task Information Escalated By Email",
  "Task Information Task Escalated Time", "Week", "Month", "TL Name", "AM Name", "AON",
  "Report ID Couvt", "US EU", "Slot",
];

export const ONFIDO_POA_ETM_CONFIG: OnfidoReportConfig = {
  uploadTypeCode: "ONFIDO_POA_ETM",
  uploadTypeName: "Onfido - POA ETM (Escalated Task Management)",
  rpcName: "import_onfido_poa_etm_batch",
  table: "onfido_poa_etm_raw",
  description: "Onfido POA queue per-task export carrying who a task was escalated to/by and when — the ETM Tracker workbook's POA ETM sheet.",
  headers: POA_ETM_HEADERS,
  dedupHeader: "URLs Continuous Processor Task URL",
  dedupColumn: "ims_url",
  extract: [
    { column: "ims_url", header: "URLs Continuous Processor Task URL", type: "string" },
    { column: "report_id", header: "IDs Report ID", type: "string" },
    { column: "report_date", header: "Date", type: "date" },
    { column: "analyst_email", header: "Task Information Analyst Email", type: "string" },
    { column: "tl_name", header: "TL Name", type: "string" },
    { column: "am_name", header: "AM Name", type: "string" },
    { column: "overall_result", header: "Report Information Report Overall Result", type: "string" },
    { column: "ims_client_name", header: "IMS Client IMS Client Name", type: "string" },
    { column: "manual_processing_time_secs", header: "Task Information Task Manual Processing Time (secs)", type: "int" },
    { column: "queue_time_secs", header: "Task Information Task Queue Time (secs)", type: "int" },
    { column: "is_escalated", header: "Task Information Task is escalated (Yes / No)", type: "bool_yes_no" },
    { column: "escalated_by_email", header: "Task Information Escalated By Email", type: "string" },
    { column: "escalated_time", header: "Task Information Task Escalated Time", type: "date" },
    { column: "month_label", header: "Month", type: "string" },
    { column: "aon_bucket", header: "AON", type: "string" },
    { column: "slot", header: "Slot", type: "int" },
  ],
};
ONFIDO_REPORT_CONFIGS.push(ONFIDO_POA_ETM_CONFIG);

// The source workbook's own header row has 4 columns whose leading "pin" emoji was
// mis-encoded upstream (its UTF-8 bytes read back as Windows-1252, then re-saved as
// UTF-8 — a real, permanent corruption in this recurring export's own template, not
// a copy/paste artifact here). Confirmed byte-for-byte via codePointAt on the parsed
// header. Every future export of this same report will carry the identical mangled
// prefix, so it is reproduced verbatim (via \u escapes, so it survives any editor's
// re-encoding) rather than "corrected" to a real emoji — a corrected string would
// simply never match a real uploaded file.
const TASK_SKIP_PIN = "ðŸ“Œ";
const DOC_TASK_SKIP_HEADERS = [
  `${TASK_SKIP_PIN} Manual Tasks Events event data: unassigned from email`,
  `${TASK_SKIP_PIN} Manual Tasks Events event data: resource id`,
  `${TASK_SKIP_PIN} Manual Tasks Events event data: organisation uuid`,
  `${TASK_SKIP_PIN} Manual Tasks Events Continuous Processor Task URL`,
  "Date",
  `${TASK_SKIP_PIN} Manual Tasks Events timestamp Time`,
  `${TASK_SKIP_PIN} Manual Tasks Events event data: task type`,
  "Client Information IMS Client Name", "Analyst Name", "TL's Name", "AM's Name", "Slot",
  "Month", "Week",
];

export const ONFIDO_TASK_SKIP_CONFIG: OnfidoReportConfig = {
  uploadTypeCode: "ONFIDO_TASK_SKIP",
  uploadTypeName: "Onfido - DOC Task Skip",
  rpcName: "import_onfido_task_skip_batch",
  table: "onfido_task_skip_raw",
  description: "Onfido DOC queue tasks that were unassigned/skipped by an analyst — the ETM Tracker workbook's DOC Task Skip sheet.",
  headers: DOC_TASK_SKIP_HEADERS,
  dedupHeader: `${TASK_SKIP_PIN} Manual Tasks Events Continuous Processor Task URL`,
  dedupColumn: "ims_url",
  extract: [
    { column: "ims_url", header: `${TASK_SKIP_PIN} Manual Tasks Events Continuous Processor Task URL`, type: "string" },
    { column: "unassigned_from_email", header: `${TASK_SKIP_PIN} Manual Tasks Events event data: unassigned from email`, type: "string" },
    { column: "resource_id", header: `${TASK_SKIP_PIN} Manual Tasks Events event data: resource id`, type: "string" },
    { column: "skip_date", header: "Date", type: "date" },
    { column: "task_type", header: `${TASK_SKIP_PIN} Manual Tasks Events event data: task type`, type: "string" },
    { column: "ims_client_name", header: "Client Information IMS Client Name", type: "string" },
    // A display name, not an email — unlike every other Onfido table's analyst_email,
    // this source file does not carry the analyst's email address at all.
    { column: "analyst_name", header: "Analyst Name", type: "string" },
    { column: "tl_name", header: "TL's Name", type: "string" },
    { column: "am_name", header: "AM's Name", type: "string" },
    { column: "slot", header: "Slot", type: "int" },
    { column: "month_label", header: "Month", type: "string" },
  ],
};
ONFIDO_REPORT_CONFIGS.push(ONFIDO_TASK_SKIP_CONFIG);

// ── Attrition & Shrinkage workbook: Agent Wise — one row per employee per day.
// The workbook's other sheets (_ASD_LIVE_MONTH_V20 / _ASD_FAST_MONTHLY_CUBE_V9,
// Location/AM/TL/MCN Level Attrition) are either an internal cache of this same
// data or a pre-aggregated pivot of it; Agent Wise is the one genuinely raw,
// per-employee-per-day source, so month/AM/TL/AON/location rollups are computed
// from it in application code — the same approach every other rollup in this
// dashboard uses, rather than importing a pivot redundantly.
const AGENT_DAILY_HEADERS = [
  "Day", "Week", "Date", "Emp ID", "Exception Tracker", "Emp. Name", "Onfido Mail ID",
  "Supervisor", "Trainer", "AM", "MO", "Designation", "Work Type", "DOJ", "Live Date",
  "Inactive Date", "State", "Batch", "Live Days", "AON", "Shift", "Status", "MCN Status",
  "Attendance", "Location", "HC", "Scheduled", "Present", "WP/WHD", "Planned Leave",
  "Unplanned Leave", "Training", "OFF", "Attrition", "Reason", "Attrition Type",
  "Notice Period Status", "HC- Looker", "Month", "WC", "Actual UL",
];

export const ONFIDO_AGENT_DAILY_CONFIG: OnfidoReportConfig = {
  uploadTypeCode: "ONFIDO_AGENT_DAILY",
  uploadTypeName: "Onfido - Agent Wise Attrition & Shrinkage (Daily)",
  rpcName: "import_onfido_agent_daily_batch",
  table: "onfido_agent_daily_raw",
  description: "Onfido process per-employee-per-day roster/attendance/attrition export — the Attrition and Shrinkage workbook's Agent Wise sheet.",
  headers: AGENT_DAILY_HEADERS,
  // No per-row URL in this file — it is a daily HR fact table, not a per-task export.
  // The natural identity is Emp ID + Date (one row per employee per day); a daily
  // whole-month re-upload with corrected values still overwrites the matching
  // employee+day row rather than duplicating it.
  dedupHeaders: ["Emp ID", "Date"],
  dedupColumn: "emp_date_key",
  extract: [
    { column: "emp_date_key", header: "", type: "string" },
    { column: "emp_id", header: "Emp ID", type: "string" },
    { column: "work_date", header: "Date", type: "date" },
    { column: "emp_name", header: "Emp. Name", type: "string" },
    { column: "analyst_email", header: "Onfido Mail ID", type: "string" },
    { column: "tl_name", header: "Supervisor", type: "string" },
    { column: "am_name", header: "AM", type: "string" },
    { column: "designation", header: "Designation", type: "string" },
    { column: "state", header: "State", type: "string" },
    { column: "location", header: "Location", type: "string" },
    { column: "batch_label", header: "Batch", type: "string" },
    { column: "aon_bucket", header: "AON", type: "string" },
    { column: "hc", header: "HC", type: "int" },
    { column: "scheduled", header: "Scheduled", type: "int" },
    { column: "present", header: "Present", type: "int" },
    { column: "planned_leave", header: "Planned Leave", type: "int" },
    { column: "unplanned_leave", header: "Unplanned Leave", type: "int" },
    { column: "actual_ul", header: "Actual UL", type: "float" },
    { column: "attrition_flag", header: "Attrition", type: "int" },
    { column: "attrition_reason", header: "Reason", type: "string" },
    { column: "attrition_type", header: "Attrition Type", type: "string" },
    { column: "month_label", header: "Month", type: "string" },
  ],
};
ONFIDO_REPORT_CONFIGS.push(ONFIDO_AGENT_DAILY_CONFIG);

export function getOnfidoConfigByRpc(rpcName: string): OnfidoReportConfig | undefined {
  return ONFIDO_REPORT_CONFIGS.find((c) => c.rpcName === rpcName);
}
