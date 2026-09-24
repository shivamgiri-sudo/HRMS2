import { isIsoDay, PROCESS_QUEUES, type ProcessQueue } from "./onfido-overview-report.pure.js";

/**
 * Validation for the two manual WFM inputs the Onfido Overview / Utilization formats need
 * (approved HC per queue; daily utilization inputs). Rejects rather than coerces: a value
 * that is not a plain non-negative number is an error, never silently 0.
 */

export const MAX_BULK_ROWS = 400;
const MAX_REMARKS = 255;
const MAX_HC = 100000;
const MAX_INPUT_VALUE = 100000000;

export interface ManpowerPlanInput {
  processQueue: ProcessQueue;
  effectiveFrom: string;
  approvedHc: number;
  activeHc: number | null;
  remarks: string | null;
}

export interface UtilizationInputRow {
  inputDate: string;
  forecastTask: number | null;
  forecastTaskPoa: number | null;
  manualFarCases: number | null;
  adhocTime: number | null;
  analystQc: number | null;
  facialChecks: number | null;
  crossTrainingTaskPoa: number | null;
  poaLiveAuditsPq: number | null;
  remarks: string | null;
}

export type Parsed<T> = { ok: true; value: T } | { ok: false; error: string };

const fail = (error: string): { ok: false; error: string } => ({ ok: false, error });

/** Blank / null / undefined mean "not entered" (null); anything else must be a finite number >= 0. */
function optionalNumber(raw: unknown, label: string, opts: { integer: boolean; max: number }): Parsed<number | null> {
  if (raw === null || raw === undefined) return { ok: true, value: null };
  if (typeof raw === "string" && raw.trim() === "") return { ok: true, value: null };
  const n = typeof raw === "number" ? raw : Number(String(raw).replace(/,/g, "").trim());
  if (!Number.isFinite(n) || n < 0) return fail(`${label} must be a number of 0 or more.`);
  if (n > opts.max) return fail(`${label} is unreasonably large.`);
  if (opts.integer && !Number.isInteger(n)) return fail(`${label} must be a whole number.`);
  return { ok: true, value: n };
}

function optionalRemarks(raw: unknown): Parsed<string | null> {
  if (raw === null || raw === undefined || String(raw).trim() === "") return { ok: true, value: null };
  const text = String(raw).trim();
  if (text.length > MAX_REMARKS) return fail(`Remarks must be ${MAX_REMARKS} characters or fewer.`);
  return { ok: true, value: text };
}

export function parseManpowerPlanInput(raw: unknown): Parsed<ManpowerPlanInput> {
  if (typeof raw !== "object" || raw === null) return fail("Request body must be an object.");
  const r = raw as Record<string, unknown>;
  if (!PROCESS_QUEUES.includes(r.processQueue as ProcessQueue)) return fail("Queue must be Extraction, POA or Encord.");
  if (!isIsoDay(r.effectiveFrom)) return fail("Effective from must be a valid date.");
  const approved = optionalNumber(r.approvedHc, "Approved HC", { integer: true, max: MAX_HC });
  if (!approved.ok) return approved;
  if (approved.value === null) return fail("Approved HC is required (enter 0 if the queue has no approved staff).");
  const active = optionalNumber(r.activeHc, "Active HC", { integer: true, max: MAX_HC });
  if (!active.ok) return active;
  const remarks = optionalRemarks(r.remarks);
  if (!remarks.ok) return remarks;
  return {
    ok: true,
    value: {
      processQueue: r.processQueue as ProcessQueue,
      effectiveFrom: r.effectiveFrom,
      approvedHc: approved.value,
      // Active HC is only accepted for Encord, the one queue with no uploaded staffing source.
      activeHc: r.processQueue === "ENCORD" ? active.value : null,
      remarks: remarks.value,
    },
  };
}

const UTILIZATION_FIELDS: { key: keyof Omit<UtilizationInputRow, "inputDate" | "remarks">; label: string; integer: boolean }[] = [
  { key: "forecastTask", label: "Forecasted Task", integer: false },
  { key: "forecastTaskPoa", label: "Forecasted Task POA", integer: false },
  { key: "manualFarCases", label: "Manual FAR Case", integer: true },
  { key: "adhocTime", label: "Adhoc Time", integer: false },
  { key: "analystQc", label: "Analyst QC", integer: true },
  { key: "facialChecks", label: "Facial checks", integer: true },
  { key: "crossTrainingTaskPoa", label: "Cross training task POA", integer: true },
  { key: "poaLiveAuditsPq", label: "POA Live Audits / POA PQ Audits", integer: true },
];

export function parseUtilizationInputRow(raw: unknown): Parsed<UtilizationInputRow> {
  if (typeof raw !== "object" || raw === null) return fail("Each row must be an object.");
  const r = raw as Record<string, unknown>;
  if (!isIsoDay(r.inputDate)) return fail("Date must be a valid date.");
  const out: UtilizationInputRow = {
    inputDate: r.inputDate,
    forecastTask: null, forecastTaskPoa: null, manualFarCases: null, adhocTime: null,
    analystQc: null, facialChecks: null, crossTrainingTaskPoa: null, poaLiveAuditsPq: null,
    remarks: null,
  };
  for (const f of UTILIZATION_FIELDS) {
    const parsed = optionalNumber(r[f.key], f.label, { integer: f.integer, max: MAX_INPUT_VALUE });
    if (!parsed.ok) return fail(`${r.inputDate}: ${parsed.error}`);
    out[f.key] = parsed.value;
  }
  const remarks = optionalRemarks(r.remarks);
  if (!remarks.ok) return fail(`${r.inputDate}: ${remarks.error}`);
  out.remarks = remarks.value;
  return { ok: true, value: out };
}

/** Validates a whole batch; nothing is written unless every row is valid. */
export function parseUtilizationInputBatch(raw: unknown): Parsed<UtilizationInputRow[]> {
  if (!Array.isArray(raw) || raw.length === 0) return fail("Provide at least one row.");
  if (raw.length > MAX_BULK_ROWS) return fail(`At most ${MAX_BULK_ROWS} rows per request.`);
  const rows: UtilizationInputRow[] = [];
  const seen = new Set<string>();
  for (const item of raw) {
    const parsed = parseUtilizationInputRow(item);
    if (!parsed.ok) return parsed;
    if (seen.has(parsed.value.inputDate)) return fail(`Date ${parsed.value.inputDate} appears more than once.`);
    seen.add(parsed.value.inputDate);
    rows.push(parsed.value);
  }
  return { ok: true, value: rows };
}
