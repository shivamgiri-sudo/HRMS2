/**
 * Which raw source tables feed each Process Performance V2 report, so the
 * Excel export can attach them as extra sheets. Every table name, date
 * expression and extra filter below is a hard-coded constant -- nothing here
 * is ever built from request input (the request only supplies a dashboard
 * key, a date range and an LOB value, and the last two are always bound as
 * `?` parameters). An unknown dashboard key is rejected by the route.
 *
 * Date expressions mirror the ones each report's own service already uses,
 * so a raw sheet holds exactly the rows the report was computed from. A
 * source with no `dateExpr` is exported in full: those reports either have
 * no date range at all (Birlanu, Housing Premium, Satya Retail) or filter
 * in application code on free-text columns that cannot be range-filtered
 * reliably in SQL (Housing Owner) -- the "Raw Data Notes" sheet says so
 * rather than silently implying the rows were date-filtered.
 */

export interface MasmisRawSource {
  kind: "masmis";
  /** Sheet name, prefixed with "Raw - " by the exporter. */
  sheet: string;
  /** Real table name in db_masmis (case-sensitive on the Linux host). */
  table: string;
  /** SQL expression yielding a DATE for each row. Omit to export every row. */
  dateExpr?: string;
  /** Column an optional LOB filter applies to (bound as a parameter). */
  lobColumn?: string;
  /** Constant SQL fragment, e.g. "campaign = 'Chat'". Never contains input. */
  extraWhere?: string;
  /** Extra columns to leave out of this sheet (e.g. a free-text chat transcript full of customer details). */
  excludeColumns?: string[];
  /** Shown in the Raw Data Notes sheet. */
  note?: string;
}

export interface DialerRawSource {
  kind: "dialer";
  sheet: string;
  /** Key of a project in call-master/inbound.service.ts PROJECTS. */
  projectKey: string;
}

export type RawSource = MasmisRawSource | DialerRawSource;

/** Columns that are upload bookkeeping, not business data. */
export const EXCLUDED_RAW_COLUMNS = new Set(["upload_batch_id", "uploaded_by"]);

// Same shapes the Neemans service documents for its mixed-format `date` columns.
const NEEMANS_SALE_DATE = `CASE
  WHEN date REGEXP '^[0-9]+$' THEN DATE_ADD('1899-12-30', INTERVAL CAST(date AS UNSIGNED) DAY)
  WHEN date REGEXP '^[0-9]{1,2}-[A-Za-z]{3}-[0-9]{4}$' THEN STR_TO_DATE(date, '%e-%b-%Y')
  WHEN date REGEXP '^[0-9]{1,2}-[A-Za-z]{3}-[0-9]{2}$' THEN STR_TO_DATE(date, '%e-%b-%y')
  ELSE NULL
END`;
const NEEMANS_ALLOC_DATE = `CASE
  WHEN date REGEXP '^[0-9]+$' THEN DATE_ADD('1899-12-30', INTERVAL CAST(date AS UNSIGNED) DAY)
  WHEN date REGEXP '^[0-9]{1,2}-[A-Za-z]{3}-[0-9]{2}$' THEN STR_TO_DATE(date, '%e-%b-%y')
  ELSE NULL
END`;
const D_MON_YY = (col: string) => `STR_TO_DATE(${col}, '%e-%b-%y')`;
const AW_DATE = (c: string) =>
  `CASE WHEN ${c} REGEXP '^[0-9]{5}$' THEN DATE_ADD('1899-12-30', INTERVAL CAST(${c} AS UNSIGNED) DAY) ` +
  `WHEN ${c} REGEXP '^[0-9]{1,2}-[A-Za-z]{3}-[0-9]{2}$' THEN STR_TO_DATE(${c}, '%e-%b-%y') ELSE NULL END`;

const NO_RANGE_NOTE = "Exported in full: this report does not filter these rows by the selected date range.";

export const RAW_SOURCES: Record<string, RawSource[]> = {
  gnc_sale: [
    { kind: "masmis", sheet: "gnc_sale", table: "gnc_sale", dateExpr: "sale_date" },
    { kind: "masmis", sheet: "gnc_allocation", table: "gnc_allocation", dateExpr: "alloc_date" },
    { kind: "masmis", sheet: "gnc_apr", table: "gnc_apr", dateExpr: "report_date" },
  ],
  gnc_inbound: [{ kind: "dialer", sheet: "GNC inbound calls", projectKey: "gnc" }],
  gnc_chat: [
    { kind: "masmis", sheet: "gnc_chat", table: "gnc_chat", dateExpr: D_MON_YY("report_date") },
    {
      kind: "masmis", sheet: "gnc_sale (Chat)", table: "gnc_sale", dateExpr: "sale_date", extraWhere: "campaign = 'Chat'",
      note: "Sale rows the Orders/Revenue KPIs come from (campaign = 'Chat'). Linked to chat agents by name only -- see the dashboard's Sale Linkage note for names that don't match.",
    },
  ],

  inbound_dubangladesh: [{ kind: "dialer", sheet: "DU Bangladesh inbound calls", projectKey: "dubangladesh" }],
  inbound_exicom: [{ kind: "dialer", sheet: "Exicom inbound calls", projectKey: "exicom" }],
  inbound_viega: [{ kind: "dialer", sheet: "Viega inbound calls", projectKey: "viega" }],
  inbound_dalmia: [{ kind: "dialer", sheet: "Dalmia inbound calls", projectKey: "dalmia" }],
  inbound_neemans: [{ kind: "dialer", sheet: "Neemans inbound calls", projectKey: "neemans" }],
  inbound_gnc: [{ kind: "dialer", sheet: "GNC inbound calls", projectKey: "gnc" }],
  inbound_bellavita: [{ kind: "dialer", sheet: "Bellavita inbound calls", projectKey: "bellavita" }],
  inbound_clovia: [{ kind: "dialer", sheet: "Clovia inbound calls", projectKey: "clovia" }],

  bellavita_sale: [
    { kind: "masmis", sheet: "bb_sale", table: "bb_sale", dateExpr: "`Date`" },
    { kind: "masmis", sheet: "bb_apr", table: "bb_apr", dateExpr: "report_date" },
  ],
  bellavita_agent_performance: [
    { kind: "masmis", sheet: "bb_apr", table: "bb_apr", dateExpr: "report_date" },
    { kind: "masmis", sheet: "bb_sale", table: "bb_sale", dateExpr: "`Date`" },
  ],
  bellavita_chat: [
    { kind: "masmis", sheet: "bb_chat", table: "bb_chat", dateExpr: "chat_date", lobColumn: "lob" },
    {
      kind: "masmis", sheet: "bb_sale (Chat)", table: "bb_sale", dateExpr: "`Date`", extraWhere: "campaign = 'Chat'",
      note: "Sale rows the Revenue/AOV figures come from (campaign = 'Chat'). Not narrowed by the LOB filter: bb_sale has no Bevzilla/Kenaz split.",
    },
  ],
  bellavita_chat_overview: [
    {
      kind: "masmis", sheet: "new_bb_chat", table: "new_bb_chat", dateExpr: "chat_date",
      extraWhere: "user_type IN ('Chat','Kenaz','Bevzilla')",
      note: "Chats behind the Overview snapshot: user_type Chat, Kenaz or Bevzilla only (Email is excluded).",
    },
    {
      kind: "masmis", sheet: "bb_chat (dispositions)", table: "bb_chat", dateExpr: "chat_date",
      extraWhere: "user_type IN ('Chat','Kenaz','Bevzilla')",
      note: "Older chat table. The BVO Chat QRC rows take each day's dispositions from new_bb_chat when it has them, otherwise from this table (identical chats where both exist).",
    },
    {
      kind: "masmis", sheet: "bb_sale (Sale Made)", table: "bb_sale", dateExpr: "`Date`",
      extraWhere: "campaign = 'Chat' AND calling_status = 'Sale Made'",
      note: "Every sale row, one per order line item. Sale Made and Revenue count each bella_vita_order_id once, so this sheet holds more rows than the snapshot's Sale Made. bb_sale has no Kenaz/Bevzilla split.",
    },
  ],
  bellavita_cart: [
    { kind: "masmis", sheet: "bb_cart", table: "bb_cart", dateExpr: D_MON_YY("call_date") },
    {
      kind: "masmis", sheet: "bb_sale (Abandon Cart)", table: "bb_sale", dateExpr: "`Date`", extraWhere: "campaign = 'Abandon Cart'",
      note: "Sale rows the Abandon Cart Revenue / Sale Count figures come from (campaign = 'Abandon Cart').",
    },
  ],

  neemans_performance: [
    { kind: "masmis", sheet: "neemans_sale_raw", table: "neemans_sale_raw", dateExpr: NEEMANS_SALE_DATE },
    { kind: "masmis", sheet: "neemans_allocation", table: "neemans_allocation", dateExpr: NEEMANS_ALLOC_DATE },
    { kind: "masmis", sheet: "neemans_apr", table: "neemans_apr", dateExpr: NEEMANS_SALE_DATE },
    { kind: "masmis", sheet: "neemans_chat", table: "neemans_chat", dateExpr: D_MON_YY("report_date") },
    { kind: "masmis", sheet: "neemans_cart", table: "neemans_cart", dateExpr: "call_date" },
    { kind: "masmis", sheet: "nms_Agent_Details", table: "nms_Agent_Details", note: "Agent roster/targets -- not date based." },
    { kind: "masmis", sheet: "neemans_month_targets", table: "neemans_month_targets", note: "Monthly targets -- not date based." },
    { kind: "dialer", sheet: "Neemans inbound calls", projectKey: "neemans" },
  ],
  neemans_chat: [
    { kind: "masmis", sheet: "neemans_chat", table: "neemans_chat", dateExpr: D_MON_YY("report_date") },
  ],
  neemans_cart: [
    { kind: "masmis", sheet: "neemans_cart", table: "neemans_cart", dateExpr: "call_date" },
  ],

  housing_owner: [
    { kind: "masmis", sheet: "owner_sale", table: "owner_sale", note: NO_RANGE_NOTE },
    { kind: "masmis", sheet: "Owner_cdr", table: "Owner_cdr", note: NO_RANGE_NOTE },
    { kind: "masmis", sheet: "owner_agent_details", table: "owner_agent_details", note: "Agent roster/targets -- not date based." },
  ],
  housing_premium: [
    { kind: "masmis", sheet: "pre_sale", table: "pre_sale", note: NO_RANGE_NOTE },
    { kind: "masmis", sheet: "Pre_cdr", table: "Pre_cdr", note: NO_RANGE_NOTE },
    { kind: "masmis", sheet: "pre_agent_details", table: "pre_agent_details", note: "Agent roster/targets -- not date based." },
  ],

  lp_feedback: [
    { kind: "masmis", sheet: "lp_feedback_apr", table: "lp_feedback_apr", dateExpr: D_MON_YY("report_date") },
    { kind: "masmis", sheet: "lp_feedback_cdr", table: "lp_feedback_cdr", dateExpr: D_MON_YY("report_date") },
  ],
  lp_onboarding: [
    { kind: "masmis", sheet: "lp_onboarding_apr", table: "lp_onboarding_apr", dateExpr: D_MON_YY("report_date") },
    { kind: "masmis", sheet: "lp_onboarding_cdr", table: "lp_onboarding_cdr", dateExpr: D_MON_YY("report_date") },
  ],

  satya_retail: [
    { kind: "masmis", sheet: "satya_allocation", table: "satya_allocation", note: NO_RANGE_NOTE },
    { kind: "masmis", sheet: "satya_cdr", table: "satya_cdr", note: NO_RANGE_NOTE },
  ],
  // The "Calling & Order Tracking" report filters both tables by report_date and
  // by warehouse, so its raw sheets do too (an 'Unmapped' warehouse has no real
  // column value to bind, so the client omits the lob filter for it).
  satya_retail_report: [
    { kind: "masmis", sheet: "satya_allocation", table: "satya_allocation", dateExpr: D_MON_YY("report_date"), lobColumn: "warehouse", note: "Rows exactly as uploaded -- includes older duplicate allocation rows that the report skips (see its Data checks page)." },
    { kind: "masmis", sheet: "satya_cdr", table: "satya_cdr", dateExpr: D_MON_YY("report_date"), lobColumn: "warehouse" },
  ],

  // Appreciate Wealth: call_date is mixed text ("5-Sep-26") / Excel serial ("46270"); the expression handles both.
  // Raw sheets are exactly as uploaded (re-uploads included); the dashboard de-duplicates them (see Data Health).
  appreciate_wealth: [
    { kind: "masmis", sheet: "aw_billing", table: "aw_billing", dateExpr: AW_DATE("call_date") },
    { kind: "masmis", sheet: "aw_out", table: "aw_out", dateExpr: AW_DATE("call_date") },
    { kind: "masmis", sheet: "aw_inbound", table: "aw_inbound", dateExpr: AW_DATE("call_date") },
    { kind: "masmis", sheet: "aw_new_cdr", table: "aw_new_cdr", dateExpr: AW_DATE("call_date") },
    { kind: "masmis", sheet: "aw_mandate", table: "aw_mandate", note: "Monthly config (month is text/Excel serial) -- exported in full, not date-filtered." },
  ],

  birlanu: [
    { kind: "masmis", sheet: "birlanu_sale", table: "birlanu_sale", note: NO_RANGE_NOTE },
    { kind: "masmis", sheet: "birlanu_apr", table: "birlanu_apr", note: NO_RANGE_NOTE },
  ],

  clovia: [
    { kind: "masmis", sheet: "cl_apr", table: "cl_apr", dateExpr: D_MON_YY("report_date") },
    { kind: "masmis", sheet: "cl_chat", table: "cl_chat", dateExpr: "DATE(date_time)" },
    { kind: "masmis", sheet: "cl_dispo", table: "cl_dispo", dateExpr: "STR_TO_DATE(report_date, '%d/%m/%Y %H:%i:%s')" },
    { kind: "masmis", sheet: "cl_email_raw", table: "cl_email_raw", dateExpr: D_MON_YY("report_date") },
    { kind: "masmis", sheet: "cl_feedback", table: "cl_feedback", dateExpr: D_MON_YY("report_date") },
    { kind: "masmis", sheet: "cl_outbound", table: "cl_outbound", dateExpr: "STR_TO_DATE(call_date, '%c/%e/%y')" },
    { kind: "masmis", sheet: "cl_quality", table: "cl_quality", dateExpr: D_MON_YY("audit_date") },
    { kind: "masmis", sheet: "cl_rechurn_call", table: "cl_rechurn_call", dateExpr: D_MON_YY("report_date") },
    { kind: "dialer", sheet: "Clovia inbound calls", projectKey: "clovia" },
  ],

  // Per-LOB Clovia slides. Same date expressions as the LOB services. The chat sheet leaves out the
  // raw transcript column (customer names / numbers / order details); the LOB filter on quality and
  // dispositions matches how each slide selects them (cl_quality.lob, cl_dispo.skill).
  clovia_inbound: [
    { kind: "dialer", sheet: "Clovia inbound calls", projectKey: "clovia" },
    { kind: "masmis", sheet: "cl_feedback", table: "cl_feedback", dateExpr: D_MON_YY("report_date") },
    { kind: "masmis", sheet: "cl_rechurn_call", table: "cl_rechurn_call", dateExpr: D_MON_YY("report_date") },
    { kind: "masmis", sheet: "cl_quality (Inbound)", table: "cl_quality", dateExpr: D_MON_YY("audit_date"), extraWhere: "lob = 'Inbound'" },
    { kind: "masmis", sheet: "cl_dispo (inbound)", table: "cl_dispo", dateExpr: "STR_TO_DATE(report_date, '%d/%m/%Y %H:%i:%s')", extraWhere: "skill = 'inbound'", note: "Tickets with a blank skill are excluded (see the Tickets tab skill mix)." },
  ],
  clovia_email: [
    { kind: "masmis", sheet: "cl_email_raw", table: "cl_email_raw", dateExpr: D_MON_YY("report_date"), note: "Raw rows: exact duplicate uploads are still present here; the slide removes them (latest upload per date + agent)." },
    { kind: "masmis", sheet: "cl_quality (Email)", table: "cl_quality", dateExpr: D_MON_YY("audit_date"), extraWhere: "lob = 'Email'" },
    { kind: "masmis", sheet: "cl_dispo (email)", table: "cl_dispo", dateExpr: "STR_TO_DATE(report_date, '%d/%m/%Y %H:%i:%s')", extraWhere: "skill = 'email'" },
  ],
  clovia_chat: [
    { kind: "masmis", sheet: "cl_chat", table: "cl_chat", dateExpr: "DATE(date_time)", excludeColumns: ["chat_transcript"], note: "Transcript column omitted on purpose. Duplicate chat_id rows are still present here; the slide removes them." },
    { kind: "masmis", sheet: "cl_quality (Chat)", table: "cl_quality", dateExpr: D_MON_YY("audit_date"), extraWhere: "lob = 'Chat'" },
    { kind: "masmis", sheet: "cl_dispo (chat)", table: "cl_dispo", dateExpr: "STR_TO_DATE(report_date, '%d/%m/%Y %H:%i:%s')", extraWhere: "skill = 'chat'" },
  ],
  clovia_outbound: [
    { kind: "masmis", sheet: "cl_outbound", table: "cl_outbound", dateExpr: "STR_TO_DATE(call_date, '%c/%e/%y')" },
    { kind: "masmis", sheet: "cl_quality (Outbound)", table: "cl_quality", dateExpr: D_MON_YY("audit_date"), extraWhere: "lob = 'Outbound'" },
    { kind: "masmis", sheet: "cl_dispo (outbound)", table: "cl_dispo", dateExpr: "STR_TO_DATE(report_date, '%d/%m/%Y %H:%i:%s')", extraWhere: "skill = 'outbound'" },
  ],
};
