import { useState } from "react";
import { errorInfo, useBulkDecide, type BulkResult } from "./useDecide";
import type { RosterRequest } from "./types";

export function BulkBar({ items, onDone }: { items: RosterRequest[]; onDone: () => void }) {
  const bulk = useBulkDecide();
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState("");
  const [result, setResult] = useState<BulkResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [names, setNames] = useState<Record<string, string>>({});

  const run = (action: "approve" | "reject") => {
    setError(null); setResult(null);
    setNames(Object.fromEntries(items.map((r) => [r.key, r.employeeName])));
    bulk.mutate(
      { items: items.map((r) => ({ kind: r.kind, id: r.id })), action, ...(action === "reject" ? { reason: reason.trim() } : {}) },
      { onSuccess: (res) => { setResult(res); setRejecting(false); setReason(""); onDone(); }, onError: (e) => setError(errorInfo(e).message) },
    );
  };
  const failures = result?.results.filter((r) => !r.ok) ?? [];
  if (!items.length && !result && !error) return null;
  return (
    <div className="space-y-2 rounded-lg border bg-slate-50 p-3 text-sm">
      {items.length ? (
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-medium text-slate-700">{items.length} selected</span>
          <button type="button" disabled={bulk.isPending} onClick={() => run("approve")} className="rounded bg-green-600 px-3 py-1 text-white disabled:opacity-50">Approve selected</button>
          <button type="button" disabled={bulk.isPending} onClick={() => setRejecting((v) => !v)} className="rounded border bg-white px-3 py-1 disabled:opacity-50">Reject selected</button>
        </div>
      ) : null}
      {rejecting && items.length ? (
        <div className="flex gap-2">
          <input aria-label="Bulk reject reason" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Reason (required)" className="flex-1 rounded border px-2 py-1" />
          <button type="button" disabled={!reason.trim() || bulk.isPending} onClick={() => run("reject")} className="rounded bg-slate-800 px-3 py-1 text-white disabled:opacity-50">Confirm reject</button>
        </div>
      ) : null}
      {error ? <p role="alert" className="text-red-600">{error}</p> : null}
      {result ? (
        <div role="status">
          <p className="font-medium">{result.okCount} done{result.failCount ? `, ${result.failCount} failed` : ""}</p>
          {failures.length ? (
            <ul className="list-disc pl-5 text-red-700">
              {failures.map((f) => (
                <li key={`${f.kind}:${f.id}`}>{names[`${f.kind}:${f.id}`] ?? f.id}: {f.error ?? (f.blockers?.join("; ") || "failed")}{f.error && f.blockers?.length ? ` (${f.blockers.join("; ")})` : ""}</li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
