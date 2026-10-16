import type { BranchHeadHealthPayload, BranchOverview, ProcessPnlRow, AttritionData } from "../../../../../../backend/src/modules/branch-head-health/types";
import type { BranchProcess } from "../../../../../../backend/src/modules/branch-head-health/processes";
import type { OpsProcessRow, QualityRow } from "../../../../../../backend/src/modules/branch-head-health/ops";
import type { AttendanceData, HiringData } from "../panelTypes";
import { normalizeProcessName, type DrillTarget } from "../drill";
import { branchProcesses, nn } from "../sections/shared";

type ProcessTarget = Extract<DrillTarget, { kind: "process" }>;

/** Section data when the section loaded; null otherwise. */
export function okData<T>(s: { status: string; data: unknown } | undefined): T | null {
  return s && s.status === "ok" && s.data != null ? (s.data as T) : null;
}

/** The process by id (active, then unmapped); else by name among the branch's processes; else null. */
export function findProcess(payload: BranchHeadHealthPayload, target: ProcessTarget, branchId: string): BranchProcess | null {
  const all = [...(payload.processes?.active ?? []), ...(payload.processes?.unmapped ?? [])];
  const byId = all.find((p) => p.processId === target.id);
  if (byId) return byId;
  const key = normalizeProcessName(target.name);
  return key ? branchProcesses(payload, branchId).find((p) => normalizeProcessName(p.processName) === key) ?? null : null;
}

/**
 * A process known only from this branch's P&L rows (not in the coverage lists): a stand-in built from
 * the row, with no cost centres, no tier and no agent list. Null when the row is not there either.
 */
export function pnlOnlyProcess(ov: BranchOverview | null, target: ProcessTarget): BranchProcess | null {
  const row = (okData<{ rows: ProcessPnlRow[] }>(ov?.processPnl)?.rows ?? []).find((r) => r.processId === target.id);
  if (!row) return null;
  return {
    processId: row.processId, processCode: "", processName: row.processName, costCentres: [], viaLink: false,
    mandatedSeats: row.mandatedSeats, headcount: nn(row.activeHc), tier: "not_wired", latestMetricDate: null, billingMirror: false, branchIds: [],
  };
}

export interface ProcessDetail {
  pnl: ProcessPnlRow | null;
  slots: AttendanceData["bySlot"];
  /** Summed over this process's shift slots; null when nothing is rostered. */
  shrinkage: { planned: number; absent: number; pct: number } | null;
  attrition: AttritionData["byProcess"][number] | null;
  quality: number | null;
  ops: OpsProcessRow | null;
  batches: HiringData["batches"];
}

const fin = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

/** Everything the payload knows about one process in one branch overview, joined by id, code or name. */
export function processDetail(ov: BranchOverview | null, p: BranchProcess): ProcessDetail {
  const key = normalizeProcessName(p.processName);
  const same = (name: unknown) => key !== "" && normalizeProcessName(String(name ?? "")) === key;
  const att = okData<AttendanceData>(ov?.attendance);
  const slots = (att?.bySlot ?? []).filter((s) => same(s.process));
  const planned = slots.reduce((a, s) => a + nn(s.planned), 0);
  const absent = slots.reduce((a, s) => a + nn(s.absent), 0);
  const pnlRows = okData<{ rows: ProcessPnlRow[] }>(ov?.processPnl)?.rows ?? [];
  const opsRows = okData<OpsProcessRow[]>(ov?.operations);
  const qRows = okData<QualityRow[]>(ov?.quality);
  // Code first (never on an empty code: two blank codes are not a match), then the normalised name.
  const byCode = <T extends { processCode: string; processName: string }>(rows: T[] | null) => {
    const list = Array.isArray(rows) ? rows : [];
    const code = String(p.processCode ?? "").trim();
    return (code ? list.find((r) => String(r.processCode ?? "").trim() === code) : undefined) ?? list.find((r) => same(r.processName)) ?? null;
  };
  const ops = byCode(opsRows);
  const q = byCode(qRows);
  const qa = fin(q?.QA_QUALITY_PCT) ? q!.QA_QUALITY_PCT : fin(ops?.metrics?.QA_QUALITY_PCT) ? (ops!.metrics.QA_QUALITY_PCT as number) : null;
  return {
    pnl: pnlRows.find((r) => r.processId === p.processId) ?? pnlRows.find((r) => same(r.processName)) ?? null,
    slots,
    shrinkage: planned > 0 ? { planned, absent, pct: (absent / planned) * 100 } : null,
    attrition: (okData<AttritionData>(ov?.attrition)?.byProcess ?? []).find((r) => same(r.process)) ?? null,
    quality: qa,
    ops,
    batches: (okData<HiringData>(ov?.hiring)?.batches ?? []).filter((b) => same(b.process)),
  };
}
