/** The live preview (S18): source tabs, a sub-source select, outcome tiles, the rule funnel, score buckets and the masked sample.
 * SelectionPreviewView is presentational (tested with static markup); SelectionPreview owns the calls. */
import { useCallback, useEffect, useId, useState } from "react";
import { AlertTriangle, Download, RefreshCw } from "lucide-react";
import { hrmsApi } from "@/lib/hrmsApi";
import RuleFunnel from "./RuleFunnel";
import SampleTable from "./SampleTable";
import { FIELD, SMALL_BTN } from "./RuleRow";
import { SOURCE_TABS, SUB_SOURCES_FOR, outcomeTiles, partialText } from "./ruleFunnelModel";
import { selectionApi } from "./selectionApi";
import type { Permissions, PreviewResult, SourceKind, SubSource } from "./selectionTypes";

export interface PreviewViewProps {
  source: SourceKind; sub: string; onSource: (s: SourceKind) => void; onSub: (s: string) => void;
  data: PreviewResult | null; loading: boolean; error: string | null; onRetry: () => void; permissions: Permissions; onCsv: () => void; csvBusy: boolean;
}

export function SelectionPreviewView(p: PreviewViewProps) {
  const subId = useId();
  const partial = p.data ? partialText(p.data) : null;
  const buckets = p.data?.scoreBuckets ?? [];
  return (
    <div className="min-w-0 space-y-3 text-slate-900 dark:text-slate-100">
      <div className="flex flex-wrap items-end gap-2">
        <div role="tablist" aria-label="Source" className="flex flex-wrap gap-1">
          {SOURCE_TABS.map((t) => (
            <button key={t.id} type="button" role="tab" aria-selected={p.source === t.id} onClick={() => p.onSource(t.id)}
              className={`${SMALL_BTN} ${p.source === t.id ? "border-blue-700 bg-blue-50 text-blue-900 dark:border-blue-400 dark:bg-blue-950 dark:text-blue-100" : ""}`}>{t.label}</button>
          ))}
        </div>
        {SUB_SOURCES_FOR[p.source].length > 1 && (
          <div className="min-w-0">
            <label htmlFor={subId} className="block text-xs font-semibold text-slate-700 dark:text-slate-200">Within the source</label>
            <select id={subId} value={p.sub} onChange={(e) => p.onSub(e.target.value)} className={FIELD}>
              {SUB_SOURCES_FOR[p.source].map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
            </select>
          </div>
        )}
        {p.permissions.export && <button type="button" className={SMALL_BTN} disabled={p.csvBusy || !p.data} onClick={p.onCsv}><Download className="h-4 w-4" aria-hidden="true" />Download CSV</button>}
      </div>
      {p.error && (
        <div role="alert" className="flex flex-wrap items-center gap-2 rounded-lg border border-rose-300 bg-rose-50 px-3 py-2 text-sm text-rose-900 dark:border-rose-700 dark:bg-rose-950 dark:text-rose-100">
          <span>Could not load the preview: {p.error}</span>
          <button type="button" className={SMALL_BTN} onClick={p.onRetry}><RefreshCw className="h-4 w-4" aria-hidden="true" />Retry</button>
        </div>
      )}
      {p.loading && !p.data && (
        <div aria-busy="true" aria-label="Loading the preview" className="space-y-2">
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">{[0, 1, 2, 3, 4].map((i) => <div key={i} className="h-16 animate-pulse rounded-lg bg-slate-100 motion-reduce:animate-none dark:bg-slate-800" />)}</div>
          <div className="h-72 animate-pulse rounded-xl bg-slate-100 motion-reduce:animate-none dark:bg-slate-800" />
        </div>
      )}
      {p.data && (
        <div aria-busy={p.loading} className="space-y-3">
          {partial && <p className="flex items-start gap-1.5 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:border-amber-700 dark:bg-amber-950 dark:text-amber-100"><AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />{partial}</p>}
          <dl className="grid grid-cols-2 gap-2 sm:grid-cols-5">
            {outcomeTiles(p.data).map((t) => (
              <div key={t.label} className="rounded-lg border border-slate-200 bg-white px-3 py-2 dark:border-slate-700 dark:bg-slate-900">
                <dt className="text-xs font-semibold text-slate-600 dark:text-slate-300">{t.label}</dt>
                <dd className="text-lg font-bold tabular-nums">{t.value}</dd>
                <dd className="text-xs text-slate-600 dark:text-slate-300">{t.note}</dd>
              </div>
            ))}
          </dl>
          <RuleFunnel preview={p.data} />
          {buckets.length > 0 && (
            <section aria-label="Scores of shortlisted people" className="space-y-1">
              <h3 className="text-sm font-bold">Scores of shortlisted people (PREFER rules)</h3>
              <ul className="flex flex-wrap gap-2 text-xs">{buckets.map((b) => <li key={b.from} className="rounded border border-slate-200 px-2 py-1 tabular-nums dark:border-slate-700">{b.from} to {b.to}: {b.n}</li>)}</ul>
            </section>
          )}
          <section aria-label="Sample people" className="space-y-1">
            <h3 className="text-sm font-bold">Sample people</h3>
            <SampleTable preview={p.data} />
          </section>
        </div>
      )}
    </div>
  );
}

const errText = (e: unknown) => (e as { message?: string })?.message ?? "Something went wrong";

export default function SelectionPreview({ requisitionId, permissions }: { requisitionId: string; permissions: Permissions }) {
  const [source, setSource] = useState<SourceKind>("he");
  const [sub, setSub] = useState("all");
  const [data, setData] = useState<PreviewResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [csvBusy, setCsvBusy] = useState(false);
  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try { setData(await selectionApi.preview(requisitionId, source, sub as SubSource | "all")); } catch (e) { setError(errText(e)); } finally { setLoading(false); }
  }, [requisitionId, source, sub]);
  useEffect(() => { void load(); }, [load]);
  const csv = async () => {
    setCsvBusy(true);
    try {
      const blob = await hrmsApi.getBlob(selectionApi.csvPath(requisitionId, source, sub as SubSource | "all"));
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a"); a.href = url; a.download = `selection-preview-${source}.csv`; a.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (e) { setError(errText(e)); } finally { setCsvBusy(false); }
  };
  return <SelectionPreviewView source={source} sub={sub} onSource={(s) => { setSource(s); setSub("all"); }} onSub={setSub} data={data} loading={loading} error={error} onRetry={load}
    permissions={permissions} onCsv={csv} csvBusy={csvBusy} />;
}
