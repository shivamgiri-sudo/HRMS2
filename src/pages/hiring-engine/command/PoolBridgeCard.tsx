/**
 * "Bring imports into the pool" (WS3 D2), organisation-wide admins only, in the Hiring Engine section: the Naukri / WorkIndia / ATS import files with how
 * many are already in the pool, a dry run (what would be added, enriched or skipped, per file), then the real run. Preview only: people
 * become visible to the selection preview and HR approval; nobody is contacted.
 */
import { useCallback, useEffect, useState } from "react";
import { AlertTriangle, DatabaseZap, Info } from "lucide-react";
import { hrmsApi } from "@/lib/hrmsApi";
import { describeError } from "./commandData";
import { BTN, PRIMARY } from "./StreamActions";
import { BRIDGE_PATH, BRIDGE_SOURCES_PATH, canRun, requestBody, resultRows, skipText, sourceGroups, type BridgeResult, type BridgeSource } from "./poolBridgeModel";

const TD = "border-b border-slate-100 px-2 py-1 text-slate-800 dark:border-slate-800 dark:text-slate-100";
const fmt = (n: number) => n.toLocaleString("en-IN");

export interface PoolBridgeViewProps {
  sources: BridgeSource[] | null; loading: boolean; error: string | null; picked: string[]; result: BridgeResult | null; busy: boolean; note: string | null;
  onPick: (types: string[]) => void; onDryRun: () => void; onRun: () => void; onRetry: () => void;
}

export function PoolBridgeView({ sources, loading, error, picked, result, busy, note, onPick, onDryRun, onRun, onRetry }: PoolBridgeViewProps) {
  const groups = sources ? sourceGroups(sources) : [];
  const toggle = (t: string) => onPick(picked.includes(t) ? picked.filter((x) => x !== t) : [...picked, t]);
  return (
    <section aria-labelledby="pool-bridge-heading" aria-busy={loading || busy} className="min-w-0 space-y-2 rounded-xl border border-slate-200 bg-white p-4 text-slate-900 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100">
      <h3 id="pool-bridge-heading" className="flex items-center gap-1.5 text-sm font-bold"><DatabaseZap className="h-4 w-4" aria-hidden /> Bring imports into the pool</h3>
      <p className="flex items-start gap-1.5 text-xs text-slate-700 dark:text-slate-200"><Info className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
        Preview only. Nobody is contacted: the people become visible to the selection preview, and only a shortlist HR approves can be enrolled.</p>
      {loading && !sources && <div aria-busy="true" aria-label="Loading the import files" className="h-20 animate-pulse rounded-lg bg-slate-100 motion-reduce:animate-none dark:bg-slate-800" />}
      {error && !sources && <p role="alert" className="flex flex-wrap items-center gap-2 text-sm text-rose-800 dark:text-rose-200"><AlertTriangle className="h-4 w-4" aria-hidden /> Could not load: {error}
        <button type="button" className={BTN} onClick={onRetry}>Retry</button></p>}
      {groups.length > 0 && (
        <fieldset className="space-y-1">
          <legend className="text-xs font-semibold text-slate-800 dark:text-slate-100">Sources</legend>
          {groups.map((g) => (
            <label key={g.recordType} className="flex min-h-11 cursor-pointer items-center gap-2 text-sm text-slate-800 dark:text-slate-100 sm:min-h-8">
              <input type="checkbox" className="h-4 w-4 cursor-pointer accent-blue-700" checked={picked.includes(g.recordType)} disabled={busy} onChange={() => toggle(g.recordType)} />
              {g.label}: {fmt(g.rows)} rows in {g.files} file{g.files === 1 ? "" : "s"}, {fmt(g.inPool)} already in the pool
            </label>
          ))}
        </fieldset>
      )}
      {sources && sources.length === 0 && <p className="text-sm text-slate-700 dark:text-slate-200">No import files found.</p>}
      <div className="flex flex-wrap gap-2">
        <button type="button" className={BTN} disabled={busy || !picked.length} onClick={onDryRun}>Dry run</button>
        <button type="button" className={PRIMARY} disabled={busy || !canRun(result, picked)} onClick={onRun}>Bring into the pool</button>
      </div>
      {note && <p role="status" className="text-xs text-slate-700 dark:text-slate-200">{note}</p>}
      {result && (
        <div className="space-y-1">
          <p className="text-sm font-semibold">{result.dryRun ? `${fmt(result.totals.inserted)} would be added, ${fmt(result.totals.enriched)} enriched` : `${fmt(result.totals.inserted)} added, ${fmt(result.totals.enriched)} enriched`} of {fmt(result.totals.scanned)} rows read
            {skipText(result.totals.skipped) ? `; skipped: ${skipText(result.totals.skipped)}` : ""}{result.next ? (result.dryRun ? "; the dry run stopped early, the real run starts from the first row" : "; more rows remain (bring into the pool again to continue)") : ""}</p>
          <div className="relative max-h-72 overflow-x-auto overflow-y-auto">
            <table className="w-full min-w-max border-collapse text-left text-xs">
              <caption className="sr-only">Per import file: rows read, added, enriched and skipped</caption>
              <thead><tr className="border-b border-slate-200 dark:border-slate-700">{["File", "Source", "Rows", "Added", "Enriched", "Skipped"].map((h) => <th key={h} scope="col" className="px-2 py-1 font-semibold">{h}</th>)}</tr></thead>
              <tbody>{resultRows(result).map((r) => (
                <tr key={`${r.source}|${r.file}`}><th scope="row" className={`${TD} max-w-xs break-words text-left font-medium`}>{r.file}</th><td className={TD}>{r.source}</td>
                  <td className={`${TD} tabular-nums`}>{fmt(r.scanned)}</td><td className={`${TD} tabular-nums`}>{fmt(r.added)}</td><td className={`${TD} tabular-nums`}>{fmt(r.enriched)}</td><td className={TD}>{r.skipped || "none"}</td></tr>
              ))}</tbody>
            </table>
          </div>
        </div>
      )}
    </section>
  );
}

export default function PoolBridgeCard() {
  const [sources, setSources] = useState<BridgeSource[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [picked, setPicked] = useState<string[]>(["naukri_import", "workindia_import"]);
  const [result, setResult] = useState<BridgeResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try { const r = await hrmsApi.get<{ data?: BridgeSource[] }>(BRIDGE_SOURCES_PATH); setSources(r?.data ?? []); } catch (e) { setError(describeError(e)); } finally { setLoading(false); }
  }, []);
  useEffect(() => { void load(); }, [load]);
  const call = async (dryRun: boolean) => {
    setBusy(true); setNote(null);
    try {
      const r = await hrmsApi.post<{ data?: BridgeResult & { next_step?: string } }>(BRIDGE_PATH, requestBody(picked, dryRun, result));
      setResult(r?.data ?? null);
      if (!dryRun) { setNote(r?.data?.next_step ?? "Done."); void load(); }
    } catch (e) { setNote(`Could not run: ${describeError(e)}`); } finally { setBusy(false); }
  };
  return <PoolBridgeView sources={sources} loading={loading} error={error} picked={picked} result={result} busy={busy} note={note}
    onPick={(t) => { setPicked(t); setResult(null); }} onDryRun={() => void call(true)} onRun={() => void call(false)} onRetry={() => void load()} />;
}
