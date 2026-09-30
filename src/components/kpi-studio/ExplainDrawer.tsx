import { useEffect, useId, useState } from "react";
import { AlertCircle, Loader2, Search, UserRound, X } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { useEmployeeSearch, useMetricExplanation, type EmployeeOption } from "@/hooks/useKpiStudio";
import { KpiExplanationPanel } from "./KpiInsightBoard";
import { friendlyError, httpStatusOf, todayLocal, type DefinitionRow } from "./definition-model";

/**
 * "Why does this person have this number?" for one KPI.
 *
 * The day-by-day explanation panel already existed and was tested; nothing opened it. This gives it
 * a door from the Definitions list: pick a person the rule applies to, pick the days, read the
 * inputs that produced each value.
 */

function daysAgo(count: number): string {
  const now = new Date();
  return todayLocal(new Date(now.getFullYear(), now.getMonth(), now.getDate() - count));
}

interface ExplainDrawerProps {
  definition: DefinitionRow | null;
  onClose: () => void;
}

export function ExplainDrawer({ definition, onClose }: ExplainDrawerProps) {
  const searchId = useId();
  const fromId = useId();
  const toId = useId();
  const today = todayLocal();

  const [search, setSearch] = useState("");
  const [employee, setEmployee] = useState<Pick<EmployeeOption, "id" | "employee_code" | "full_name"> | null>(null);
  const [from, setFrom] = useState(() => daysAgo(29));
  const [to, setTo] = useState(today);

  // A rule written for one person can only be explained for that person, so they are preselected.
  useEffect(() => {
    setSearch("");
    if (definition?.employee_id) {
      setEmployee({
        id: definition.employee_id,
        employee_code: definition.employee_code ?? "",
        full_name: definition.employee_name,
      });
    } else {
      setEmployee(null);
    }
  }, [definition?.id, definition?.employee_id, definition?.employee_code, definition?.employee_name]);

  const employees = useEmployeeSearch({
    search: search.trim() || undefined,
    branch_id: definition?.branch_id ?? undefined,
    process_id: definition?.process_id ?? undefined,
    designation_id: definition?.designation_id ?? undefined,
  });

  const rangeError = !from || !to ? "Choose both dates." : from > to ? "The start date is after the end date." : null;
  const explanation = useMetricExplanation(
    rangeError ? null : (employee?.id ?? null),
    definition?.metric_id ?? null,
    { from, to },
  );

  const fixedEmployee = Boolean(definition?.employee_id);
  const forbidden = httpStatusOf(explanation.error) === 403;

  return (
    <Sheet open={Boolean(definition)} onOpenChange={(open) => (open ? undefined : onClose())}>
      <SheetContent side="right" className="w-full overflow-y-auto sm:max-w-xl">
        <SheetHeader>
          <SheetTitle>How {definition?.metric_name ?? "this KPI"} was calculated</SheetTitle>
          <SheetDescription>
            Pick a person and a range of days to see each day's value and the figures it was worked
            out from.
          </SheetDescription>
        </SheetHeader>

        <div className="mt-5 space-y-5">
          <section className="space-y-2">
            {employee ? (
              <div className="flex items-center justify-between gap-3 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
                <span className="flex min-w-0 items-center gap-2 text-sm text-slate-800">
                  <UserRound className="h-4 w-4 shrink-0 text-slate-500" aria-hidden="true" />
                  <span className="truncate font-medium">{employee.full_name ?? employee.employee_code}</span>
                  {employee.full_name && employee.employee_code && (
                    <span className="shrink-0 text-xs text-slate-500">{employee.employee_code}</span>
                  )}
                </span>
                {!fixedEmployee && (
                  <button
                    type="button"
                    onClick={() => setEmployee(null)}
                    className="inline-flex min-h-[36px] shrink-0 cursor-pointer items-center gap-1 rounded-md px-2 text-xs font-medium text-slate-600 transition-colors hover:bg-slate-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
                  >
                    <X className="h-3.5 w-3.5" aria-hidden="true" />
                    Change person
                  </button>
                )}
              </div>
            ) : (
              <>
                <label htmlFor={searchId} className="block text-sm font-medium text-slate-700">
                  Person
                </label>
                <div className="relative">
                  <Search
                    className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400"
                    aria-hidden="true"
                  />
                  <Input
                    id={searchId}
                    value={search}
                    onChange={(event) => setSearch(event.target.value)}
                    placeholder="Search by name or employee code"
                    className="pl-8"
                    autoComplete="off"
                  />
                </div>

                {employees.isFetching && (
                  <p className="flex items-center gap-2 text-xs text-slate-500">
                    <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" /> Searching…
                  </p>
                )}
                {employees.isError && (
                  <p role="alert" className="flex items-start gap-1.5 text-xs text-rose-700">
                    <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                    {friendlyError(employees.error)}
                  </p>
                )}
                {!employees.isFetching && employees.data && employees.data.length === 0 && (
                  <p className="text-xs text-slate-500">
                    Nobody matches. Only people this KPI applies to, within your own processes, are listed.
                  </p>
                )}
                {!employees.isFetching && !employees.data && !employees.isError && (
                  <p className="text-xs text-slate-500">Type at least two letters of a name or code.</p>
                )}

                {employees.data && employees.data.length > 0 && (
                  <ul className="max-h-56 space-y-1 overflow-y-auto" aria-label="Matching people">
                    {employees.data.map((option) => (
                      <li key={option.id}>
                        <button
                          type="button"
                          onClick={() => setEmployee(option)}
                          className="flex min-h-[44px] w-full cursor-pointer items-center justify-between gap-3 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-left text-sm transition-colors hover:border-slate-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
                        >
                          <span className="min-w-0">
                            <span className="block truncate font-medium text-slate-800">
                              {option.full_name ?? option.employee_code}
                            </span>
                            <span className="block text-xs text-slate-500">{option.employee_code}</span>
                          </span>
                          <span className="shrink-0 text-xs text-slate-500">{option.process_name ?? ""}</span>
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </>
            )}
          </section>

          <section className="grid grid-cols-2 gap-3">
            <div>
              <label htmlFor={fromId} className="mb-1 block text-sm font-medium text-slate-700">
                From
              </label>
              <Input id={fromId} type="date" value={from} max={to || today} onChange={(event) => setFrom(event.target.value)} />
            </div>
            <div>
              <label htmlFor={toId} className="mb-1 block text-sm font-medium text-slate-700">
                To
              </label>
              <Input id={toId} type="date" value={to} min={from} max={today} onChange={(event) => setTo(event.target.value)} />
            </div>
            {rangeError && (
              <p role="alert" className="col-span-2 flex items-start gap-1.5 text-xs text-rose-700">
                <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                {rangeError}
              </p>
            )}
          </section>

          <section aria-live="polite">
            {!employee ? (
              <p className="rounded-lg border border-dashed border-slate-200 p-6 text-center text-sm text-slate-500">
                Choose a person to see how their number was worked out.
              </p>
            ) : rangeError ? null : explanation.isError ? (
              <p role="alert" className="flex items-start gap-2 rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800">
                <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
                {forbidden ? "You can only see people in your own processes." : friendlyError(explanation.error)}
              </p>
            ) : (
              <div className="overflow-x-auto">
                <KpiExplanationPanel
                  loading={explanation.isLoading}
                  explanation={explanation.data?.explanation ?? null}
                  message={explanation.data?.message}
                />
              </div>
            )}
          </section>
        </div>
      </SheetContent>
    </Sheet>
  );
}
