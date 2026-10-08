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
 * Why this file registers ONE upload type and not six.
 *
 * Every other dataset in the Bella Vita workbooks is already held by a system,
 * verified live 2026-09-08 across all eight visible schemas:
 *
 *   - Orders / sales / revenue -> db_masmis.bvo_order_export (3,050,861 rows,
 *     Shopify BVO ids) and db_masmis.bb_sale (23,391 rows).
 *   - Cancellations / RTO -> db_masmis.bb_sale carries them natively:
 *     final_status='RTO' (2,996), plus rto_status and rto_initiated_datetime.
 *     Its `lob` column already splits Repeat / Chat / Abandon Cart / Inbound.
 *   - Abandoned-cart lead allocation -> db_masmis.bb_cart (48,000 rows) with
 *     agent, disposition and same_day_connect.
 *   - Call detail -> dialer_db. Inbound alone carries ~576k Bella Vita calls
 *     (H_/E_Bellavita_* on cdr_in_11_5, Blabliblu_IN on cdr_in_10_4) back to
 *     Jan-2024; outbound BELLA_O on cdr_ob_11_5 is larger still.
 *   - Slot-wise inbound SLA -> computed live by inbound-ops.service.ts (project
 *     "bellavita") and process-performance/kpi-cdr-source.ts. The workbook's
 *     "Slot Wise SLA Raw" tab is a stale copy: all 500 rows in the Aug-2026 file
 *     are dated 2023.
 *   - APR / utilisation -> mas_hrms.apr, and db_masmis.bb_apr.
 *
 * The daily target plan is the only genuine gap: db_masmis has
 * neemans_month_targets but no Bella equivalent, and a target is a plan someone
 * commits to, not an observation any system emits. So it is the only thing here.
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

// -- 1. Targets -------------------------------------------------------------
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

export function getBellaConfigByRpc(rpcName: string): BellaReportConfig | undefined {
  return BELLA_REPORT_CONFIGS.find((c) => c.rpcName === rpcName);
}
