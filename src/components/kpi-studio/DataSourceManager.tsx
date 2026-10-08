import { useState } from "react";
import { AlertCircle, Database, Loader2, Plus, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useDataSource, useDataSources, useRestoreDataSource } from "@/hooks/useKpiStudio";
import { FieldEditor } from "./sources/FieldEditor";
import { SourceForm } from "./sources/SourceForm";
import { focusRing } from "./sources/form-bits";
import { describeSaveError, emptySourceForm, formFromSource, sourceTypeLabel } from "./sources/source-form";

/**
 * Data sources and their fields.
 *
 * A "field" here is the unit that makes the formula builder work: a named number a formula can
 * reference. Declaring them up front is what lets the builder offer clickable inputs and reject a
 * formula that references a column the source does not have — otherwise a typo becomes a KPI that
 * silently reads empty for ever.
 *
 * All six source types the server supports are configured here: a table in this system, one of the
 * other databases this system already connects to, an Integration Hub connector, a Google Sheet
 * published as CSV, a spreadsheet upload and hand-entered values — including the process mapping,
 * text-date format and per-field row conditions that used to need a developer script. The form
 * rules live in sources/source-form.ts and mirror the server's.
 */
export function DataSourceManager() {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  /** "new" while adding a source, "edit" while changing the selected one's settings. */
  const [formMode, setFormMode] = useState<"new" | "edit" | null>(null);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [showRetired, setShowRetired] = useState(false);

  // Retired sources are fetched here (and only here) so they can be brought back.
  const sources = useDataSources(true);
  const all = sources.data ?? [];
  const live = all.filter((source) => source.active_status !== 0);
  const retired = all.filter((source) => source.active_status === 0);
  const restoreSource = useRestoreDataSource();
  const detail = useDataSource(selectedId);

  return (
    <div className="space-y-5">
      {message && (
        <p
          role="status"
          className={`rounded-lg border p-3 text-sm ${
            message.ok ? "border-emerald-200 bg-emerald-50 text-emerald-800" : "border-rose-200 bg-rose-50 text-rose-800"
          }`}
        >
          {message.text}
        </p>
      )}

      <div className="grid gap-5 lg:grid-cols-[20rem_1fr]">
        {/* ── Source list ── */}
        <div className="min-w-0 space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold text-slate-800">Data sources</h3>
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="cursor-pointer"
              onClick={() => {
                setMessage(null);
                setFormMode("new");
              }}
            >
              <Plus className="mr-1 h-3.5 w-3.5" aria-hidden="true" /> Add
            </Button>
          </div>

          <div className="space-y-1">
            {live.map((source) => (
              <button
                key={source.id}
                type="button"
                aria-current={selectedId === source.id && formMode !== "new" ? "true" : undefined}
                onClick={() => {
                  setSelectedId(source.id);
                  setFormMode(null);
                }}
                className={`flex w-full cursor-pointer items-start justify-between gap-2 rounded-lg border px-3 py-2 text-left transition-colors ${focusRing} ${
                  selectedId === source.id ? "border-indigo-500 bg-indigo-50" : "border-slate-200 bg-white hover:border-slate-300"
                }`}
              >
                <span className="min-w-0">
                  <span className="block truncate text-sm font-medium text-slate-900">{source.source_name}</span>
                  <span className="block text-[11px] text-slate-500">{sourceTypeLabel(source.source_type)}</span>
                </span>
                <span
                  className={`shrink-0 rounded-full px-1.5 py-0.5 text-[11px] ${
                    source.field_count > 0 ? "bg-emerald-100 text-emerald-700" : "bg-amber-100 text-amber-700"
                  }`}
                >
                  {source.field_count} field{source.field_count === 1 ? "" : "s"}
                </span>
              </button>
            ))}
            {sources.isLoading && (
              <p className="flex items-center gap-2 p-3 text-xs text-slate-500">
                <Loader2 className="h-3 w-3 animate-spin" aria-hidden="true" /> Loading…
              </p>
            )}
            {sources.isError && (
              <div role="alert" className="rounded-lg border border-rose-200 bg-rose-50 p-3 text-xs text-rose-800">
                <p className="flex items-start gap-1.5">
                  <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                  Could not load the data sources. {describeSaveError(sources.error, "")}
                </p>
                <button
                  type="button"
                  onClick={() => void sources.refetch()}
                  className={`mt-1.5 cursor-pointer rounded font-medium underline ${focusRing}`}
                >
                  Try again
                </button>
              </div>
            )}
            {sources.isSuccess && live.length === 0 && (
              <p className="rounded-lg border border-dashed border-slate-200 p-3 text-xs text-slate-500">
                No data sources yet. Choose Add to set up the first one.
              </p>
            )}
          </div>

          {/* Retired sources stay listed, quietly. A retirement that hid the source forever would
              make one mis-click cost every field configured on it. */}
          {retired.length > 0 && (
            <div className="space-y-1 border-t border-slate-200 pt-3">
              <button
                type="button"
                aria-expanded={showRetired}
                onClick={() => setShowRetired((open) => !open)}
                className={`w-full cursor-pointer rounded py-1 text-left text-[11px] font-medium uppercase tracking-wide text-slate-500 hover:text-slate-700 ${focusRing}`}
              >
                {showRetired ? "Hide" : "Show"} retired ({retired.length})
              </button>
              {showRetired &&
                retired.map((source) => (
                  <div
                    key={source.id}
                    className="flex items-center justify-between gap-2 rounded-lg border border-dashed border-slate-200 bg-slate-50 px-3 py-2"
                  >
                    <span className="min-w-0">
                      <span className="block truncate text-sm text-slate-500 line-through">{source.source_name}</span>
                      <span className="block text-[11px] text-slate-500">{sourceTypeLabel(source.source_type)}</span>
                    </span>
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      className="h-8 shrink-0 cursor-pointer px-2 text-xs text-indigo-600 hover:text-indigo-700"
                      disabled={restoreSource.isPending}
                      onClick={() =>
                        restoreSource.mutate(source.id, {
                          onSuccess: () => setMessage({ ok: true, text: `${source.source_name} is back, with its fields.` }),
                          onError: (error) =>
                            setMessage({ ok: false, text: describeSaveError(error, "Could not restore the source.") }),
                        })
                      }
                    >
                      <RotateCcw className="mr-1 h-3 w-3" aria-hidden="true" /> Restore
                    </Button>
                  </div>
                ))}
            </div>
          )}
        </div>

        {/* ── Source form, or the selected source's fields ── */}
        <div className="min-w-0">
          {formMode === "new" ? (
            <SourceForm
              key="new"
              initial={emptySourceForm}
              onCancel={() => setFormMode(null)}
              onSaved={(id) => {
                setSelectedId(id);
                setFormMode(null);
                setMessage({ ok: true, text: "Data source created. Now add the fields a formula can read." });
              }}
            />
          ) : !selectedId ? (
            <div className="rounded-xl border border-dashed border-slate-200 p-10 text-center">
              <Database className="mx-auto mb-2 h-8 w-8 text-slate-300" aria-hidden="true" />
              <p className="text-sm font-medium text-slate-600">Pick a data source</p>
              <p className="mt-1 text-sm text-slate-500">
                Its fields are the numbers a calculation can read. Or choose Add to set up a new one.
              </p>
            </div>
          ) : detail.isLoading ? (
            <p className="flex items-center gap-2 p-6 text-sm text-slate-500">
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> Loading…
            </p>
          ) : detail.isError ? (
            <p role="alert" className="rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-800">
              Could not open this data source. {describeSaveError(detail.error, "")}
            </p>
          ) : detail.data && formMode === "edit" ? (
            <SourceForm
              key={detail.data.id}
              initial={formFromSource(detail.data as unknown as Record<string, unknown>)}
              onCancel={() => setFormMode(null)}
              onSaved={() => {
                setFormMode(null);
                setMessage({ ok: true, text: "Changes saved." });
              }}
            />
          ) : detail.data ? (
            <FieldEditor
              key={detail.data.id}
              source={detail.data}
              onEditSource={() => {
                setMessage(null);
                setFormMode("edit");
              }}
              onRetired={() => setSelectedId(null)}
            />
          ) : null}
        </div>
      </div>
    </div>
  );
}
