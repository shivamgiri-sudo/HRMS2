/**
 * Bella Vita process raw-data report formats.
 *
 * The Bella Vita account runs four LOBs across two workbook families:
 *   - "B-3" (BLA / BLI / BLU — the three brands) with ABC Cart, Upgrade and
 *     Inbound sub-LOBs, exported as BLA BLI BLU_Master_Dashboard <Month>.xlsb
 *   - "Repeat Customer LOB", exported as Bella Vita Repeat LOB Mis Dashboard.xlsb
 *
 * Only genuinely RAW facts are ingested here. The workbooks also carry many
 * pre-aggregated sheets (Agent Wise View, Category/Product Wise, Day Wise
 * Lineitem, MBR_Snap, Top Ten Item Tracker, the Dashboard tabs). Every one of
 * those is computable from the four sources below, so they are deliberately NOT
 * imported — importing a pivot alongside the facts it came from is how you end
 * up with two engines that disagree about the same number.
 *
 * APR / utilisation is likewise absent on purpose: the "APR-Utilization Raw"
 * and "APR" sheets already have a home in mas_hrms.apr, fed by the existing APR
 * upload path. Nothing here duplicates it.
 *
 * Structure mirrors onfido-report-configs.ts exactly: every table stores the
 * FULL row as `raw_data` JSON keyed by the exact source header, and a handful of
 * columns are pulled out and indexed. The `extract` map is the single source of
 * truth that both the table DDL (scripts/setup-bella-reports.ts) and the import
 * service (bella-raw-bulk.service.ts) read from.
 *
 * A note on duplicate headers: some of these sheets repeat a column name
 * ("Customer Number" twice in Sale Raw, "CON" twice in Received Data). The
 * frontend parses a file row into an object
 * keyed by header before it ever reaches the backend, so a repeated name keeps
 * only its last value in `raw_data`. That is harmless here — in every case the
 * repeat is a display copy of a column already extracted by name — but it is the
 * reason no `extract` entry below points at a duplicated header.
 */

/*
 * Two datasets that looked missing are deliberately absent: dialer_db already
 * holds them, live and far more completely than the monthly workbook.
 *
 *   - Call detail records. The workbook's "CDR Cart ABC"/"CDR Upgrade" sheets are
 *     a hand-copy of dialer_db. Inbound alone carries ~576k Bella Vita calls
 *     (H_/E_Bellavita_Organic/Luxury on cdr_in_11_5, Blabliblu_IN on cdr_in_10_4)
 *     back to Jan-2024 and current to yesterday; outbound BELLA_O on cdr_ob_11_5
 *     is larger still. AgentId there already carries the MAS employee code.
 *   - Slot-wise inbound SLA. Derivable from those same tables, and already
 *     computed live by quality-dashboard/inbound-ops.service.ts (project key
 *     "bellavita") and process-performance/kpi-cdr-source.ts. The workbook's
 *     "Slot Wise SLA Raw" tab is a stale copy: every one of its 500 rows in the
 *     August 2026 file is dated 2023.
 */

export type BellaFieldExtract = {
  /** DB column name for the indexed/extracted field. */
  column: string;
  /** Exact source header this is read from (must match a header in `headers`). */
  header: string;
  /** How to coerce the raw string value before insert. */
  type: "string" | "date" | "int" | "float" | "bool_yes_no";
};

export type BellaReportConfig = {
  /** upload_template_master.upload_type_code */
  uploadTypeCode: string;
  /** Human label shown in the Bulk Upload Hub. */
  uploadTypeName: string;
  /** Frontend IMPORT_RPC_BY_TYPE / backend KNOWN_IMPORT_RPCS key. */
  rpcName: string;
  /** Destination table in bella_db. */
  table: string;
  description: string;
  /** Exact column headers as they appear in the source file (order preserved). */
  headers: string[];
  /** Header used as the natural dedup key. Omit when `dedupHeaders` is used. */
  dedupHeader?: string;
  dedupColumn: string;
  /** Composite natural key — the "|"-joined values of these headers. */
  dedupHeaders?: string[];
  extract: BellaFieldExtract[];
};

export const BELLA_REPORT_CONFIGS: BellaReportConfig[] = [];

// -- 1. Sales ---------------------------------------------------------------
// B-3 workbook, "Overall Sales Raw" sheet - one row per sold line item.
const SALE_RAW_HEADERS = [
  "Week", "Date", "EMP ID", "Emp_Name", "Customer Number", "E-mail ID", "Payment Status",
  "Amount", "OrderID", "Campaign", "Calling Status", "Discount Code", "Count",
  "Current Status", "Lineitem sku", "New sold line item", "Created By",
  "Order Creation time", "Call Date & Time", "Call Duration", "Countifs of calls", "Diff",
  "Lead_Line_Item", "Source", "Business", "Campagin", "New sold line item Categoty",
  "For Unique sales", "Alternate number", "Recording Link",
];

export const BELLA_SALE_RAW_CONFIG: BellaReportConfig = {
  uploadTypeCode: "BELLA_SALE_RAW",
  uploadTypeName: "Bella Vita - Sales Raw (Order Line Items)",
  rpcName: "import_bella_sale_raw_batch",
  table: "bella_sale_raw",
  description:
    "Bella Vita per-order-line sales export - the B-3 Master Dashboard workbook's 'Overall Sales Raw' sheet. One row per line item sold, carrying the MAS employee code so revenue attributes to a person.",
  headers: SALE_RAW_HEADERS,
  // One order can carry several line items, so OrderID alone is not row identity.
  // Date + EMP ID + OrderID groups them; the occurrence suffix the import service
  // adds to `id` keeps each line item its own row while still letting a re-upload
  // of an overlapping day upsert rather than duplicate.
  dedupHeaders: ["Date", "EMP ID", "OrderID"],
  dedupColumn: "sale_key",
  extract: [
    { column: "sale_key", header: "", type: "string" },
    { column: "work_date", header: "Date", type: "date" },
    { column: "week_label", header: "Week", type: "string" },
    { column: "emp_id", header: "EMP ID", type: "string" },
    { column: "emp_name", header: "Emp_Name", type: "string" },
    { column: "order_id", header: "OrderID", type: "string" },
    { column: "payment_status", header: "Payment Status", type: "string" },
    { column: "amount", header: "Amount", type: "float" },
    { column: "campaign", header: "Campaign", type: "string" },
    { column: "calling_status", header: "Calling Status", type: "string" },
    { column: "discount_code", header: "Discount Code", type: "string" },
    { column: "current_status", header: "Current Status", type: "string" },
    { column: "lineitem_sku", header: "Lineitem sku", type: "string" },
    { column: "sold_line_item", header: "New sold line item", type: "string" },
    { column: "sold_category", header: "New sold line item Categoty", type: "string" },
    { column: "lead_line_item", header: "Lead_Line_Item", type: "string" },
    { column: "sale_source", header: "Source", type: "string" },
    { column: "business", header: "Business", type: "string" },
    { column: "call_duration", header: "Call Duration", type: "string" },
  ],
};
BELLA_REPORT_CONFIGS.push(BELLA_SALE_RAW_CONFIG);

// -- 2. Lead allocation -----------------------------------------------------
// B-3 workbook, "Received Data" sheet - one row per lead per day, with the
// attempt ladder (same day / D-1 / D-2) and DND state.
const LEAD_HEADERS = [
  "Date", "Phone", "Customer Name", "Address", "Email ID", "Product", "Amount",
  "Source File", "Checkout", "CON", "For Unique", "DND", "D-1 NC", "D-2 NC", "D-3 NC",
  "BBB All", "Emp Id", "Emp Name", "Workable", "Call Answer With in Same Day",
  "Same Day Attempt", "D-1 Attempt", "D-2 Attempt", "LOB", "CON", "Data Type",
  "Final Dispo", "Final Dispo1", "Final Dispo2", "Remarks",
];

export const BELLA_LEAD_ALLOCATION_CONFIG: BellaReportConfig = {
  uploadTypeCode: "BELLA_LEAD_ALLOCATION",
  uploadTypeName: "Bella Vita - Lead Allocation / Received Data (Daily)",
  rpcName: "import_bella_lead_allocation_batch",
  table: "bella_lead_allocation_raw",
  description:
    "Bella Vita per-lead-per-day allocation export - the B-3 Master Dashboard workbook's 'Received Data' sheet. Carries which agent a lead was allocated to, whether it was workable, the DND flag and the attempt ladder.",
  headers: LEAD_HEADERS,
  dedupHeaders: ["Date", "Phone"],
  dedupColumn: "lead_key",
  extract: [
    { column: "lead_key", header: "", type: "string" },
    { column: "work_date", header: "Date", type: "date" },
    { column: "phone", header: "Phone", type: "string" },
    { column: "product", header: "Product", type: "string" },
    { column: "amount", header: "Amount", type: "float" },
    { column: "source_file", header: "Source File", type: "string" },
    { column: "dnd_status", header: "DND", type: "string" },
    { column: "emp_id", header: "Emp Id", type: "string" },
    { column: "emp_name", header: "Emp Name", type: "string" },
    { column: "workable", header: "Workable", type: "string" },
    { column: "lob", header: "LOB", type: "string" },
    { column: "data_type", header: "Data Type", type: "string" },
    { column: "final_dispo", header: "Final Dispo", type: "string" },
    { column: "same_day_attempt", header: "Same Day Attempt", type: "int" },
    { column: "d1_attempt", header: "D-1 Attempt", type: "int" },
    { column: "d2_attempt", header: "D-2 Attempt", type: "int" },
  ],
};
BELLA_REPORT_CONFIGS.push(BELLA_LEAD_ALLOCATION_CONFIG);

// -- 3. Targets -------------------------------------------------------------
// B-3 workbook, "ABC Target vs Achievment" / "Upgrade Target vs Achievment".
// Those sheets are laid out as three side-by-side panels (plan | achievement |
// summary) separated by blank columns. Only the FIRST panel - the plan - is a
// real input; the achievement panels are computed from sales and are therefore
// left out, same reasoning as the pivot sheets above.
//
// The sheet itself carries no LOB column (the LOB is which sheet you opened), so
// the template adds one required "LOB" column. Without it, an ABC upload and an
// Upgrade upload for the same date would collide on the dedup key.
const TARGET_HEADERS = [
  "Date", "Data", "Workable Data", "Required Data", "Capped Data at 110%", "Conversion",
  "Target Sale", "Prepaid %", "RTO%", "Revenue", "LOB",
];

export const BELLA_TARGET_PLAN_CONFIG: BellaReportConfig = {
  uploadTypeCode: "BELLA_TARGET_PLAN",
  uploadTypeName: "Bella Vita - Daily Target Plan by LOB",
  rpcName: "import_bella_target_plan_batch",
  table: "bella_target_plan_raw",
  description:
    "Bella Vita daily target plan - the plan panel (columns A-J) of the B-3 workbook's 'ABC Target vs Achievment' and 'Upgrade Target vs Achievment' sheets. Add an LOB column naming which sheet the rows came from (ABC or Upgrade) before uploading.",
  headers: TARGET_HEADERS,
  dedupHeaders: ["Date", "LOB"],
  dedupColumn: "target_key",
  extract: [
    { column: "target_key", header: "", type: "string" },
    { column: "plan_date", header: "Date", type: "date" },
    { column: "lob", header: "LOB", type: "string" },
    { column: "data_count", header: "Data", type: "int" },
    { column: "workable_data", header: "Workable Data", type: "int" },
    { column: "required_data", header: "Required Data", type: "float" },
    { column: "capped_data_110", header: "Capped Data at 110%", type: "float" },
    { column: "conversion_rate", header: "Conversion", type: "float" },
    { column: "target_sale", header: "Target Sale", type: "float" },
    { column: "prepaid_pct", header: "Prepaid %", type: "float" },
    { column: "rto_pct", header: "RTO%", type: "float" },
    { column: "target_revenue", header: "Revenue", type: "float" },
  ],
};
BELLA_REPORT_CONFIGS.push(BELLA_TARGET_PLAN_CONFIG);

// -- 4. Cancellations / RTO -------------------------------------------------
// Repeat LOB workbook, "Cancelled Orders" sheet - cancellation and
// return-to-origin outcomes, which is what turns a booked sale into lost revenue.
const CANCELLED_HEADERS = [
  "Week", "Date", "EMP ID", "Emp_Name", "TL", "T1", "T2", "FHD", "T3", "Phone Number",
  "E-mail ID", "Payment Status", "Amount", "BellaVitaOderID", "Campaign", "Calling Status",
  "Discount Code", "Count", "Current Status", "Final Status", "Order Date&Time", "State",
  "Line Item Name", "Pincode", "Order Date", "24Hrs&48hrs", "Crazy Deal", "Perfume", "Size",
  "Order Pickup Date", "RTO Initiated Date", "Diff Hour", "LOB", "Pincode Relevent",
  "RTO Status", "Draft Order", "Target", "Sale Source Name", "Status",
];

export const BELLA_CANCELLED_ORDER_CONFIG: BellaReportConfig = {
  uploadTypeCode: "BELLA_CANCELLED_ORDER",
  uploadTypeName: "Bella Vita - Cancelled Orders & RTO",
  rpcName: "import_bella_cancelled_order_batch",
  table: "bella_cancelled_order_raw",
  description:
    "Bella Vita cancellation and return-to-origin export - the Repeat LOB workbook's 'Cancelled Orders' sheet. One row per cancelled or returned order, with the agent and TL it is attributed to.",
  headers: CANCELLED_HEADERS,
  dedupHeaders: ["BellaVitaOderID", "EMP ID"],
  dedupColumn: "cancel_key",
  extract: [
    { column: "cancel_key", header: "", type: "string" },
    { column: "work_date", header: "Date", type: "date" },
    { column: "week_label", header: "Week", type: "string" },
    { column: "emp_id", header: "EMP ID", type: "string" },
    { column: "emp_name", header: "Emp_Name", type: "string" },
    { column: "tl_name", header: "TL", type: "string" },
    { column: "order_id", header: "BellaVitaOderID", type: "string" },
    { column: "phone_number", header: "Phone Number", type: "string" },
    { column: "payment_status", header: "Payment Status", type: "string" },
    { column: "amount", header: "Amount", type: "float" },
    { column: "campaign", header: "Campaign", type: "string" },
    { column: "calling_status", header: "Calling Status", type: "string" },
    { column: "current_status", header: "Current Status", type: "string" },
    { column: "final_status", header: "Final Status", type: "string" },
    { column: "state", header: "State", type: "string" },
    { column: "line_item_name", header: "Line Item Name", type: "string" },
    { column: "pincode", header: "Pincode", type: "string" },
    { column: "order_date", header: "Order Date", type: "date" },
    { column: "rto_initiated_date", header: "RTO Initiated Date", type: "date" },
    { column: "rto_status", header: "RTO Status", type: "string" },
    { column: "lob", header: "LOB", type: "string" },
    { column: "sale_source_name", header: "Sale Source Name", type: "string" },
    { column: "order_status", header: "Status", type: "string" },
  ],
};
BELLA_REPORT_CONFIGS.push(BELLA_CANCELLED_ORDER_CONFIG);

export function getBellaConfigByRpc(rpcName: string): BellaReportConfig | undefined {
  return BELLA_REPORT_CONFIGS.find((c) => c.rpcName === rpcName);
}
