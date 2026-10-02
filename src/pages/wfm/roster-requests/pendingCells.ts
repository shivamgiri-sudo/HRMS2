import { KIND_LABEL, type RequestKind } from "./types";

export interface PendingCell { employeeId: string; date: string; kind: RequestKind; id: string | number }
export interface PendingRef { kind: RequestKind; id: string }

export const pendingCellKey = (employeeId: string, date: string) => `${employeeId}|${date}`;

/** Index the flat server list by cell so the grid does an O(1) lookup per cell. */
export function indexPendingCells(cells: readonly PendingCell[]): Map<string, PendingRef[]> {
  const out = new Map<string, PendingRef[]>();
  for (const c of cells) {
    if (!c || !c.employeeId || !c.date || !(c.kind in KIND_LABEL)) continue;
    const k = pendingCellKey(String(c.employeeId), String(c.date).slice(0, 10));
    const list = out.get(k) ?? [];
    list.push({ kind: c.kind, id: String(c.id) });
    out.set(k, list);
  }
  return out;
}

export const pendingBadgeTitle = (kind: RequestKind) => `Pending ${KIND_LABEL[kind].toLowerCase()}`;

export const pendingBadgeHref = (ref: PendingRef) =>
  `/wfm/roster-requests?kind=${encodeURIComponent(ref.kind)}&id=${encodeURIComponent(ref.id)}`;
