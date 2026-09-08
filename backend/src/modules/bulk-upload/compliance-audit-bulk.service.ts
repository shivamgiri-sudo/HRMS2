import { RowDataPacket } from "mysql2";
import { db } from "../../db/mysql.js";

/**
 * Floor compliance audit import.
 *
 * The audits come off a Google Form whose response sheet is the only place they
 * have ever lived. This writes them into mas_hrms rather than a client warehouse
 * because they are about MAS staff on MAS floors, not about any client's calls.
 *
 * A focused service rather than another copy of the generic raw-report importer:
 * this is one fixed form with a fixed answer vocabulary, and the Compliant /
 * Non-Compliant coercion below is the whole reason it needs its own file.
 */

/** Exact header text as the Form writes it. Order is the sheet's own. */
export const COMPLIANCE_AUDIT_HEADERS = [
  "Audit Date",
  "Email Address",
  "Analyst Name",
  "Desk No.",
  "AM Name",
  "Pen, Paper Access on the floor",
  "Unattended / Unlocked System",
  "Unauthorized use of personal devices (phones, tablets, etc.)",
  "No food / drinks near workstations",
  "ID Card not displayed or missing",
  "Clean desk policy adherence (no notes, stickies, printed data)",
  "Logged in from another domain ID",
  "Dual ID logged in (same user on multiple systems)",
  "Access to personal emails / messaging sites (e.g. Gmail, WhatsApp Web)",
  "Any suspicious software or browser extensions installed",
  "Google Sheet Review – PKT, Document Number or any other PI information visibility",
  "Storing or sharing PI/PHI data outside authorized tools",
  "Screenshots or screen recording without approval",
  "Files downloaded locally instead of shared drive",
  "Copy-pasting sensitive info to chat / notes",
  "Sharing links with edit access to unauthorized personnel",
  "Date",
  "Week",
  "Month",
  "Overall Score",
  "Physical & Floor Compliance",
  "System & Access Compliance",
  "Data & Information Security",
  "Additional Remarks",
] as const;

type Coerce = "date" | "text" | "flag" | "pct";

const COLUMNS: Array<{ column: string; header: string; type: Coerce }> = [
  { column: "audit_date", header: "Date", type: "date" },
  { column: "auditor_email", header: "Email Address", type: "text" },
  { column: "analyst_name", header: "Analyst Name", type: "text" },
  { column: "desk_no", header: "Desk No.", type: "text" },
  { column: "am_name", header: "AM Name", type: "text" },

  { column: "pen_paper_access", header: "Pen, Paper Access on the floor", type: "flag" },
  { column: "unattended_system", header: "Unattended / Unlocked System", type: "flag" },
  { column: "personal_devices", header: "Unauthorized use of personal devices (phones, tablets, etc.)", type: "flag" },
  { column: "food_drinks", header: "No food / drinks near workstations", type: "flag" },
  { column: "id_card_displayed", header: "ID Card not displayed or missing", type: "flag" },
  { column: "clean_desk", header: "Clean desk policy adherence (no notes, stickies, printed data)", type: "flag" },

  { column: "foreign_domain_login", header: "Logged in from another domain ID", type: "flag" },
  { column: "dual_id_login", header: "Dual ID logged in (same user on multiple systems)", type: "flag" },
  { column: "personal_email_access", header: "Access to personal emails / messaging sites (e.g. Gmail, WhatsApp Web)", type: "flag" },
  { column: "suspicious_software", header: "Any suspicious software or browser extensions installed", type: "flag" },

  { column: "pi_visible_in_sheet", header: "Google Sheet Review – PKT, Document Number or any other PI information visibility", type: "flag" },
  { column: "pi_phi_outside_tools", header: "Storing or sharing PI/PHI data outside authorized tools", type: "flag" },
  { column: "unapproved_screenshots", header: "Screenshots or screen recording without approval", type: "flag" },
  { column: "local_file_downloads", header: "Files downloaded locally instead of shared drive", type: "flag" },
  { column: "sensitive_copy_paste", header: "Copy-pasting sensitive info to chat / notes", type: "flag" },
  { column: "edit_links_shared", header: "Sharing links with edit access to unauthorized personnel", type: "flag" },

  { column: "week_label", header: "Week", type: "text" },
  { column: "month_label", header: "Month", type: "text" },
  { column: "overall_score", header: "Overall Score", type: "pct" },
  { column: "physical_score", header: "Physical & Floor Compliance", type: "pct" },
  { column: "system_access_score", header: "System & Access Compliance", type: "pct" },
  { column: "data_security_score", header: "Data & Information Security", type: "pct" },
  { column: "remarks", header: "Additional Remarks", type: "text" },
];

/**
 * "Compliant" / "Non- Compliant" — note the space after the hyphen, which is how
 * the Form actually writes it. Matching on the "non" prefix rather than the exact
 * string means a later edit to that label cannot silently turn every failure into
 * a pass. Anything unrecognised stays NULL: an unanswered parameter is not a
 * failure, and scoring it as one would understate every rate built on it.
 */
export function parseFlag(raw: unknown): 0 | 1 | null {
  const v = String(raw ?? "").trim().toLowerCase().replace(/\s+/g, " ");
  if (!v) return null;
  if (v.startsWith("non")) return 0;
  if (v.startsWith("compliant") || v === "yes" || v === "1") return 1;
  if (v === "na" || v === "n/a" || v === "-") return null;
  return null;
}

/** "93.75%" and "93.75" both mean the same thing here. */
export function parsePct(raw: unknown): number | null {
  const v = String(raw ?? "").trim().replace("%", "");
  if (!v) return null;
  const n = Number(v);
  if (!Number.isFinite(n)) return null;
  // A sheet that stores 0.9375 rather than 93.75 would otherwise read as under 1%.
  return Math.round((n > 0 && n <= 1 ? n * 100 : n) * 100) / 100;
}

/** The Form writes "13-Nov-2025"; the submission timestamp column uses M/D/YYYY. */
export function parseDate(raw: unknown): string | null {
  const v = String(raw ?? "").trim();
  if (!v) return null;
  const MONTHS: Record<string, number> = {
    jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6,
    jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12,
  };
  const dMonY = /^(\d{1,2})-([A-Za-z]{3})-(\d{4})$/.exec(v);
  if (dMonY) {
    const m = MONTHS[dMonY[2].toLowerCase()];
    if (m) return `${dMonY[3]}-${String(m).padStart(2, "0")}-${dMonY[1].padStart(2, "0")}`;
  }
  const mdY = /^(\d{1,2})\/(\d{1,2})\/(\d{4})/.exec(v);
  if (mdY) return `${mdY[3]}-${mdY[1].padStart(2, "0")}-${mdY[2].padStart(2, "0")}`;
  const iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(v);
  if (iso) return iso[0];
  return null;
}

function coerce(type: Coerce, raw: unknown): unknown {
  if (type === "date") return parseDate(raw);
  if (type === "flag") return parseFlag(raw);
  if (type === "pct") return parsePct(raw);
  const s = String(raw ?? "").trim();
  return s === "" ? null : s.slice(0, 1000);
}

interface BatchRow extends RowDataPacket {
  id: string;
  row_no: number;
  normalized_data: string | Record<string, unknown>;
}

export async function importComplianceAuditBatch(
  batchId: string,
  importedByUserId: string,
): Promise<{ importedRows: number; errorRows: number; errors: string[] }> {
  const [batchRows] = await db.execute<BatchRow[]>(
    `SELECT id, row_no, normalized_data FROM upload_batch_row
      WHERE upload_batch_id = ? AND row_status IN ('valid','pending')
      ORDER BY row_no`,
    [batchId],
  );
  if (batchRows.length === 0) return { importedRows: 0, errorRows: 0, errors: [] };

  const cols = COLUMNS.map((c) => c.column);
  const insertCols = ["id", "audit_key", ...cols, "raw_data", "upload_batch_id", "source_row_no", "uploaded_by"];
  const placeholders = `(${insertCols.map(() => "?").join(",")})`;
  const update = [...cols, "raw_data"].map((c) => `${c} = VALUES(${c})`).join(", ");

  const errors: string[] = [];
  let importedRows = 0;
  let errorRows = 0;
  const errorUpdates: Array<{ rowId: string; message: string }> = [];
  const occurrence = new Map<string, number>();

  for (const row of batchRows) {
    const data =
      typeof row.normalized_data === "string"
        ? JSON.parse(row.normalized_data)
        : ((row.normalized_data ?? {}) as Record<string, unknown>);

    // One person is audited once per day at one desk. Desk is part of the key
    // because the same analyst can be audited at a different desk on the same day,
    // and dropping it would silently overwrite one of those two audits.
    const parts = ["Date", "Analyst Name", "Desk No."].map((h) => String(data[h] ?? "").trim());
    if (!parts[0] || !parts[1]) {
      const msg = `Row ${row.row_no}: "Date" and "Analyst Name" are both required to identify an audit`;
      errors.push(msg);
      errorUpdates.push({ rowId: row.id, message: msg });
      errorRows++;
      continue;
    }
    const auditKey = parts.join("|");
    const n = (occurrence.get(auditKey) ?? 0) + 1;
    occurrence.set(auditKey, n);
    const id = `compliance_audit:${auditKey}${n > 1 ? `:${n}` : ""}`.slice(0, 191);

    const values = [
      id,
      auditKey,
      ...COLUMNS.map((c) => coerce(c.type, data[c.header])),
      JSON.stringify(data),
      batchId,
      row.row_no,
      importedByUserId,
    ];

    try {
      await db.execute(
        `INSERT INTO compliance_audit_response (${insertCols.join(",")})
         VALUES ${placeholders}
         ON DUPLICATE KEY UPDATE ${update}`,
        values as never[],
      );
      importedRows++;
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      errors.push(`Row ${row.row_no}: ${msg}`);
      errorUpdates.push({ rowId: row.id, message: msg.slice(0, 500) });
      errorRows++;
    }
  }

  if (errorUpdates.length) {
    const cases = errorUpdates.map(() => "WHEN ? THEN CAST(? AS JSON)").join(" ");
    const ids = errorUpdates.map((u) => u.rowId);
    await db.execute(
      `UPDATE upload_batch_row SET row_status = 'error', error_messages = CASE id ${cases} END
        WHERE id IN (${ids.map(() => "?").join(",")})`,
      [...errorUpdates.flatMap((u) => [u.rowId, JSON.stringify([u.message])]), ...ids],
    );
  }

  return { importedRows, errorRows, errors };
}
