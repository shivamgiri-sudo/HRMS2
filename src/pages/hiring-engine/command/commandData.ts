/**
 * Pure helpers of the Drive Command Center shell: stale-response sequencing, option lists and filter edits.
 * No I/O, no React. No regex literals (Tailwind scans source text).
 */
import { addDaysIso, defaultFilters, isIsoDay, istTodayClient, type Filters } from "./driveCommandModel";

// ---- request sequencing ------------------------------------------------------------------------------------------------------------------
export interface RequestTicket { signal: AbortSignal; isCurrent: () => boolean }
export interface RequestSequencer { begin: () => RequestTicket; cancel: () => void }

/**
 * Only the latest ticket is current. begin() aborts the previous request and makes its ticket stale; cancel() (unmount) aborts
 * and invalidates everything. A response must be applied only while its ticket isCurrent(), so a slow old response never
 * overwrites a newer one even if the transport ignores the abort signal.
 */
export function createRequestSequencer(): RequestSequencer {
  let latest = 0;
  let ctrl: AbortController | null = null;
  return {
    begin() {
      ctrl?.abort();
      const mine = ++latest;
      const own = new AbortController();
      ctrl = own;
      return { signal: own.signal, isCurrent: () => mine === latest && !own.signal.aborted };
    },
    cancel() {
      latest += 1;
      ctrl?.abort();
      ctrl = null;
    },
  };
}

/** A user-facing message for a failed request; never an empty string. */
export function describeError(e: unknown): string {
  const m = (e as { message?: unknown } | null | undefined)?.message;
  return typeof m === "string" && m.trim() ? m : "Request failed";
}

// ---- options -----------------------------------------------------------------------------------------------------------------------------
export interface RequisitionOption { id: string; label: string; branch: string }
interface OpenRequisitionRow { id?: unknown; requisition_code?: unknown; designation_name?: unknown; branch_name?: unknown }

const text = (v: unknown): string => (typeof v === "string" ? v.trim() : typeof v === "number" ? String(v) : "");

/** Rows of GET /api/he/requisitions/open as select options; rows without an id are skipped. */
export function requisitionOptions(rows: unknown): RequisitionOption[] {
  if (!Array.isArray(rows)) return [];
  const out: RequisitionOption[] = [];
  for (const r of rows as OpenRequisitionRow[]) {
    const id = text(r?.id);
    if (!id) continue;
    const code = text(r.requisition_code) || `#${id}`;
    const role = text(r.designation_name);
    out.push({ id, label: role ? `${code} - ${role}` : code, branch: text(r.branch_name) });
  }
  return out;
}

/** Distinct non-empty branches, sorted. */
export function branchOptions(reqs: readonly RequisitionOption[]): string[] {
  return Array.from(new Set(reqs.map((r) => r.branch).filter((b) => b !== ""))).sort((a, b) => a.localeCompare(b));
}

// ---- filter edits ------------------------------------------------------------------------------------------------------------------------
const MAX_SPAN = 92;
const MAX_AHEAD = 14;

/** The min/max the date inputs advertise, consistent with the API window limits. */
export function dateBounds(f: Filters, now: Date = new Date()): { from: { min: string; max: string }; to: { min: string; max: string } } {
  const ceiling = addDaysIso(istTodayClient(now), MAX_AHEAD);
  const toMax = addDaysIso(f.from, MAX_SPAN - 1);
  return { from: { min: addDaysIso(f.to, -(MAX_SPAN - 1)), max: f.to }, to: { min: f.from, max: toMax < ceiling ? toMax : ceiling } };
}

/** Edit one date; an invalid or cleared value is ignored. The other end is pulled along so the window stays valid. */
export function applyDateChange(f: Filters, field: "from" | "to", value: string, now: Date = new Date()): Filters {
  if (!isIsoDay(value)) return f;
  const ceiling = addDaysIso(istTodayClient(now), MAX_AHEAD);
  if (field === "from") {
    const to = value > f.to ? value : f.to;
    const capped = to > addDaysIso(value, MAX_SPAN - 1) ? addDaysIso(value, MAX_SPAN - 1) : to;
    return { ...f, from: value, to: capped > ceiling ? ceiling : capped };
  }
  const to = value > ceiling ? ceiling : value;
  const from = f.from > to ? to : f.from;
  return { ...f, to, from: from < addDaysIso(to, -(MAX_SPAN - 1)) ? addDaysIso(to, -(MAX_SPAN - 1)) : from };
}

/** Pick a branch; a chosen requisition from another branch is cleared. */
export function applyBranchChange(f: Filters, branch: string, reqs: readonly RequisitionOption[]): Filters {
  const b = branch === "" ? null : branch;
  const keep = f.requisitionId && b ? reqs.find((r) => r.id === f.requisitionId)?.branch === b : true;
  return { ...f, branch: b, requisitionId: keep ? f.requisitionId : null };
}

export function applyRequisitionChange(f: Filters, id: string): Filters {
  return { ...f, requisitionId: id === "" ? null : id };
}

export function resetFilters(now: Date = new Date()): Filters { return defaultFilters(now); }

/** Stable string key of the filters (effect dependency). */
export function filtersKey(f: Filters): string { return [f.from, f.to, f.requisitionId ?? "", f.branch ?? ""].join("|"); }
