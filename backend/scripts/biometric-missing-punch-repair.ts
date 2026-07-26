import "dotenv/config";
import { readFile } from "fs/promises";
import path from "path";
import type { RowDataPacket } from "mysql2";

type Args = {
  from: string;
  to: string;
  runMonth?: string;
  limit: number;
  apply: boolean;
  recalc: boolean;
};

type QueueRow = {
  employee_id: string;
  employee_code: string;
  employee_name: string;
  start_date: string;
  action_bucket: string;
};

type CandidateRow = {
  employee_id: string;
  employee_code: string;
  employee_name: string;
  start_date: string;
  before_status: string | null;
  before_source: string | null;
  before_raw_minutes: number | null;
  is_locked: number | null;
  regularization_id: string | null;
  override_by: string | null;
  recomputed_status: string;
  recomputed_source: string;
  recomputed_source_system: string;
  recomputed_raw_minutes: number;
  recomputed_dialler_minutes: number | null;
  recomputed_biometric_minutes: number | null;
};

function parseArgs(argv: string[]): Args {
  const out: Partial<Args> = { limit: 0, apply: false, recalc: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--from") out.from = argv[++i];
    else if (arg === "--to") out.to = argv[++i];
    else if (arg === "--run-month") out.runMonth = argv[++i];
    else if (arg === "--limit") out.limit = Number(argv[++i]);
    else if (arg === "--apply") out.apply = true;
    else if (arg === "--recalc") out.recalc = true;
  }

  if (!out.from || !out.to) {
    throw new Error(
      "Usage: npm run biometric-missing-punch:repair -- --from YYYY-MM-DD --to YYYY-MM-DD [--run-month YYYY-MM] [--limit N] [--apply] [--recalc]",
    );
  }

  if (!/^\d{4}-\d{2}-\d{2}$/.test(out.from) || !/^\d{4}-\d{2}-\d{2}$/.test(out.to)) {
    throw new Error("--from and --to must be YYYY-MM-DD");
  }

  if (out.runMonth && !/^\d{4}-\d{2}$/.test(out.runMonth)) {
    throw new Error("--run-month must be YYYY-MM");
  }

  return out as Args;
}

function toNumber(value: unknown): number {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

async function loadQueueRows(from: string, to: string): Promise<QueueRow[]> {
  const filePath = path.resolve("logs", `night_shift_remaining_queue_${from}_to_${to}.json`);
  const raw = await readFile(filePath, "utf8").catch(() => null);
  if (!raw) {
    throw new Error(`Queue file not found: ${filePath}. Run night-shift:export-remaining first.`);
  }

  const parsed = JSON.parse(raw) as { rows?: QueueRow[] };
  return (parsed.rows ?? []).filter((row) => row.action_bucket === "BIOMETRIC_MISSING_PUNCH_REVIEW");
}

async function latestRunIdForMonth(db: any, runMonth: string): Promise<string | null> {
  const [rows] = await db.query<RowDataPacket[]>(
    `SELECT id
       FROM salary_prep_run
      WHERE run_month = ?
      ORDER BY created_at DESC
      LIMIT 1`,
    [runMonth],
  );
  return (rows[0] as { id?: string } | undefined)?.id ?? null;
}

async function loadAdrRow(db: any, employeeId: string, date: string) {
  const [rows] = await db.query<RowDataPacket[]>(
    `SELECT attendance_status, attendance_source, raw_minutes, is_locked, regularization_id, override_by
       FROM attendance_daily_record
      WHERE employee_id = ?
        AND DATE(CONVERT_TZ(record_date, '+00:00', '+05:30')) = ?
      LIMIT 1`,
    [employeeId, date],
  );
  return (rows[0] as RowDataPacket | undefined) ?? null;
}

async function loadCandidates(
  db: any,
  attendanceEngineService: any,
  queueRows: QueueRow[],
  limit: number,
): Promise<CandidateRow[]> {
  const candidates: CandidateRow[] = [];

  for (const row of queueRows) {
    const adr = await loadAdrRow(db, row.employee_id, row.start_date);
    if (!adr) {
      continue;
    }

    if (String(adr.attendance_status ?? "") !== "missing_punch" || String(adr.attendance_source ?? "") !== "biometric") {
      continue;
    }

    const recomputed = await attendanceEngineService.processEmployee(row.employee_id, row.start_date);
    if (recomputed.source !== "dialler" || recomputed.rawMinutes < 240) {
      continue;
    }

    candidates.push({
      employee_id: row.employee_id,
      employee_code: row.employee_code,
      employee_name: row.employee_name,
      start_date: row.start_date,
      before_status: adr.attendance_status ? String(adr.attendance_status) : null,
      before_source: adr.attendance_source ? String(adr.attendance_source) : null,
      before_raw_minutes: adr.raw_minutes === null ? null : toNumber(adr.raw_minutes),
      is_locked: adr.is_locked === null ? null : toNumber(adr.is_locked),
      regularization_id: adr.regularization_id ? String(adr.regularization_id) : null,
      override_by: adr.override_by ? String(adr.override_by) : null,
      recomputed_status: String(recomputed.status),
      recomputed_source: String(recomputed.source),
      recomputed_source_system: String(recomputed.sourceSystem),
      recomputed_raw_minutes: toNumber(recomputed.rawMinutes),
      recomputed_dialler_minutes: recomputed.diallerMinutes === null ? null : toNumber(recomputed.diallerMinutes),
      recomputed_biometric_minutes: recomputed.biometricMinutes === null ? null : toNumber(recomputed.biometricMinutes),
    });

    if (limit > 0 && candidates.length >= limit) {
      break;
    }
  }

  return candidates;
}

async function applyCandidate(attendanceEngineService: any, row: CandidateRow): Promise<"repaired" | "skipped"> {
  if (Number(row.is_locked ?? 0) === 1 || row.regularization_id || row.override_by) {
    return "skipped";
  }

  const recomputed = await attendanceEngineService.processEmployee(row.employee_id, row.start_date);
  await attendanceEngineService.upsertDailyRecord(recomputed, "biometric_missing_punch_repair");
  return "repaired";
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const runMonth = args.runMonth ?? args.from.slice(0, 7);
  const queueRows = await loadQueueRows(args.from, args.to);
  const { db, closePool } = await import("../src/db/mysql.js");
  const { attendanceEngineService } = await import("../src/modules/wfm/attendance-engine.service.js");
  const { calculatePayrollRunScoped } = await import("../src/modules/payroll/payrollCalculate.service.js");

  try {
    const runId = await latestRunIdForMonth(db, runMonth);
    const candidates = await loadCandidates(db, attendanceEngineService, queueRows, args.limit);
    const protectedRows = candidates.filter(
      (row) => Number(row.is_locked ?? 0) === 1 || Boolean(row.regularization_id) || Boolean(row.override_by),
    );
    const repairableRows = candidates.filter((row) => !protectedRows.includes(row));

    console.log(`Biometric missing-punch engine repair audit - ${args.from} to ${args.to}`);
    console.log(`Run month: ${runMonth}`);
    console.log(`Run id: ${runId ?? "not found"}`);
    console.table([
      { metric: "queue_rows", count: queueRows.length },
      { metric: "engine_repair_candidates", count: candidates.length },
      { metric: "repairable_rows", count: repairableRows.length },
      { metric: "protected_rows_skipped", count: protectedRows.length },
    ]);
    console.log("Sample repairable rows:");
    console.table(repairableRows.slice(0, 20));

    if (!args.apply) {
      console.log(
        "Dry-run only. Re-run with --apply to reprocess unlocked missing_punch rows through the attendance engine.",
      );
      return;
    }

    let repaired = 0;
    let skipped = 0;
    const affectedEmployeeIds = new Set<string>();

    for (const row of candidates) {
      const result = await applyCandidate(attendanceEngineService, row);
      if (result === "repaired") {
        repaired += 1;
        affectedEmployeeIds.add(row.employee_id);
      } else {
        skipped += 1;
      }
    }

    console.table([
      { metric: "repaired_rows", count: repaired },
      { metric: "skipped_rows", count: skipped },
      { metric: "affected_employees", count: affectedEmployeeIds.size },
    ]);

    if (args.recalc && runId && affectedEmployeeIds.size > 0) {
      const recalc = await calculatePayrollRunScoped(runId, "biometric_missing_punch_repair", {
        employeeIds: Array.from(affectedEmployeeIds),
      });
      console.log("Payroll recalculation result:");
      console.dir(recalc, { depth: null });
    } else if (args.recalc) {
      console.log("No repaired employees, so payroll recalculation was skipped.");
    } else {
      console.log("ADR repair applied. Payroll recalculation not run because --recalc was not passed.");
    }
  } finally {
    await closePool();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
