import { randomUUID } from "crypto";
import type { RowDataPacket } from "mysql2";
import { db } from "../../db/mysql.js";
import { queryRows, tableExists } from "../../shared/dbHelpers.js";

const BILLING_MODELS = new Set([
  "per_seat",
  "per_fte",
  "per_productive_hour",
  "per_login_hour",
  "per_talk_minute",
  "per_transaction",
  "per_mandate",
  "per_case",
  "fixed_monthly",
  "outcome_based",
]);

const RULE_STATUSES = new Set(["draft", "approved", "inactive"]);
const DELIVERY_STATUSES = new Set(["draft", "validated", "locked"]);

function currentPeriod() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
}

function normalisePeriod(value?: string) {
  return value && /^\d{4}-\d{2}$/.test(value) ? value : currentPeriod();
}

function money(value: unknown, field: string) {
  const number = Number(value ?? 0);
  if (!Number.isFinite(number) || number < 0) {
    throw Object.assign(new Error(`${field} must be zero or greater`), { statusCode: 400 });
  }
  return number;
}

function nullableNumber(value: unknown, field: string) {
  if (value === null || value === undefined || value === "") return null;
  return money(value, field);
}

function cleanText(value: unknown) {
  const text = String(value ?? "").trim();
  return text || null;
}

function dateRangeOverlaps(
  existingFrom: string,
  existingTo: string | null,
  nextFrom: string,
  nextTo: string | null
) {
  return existingFrom <= (nextTo ?? "9999-12-31")
    && nextFrom <= (existingTo ?? "9999-12-31");
}

async function ensureCommercialFoundation() {
  const required = ["process_lob_master", "process_revenue_rule", "process_delivery_actual"];
  const missing: string[] = [];
  for (const table of required) {
    if (!(await tableExists(table))) missing.push(table);
  }
  if (missing.length) {
    throw Object.assign(
      new Error(`LOB commercial foundation unavailable: ${missing.join(", ")}. Run migration 421 first.`),
      { statusCode: 503 }
    );
  }
}

async function getLobForUpdate(
  connection: Awaited<ReturnType<typeof db.getConnection>>,
  processId: string,
  processLobId: string
) {
  const [rows] = await connection.execute<RowDataPacket[]>(
    `SELECT id, process_id, lob_code, lob_name, active_status, approval_status
       FROM process_lob_master
      WHERE id = ? AND process_id = ?
      FOR UPDATE`,
    [processLobId, processId]
  );
  const row = rows[0];
  if (!row) throw Object.assign(new Error("LOB does not belong to the selected process"), { statusCode: 400 });
  if (Number(row.active_status ?? 0) !== 1 || String(row.approval_status) !== "approved") {
    throw Object.assign(new Error("Only an approved active LOB can receive rates or delivery actuals"), { statusCode: 400 });
  }
  return row;
}

export interface SaveLobRevenueRuleInput {
  id?: string;
  processId: string;
  processLobId: string;
  contractId?: string | null;
  ruleName: string;
  billingModel: string;
  metricKey: string;
  rateAmount: number;
  currencyCode?: string;
  fxToInr?: number;
  monthlyMinimumCommitment?: number;
  includedUnits?: number;
  overageRate?: number;
  mandatedSeats?: number | null;
  qualityGatePct?: number | null;
  slaGatePct?: number | null;
  effectiveFrom: string;
  effectiveTo?: string | null;
  status?: "draft" | "approved" | "inactive";
  approvalReference?: string | null;
}

export interface SaveLobDeliveryInput {
  id?: string;
  processId: string;
  processLobId: string;
  periodCode: string;
  activityDate?: string | null;
  metricKey: string;
  plannedUnits?: number;
  deliveredUnits?: number;
  acceptedUnits?: number;
  rejectedUnits?: number;
  billableUnits?: number;
  productiveHours?: number;
  loginHours?: number;
  talkMinutes?: number;
  qualityScore?: number | null;
  slaScore?: number | null;
  dataSource?: string;
  sourceReference?: string;
  status?: "draft" | "validated" | "locked";
}

export const processLobCommercialService = {
  async list(processId: string, periodCode?: string) {
    await ensureCommercialFoundation();
    const period = normalisePeriod(periodCode);
    const [year, month] = period.split("-").map(Number);
    const end = `${period}-${String(new Date(year, month, 0).getDate()).padStart(2, "0")}`;
    const [lobs, rules, delivery] = await Promise.all([
      queryRows<RowDataPacket>(
        `SELECT l.*, p.process_name, p.client_id, cm.client_name,
                p.branch_id, bm.branch_name
           FROM process_lob_master l
           JOIN process_master p ON p.id = l.process_id
           LEFT JOIN client_master cm ON cm.id = p.client_id
           LEFT JOIN branch_master bm ON bm.id = p.branch_id
          WHERE l.process_id = ?
            AND l.active_status = 1
            AND l.effective_from <= ?
            AND (l.effective_to IS NULL OR l.effective_to >= ?)
          ORDER BY l.lob_code`,
        [processId, end, `${period}-01`]
      ),
      queryRows<RowDataPacket>(
        `SELECT r.*, l.lob_code, l.lob_name
           FROM process_revenue_rule r
           JOIN process_lob_master l ON l.id = r.process_lob_id
          WHERE r.process_id = ?
            AND r.effective_from <= ?
            AND (r.effective_to IS NULL OR r.effective_to >= ?)
          ORDER BY l.lob_code, r.metric_key, r.effective_from DESC`,
        [processId, end, `${period}-01`]
      ),
      queryRows<RowDataPacket>(
        `SELECT d.*, l.lob_code, l.lob_name
           FROM process_delivery_actual d
           JOIN process_lob_master l ON l.id = d.process_lob_id
          WHERE d.process_id = ? AND d.period_code = ?
          ORDER BY l.lob_code, d.metric_key, d.activity_date, d.updated_at DESC`,
        [processId, period]
      ),
    ]);
    return { period, processId, lobs, revenueRules: rules, deliveryActuals: delivery };
  },

  async saveRevenueRule(input: SaveLobRevenueRuleInput, actorUserId: string) {
    await ensureCommercialFoundation();
    const processId = String(input.processId ?? "").trim();
    const processLobId = String(input.processLobId ?? "").trim();
    const ruleName = String(input.ruleName ?? "").trim();
    const billingModel = String(input.billingModel ?? "").trim();
    const metricKey = String(input.metricKey ?? "").trim();
    const effectiveFrom = String(input.effectiveFrom ?? "").slice(0, 10);
    const effectiveTo = cleanText(input.effectiveTo)?.slice(0, 10) ?? null;
    const status = input.status ?? "draft";
    if (!processId || !processLobId || !ruleName || !metricKey || !effectiveFrom) {
      throw Object.assign(new Error("Process, LOB, rule name, metric and effective-from date are required"), { statusCode: 400 });
    }
    if (!BILLING_MODELS.has(billingModel)) {
      throw Object.assign(new Error("Unsupported billing model"), { statusCode: 400 });
    }
    if (!RULE_STATUSES.has(status)) throw Object.assign(new Error("Invalid revenue-rule status"), { statusCode: 400 });
    if (effectiveTo && effectiveTo < effectiveFrom) {
      throw Object.assign(new Error("Effective-to date cannot precede effective-from date"), { statusCode: 400 });
    }
    const rateAmount = money(input.rateAmount, "Rate");
    const fxToInr = money(input.fxToInr ?? 1, "FX rate");
    if (fxToInr <= 0) throw Object.assign(new Error("FX rate must be greater than zero"), { statusCode: 400 });
    const currencyCode = String(input.currencyCode ?? "INR").trim().toUpperCase();
    if (!/^[A-Z]{3}$/.test(currencyCode)) {
      throw Object.assign(new Error("Currency code must be a three-letter ISO code"), { statusCode: 400 });
    }

    const id = String(input.id ?? randomUUID());
    const connection = await db.getConnection();
    try {
      await connection.beginTransaction();
      await getLobForUpdate(connection, processId, processLobId);
      if (status === "approved") {
        const [overlaps] = await connection.execute<RowDataPacket[]>(
          `SELECT id, effective_from, effective_to
             FROM process_revenue_rule
            WHERE process_id = ?
              AND process_lob_id = ?
              AND metric_key = ?
              AND billing_model = ?
              AND status = 'approved'
              AND id <> ?
            FOR UPDATE`,
          [processId, processLobId, metricKey, billingModel, id]
        );
        if (overlaps.some((row) => dateRangeOverlaps(
          String(row.effective_from).slice(0, 10),
          row.effective_to ? String(row.effective_to).slice(0, 10) : null,
          effectiveFrom,
          effectiveTo
        ))) {
          throw Object.assign(
            new Error("An approved LOB revenue rule already overlaps this metric, billing model and date range"),
            { statusCode: 409 }
          );
        }
      }

      await connection.execute(
        `INSERT INTO process_revenue_rule
          (id, process_id, process_lob_id, contract_id, rule_name, billing_model, metric_key,
           rate_amount, currency_code, fx_to_inr, monthly_minimum_commitment, included_units,
           overage_rate, mandated_seats, quality_gate_pct, sla_gate_pct, effective_from,
           effective_to, status, approved_by, approved_at, approval_reference, created_by, updated_by)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE
           process_id=VALUES(process_id), process_lob_id=VALUES(process_lob_id),
           contract_id=VALUES(contract_id), rule_name=VALUES(rule_name),
           billing_model=VALUES(billing_model), metric_key=VALUES(metric_key),
           rate_amount=VALUES(rate_amount), currency_code=VALUES(currency_code),
           fx_to_inr=VALUES(fx_to_inr), monthly_minimum_commitment=VALUES(monthly_minimum_commitment),
           included_units=VALUES(included_units), overage_rate=VALUES(overage_rate),
           mandated_seats=VALUES(mandated_seats), quality_gate_pct=VALUES(quality_gate_pct),
           sla_gate_pct=VALUES(sla_gate_pct), effective_from=VALUES(effective_from),
           effective_to=VALUES(effective_to), status=VALUES(status),
           approved_by=VALUES(approved_by), approved_at=VALUES(approved_at),
           approval_reference=VALUES(approval_reference), updated_by=VALUES(updated_by),
           updated_at=NOW()`,
        [
          id,
          processId,
          processLobId,
          cleanText(input.contractId),
          ruleName,
          billingModel,
          metricKey,
          rateAmount,
          currencyCode,
          fxToInr,
          money(input.monthlyMinimumCommitment ?? 0, "Monthly minimum commitment"),
          money(input.includedUnits ?? 0, "Included units"),
          money(input.overageRate ?? 0, "Overage rate"),
          nullableNumber(input.mandatedSeats, "Mandated seats"),
          nullableNumber(input.qualityGatePct, "Quality gate"),
          nullableNumber(input.slaGatePct, "SLA gate"),
          effectiveFrom,
          effectiveTo,
          status,
          status === "approved" ? actorUserId : null,
          status === "approved" ? new Date() : null,
          cleanText(input.approvalReference),
          actorUserId,
          actorUserId,
        ]
      );
      await connection.commit();
      return { id };
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
  },

  async saveDeliveryActual(input: SaveLobDeliveryInput, actorUserId: string) {
    await ensureCommercialFoundation();
    const processId = String(input.processId ?? "").trim();
    const processLobId = String(input.processLobId ?? "").trim();
    const periodCode = normalisePeriod(input.periodCode);
    const metricKey = String(input.metricKey ?? "").trim();
    const dataSource = String(input.dataSource ?? "manual").trim();
    const sourceReference = String(input.sourceReference ?? "manual").trim();
    const status = input.status ?? "draft";
    if (!processId || !processLobId || !metricKey || !dataSource || !sourceReference) {
      throw Object.assign(new Error("Process, LOB, metric, data source and source reference are required"), { statusCode: 400 });
    }
    if (!DELIVERY_STATUSES.has(status)) throw Object.assign(new Error("Invalid delivery status"), { statusCode: 400 });
    if (input.activityDate && !String(input.activityDate).startsWith(periodCode)) {
      throw Object.assign(new Error("Activity date must fall inside the selected period"), { statusCode: 400 });
    }
    const planned = money(input.plannedUnits ?? 0, "Planned units");
    const delivered = money(input.deliveredUnits ?? 0, "Delivered units");
    const accepted = money(input.acceptedUnits ?? 0, "Accepted units");
    const rejected = money(input.rejectedUnits ?? 0, "Rejected units");
    const billable = money(input.billableUnits ?? 0, "Billable units");
    if (accepted + rejected > delivered + 0.0001) {
      throw Object.assign(new Error("Accepted plus rejected units cannot exceed delivered units"), { statusCode: 400 });
    }
    if (billable > accepted + 0.0001 && accepted > 0) {
      throw Object.assign(new Error("Billable units cannot exceed accepted units"), { statusCode: 400 });
    }

    const id = String(input.id ?? randomUUID());
    const connection = await db.getConnection();
    try {
      await connection.beginTransaction();
      await getLobForUpdate(connection, processId, processLobId);
      await connection.execute(
        `INSERT INTO process_delivery_actual
          (id, process_id, process_lob_id, period_code, activity_date, metric_key,
           planned_units, delivered_units, accepted_units, rejected_units, billable_units,
           productive_hours, login_hours, talk_minutes, quality_score, sla_score,
           data_source, source_reference, status, validated_by, validated_at, created_by, updated_by)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE
           process_lob_id=VALUES(process_lob_id), activity_date=VALUES(activity_date),
           planned_units=VALUES(planned_units), delivered_units=VALUES(delivered_units),
           accepted_units=VALUES(accepted_units), rejected_units=VALUES(rejected_units),
           billable_units=VALUES(billable_units), productive_hours=VALUES(productive_hours),
           login_hours=VALUES(login_hours), talk_minutes=VALUES(talk_minutes),
           quality_score=VALUES(quality_score), sla_score=VALUES(sla_score),
           status=VALUES(status), validated_by=VALUES(validated_by),
           validated_at=VALUES(validated_at), updated_by=VALUES(updated_by), updated_at=NOW()`,
        [
          id,
          processId,
          processLobId,
          periodCode,
          cleanText(input.activityDate),
          metricKey,
          planned,
          delivered,
          accepted,
          rejected,
          billable,
          money(input.productiveHours ?? 0, "Productive hours"),
          money(input.loginHours ?? 0, "Login hours"),
          money(input.talkMinutes ?? 0, "Talk minutes"),
          nullableNumber(input.qualityScore, "Quality score"),
          nullableNumber(input.slaScore, "SLA score"),
          dataSource,
          sourceReference,
          status,
          status === "validated" || status === "locked" ? actorUserId : null,
          status === "validated" || status === "locked" ? new Date() : null,
          actorUserId,
          actorUserId,
        ]
      );
      await connection.commit();
      return { id, periodCode };
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
  },
};
