import type { ReactNode } from "react";
import type { BranchHeadHealthPayload, BranchOverview } from "../../../../../../backend/src/modules/branch-head-health/types";
import type { DrillTarget, MetricDrillId } from "../drill";
import { processTarget } from "../drill";
import type { TableSpec } from "../viz";

/** Every visual section gets the branch overview, the whole payload (for process ids) and the drill callback. */
export interface VisualProps {
  overview: BranchOverview;
  payload: BranchHeadHealthPayload;
  onSelect: (target: DrillTarget) => void;
}

/** Active processes reachable from this branch (a process name can repeat across branches). */
export function branchProcesses(payload: BranchHeadHealthPayload, branchId: string) {
  return (payload.processes?.active ?? []).filter((p) => (p.branchIds ?? []).includes(branchId));
}

/** Click handler for a process name: this branch's process drawer when it joins, else the section metric. */
export function selectByName({ overview, payload, onSelect }: VisualProps, fallback: MetricDrillId) {
  const branchId = overview.branch.branchId;
  const rows = branchProcesses(payload, branchId);
  return (name: string) => onSelect(processTarget(name, rows, fallback, branchId));
}

/** Rows keyed by index (names can repeat); maps a clicked row id back to its label for the join. */
export function byLabel(items: ReadonlyArray<{ id: string; label: string }>, select: (name: string) => void) {
  const names = new Map(items.map((it) => [it.id, it.label]));
  return (id: string) => select(names.get(id) ?? "");
}

/**
 * Append extra columns to a primitive's table twin. The base rows come from the primitive's own
 * builder (so they match the chart); `extra(i)` adds the same row's other payload fields.
 */
export function extendTable(base: TableSpec, columns: string[], extra: (i: number) => Array<string | number | null>): TableSpec {
  return { ...base, columns: [...base.columns, ...columns], rows: base.rows.map((r, i) => [...r, ...extra(i)]) };
}

export const Tiles = ({ label, children }: { label: string; children: ReactNode }) => (
  <ul aria-label={label} className="grid list-none grid-cols-2 gap-2 p-0 sm:grid-cols-4">{children}</ul>
);

export const Foot = ({ children }: { children: ReactNode }) => <p className="mt-2 text-[12px] text-slate-700">{children}</p>;

/** Collapsed-by-default disclosure with a 44px summary. */
export function Fold({ title, children, group }: { title: ReactNode; children: ReactNode; group?: string }) {
  return (
    <details data-group={group} className="rounded-lg border border-slate-200">
      <summary className="flex min-h-[44px] cursor-pointer items-center px-3 text-[13px] font-semibold text-slate-900">{title}</summary>
      <div className="p-3">{children}</div>
    </details>
  );
}

/** Two or more frames side by side from 1024px, stacked below. */
export const Grid = ({ children }: { children: ReactNode }) => <div className="grid min-w-0 gap-3 lg:grid-cols-2">{children}</div>;

const fin = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
/** Non-negative finite number (0 for anything else). */
export const nn = (v: unknown): number => (fin(v) && v > 0 ? v : 0);

/** One grid cell of a `Tiles` list. */
export const TileItem = ({ children }: { children: ReactNode }) => <li className="min-w-0">{children}</li>;
