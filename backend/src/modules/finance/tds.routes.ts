import { Router } from "express";
import type { RowDataPacket } from "mysql2";
import { requireAuth } from "../../middleware/authMiddleware.js";
import { requireRole } from "../../middleware/requireRole.js";
import { db } from "../../db/mysql.js";

/**
 * TDS advisory report: what the rules say should have been deducted on vendor payments, against what was.
 * Read-only. Mounted at /api/finance/tds.
 */
export const TDS_READ_ROLES = [
  "finance_head",
  "accounts_head",
  "ceo",
  "finance",
  "admin",
  "super_admin",
] as const;

export const tdsRouter = Router();
tdsRouter.use(requireAuth);

const MAX_DAYS = 400;
const MAX_ROWS = 500;

function days(raw: unknown, fallback: number): number {
  const n = Math.trunc(Number(raw));
  return Number.isFinite(n) && n > 0 ? Math.min(n, MAX_DAYS) : fallback;
}

tdsRouter.get(
  "/sections",
  requireRole(...TDS_READ_ROLES),
  async (_req, res) => {
    try {
      const [sections] = await db.execute<RowDataPacket[]>(
        `SELECT * FROM tds_section_master WHERE active_status = 1 ORDER BY section_code`,
      );
      const [defaults] = await db.execute<RowDataPacket[]>(
        `SELECT sub_head_name, section_code, confidence, note FROM tds_sub_head_default ORDER BY section_code, sub_head_name`,
      );
      res.json({
        success: true,
        data: { sections, subHeadDefaults: defaults },
      });
    } catch (error) {
      console.error("[tds] sections failed", error);
      res
        .status(500)
        .json({ success: false, error: "Unable to load TDS sections" });
    }
  },
);

tdsRouter.get("/summary", requireRole(...TDS_READ_ROLES), async (req, res) => {
  try {
    const window = days(req.query.days, 180);
    const [bySection] = await db.execute<RowDataPacket[]>(
      `SELECT COALESCE(section_code, 'No section') AS section_code, COUNT(*) AS payments,
              ROUND(SUM(payment_amount), 2) AS paid, ROUND(SUM(expected_tds), 2) AS expected_tds,
              ROUND(SUM(deducted_tds), 2) AS deducted_tds, ROUND(SUM(shortfall), 2) AS shortfall
         FROM tds_assessment WHERE created_at >= DATE_SUB(NOW(), INTERVAL ? DAY)
        GROUP BY COALESCE(section_code, 'No section') ORDER BY SUM(shortfall) DESC`,
      [window],
    );
    res.json({ success: true, data: { days: window, bySection } });
  } catch (error) {
    console.error("[tds] summary failed", error);
    res
      .status(500)
      .json({ success: false, error: "Unable to load the TDS summary" });
  }
});

tdsRouter.get(
  "/exceptions",
  requireRole(...TDS_READ_ROLES),
  async (req, res) => {
    try {
      const window = days(req.query.days, 90);
      const [rows] = await db.execute<RowDataPacket[]>(
        `SELECT id, vendor_payment_tracking_id, vendor_id, sub_head_name, section_code, confidence, financial_year,
              payment_amount, base_amount, rate_pct, expected_tds, deducted_tds, shortfall, pan_valid, reason, created_at
         FROM tds_assessment
        WHERE shortfall > 0 AND created_at >= DATE_SUB(NOW(), INTERVAL ? DAY)
        ORDER BY shortfall DESC LIMIT ${MAX_ROWS}`,
        [window],
      );
      const vendorIds = [
        ...new Set(rows.map((r) => String(r.vendor_id ?? "")).filter(Boolean)),
      ];
      const names = new Map<string, string>();
      if (vendorIds.length) {
        const [vendors] = await db.execute<RowDataPacket[]>(
          `SELECT id, vendor_name FROM vendor_master WHERE id IN (${vendorIds.map(() => "?").join(",")})`,
          vendorIds,
        );
        for (const v of vendors)
          names.set(String(v.id), String(v.vendor_name ?? ""));
      }
      res.json({
        success: true,
        data: {
          days: window,
          rows: rows.map((r) => ({
            ...r,
            vendor_name: names.get(String(r.vendor_id)) ?? null,
          })),
        },
      });
    } catch (error) {
      console.error("[tds] exceptions failed", error);
      res
        .status(500)
        .json({ success: false, error: "Unable to load the TDS exceptions" });
    }
  },
);
