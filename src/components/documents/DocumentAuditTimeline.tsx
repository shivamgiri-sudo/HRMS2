import type { DocumentAuditEntry } from "./types";

export function DocumentAuditTimeline({ entries }: { entries: DocumentAuditEntry[] }) {
  return (
    <div className="max-h-44 overflow-auto border-t border-slate-200 bg-white px-4 py-3 text-xs">
      <div className="mb-2 font-semibold text-slate-700">Access audit</div>
      {entries.length === 0 ? (
        <div className="text-slate-500">No audit entries loaded.</div>
      ) : (
        <div className="space-y-2">
          {entries.map((entry, index) => (
            <div key={`${entry.created_at}-${index}`} className="flex items-center justify-between gap-4 rounded border border-slate-100 px-2 py-1.5">
              <span className="font-medium text-slate-700">{entry.access_type}</span>
              <span className="text-slate-500">{entry.outcome}</span>
              <span className="text-slate-500">{new Date(entry.created_at).toLocaleString()}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
