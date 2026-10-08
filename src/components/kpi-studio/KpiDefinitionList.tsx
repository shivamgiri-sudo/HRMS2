import { Fragment, useId, useMemo, useState } from "react";
import { AlertCircle, Archive, CalendarClock, CheckCircle2, Copy, History, Loader2, MoreHorizontal, Pencil, Search, Telescope, Users } from "lucide-react";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { useDefinitionCoverage, useDefinitions, useRetireDefinition, useScopeOptions } from "@/hooks/useKpiStudio";
import { ExplainDrawer } from "./ExplainDrawer";
import { datePart, draftFrom, friendlyError, groupVersions, statusOf, todayLocal } from "./definition-model";
import type { DefinitionDraft, DefinitionGroup, DefinitionRow, DefinitionStatus } from "./definition-model";

/**
 * Every configured KPI, one row per KPI-and-scope, with the scope tier on each row. A rule changed
 * over time is still one row: today's version is shown and the older ones sit behind History.
 */

const SCOPE_STYLE: Record<string, string> = {
  employee: "bg-violet-100 text-violet-700 border-violet-200",
  "branch+process+designation": "bg-indigo-100 text-indigo-700 border-indigo-200",
  "process+designation": "bg-blue-100 text-blue-700 border-blue-200",
  "branch+process": "bg-sky-100 text-sky-700 border-sky-200",
  process: "bg-cyan-100 text-cyan-700 border-cyan-200",
  "branch+designation": "bg-teal-100 text-teal-700 border-teal-200",
  designation: "bg-emerald-100 text-emerald-700 border-emerald-200",
  branch: "bg-slate-100 text-slate-600 border-slate-200",
};

const ACTION_CLASS =
  "inline-flex min-h-[36px] cursor-pointer items-center gap-1 rounded-md px-2 text-xs font-medium text-slate-600 transition-colors hover:bg-slate-100 hover:text-slate-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500";

type PanelKind = "who" | "history" | "end";

function scopeTargetLabel(definition: DefinitionRow): string {
  if (definition.employee_id) {
    return definition.employee_name ?? definition.employee_code ?? "one employee";
  }
  const parts = [definition.branch_name, definition.process_name, definition.designation_name].filter(Boolean);
  return parts.length ? parts.join(" · ") : "—";
}

function formatNumber(value: string | number | null): string {
  if (value === null || value === "") return "—";
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return String(value);
  // Trailing zeros from a DECIMAL(18,4) column are noise: 240.0000 reads as a precision claim
  // nobody made.
  return String(Math.round(parsed * 10_000) / 10_000);
}

function StatusBadge({ status, definition }: { status: DefinitionStatus; definition: DefinitionRow }) {
  if (status === "current") {
    return (
      <span className="inline-flex items-center gap-1 rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-[11px] font-medium text-emerald-800">
        <CheckCircle2 className="h-3 w-3" aria-hidden="true" /> Current
      </span>
    );
  }
  if (status === "scheduled") {
    return (
      <span className="inline-flex items-center gap-1 rounded-full border border-sky-200 bg-sky-50 px-2 py-0.5 text-[11px] font-medium text-sky-800">
        <CalendarClock className="h-3 w-3" aria-hidden="true" /> Starts {datePart(definition.effective_from)}
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 rounded-full border border-slate-300 bg-slate-100 px-2 py-0.5 text-[11px] font-medium text-slate-700">
      <Archive className="h-3 w-3" aria-hidden="true" /> Ended {datePart(definition.effective_to)}
    </span>
  );
}

interface KpiDefinitionListProps {
  /** Whether this viewer may change rules. Without it the list is read-only. */
  canConfigure?: boolean;
  /** Opens the builder prefilled from a row, for an edit or a copy. */
  onEdit?: (draft: DefinitionDraft) => void;
}

const PAGE_SIZE = 50;

export function KpiDefinitionList({ canConfigure = false, onEdit }: KpiDefinitionListProps) {
  const searchId = useId();
  const processId = useId();
  const [search, setSearch] = useState("");
  const [processFilter, setProcessFilter] = useState("");
  const [showEnded, setShowEnded] = useState(false);
  const [page, setPage] = useState(0);
  const [panel, setPanel] = useState<{ key: string; kind: PanelKind } | null>(null);
  const [explaining, setExplaining] = useState<DefinitionRow | null>(null);

  const today = todayLocal();
  const scopeOptions = useScopeOptions();
  // Every version is fetched, not only today's: History needs the old ones, and status is worked
  // out here so the list and the badge cannot disagree.
  const definitions = useDefinitions({ process_id: processFilter || undefined });

  const groups = useMemo(
    () => groupVersions((definitions.data ?? []) as DefinitionRow[], today),
    [definitions.data, today],
  );

  const visible = useMemo(() => {
    const term = search.trim().toLowerCase();
    return groups.filter((group) => {
      if (!showEnded && group.status === "ended") return false;
      if (!term) return true;
      const row = group.current;
      return [row.metric_name, row.metric_code, row.process_name, row.designation_name, row.branch_name, row.employee_name, row.employee_code]
        .filter(Boolean)
        .some((field) => String(field).toLowerCase().includes(term));
    });
  }, [groups, search, showEnded]);

  // 1,000+ rules in one table is slow to render and impossible to scan; show a page at a time.
  const pageCount = Math.max(1, Math.ceil(visible.length / PAGE_SIZE));
  const safePage = Math.min(page, pageCount - 1);
  const paged = useMemo(() => visible.slice(safePage * PAGE_SIZE, (safePage + 1) * PAGE_SIZE), [visible, safePage]);

  const endedCount = groups.filter((group) => group.status === "ended").length;
  const toggle = (key: string, kind: PanelKind) =>
    setPanel((open) => (open && open.key === key && open.kind === kind ? null : { key, kind }));

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3">
        <div className="w-full sm:w-72">
          <label htmlFor={searchId} className="mb-1 block text-xs font-medium text-slate-700">
            Search
          </label>
          <div className="relative">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" aria-hidden="true" />
            <Input
              id={searchId}
              value={search}
              onChange={(event) => { setSearch(event.target.value); setPage(0); }}
              placeholder="KPI name or code"
              className="pl-8"
            />
          </div>
        </div>

        <div className="w-full sm:w-56">
          <label htmlFor={processId} className="mb-1 block text-xs font-medium text-slate-700">
            Process
          </label>
          <select
            id={processId}
            value={processFilter}
            onChange={(event) => { setProcessFilter(event.target.value); setPage(0); }}
            className="h-10 w-full cursor-pointer rounded-lg border border-slate-300 bg-white px-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
          >
            <option value="">All processes</option>
            {(scopeOptions.data?.processes ?? []).map((process) => (
              <option key={process.id} value={process.id}>
                {process.name}
              </option>
            ))}
          </select>
        </div>

        <label className="flex min-h-[40px] cursor-pointer items-center gap-2 text-sm text-slate-700">
          <input
            type="checkbox"
            checked={showEnded}
            onChange={(event) => { setShowEnded(event.target.checked); setPage(0); }}
            className="h-4 w-4 cursor-pointer rounded border-slate-300"
          />
          Show ended{endedCount > 0 ? ` (${endedCount})` : ""}
        </label>

        <span className="text-sm text-slate-500 sm:ml-auto" aria-live="polite">
          {definitions.isLoading ? "" : `${visible.length} KPI rule${visible.length === 1 ? "" : "s"}`}
        </span>
      </div>

      {definitions.isLoading ? (
        <div className="space-y-2 rounded-xl border border-slate-200 bg-white p-4" aria-busy="true">
          <span className="sr-only">Loading KPI rules</span>
          {[0, 1, 2, 3].map((row) => (
            <Skeleton key={row} className="h-12 w-full" />
          ))}
        </div>
      ) : definitions.isError ? (
        <div role="alert" className="flex flex-wrap items-center gap-3 rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-800">
          <AlertCircle className="h-4 w-4 shrink-0" aria-hidden="true" />
          <span className="min-w-0 flex-1">Could not load the KPI rules. {friendlyError(definitions.error)}</span>
          <Button type="button" size="sm" variant="outline" onClick={() => void definitions.refetch()}>
            Try again
          </Button>
        </div>
      ) : visible.length === 0 ? (
        <div className="rounded-xl border border-dashed border-slate-200 p-10 text-center">
          <p className="text-sm font-medium text-slate-700">
            {groups.length === 0
              ? "No KPIs have been set up here yet."
              : search.trim()
                ? "No KPI matches that search."
                : "Every KPI here has ended."}
          </p>
          <p className="mt-1 text-sm text-slate-500">
            {groups.length === 0
              ? canConfigure
                ? "Open the Build a KPI tab to set one up. Targets set elsewhere keep working regardless."
                : "When a KPI is set up for your processes it will appear here."
              : search.trim()
                ? "Check the spelling, clear the process filter, or tick Show ended."
                : "Tick Show ended to see them."}
          </p>
        </div>
      ) : (
        <>
        <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
          <table className="min-w-[56rem] w-full text-sm">
            <thead className="border-b border-slate-200 bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th scope="col" className="px-4 py-3 font-semibold">KPI</th>
                <th scope="col" className="px-4 py-3 font-semibold">Status</th>
                <th scope="col" className="px-4 py-3 font-semibold">Applies to</th>
                <th scope="col" className="px-4 py-3 font-semibold">Calculation</th>
                <th scope="col" className="px-4 py-3 text-right font-semibold">Target</th>
                <th scope="col" className="px-4 py-3 text-right font-semibold">Weight</th>
                <th scope="col" className="px-4 py-3 font-semibold">From</th>
                <th scope="col" className="px-4 py-3 font-semibold">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {paged.map((group) => (
                <DefinitionRows
                  key={group.key}
                  group={group}
                  today={today}
                  canConfigure={canConfigure}
                  openPanel={panel && panel.key === group.key ? panel.kind : null}
                  onToggle={(kind) => toggle(group.key, kind)}
                  onClosePanel={() => setPanel(null)}
                  onEdit={onEdit}
                  onExplain={setExplaining}
                />
              ))}
            </tbody>
          </table>
        </div>
        {pageCount > 1 && (
          <nav aria-label="Pages of KPI rules" className="flex flex-wrap items-center justify-between gap-2 px-1 py-2 text-sm text-slate-600">
            <span>Showing {safePage * PAGE_SIZE + 1}–{Math.min((safePage + 1) * PAGE_SIZE, visible.length)} of {visible.length.toLocaleString("en-IN")}</span>
            <span className="flex items-center gap-2">
              <button type="button" onClick={() => setPage(safePage - 1)} disabled={safePage === 0} className={`${ACTION_CLASS} min-h-[36px] disabled:cursor-not-allowed disabled:opacity-50`}>Previous</button>
              <span>Page {safePage + 1} of {pageCount}</span>
              <button type="button" onClick={() => setPage(safePage + 1)} disabled={safePage >= pageCount - 1} className={`${ACTION_CLASS} min-h-[36px] disabled:cursor-not-allowed disabled:opacity-50`}>Next</button>
            </span>
          </nav>
        )}
        </>
      )}

      <p className="text-xs text-slate-500">
        Where two rules cover the same person, the more specific one wins: a rule for one employee
        beats a process rule, which beats a designation rule. Ending or editing a rule never changes
        a score that was already calculated.
      </p>

      <ExplainDrawer definition={explaining} onClose={() => setExplaining(null)} />
    </div>
  );
}

function DefinitionRows(props: {
  group: DefinitionGroup;
  today: string;
  canConfigure: boolean;
  openPanel: PanelKind | null;
  onToggle: (kind: PanelKind) => void;
  onClosePanel: () => void;
  onEdit?: (draft: DefinitionDraft) => void;
  onExplain: (definition: DefinitionRow) => void;
}) {
  const { group, today, canConfigure, openPanel, onToggle, onClosePanel, onEdit, onExplain } = props;
  const definition = group.current;
  const older = group.versions.filter((version) => version.id !== definition.id);
  const upcoming = group.status === "current" ? group.versions.find((version) => statusOf(version, today) === "scheduled") : undefined;
  const endsOn = group.status === "current" ? datePart(definition.effective_to) : "";

  return (
    <Fragment>
      <tr className="align-top transition-colors hover:bg-slate-50/70">
        <td className="px-4 py-3">
          <span className="block font-medium text-slate-900">{definition.metric_name}</span>
          <span className="block text-xs text-slate-500">
            {definition.metric_code} · {definition.unit}
          </span>
        </td>

        <td className="px-4 py-3">
          <StatusBadge status={group.status} definition={definition} />
          {endsOn && <span className="mt-1 block text-[11px] text-slate-500">Ends {endsOn}</span>}
          {upcoming && (
            <span className="mt-1 block text-[11px] text-slate-500">New version starts {datePart(upcoming.effective_from)}</span>
          )}
        </td>

        <td className="px-4 py-3">
          {definition.scope_label && (
            <span
              className={`inline-block rounded-full border px-2 py-0.5 text-[11px] font-medium ${
                SCOPE_STYLE[definition.scope_label] ?? "bg-slate-100 text-slate-600 border-slate-200"
              }`}
            >
              {definition.scope_label}
            </span>
          )}
          <span className="mt-1 block text-xs text-slate-600">{scopeTargetLabel(definition)}</span>
        </td>

        <td className="max-w-[16rem] px-4 py-3">
          {definition.formula_expression ? (
            <>
              <code className="block break-words font-mono text-[11px] leading-snug text-slate-700">
                {definition.formula_expression}
              </code>
              {definition.source_name && (
                <span className="mt-0.5 block text-[11px] text-slate-500">from {definition.source_name}</span>
              )}
            </>
          ) : (
            <span className="text-xs text-slate-500">Scores existing data</span>
          )}
        </td>

        <td className="px-4 py-3 text-right font-mono text-slate-900">
          {formatNumber(definition.target_value)}
          {definition.min_threshold !== null && definition.min_threshold !== "" && (
            <span className="mt-0.5 block text-[11px] font-normal text-slate-500">
              limit {formatNumber(definition.min_threshold)}
            </span>
          )}
        </td>

        <td className="px-4 py-3 text-right font-mono text-slate-600">{formatNumber(definition.weightage)}%</td>

        <td className="px-4 py-3 text-xs text-slate-600">
          {datePart(definition.effective_from)}
          {definition.effective_to && <span className="mt-0.5 block text-slate-500">to {datePart(definition.effective_to)}</span>}
        </td>

        <td className="px-4 py-3">
          {/* One compact menu instead of five stacked buttons, so a row stays one line tall. */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button type="button" aria-label={`Actions for ${definition.metric_name}`} className={`${ACTION_CLASS} min-h-[36px]`}>
                <MoreHorizontal className="h-4 w-4" aria-hidden="true" /> Actions
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={() => onToggle("who")}><Users className="mr-2 h-4 w-4" aria-hidden="true" />Who it applies to</DropdownMenuItem>
              <DropdownMenuItem onClick={() => onToggle("history")}><History className="mr-2 h-4 w-4" aria-hidden="true" />History{older.length > 0 ? ` (${older.length})` : ""}</DropdownMenuItem>
              {definition.grain !== "process" && (
                <DropdownMenuItem onClick={() => onExplain(definition)}><Telescope className="mr-2 h-4 w-4" aria-hidden="true" />Explain for an employee</DropdownMenuItem>
              )}
              {canConfigure && onEdit && (
                <>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onClick={() => onEdit(draftFrom(definition, "edit"))}><Pencil className="mr-2 h-4 w-4" aria-hidden="true" />Edit (new version)</DropdownMenuItem>
                  <DropdownMenuItem onClick={() => onEdit(draftFrom(definition, "clone"))}><Copy className="mr-2 h-4 w-4" aria-hidden="true" />Copy to another scope</DropdownMenuItem>
                </>
              )}
              {canConfigure && group.status !== "ended" && (
                <DropdownMenuItem onClick={() => onToggle("end")} className="text-rose-600 focus:text-rose-600"><Archive className="mr-2 h-4 w-4" aria-hidden="true" />End on a date</DropdownMenuItem>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        </td>
      </tr>

      {openPanel && (
        <tr className="bg-slate-50/80">
          <td colSpan={8} className="px-4 py-3">
            {openPanel === "who" && <CoveragePanel definitionId={definition.id} />}
            {openPanel === "history" && <HistoryPanel versions={older} today={today} />}
            {openPanel === "end" && <EndForm definition={definition} today={today} onDone={onClosePanel} />}
          </td>
        </tr>
      )}
    </Fragment>
  );
}

function CoveragePanel({ definitionId }: { definitionId: string }) {
  const coverage = useDefinitionCoverage(definitionId);
  if (coverage.isLoading) {
    return (
      <span className="flex items-center gap-2 text-xs text-slate-500">
        <Loader2 className="h-3 w-3 animate-spin" aria-hidden="true" /> Checking who this applies to…
      </span>
    );
  }
  if (coverage.isError) {
    return <p role="alert" className="text-xs text-rose-700">Could not check who this applies to. {friendlyError(coverage.error)}</p>;
  }
  const count = coverage.data?.employee_count ?? 0;
  const sample = coverage.data?.sample ?? [];
  return (
    <div className="text-xs">
      <p className="font-medium text-slate-700">
        {count} active employee{count === 1 ? "" : "s"} currently measured by this rule
      </p>
      {sample.length > 0 && (
        <div className="mt-1.5 flex flex-wrap gap-1.5">
          {sample.map((employee) => (
            <span key={employee.id} className="rounded-md border border-slate-200 bg-white px-2 py-0.5 text-[11px] text-slate-600">
              {employee.employee_code}
              {employee.full_name ? ` · ${employee.full_name}` : ""}
            </span>
          ))}
          {count > sample.length && (
            <span className="px-1 py-0.5 text-[11px] text-slate-500">and {(count - sample.length).toLocaleString()} more</span>
          )}
        </div>
      )}
      {count === 0 && (
        <p className="mt-1 text-amber-800">This rule currently matches nobody. Check the branch and process actually go together.</p>
      )}
    </div>
  );
}

function HistoryPanel({ versions, today }: { versions: DefinitionRow[]; today: string }) {
  if (versions.length === 0) {
    return <p className="text-xs text-slate-600">This is the only version. Earlier versions appear here after an edit.</p>;
  }
  return (
    <div className="text-xs">
      <p className="font-medium text-slate-700">Other versions (read-only)</p>
      <ul className="mt-2 space-y-2">
        {versions.map((version) => (
          <li key={version.id} className="rounded-lg border border-slate-200 bg-white p-2.5">
            <div className="flex flex-wrap items-center gap-2">
              <StatusBadge status={statusOf(version, today)} definition={version} />
              <span className="text-slate-700">
                {datePart(version.effective_from)} to {datePart(version.effective_to) || "no end date"}
              </span>
              <span className="text-slate-600">
                Target {formatNumber(version.target_value)} · weight {formatNumber(version.weightage)}%
              </span>
            </div>
            <code className="mt-1.5 block break-words font-mono text-[11px] leading-snug text-slate-700">
              {version.formula_expression ?? "No calculation. Scored existing data."}
            </code>
          </li>
        ))}
      </ul>
    </div>
  );
}

function EndForm({ definition, today, onDone }: { definition: DefinitionRow; today: string; onDone: () => void }) {
  const dateId = useId();
  const retire = useRetireDefinition();
  const startsOn = datePart(definition.effective_from);
  // A rule that has not started yet cannot end before it starts.
  const [endDate, setEndDate] = useState(startsOn > today ? startsOn : today);
  const invalid = !endDate ? "Choose an end date." : endDate < startsOn ? `This rule starts on ${startsOn}. Choose that day or later.` : null;

  async function submit() {
    if (invalid) return;
    try {
      await retire.mutateAsync({ id: definition.id, effectiveTo: endDate });
      onDone();
    } catch {
      // Shown below from retire.error.
    }
  }

  return (
    <form
      className="space-y-2 text-xs"
      onSubmit={(event) => {
        event.preventDefault();
        void submit();
      }}
    >
      <p className="font-medium text-slate-800">End {definition.metric_name} for {scopeTargetLabel(definition)}</p>
      <p className="text-slate-600">
        It stops applying after this date. Past days keep their numbers and can still be recomputed.
      </p>
      <div className="flex flex-wrap items-end gap-2">
        <div>
          <label htmlFor={dateId} className="mb-1 block font-medium text-slate-700">
            Last day it applies
          </label>
          <Input id={dateId} type="date" value={endDate} min={startsOn} onChange={(event) => setEndDate(event.target.value)} className="w-44" />
        </div>
        <Button type="submit" size="sm" variant="destructive" disabled={retire.isPending || Boolean(invalid)}>
          {retire.isPending && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" aria-hidden="true" />}
          End on this date
        </Button>
        <Button type="button" size="sm" variant="ghost" onClick={onDone} disabled={retire.isPending}>
          Cancel
        </Button>
      </div>
      {(invalid || retire.isError) && (
        <p role="alert" className="flex items-start gap-1.5 text-rose-700">
          <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          {invalid ?? friendlyError(retire.error)}
        </p>
      )}
    </form>
  );
}
