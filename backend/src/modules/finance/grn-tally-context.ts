import type { RowDataPacket } from "mysql2";
import { branchShortCode } from "./salary-voucher.service.js";
import type {
  GrnTallyLedgerNames,
  GrnTdsRule,
  GrnVoucherInput,
} from "./grn-tally-voucher.js";

/**
 * Everything the GRN Tally voucher needs beyond the grn_request row: the vendor's Tally name and
 * TDS setup, the branch's cost-centre code and GST state, the imprest holder's ledger, and the
 * default TDS section per sub-head. Loaded with one IN (...) query per table and no cross-table
 * name joins (two tables with different collations make a joined name comparison fail).
 */

type Executor = { execute(sql: string, params?: any[]): Promise<[any, any]> };

/** Columns every GRN Tally path selects from grn_request g. */
export const GRN_TALLY_COLUMNS = `g.id, g.grn_number, g.grn_type, g.bill_date, g.invoice_number, g.vendor_id, g.vendor_name,
  g.head, g.sub_head, g.description, g.branch_id, g.amount, g.amount_without_tax, g.tax_amount, g.other_charges,
  g.round_off_amount, g.amount_with_tax, g.gst_type, g.gst_rate, g.recoverable_tax_pct, g.accounting_period,
  g.billing_state_code, g.imprest_manager_id`;

/** Cost-centre prefixes as the legacy GRN sheet prints them (HO/2609, AHM-JD/2609, Noida/2609). */
const GRN_BRANCH_CODE: Record<string, string> = {
  "HEAD OFFICE": "HO",
  "AHMEDABAD-JALDARSHAN": "AHM-JD",
  NOIDA: "Noida",
  "NOIDA-2": "NOIDA-2",
};

/** GST state codes to the state names Tally's input-tax ledgers carry. */
const GST_STATE: Record<string, string> = {
  "01": "Jammu & Kashmir", "02": "Himachal Pradesh", "03": "Punjab", "04": "Chandigarh",
  "05": "Uttarakhand", "06": "Haryana", "07": "Delhi", "08": "Rajasthan", "09": "Uttar Pradesh",
  "10": "Bihar", "11": "Sikkim", "12": "Arunachal Pradesh", "13": "Nagaland", "14": "Manipur",
  "15": "Mizoram", "16": "Tripura", "17": "Meghalaya", "18": "Assam", "19": "West Bengal",
  "20": "Jharkhand", "21": "Odisha", "22": "Chhattisgarh", "23": "Madhya Pradesh", "24": "Gujarat",
  "26": "Dadra and Nagar Haveli and Daman and Diu", "27": "Maharashtra", "29": "Karnataka", "30": "Goa",
  "32": "Kerala", "33": "Tamil Nadu", "34": "Puducherry", "36": "Telangana", "37": "Andhra Pradesh",
  "38": "Ladakh",
};

export function gstStateName(code: unknown): string | null {
  const c = String(code ?? "").trim().padStart(2, "0").slice(0, 2);
  return GST_STATE[c] ?? null;
}

export function grnBranchCode(branchName: string, overrides: Record<string, string> = {}): string {
  const key = branchName.trim().toUpperCase();
  return overrides[key] ?? GRN_BRANCH_CODE[key] ?? branchShortCode(branchName);
}

/**
 * Vendor master and sub-head defaults name sections loosely (194J, 194I(b), 194I_LB). Folds them
 * onto the tds_section_master codes; a bare 194J / 194I takes the sub-head's own variant when
 * it has one.
 */
export function normalizeTdsSection(raw: unknown, hint?: string | null): string | null {
  const s = String(raw ?? "").toUpperCase().replace(/[^0-9A-Z_]/g, "");
  if (!s) return null;
  if (/^194J/.test(s)) {
    if (s.includes("TECH")) return "194J_TECH";
    if (s.includes("PROF")) return "194J_PROF";
    return hint?.startsWith("194J") ? hint : "194J_PROF";
  }
  if (/^194I/.test(s)) {
    if (s.includes("PM") || s === "194IA") return "194I_PM";
    if (s.includes("LB") || s === "194IB") return "194I_LB";
    return hint?.startsWith("194I") ? hint : "194I_LB";
  }
  return s.replace(/_.*/, "");
}

export type GrnTallyContext = {
  vendors: Map<string, { ledger: string; tdsEnabled: number | null; tdsSection: string | null; tdsRate: number | null }>;
  branches: Map<string, { name: string; gstStateCode: string | null; state: string | null }>;
  holders: Map<string, { tally: string | null; person: string | null }>;
  subHeadTds: Map<string, { section: string; confidence: string }>;
  sectionRates: Map<string, number>;
  branchCodeOverrides: Record<string, string>;
};

async function safeRows(executor: Executor, sql: string, params: unknown[] = []): Promise<RowDataPacket[]> {
  try {
    const [rows] = (await executor.execute(sql, params)) as [RowDataPacket[], unknown];
    return rows;
  } catch {
    // A table from a later migration (TDS engine, imprest) may not exist yet; the voucher then
    // falls back (no TDS, imprest exception) rather than failing the whole export.
    return [];
  }
}

const inList = (ids: string[]) => ids.map(() => "?").join(",");

export async function loadGrnTallyContext(
  executor: Executor,
  rows: RowDataPacket[],
  env: NodeJS.ProcessEnv = process.env,
): Promise<GrnTallyContext> {
  const ids = (key: string) => [...new Set(rows.map((r) => String(r[key] ?? "")).filter(Boolean))];
  const vendorIds = ids("vendor_id");
  const branchIds = ids("branch_id");
  const holderIds = ids("imprest_manager_id");

  const ctx: GrnTallyContext = {
    vendors: new Map(),
    branches: new Map(),
    holders: new Map(),
    subHeadTds: new Map(),
    sectionRates: new Map(),
    branchCodeOverrides: {},
  };
  try {
    const parsed = JSON.parse(env.GRN_TALLY_COST_CENTRE_CODES ?? "{}");
    for (const [k, v] of Object.entries(parsed)) ctx.branchCodeOverrides[k.toUpperCase()] = String(v);
  } catch {
    /* ignore a malformed override */
  }

  if (vendorIds.length) {
    for (const r of await safeRows(
      executor,
      `SELECT id, COALESCE(NULLIF(TRIM(tally_name), ''), vendor_name) AS n, tds_enabled, tds_section, tds_rate
         FROM vendor_master WHERE id IN (${inList(vendorIds)})`,
      vendorIds,
    )) {
      ctx.vendors.set(String(r.id), {
        ledger: String(r.n ?? ""),
        tdsEnabled: r.tds_enabled == null ? null : Number(r.tds_enabled),
        tdsSection: r.tds_section ? String(r.tds_section) : null,
        tdsRate: r.tds_rate == null ? null : Number(r.tds_rate),
      });
    }
  }
  if (branchIds.length) {
    for (const r of await safeRows(
      executor,
      `SELECT id, branch_name, gst_state_code, state FROM branch_master WHERE id IN (${inList(branchIds)})`,
      branchIds,
    )) {
      ctx.branches.set(String(r.id), {
        name: String(r.branch_name ?? ""),
        gstStateCode: r.gst_state_code ? String(r.gst_state_code) : null,
        state: r.state ? String(r.state) : null,
      });
    }
  }
  if (holderIds.length) {
    const holders = await safeRows(
      executor,
      `SELECT id, employee_id, tally_name FROM imprest_manager WHERE id IN (${inList(holderIds)})`,
      holderIds,
    );
    const empIds = [...new Set(holders.map((h) => String(h.employee_id ?? "")).filter(Boolean))];
    const names = new Map<string, string>();
    if (empIds.length) {
      for (const e of await safeRows(
        executor,
        `SELECT id, TRIM(CONCAT(COALESCE(first_name, ''), ' ', COALESCE(last_name, ''))) AS n FROM employees WHERE id IN (${inList(empIds)})`,
        empIds,
      )) names.set(String(e.id), String(e.n ?? "").replace(/\s+/g, " ").trim());
    }
    for (const h of holders) {
      ctx.holders.set(String(h.id), {
        tally: String(h.tally_name ?? "").trim() || null,
        person: names.get(String(h.employee_id ?? "")) || null,
      });
    }
  }
  for (const r of await safeRows(executor, `SELECT sub_head_name, section_code, confidence FROM tds_sub_head_default`)) {
    ctx.subHeadTds.set(String(r.sub_head_name).trim().toLowerCase(), {
      section: String(r.section_code),
      confidence: String(r.confidence ?? "firm"),
    });
  }
  for (const r of await safeRows(executor, `SELECT section_code, rate_other FROM tds_section_master WHERE active_status = 1`)) {
    ctx.sectionRates.set(String(r.section_code), Number(r.rate_other ?? 0));
  }
  return ctx;
}

/**
 * TDS for one GRN: the vendor's own section and rate when the vendor master has one, else the
 * sub-head's default section when that default is firm. A sub-head whose default needs review
 * (labour vs materials, say) gets no TDS and says so on the check sheet.
 */
export function resolveGrnTds(
  vendor: GrnTallyContext["vendors"] extends Map<string, infer V> ? V | undefined : never,
  subHead: string,
  ctx: Pick<GrnTallyContext, "subHeadTds" | "sectionRates">,
): { rule: GrnTdsRule | null; basis: string } {
  const fallback = ctx.subHeadTds.get(subHead.trim().toLowerCase());
  if (vendor?.tdsSection && vendor.tdsEnabled !== 0) {
    const section = normalizeTdsSection(vendor.tdsSection, fallback?.section);
    if (section) {
      const rate = vendor.tdsRate && vendor.tdsRate > 0 ? vendor.tdsRate : ctx.sectionRates.get(section) ?? 0;
      const basis = `Vendor master ${section} @ ${rate}%`;
      return rate > 0 ? { rule: { section, ratePct: rate, basis }, basis } : { rule: null, basis: `${basis}: no rate` };
    }
  }
  if (fallback?.confidence === "firm") {
    const rate = ctx.sectionRates.get(fallback.section) ?? 0;
    const basis = `Sub-head default ${fallback.section} @ ${rate}%`;
    if (rate > 0) return { rule: { section: fallback.section, ratePct: rate, basis }, basis };
  }
  if (fallback) return { rule: null, basis: `No TDS: sub-head default ${fallback.section} needs Accounts review; set TDS on the vendor` };
  return { rule: null, basis: "No TDS" };
}

const ymd = (value: unknown): string => {
  if (!value) return "";
  if (value instanceof Date) {
    const local = new Date(value.getTime() - value.getTimezoneOffset() * 60000);
    return local.toISOString().slice(0, 10);
  }
  return String(value).slice(0, 10);
};

export function toVoucherInput(
  r: RowDataPacket,
  ctx: GrnTallyContext,
  names: GrnTallyLedgerNames,
): GrnVoucherInput & { tdsBasis: string } {
  const gross =
    Number(r.amount_with_tax) > 0
      ? Number(r.amount_with_tax)
      : Number(r.amount);
  const vendor = ctx.vendors.get(String(r.vendor_id ?? ""));
  const branch = ctx.branches.get(String(r.branch_id ?? ""));
  const holder = ctx.holders.get(String(r.imprest_manager_id ?? ""));
  const imprestLedger =
    holder?.tally ?? (holder?.person ? names.imprestLedgerPattern.replace("{name}", holder.person) : null);
  const subHead = String(r.sub_head ?? "");
  const tds = resolveGrnTds(vendor, subHead, ctx);
  return {
    grnId: String(r.id),
    grnNumber: String(r.grn_number ?? ""),
    grnType: r.grn_type === "imprest" ? "imprest" : "vendor",
    billDate: ymd(r.bill_date),
    postingDate: ymd(r.approved_on) || null,
    accountingPeriod: r.accounting_period ? String(r.accounting_period) : null,
    invoiceNumber: r.invoice_number ? String(r.invoice_number) : null,
    vendorLedger: vendor?.ledger || (r.vendor_name ? String(r.vendor_name) : null),
    imprestLedger,
    expenseLedger: subHead,
    headName: r.head ? String(r.head) : null,
    branchName: branch?.name ?? null,
    branchCode: branch?.name ? grnBranchCode(branch.name, ctx.branchCodeOverrides) : null,
    gstStateName:
      gstStateName(r.billing_state_code) ?? gstStateName(branch?.gstStateCode) ?? (branch?.state?.trim() || null),
    narrationText: r.description ? String(r.description) : null,
    amountWithoutTax: Number(r.amount_without_tax ?? 0),
    taxAmount: Number(r.tax_amount ?? 0),
    otherCharges: Number(r.other_charges ?? 0),
    roundOff: Number(r.round_off_amount ?? 0),
    gross,
    gstType: r.gst_type ? String(r.gst_type) : null,
    gstRate: r.gst_rate == null ? null : Number(r.gst_rate),
    recoverableTaxPct:
      r.recoverable_tax_pct == null ? 100 : Number(r.recoverable_tax_pct),
    tds: tds.rule,
    tdsBasis: tds.basis,
  };
}
