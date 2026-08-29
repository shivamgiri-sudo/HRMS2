import crypto from "crypto";
import { Router } from "express";
import type { RowDataPacket, ResultSetHeader } from "mysql2";
import { db } from "../../db/mysql.js";

/**
 * Open (unauthenticated) KPI capture surface — /kpi-capture.
 *
 * Purpose: collect, from the people who actually run each process, which KPIs apply to which
 * cost centre and designation — including KPIs that do not exist in HRMS yet. That inventory is
 * the missing input for a per-cost-centre KPI dashboard: kpi_master_config currently carries a
 * designation on 19 of its 566 rows, so designation-level KPI definition is effectively absent.
 *
 * THREE ENDPOINTS, TWO TRUST LEVELS
 *   GET  /masters              open  — dropdown data. No headcount, no targets. See below.
 *   POST /submissions          open  — one KPI per call. Rate limited at the mount.
 *   GET  /results/:token       token — everything submitted, including targets.
 *
 * WHY /masters OMITS HEADCOUNT
 *   The form cannot work without listing cost centres, so anyone holding the submit link
 *   necessarily learns the client/process names. That is inherent to the request. What is NOT
 *   inherent is telling them how many people sit on each account, or what each team is targeted
 *   on — so headcount is dropped here and every target lives behind the results token.
 *
 * NOTHING HERE WRITES LIVE KPI CONFIG. Submissions land in kpi_capture_submission with
 * status='submitted'. No scoring path reads that table. Promotion into kpi_metric_master /
 * kpi_master_config is a separate authenticated action, deliberately not part of this router.
 */
export const kpiCaptureRouter = Router();

// Closed vocabularies. Anything outside these is rejected rather than coerced — the values are
// copied verbatim into kpi_metric_master on promotion, so a typo here becomes a bad catalogue row.
const UNITS = new Set(["percent", "count", "seconds", "currency", "boolean"]);
const DIRECTIONS = new Set(["higher_is_better", "lower_is_better"]);
const AGGREGATIONS = new Set(["average", "sum", "ratio", "latest"]);
const FREQUENCIES = new Set(["daily", "weekly", "monthly", "quarterly"]);

const MAX = {
  submitter_name: 120,
  submitter_email: 190,
  label: 255,
  kpi_name: 190,
  formula: 4000,
  data_source: 160,
  owner_name: 160,
  notes: 4000,
};

/** Trim, collapse whitespace, cap length. Returns "" for null/undefined/non-string. */
function str(v: unknown, max: number): string {
  if (typeof v !== "string") return "";
  return v.replace(/\s+/g, " ").trim().slice(0, max);
}

/**
 * Numeric fields arrive from a text input, so "" and "  " must mean "not provided" rather than 0.
 * A KPI whose min_threshold silently became 0 would score every value as a pass.
 */
function num(v: unknown): number | null {
  if (v === null || v === undefined) return null;
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v !== "string" || v.trim() === "") return null;
  const n = Number(v.trim());
  return Number.isFinite(n) ? n : null;
}

// ── GET /api/public/kpi-capture/masters ───────────────────────────────────────
// Cost centres are restricted to those that actually hold active employees. cost_centre_master
// has 922 rows and 401 flagged active, but only ~30 have anyone on them; offering all 401 makes
// the dropdown unusable and guarantees mis-picks.
kpiCaptureRouter.get("/masters", async (_req, res) => {
  try {
    const [costCentres] = await db.execute<RowDataPacket[]>(
      `SELECT cc.id,
              cc.cost_centre_code,
              COALESCE(NULLIF(p.process_name, ''), cc.cost_centre_name) AS process_name
         FROM cost_centre_master cc
         JOIN employees e
           ON e.cost_centre_id = cc.id
          AND e.employment_status = 'active'
         LEFT JOIN process_master p ON p.id = cc.process_id
        GROUP BY cc.id, cc.cost_centre_code, process_name
        ORDER BY COUNT(e.id) DESC`
    );

    const [designations] = await db.execute<RowDataPacket[]>(
      `SELECT d.id, d.designation_name
         FROM designation_master d
         JOIN employees e
           ON e.designation_id = d.id
          AND e.employment_status = 'active'
        GROUP BY d.id, d.designation_name
        ORDER BY COUNT(e.id) DESC`
    );

    const [metrics] = await db.execute<RowDataPacket[]>(
      `SELECT id, metric_code, metric_name, family, unit, direction, aggregation_method
         FROM kpi_metric_master
        WHERE active_status = 1
        ORDER BY FIELD(family, 'operations', 'quality', 'performance', 'custom'), metric_name`
    );

    res.json({
      success: true,
      costCentres: costCentres.map((r) => ({
        id: r.id as string,
        code: r.cost_centre_code as string,
        label: `${r.process_name as string} — ${r.cost_centre_code as string}`,
      })),
      designations: designations.map((r) => ({
        id: r.id as string,
        label: r.designation_name as string,
      })),
      metrics: metrics.map((r) => ({
        id: r.id as string,
        code: r.metric_code as string,
        name: r.metric_name as string,
        family: r.family as string,
        unit: r.unit as string,
        direction: r.direction as string,
        aggregation: r.aggregation_method as string,
      })),
    });
  } catch (err) {
    console.error("[kpi-capture] masters failed", err);
    res.status(500).json({ success: false, message: "Could not load the form options. Please refresh." });
  }
});

// ── POST /api/public/kpi-capture/submissions ─────────────────────────────────
kpiCaptureRouter.post("/submissions", async (req, res) => {
  try {
    const b = (req.body ?? {}) as Record<string, unknown>;

    const submitterName = str(b.submitterName, MAX.submitter_name);
    const costCentreLabel = str(b.costCentreLabel, MAX.label);
    const designationLabel = str(b.designationLabel, MAX.label);
    const dataSource = str(b.dataSource, MAX.data_source);
    const ownerName = str(b.ownerName, MAX.owner_name);

    const isNewKpi = b.isNewKpi === true || b.isNewKpi === "true";
    const newKpiName = str(b.newKpiName, MAX.kpi_name);
    const existingMetricId = str(b.existingMetricId, 36);

    const unit = str(b.unit, 24).toLowerCase();
    const direction = str(b.direction, 24).toLowerCase();
    const aggregation = str(b.aggregation, 24).toLowerCase();
    const frequency = str(b.frequency, 24).toLowerCase();

    // Collect every problem before answering. Returning only the first one turns a six-field
    // form into six round trips.
    const errors: string[] = [];
    if (!submitterName) errors.push("Your name is required.");
    if (!costCentreLabel) errors.push("Cost centre is required.");
    if (!designationLabel) errors.push("Designation is required.");
    if (!dataSource) errors.push("Data source is required.");
    if (!ownerName) errors.push("KPI owner is required.");
    if (isNewKpi && !newKpiName) errors.push("Name the new KPI.");
    if (!isNewKpi && !existingMetricId) errors.push("Pick a KPI, or tick 'not in this list'.");
    if (!UNITS.has(unit)) errors.push("Unit is not one of the allowed values.");
    if (!DIRECTIONS.has(direction)) errors.push("Direction is not one of the allowed values.");
    if (!AGGREGATIONS.has(aggregation)) errors.push("Roll-up method is not one of the allowed values.");
    if (!FREQUENCIES.has(frequency)) errors.push("Frequency is not one of the allowed values.");

    const targetValue = num(b.targetValue);
    const minThreshold = num(b.minThreshold);
    const maxAchievement = num(b.maxAchievement);
    const weightage = num(b.weightage);

    if (targetValue === null) errors.push("Target value is required and must be a number.");
    if (weightage === null) errors.push("Weightage is required and must be a number.");
    else if (weightage < 0 || weightage > 100) errors.push("Weightage must be between 0 and 100.");

    if (errors.length) {
      return res.status(400).json({ success: false, message: errors.join(" "), errors });
    }

    // Resolve the ids against master data. A label that no longer resolves is stored with a NULL
    // id rather than rejected — the person filling the form should not lose their answers because
    // a cost centre was closed while the tab was open.
    let costCentreId: string | null = null;
    if (str(b.costCentreId, 36)) {
      const [rows] = await db.execute<RowDataPacket[]>(
        `SELECT id FROM cost_centre_master WHERE id = ? LIMIT 1`,
        [str(b.costCentreId, 36)]
      );
      costCentreId = rows.length ? (rows[0].id as string) : null;
    }

    let designationId: string | null = null;
    if (str(b.designationId, 36)) {
      const [rows] = await db.execute<RowDataPacket[]>(
        `SELECT id FROM designation_master WHERE id = ? LIMIT 1`,
        [str(b.designationId, 36)]
      );
      designationId = rows.length ? (rows[0].id as string) : null;
    }

    let metricId: string | null = null;
    let metricCode: string | null = null;
    if (!isNewKpi && existingMetricId) {
      const [rows] = await db.execute<RowDataPacket[]>(
        `SELECT id, metric_code FROM kpi_metric_master WHERE id = ? LIMIT 1`,
        [existingMetricId]
      );
      if (!rows.length) {
        return res.status(400).json({
          success: false,
          message: "That KPI is no longer in the catalogue. Refresh the page and pick again.",
        });
      }
      metricId = rows[0].id as string;
      metricCode = rows[0].metric_code as string;
    }

    const id = crypto.randomUUID();
    await db.execute<ResultSetHeader>(
      `INSERT INTO kpi_capture_submission
         (id, submitter_name, submitter_email,
          cost_centre_id, cost_centre_label, designation_id, designation_label,
          is_new_kpi, existing_metric_id, existing_metric_code, new_kpi_name, new_kpi_formula,
          unit, direction, aggregation_method, measure_frequency,
          target_value, min_threshold, max_achievement, weightage,
          data_source, owner_name, notes, status, source_ip)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'submitted', ?)`,
      [
        id,
        submitterName,
        str(b.submitterEmail, MAX.submitter_email) || null,
        costCentreId,
        costCentreLabel,
        designationId,
        designationLabel,
        isNewKpi ? 1 : 0,
        metricId,
        metricCode,
        isNewKpi ? newKpiName : null,
        isNewKpi ? str(b.newKpiFormula, MAX.formula) || null : null,
        unit,
        direction,
        aggregation,
        frequency,
        targetValue,
        minThreshold,
        maxAchievement,
        weightage,
        dataSource,
        ownerName,
        str(b.notes, MAX.notes) || null,
        (req.ip || "").slice(0, 64) || null,
      ]
    );

    res.status(201).json({ success: true, id, message: "Saved. Add the next KPI for this team." });
  } catch (err) {
    console.error("[kpi-capture] submit failed", err);
    res.status(500).json({ success: false, message: "Could not save. Please try again." });
  }
});

// ── GET /api/public/kpi-capture/results/:token ───────────────────────────────
// Token-gated rather than session-gated: the owner wants to open it without signing in, and the
// page carries client names, headcount and targets, so it must not sit on a guessable path.
kpiCaptureRouter.get("/results/:token", async (req, res) => {
  try {
    const token = str(req.params.token, 128);
    if (!token) return res.status(404).json({ success: false, message: "Not found" });

    const [tokens] = await db.execute<RowDataPacket[]>(
      `SELECT id FROM kpi_capture_access_token WHERE token = ? AND active_status = 1 LIMIT 1`,
      [token]
    );
    // 404 rather than 401/403 on purpose: a wrong token should not confirm that a valid one exists.
    if (!tokens.length) return res.status(404).json({ success: false, message: "Not found" });

    await db
      .execute(`UPDATE kpi_capture_access_token SET last_used_at = NOW() WHERE id = ?`, [tokens[0].id])
      .catch(() => undefined); // best-effort audit stamp; never fail the read for it

    const [rows] = await db.execute<RowDataPacket[]>(
      `SELECT s.id, s.created_at, s.submitter_name, s.submitter_email,
              s.cost_centre_label, s.designation_label,
              s.is_new_kpi, s.existing_metric_code,
              COALESCE(s.new_kpi_name, m.metric_name) AS kpi_name,
              s.new_kpi_formula,
              s.unit, s.direction, s.aggregation_method, s.measure_frequency,
              s.target_value, s.min_threshold, s.max_achievement, s.weightage,
              s.data_source, s.owner_name, s.notes, s.status
         FROM kpi_capture_submission s
         LEFT JOIN kpi_metric_master m ON m.id = s.existing_metric_id
        ORDER BY s.created_at DESC
        LIMIT 5000`
    );

    // Weightage per cost centre + designation should total 100. Surfacing where it does not is the
    // single most useful check on this data — an incomplete set is invisible row by row.
    const [weights] = await db.execute<RowDataPacket[]>(
      `SELECT cost_centre_label, designation_label,
              COUNT(*) AS kpi_count,
              ROUND(SUM(weightage), 2) AS total_weightage
         FROM kpi_capture_submission
        WHERE status = 'submitted'
        GROUP BY cost_centre_label, designation_label
        ORDER BY cost_centre_label, designation_label`
    );

    res.json({
      success: true,
      summary: {
        total: rows.length,
        newKpis: rows.filter((r) => Number(r.is_new_kpi) === 1).length,
        costCentres: new Set(rows.map((r) => r.cost_centre_label)).size,
        designations: new Set(rows.map((r) => r.designation_label)).size,
      },
      weightageCheck: weights.map((w) => ({
        costCentre: w.cost_centre_label as string,
        designation: w.designation_label as string,
        kpiCount: Number(w.kpi_count),
        totalWeightage: Number(w.total_weightage ?? 0),
      })),
      submissions: rows,
    });
  } catch (err) {
    console.error("[kpi-capture] results failed", err);
    res.status(500).json({ success: false, message: "Could not load results." });
  }
});
