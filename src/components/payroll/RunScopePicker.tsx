/**
 * Choose the branches and cost centres a payroll run will pay.
 *
 * Only ACTIVE branches appear, each expanding to its cost centres with headcount. Selection spans
 * branches, because a run may cover cost centres in more than one.
 *
 * A cost centre already covered by a live run this month is shown but disabled, with the reason. It
 * is deliberately shown rather than hidden: a Payroll Head looking for a cost centre needs to learn
 * that it is already handled, not that it has vanished.
 *
 * Selection maths lives in runScopeSelection.ts so it can be tested without rendering — the rule
 * decides who gets paid, and a rule buried in a component is a rule nothing asserts.
 */

import { useMemo, useState } from "react";
import { Building2, ChevronDown, ChevronRight, Lock, Users } from "lucide-react";
import { Checkbox } from "@/components/ui/checkbox";
import { cn } from "@/lib/utils";
import {
  branchState,
  isSelectable,
  selectionSummary,
  toggleBranch,
  toggleCostCentre,
  type PickerBranch,
} from "./runScopeSelection";

type Props = {
  branches: PickerBranch[];
  value: string[];
  onChange: (costCentreIds: string[]) => void;
  /** Shown while the coverage query is in flight. */
  loading?: boolean;
};

const CLAIMED_LABEL: Record<string, string> = {
  paid: "already paid this month",
  in_run: "already in a run this month",
};

export function RunScopePicker({ branches, value, onChange, loading = false }: Props) {
  // Branches start expanded: with four active branches there is nothing to gain by hiding them, and
  // a collapsed list makes the user click before they can see what they are choosing between.
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const summary = useMemo(() => selectionSummary(value, branches), [value, branches]);

  const toggleCollapse = (branchId: string) =>
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(branchId)) next.delete(branchId);
      else next.add(branchId);
      return next;
    });

  if (loading) {
    return (
      <div className="rounded-2xl border border-white/60 bg-white/95 p-6 text-sm text-slate-500 shadow-sm backdrop-blur-sm">
        Loading branches and cost centres…
      </div>
    );
  }

  if (!branches.length) {
    return (
      <div className="rounded-2xl border border-white/60 bg-white/95 p-6 text-sm text-slate-500 shadow-sm backdrop-blur-sm">
        No active branch has cost centres with employees for this month.
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="overflow-hidden rounded-2xl border border-white/60 bg-white/95 shadow-sm backdrop-blur-sm transition-all duration-200 hover:shadow-md">
        {/* Payroll is financial data, so blue per the frozen section-gradient map. */}
        <div className="flex items-center gap-3 bg-gradient-to-r from-blue-600 to-indigo-600 px-4 py-3 text-white">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-white/20">
            <Building2 className="h-4 w-4" />
          </div>
          <div>
            <h3 className="text-base font-semibold leading-tight">Branches &amp; cost centres</h3>
            <p className="text-xs text-blue-100">Choose what this payroll run will pay</p>
          </div>
        </div>
        {branches.map((branch) => {
          const state = branchState(value, branch);
          const isCollapsed = collapsed.has(branch.branchId);
          const branchStaff = branch.costCentres.reduce((n, c) => n + c.staff, 0);
          const nothingToPick = branch.costCentres.every((c) => !isSelectable(c));

          return (
            <div key={branch.branchId} className="border-b border-slate-100 last:border-b-0">
              <div className="flex min-h-[44px] items-center gap-3 bg-gradient-to-r from-slate-50 to-blue-50/60 px-4 py-3">
                {/*
                  Radix renders the same tick for "indeterminate" as for "checked", and the shared
                  ui/checkbox is used app-wide so it is not the place to change that. A lighter fill
                  separates "some of this branch" from "all of it"; the semantics are already right
                  underneath, since Radix emits aria-checked="mixed".
                */}
                <Checkbox
                  checked={state === "all" ? true : state === "some" ? "indeterminate" : false}
                  onCheckedChange={() => onChange(toggleBranch(value, branch))}
                  disabled={nothingToPick}
                  aria-label={`Select all cost centres in ${branch.branchName}`}
                  className="cursor-pointer data-[state=indeterminate]:border-blue-400 data-[state=indeterminate]:bg-blue-400"
                />
                <button
                  type="button"
                  onClick={() => toggleCollapse(branch.branchId)}
                  className="flex flex-1 items-center gap-2 text-left transition-colors duration-200 hover:text-blue-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-1 cursor-pointer"
                  aria-expanded={!isCollapsed}
                >
                  {isCollapsed ? (
                    <ChevronRight className="h-4 w-4 text-slate-400" />
                  ) : (
                    <ChevronDown className="h-4 w-4 text-slate-400" />
                  )}
                  <Building2 className="h-4 w-4 text-blue-600" />
                  <span className="font-semibold text-gray-800">{branch.branchName}</span>
                  <span className="hidden text-xs font-semibold uppercase tracking-wide text-slate-500 sm:inline">
                    {branch.costCentres.length} cost {branch.costCentres.length === 1 ? "centre" : "centres"}
                    {" · "}
                    {branchStaff} {branchStaff === 1 ? "employee" : "employees"}
                  </span>
                </button>
              </div>

              {!isCollapsed && (
                <ul className="divide-y divide-slate-50">
                  {branch.costCentres.map((cc) => {
                    const selectable = isSelectable(cc);
                    const checked = value.includes(cc.costCentreId);
                    return (
                      <li
                        key={cc.costCentreId}
                        className={cn(
                          "flex min-h-[44px] items-center gap-3 py-2.5 pl-12 pr-4 transition-colors duration-200",
                          selectable ? "hover:bg-blue-50/50" : "opacity-60",
                        )}
                      >
                        <Checkbox
                          checked={checked}
                          disabled={!selectable}
                          onCheckedChange={() => onChange(toggleCostCentre(value, cc))}
                          aria-label={cc.costCentreCode}
                          className={selectable ? "cursor-pointer" : ""}
                        />
                        <span className="flex-1 text-sm font-medium text-gray-800">{cc.costCentreCode}</span>
                        <span className="flex items-center gap-1.5 text-sm font-semibold text-slate-600">
                          <Users className="h-3.5 w-3.5" />
                          {cc.staff}
                        </span>
                        {!selectable && (
                          <span className="flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-xs font-bold text-amber-700">
                            <Lock className="h-3 w-3" />
                            {CLAIMED_LABEL[cc.status] ?? "unavailable"}
                          </span>
                        )}
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          );
        })}
      </div>

      {/*
        Headcount leads. "12 cost centres" says nothing about whether this run pays 15 people or 900,
        and the number of people about to be paid is the one worth reading twice before running.
      */}
      <div
        className={cn(
          "rounded-xl border px-4 py-3 text-sm",
          summary.employees > 0
            ? "border-blue-200 bg-blue-50 text-blue-900"
            : "border-slate-200 bg-slate-50 text-slate-500",
        )}
        aria-live="polite"
      >
        {summary.employees > 0 ? (
          <>
            This run will pay <span className="font-bold">{summary.employees}</span>{" "}
            {summary.employees === 1 ? "employee" : "employees"} across{" "}
            <span className="font-bold">{summary.costCentres}</span> cost{" "}
            {summary.costCentres === 1 ? "centre" : "centres"} in{" "}
            <span className="font-bold">{summary.branches}</span>{" "}
            {summary.branches === 1 ? "branch" : "branches"}.
          </>
        ) : (
          "Select at least one cost centre. A run with no cost centres is not permitted."
        )}
      </div>
    </div>
  );
}

export default RunScopePicker;
