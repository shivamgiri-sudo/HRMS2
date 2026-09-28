/**
 * The TPZ Process (Process Performance V2) catalogue: which processes exist, which API paths serve their dashboards, which
 * upload types and import functions their uploaders use, and which process_master rows tie a process to a branch.
 *
 * Kept in step with src/pages/ProcessPerformanceV2Page.tsx (COMPANIES / UPLOADERS_BY_COMPANY) and
 * src/components/process-performance/BellavitaMasmisUploader.tsx (RPC_BY_TYPE). A path or upload type that is NOT listed
 * here is simply not governed by TPZ grants and behaves exactly as it did before.
 */

export interface TpzCompany {
  key: string;
  label: string;
  /** process_master.process_code values of this process -- how a branch grant finds it. Empty = not tied to a branch. */
  processCodes: string[];
  /** Path prefixes under /api/process-performance that serve this process's dashboards. */
  perfPrefixes: string[];
  /** /api/inbound-insights/:key and /api/inbound/project/:key project keys. */
  inboundKeys: string[];
  /** upload_type_code -> the import function its uploader calls. */
  uploads: Record<string, string>;
}

export const TPZ_COMPANIES: TpzCompany[] = [
  {
    key: "bellavita", label: "Bellavita", processCodes: ["BELLA_VITA"],
    perfPrefixes: ["/bellavita-sale-dashboard", "/bellavita-agent-performance", "/bellavita-chat-dashboard", "/bellavita-cart-dashboard"],
    inboundKeys: ["bellavita"],
    uploads: {
      BB_SALE_MASMIS: "import_bb_sale_masmis_batch", BB_APR_MASMIS: "import_bb_apr_masmis_batch",
      BB_CHAT_MASMIS: "import_bb_chat_masmis_batch", BB_CART_MASMIS: "import_bb_cart_masmis_batch",
    },
  },
  {
    key: "gnc", label: "GNC", processCodes: ["GNC"],
    perfPrefixes: ["/gnc-sale-dashboard", "/gnc-chat-dashboard", "/gnc-abandon-cart-dashboard", "/gnc-targets"],
    inboundKeys: ["gnc"],
    uploads: {
      GNC_SALE_MASMIS: "import_gnc_sale_masmis_batch", GNC_APR: "import_gnc_apr_batch",
      GNC_ALLOCATION_MASMIS: "import_gnc_allocation_masmis_batch", GNC_CHAT_MASMIS: "import_gnc_chat_batch",
    },
  },
  {
    key: "neemans", label: "Neemans", processCodes: ["NEEMANS"],
    perfPrefixes: ["/neemans-cart-dashboard", "/neemans-chat-dashboard", "/neemans-performance-dashboard"],
    inboundKeys: ["neemans"],
    uploads: {
      NEEMANS_SALE_RAW_MASMIS: "import_neemans_sale_raw_masmis_batch", NEEMANS_ALLOCATION_MASMIS: "import_neemans_allocation_masmis_batch",
      NEEMANS_APR_MASMIS: "import_neemans_apr_masmis_batch", NEEMANS_MONTH_TARGET_MASMIS: "import_neemans_month_target_batch",
      NEEMANS_AGENT_DETAILS_MASMIS: "import_neemans_agent_details_batch", NEEMANS_CHAT_MASMIS: "import_neemans_chat_batch",
    },
  },
  {
    key: "appreciate_health", label: "Appreciate Wealth", processCodes: [],
    perfPrefixes: ["/appreciate-wealth"], inboundKeys: [],
    uploads: {
      AW_BILLING_MASMIS: "import_aw_billing_batch", AW_INBOUND_MASMIS: "import_aw_inbound_batch", AW_MANDATE_MASMIS: "import_aw_mandate_batch",
      AW_NEW_CDR_MASMIS: "import_aw_new_cdr_batch", AW_OUT_MASMIS: "import_aw_out_batch", AW_CHAT_MASMIS: "import_aw_chat_batch",
    },
  },
  {
    key: "housing_owner", label: "Housing Owner", processCodes: ["HOUSING_OWNER"],
    perfPrefixes: ["/housing-owner-dashboard"], inboundKeys: [],
    uploads: {
      OWNER_SALE_MASMIS: "import_owner_sale_batch", OWNER_CDR_MASMIS: "import_owner_cdr_batch", OWNER_AGENT_DETAILS_MASMIS: "import_owner_agent_details_batch",
    },
  },
  {
    key: "housing_premium", label: "Housing Premium", processCodes: ["HOUSING_PREMIUM"],
    perfPrefixes: ["/housing-premium-dashboard"], inboundKeys: [],
    uploads: {
      PRE_SALE_MASMIS: "import_pre_sale_batch", PRE_CDR_MASMIS: "import_pre_cdr_batch", PRE_AGENT_DETAILS_MASMIS: "import_pre_agent_details_batch",
    },
  },
  {
    key: "clovia", label: "Clovia", processCodes: ["CLOVIA"],
    perfPrefixes: ["/clovia-channels-dashboard", "/clovia-lob", "/clovia-record", "/clovia-inbound-snapshot"],
    inboundKeys: ["clovia"],
    uploads: {
      CL_APR_MASMIS: "import_cl_apr_batch", CL_CHAT_MASMIS: "import_cl_chat_batch", CL_DISPO_MASMIS: "import_cl_dispo_batch",
      CL_EMAIL_RAW_MASMIS: "import_cl_email_raw_batch", CL_FEEDBACK_MASMIS: "import_cl_feedback_batch", CL_IB_CDR_MASMIS: "import_cl_ib_cdr_batch",
      CL_OUTBOUND_MASMIS: "import_cl_outbound_batch", CL_QUALITY_MASMIS: "import_cl_quality_batch", CL_RECHURN_CALL_MASMIS: "import_cl_rechurn_call_batch",
    },
  },
  {
    key: "birlanu", label: "Birlanu", processCodes: ["BIRLANU"],
    perfPrefixes: ["/birlanu-dashboard", "/birlanu-mis"], inboundKeys: [],
    uploads: { BIRLANU_SALE_MASMIS: "import_birlanu_sale_batch", BIRLANU_APR_MASMIS: "import_birlanu_apr_batch" },
  },
  {
    key: "satya_retail", label: "Satya Retail", processCodes: [],
    perfPrefixes: ["/satya-retail-dashboard", "/satya-retail-report"], inboundKeys: [],
    uploads: { SATYA_ALLOCATION_MASMIS: "import_satya_allocation_batch", SATYA_CDR_MASMIS: "import_satya_cdr_batch" },
  },
  {
    key: "lp_feedback", label: "LP Feedback", processCodes: [],
    perfPrefixes: ["/lp-feedback-dashboard"], inboundKeys: [],
    uploads: { LP_FEEDBACK_APR_MASMIS: "import_lp_feedback_apr_batch", LP_FEEDBACK_CDR_MASMIS: "import_lp_feedback_cdr_batch" },
  },
  {
    key: "lp_onboarding", label: "LP Onboarding", processCodes: [],
    perfPrefixes: ["/lp-onboarding-dashboard"], inboundKeys: [],
    uploads: { LP_ONBOARDING_APR_MASMIS: "import_lp_onboarding_apr_batch", LP_ONBOARDING_CDR_MASMIS: "import_lp_onboarding_cdr_batch" },
  },
  { key: "puresta", label: "Puresta", processCodes: [], perfPrefixes: [], inboundKeys: [], uploads: {} },
  {
    key: "dalmia", label: "Dalmia", processCodes: ["DALMIA_CEMENT"],
    perfPrefixes: ["/dalmia-dashboard"], inboundKeys: ["dalmia"],
    uploads: {
      DALMIA_DD_RAW: "import_dalmia_dd_batch", DALMIA_OUTBOUND_RAW: "import_dalmia_outbound_batch",
      DALMIA_APR: "import_dalmia_apr_batch", DALMIA_AFTER_HOUR: "import_dalmia_after_hour_batch",
    },
  },
  { key: "dubangladesh", label: "DU Bangladesh", processCodes: [], perfPrefixes: [], inboundKeys: ["dubangladesh"], uploads: {} },
  { key: "viega", label: "Viega", processCodes: ["VIEGA"], perfPrefixes: [], inboundKeys: ["viega"], uploads: {} },
  { key: "exicom", label: "Exicom", processCodes: ["EXICOM"], perfPrefixes: [], inboundKeys: ["exicom"], uploads: {} },
];

export type TpzCapability = "dashboards" | "upload" | "mis";

const COMPANY_BY_KEY = new Map(TPZ_COMPANIES.map((c) => [c.key, c]));
export const isTpzCompanyKey = (key: string): boolean => COMPANY_BY_KEY.has(key);
export const tpzCompany = (key: string): TpzCompany | undefined => COMPANY_BY_KEY.get(key);

/** Roles that see every TPZ dashboard today (the route's own role list). */
export const LEGACY_TPZ_VIEW_ROLES = [
  "super_admin", "admin", "ceo", "coo", "manager", "process_manager", "operations_manager", "branch_head", "qa", "quality_analyst", "tq_head",
] as const;

/** Roles the bulk-upload endpoints already admit -- the people who can use an uploader today. */
export const LEGACY_TPZ_UPLOAD_ROLES = ["super_admin", "admin", "hr", "wfm", "wfm_analyst", "payroll", "payroll_hr"] as const;

/** Roles that are never narrowed by grants, so nobody can lock the administrators out. */
export const TPZ_ALWAYS_FULL_ROLES = ["super_admin", "admin"] as const;

/** Company for a path under /api/process-performance (e.g. "/bellavita-sale-dashboard/overview"), or null when the path is not a TPZ one. */
export function companyForPerformancePath(path: string): { company: string; capability: TpzCapability } | null {
  const clean = path.split("?")[0].toLowerCase();
  const mis = /^\/mis\/([^/]+)\/excel\/?$/.exec(clean);
  // Any MIS company key is governed -- one the catalogue does not know is simply not grantable, so only full-access roles reach it.
  if (mis) return { company: mis[1], capability: "mis" };
  for (const c of TPZ_COMPANIES) {
    for (const p of c.perfPrefixes) {
      if (clean === p || clean.startsWith(`${p}/`)) return { company: c.key, capability: "dashboards" };
    }
  }
  return null;
}

/** Company for an inbound project key (/api/inbound-insights/:key, /api/inbound/project/:key). */
export function companyForInboundKey(key: string): string | null {
  const k = key.toLowerCase();
  return TPZ_COMPANIES.find((c) => c.inboundKeys.includes(k))?.key ?? null;
}

/** Every upload type TPZ owns, with its company and import function. */
export const TPZ_UPLOAD_TYPES: Map<string, { company: string; rpc: string }> = new Map(
  TPZ_COMPANIES.flatMap((c) => Object.entries(c.uploads).map(([code, rpc]) => [code, { company: c.key, rpc }] as const)),
);
