/** Booked for a walk-in but no longer meeting the criteria after a change (S19). Their slot stays; HR keeps or cancels by hand. Masked. */
import { useCallback, useEffect, useState } from "react";
import { selectionApi } from "./selectionApi";

type Row = { followupId: string; maskedMobile: string; firstName: string; verdict: string; slotAt: string | null; matchState: string };

export function BookedMismatchView({ rows }: { rows: Row[] }) {
  if (!rows.length) return <p className="text-sm text-slate-600 dark:text-slate-300">Nobody booked is affected by the current criteria.</p>;
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-max text-left text-xs text-slate-900 dark:text-slate-100">
        <caption className="mb-1 text-left text-xs text-slate-600 dark:text-slate-300">Booked but no longer meet the criteria. Booked slots continue; keep or cancel them by hand.</caption>
        <thead><tr className="border-b border-slate-200 dark:border-slate-700"><th scope="col" className="px-2 py-1">Mobile</th><th scope="col" className="px-2 py-1">Name</th><th scope="col" className="px-2 py-1">Now</th><th scope="col" className="px-2 py-1">Booking</th><th scope="col" className="px-2 py-1">Slot</th></tr></thead>
        <tbody>{rows.map((r) => (
          <tr key={r.followupId} className="border-b border-slate-100 dark:border-slate-800">
            <th scope="row" className="px-2 py-1 font-mono font-medium">{r.maskedMobile}</th><td className="px-2 py-1">{r.firstName || "–"}</td>
            <td className="px-2 py-1">{r.verdict === "fail" ? "Fails a MUST rule" : r.verdict === "review" ? "Needs review" : r.verdict}</td>
            <td className="px-2 py-1">{r.matchState.replaceAll("_", " ")}</td><td className="px-2 py-1">{r.slotAt ?? "–"}</td>
          </tr>))}</tbody>
      </table>
    </div>
  );
}

export default function BookedMismatchList({ requisitionId }: { requisitionId: string }) {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(async () => { try { setRows(await selectionApi.bookedMismatch(requisitionId) as Row[]); } catch (e) { setError((e as Error).message); } }, [requisitionId]);
  useEffect(() => { void load(); }, [load]);
  if (error) return <p role="alert" className="text-sm text-rose-800 dark:text-rose-200">{error}</p>;
  if (!rows) return <div aria-busy="true" aria-label="Loading" className="h-12 animate-pulse rounded-lg bg-slate-100 motion-reduce:animate-none dark:bg-slate-800" />;
  return <BookedMismatchView rows={rows} />;
}
