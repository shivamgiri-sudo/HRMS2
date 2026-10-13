import { useState } from "react";
import { Download, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { downloadCsv } from "@/lib/safeCsv";
import { fetchHistoryExport, useHistory, useHistoryFilters, type HistoryQuery } from "@/hooks/useTeamRoster";
import { detailRows, summaryRows } from "./historyExport";
import { STATUS_META, SUBMISSION_STATUS_FILTERS, formatDmy, formatDmyTime, unpackError } from "./teamRosterFormat";

const SELECT = "h-9 rounded-md border border-slate-200 bg-white px-2 text-sm";

function decisionText(d: { decision: string; at: string | null; by: string | null } | null, none: string): string {
  if (!d) return none;
  const verb = d.decision === "approved" ? "Approved" : "Rejected";
  return [verb, d.by, d.at ? formatDmyTime(d.at) : null].filter(Boolean).join(" - ");
}

/** Permanent log of every submission the caller may see, with branch / process / manager filters and CSV downloads. */
export default function HistoryTab({ onOpen }: { onOpen: (id: number) => void }) {
  const [f, setF] = useState<HistoryQuery>({});
  const [offset, setOffset] = useState(0);
  const [busy, setBusy] = useState<"detail" | "summary" | null>(null);
  const filters = useHistoryFilters();
  const q = useHistory(f, offset);
  const set = (patch: Partial<HistoryQuery>) => { setF((p) => ({ ...p, ...patch })); setOffset(0); };
  const processes = (filters.data?.processes ?? []).filter((p) => !f.branchId || p.branchId === f.branchId);

  const download = async (kind: "detail" | "summary") => {
    setBusy(kind);
    try {
      const out = await fetchHistoryExport(f);
      if (out.rows.length === 0) { toast.info("Nothing to download for these filters."); return; }
      const stamp = new Date().toISOString().slice(0, 10);
      downloadCsv(kind === "detail" ? detailRows(out.rows) : summaryRows(out.rows), `team-roster-${kind}-${stamp}.csv`);
      if (out.truncated) toast.warning(`Download was limited to the first ${out.max} rows. Narrow the filters for the rest.`);
    } catch (e) {
      toast.error(unpackError(e).message);
    } finally {
      setBusy(null);
    }
  };

  const data = q.data;
  const items = data?.items ?? [];
  const total = data?.total ?? 0;
  const limit = data?.limit ?? 25;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-end gap-2">
        <label className="text-xs text-slate-500">Branch
          <select className={`${SELECT} mt-0.5 block`} value={f.branchId ?? ""} onChange={(e) => set({ branchId: e.target.value || undefined, processId: undefined })}>
            <option value="">All branches</option>
            {(filters.data?.branches ?? []).map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
          </select>
        </label>
        <label className="text-xs text-slate-500">Process
          <select className={`${SELECT} mt-0.5 block`} value={f.processId ?? ""} onChange={(e) => set({ processId: e.target.value || undefined })}>
            <option value="">All processes</option>
            {processes.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </label>
        <label className="text-xs text-slate-500">Manager
          <select className={`${SELECT} mt-0.5 block`} value={f.managerId ?? ""} onChange={(e) => set({ managerId: e.target.value || undefined })}>
            <option value="">All managers</option>
            {(filters.data?.managers ?? []).map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
          </select>
        </label>
        <label className="text-xs text-slate-500">Status
          <select className={`${SELECT} mt-0.5 block`} value={f.status ?? ""} onChange={(e) => set({ status: e.target.value || undefined })}>
            <option value="">All</option>
            {SUBMISSION_STATUS_FILTERS.map((s) => <option key={s} value={s}>{STATUS_META[s].label}</option>)}
          </select>
        </label>
        <label className="text-xs text-slate-500">Roster from
          <Input type="date" className="mt-0.5 h-9 w-40" value={f.from ?? ""} onChange={(e) => set({ from: e.target.value || undefined })} />
        </label>
        <label className="text-xs text-slate-500">Roster to
          <Input type="date" className="mt-0.5 h-9 w-40" value={f.to ?? ""} onChange={(e) => set({ to: e.target.value || undefined })} />
        </label>
        <label className="text-xs text-slate-500">Search
          <Input className="mt-0.5 h-9 w-48" placeholder="Number, name or code" value={f.search ?? ""} onChange={(e) => set({ search: e.target.value || undefined })} />
        </label>
        <div className="ml-auto flex gap-2">
          <Button size="sm" variant="outline" disabled={busy !== null} onClick={() => download("detail")}>
            {busy === "detail" ? <Loader2 className="mr-1 h-4 w-4 animate-spin" aria-hidden /> : <Download className="mr-1 h-4 w-4" aria-hidden />}Download details
          </Button>
          <Button size="sm" variant="outline" disabled={busy !== null} onClick={() => download("summary")}>
            {busy === "summary" ? <Loader2 className="mr-1 h-4 w-4 animate-spin" aria-hidden /> : <Download className="mr-1 h-4 w-4" aria-hidden />}Download summary
          </Button>
        </div>
      </div>
      <p className="text-xs text-slate-500">
        Downloads follow the filters above. Details has one row per raised cell, sorted branch, process, manager. Summary rolls the same rows up per branch, process and manager.
      </p>

      {q.isLoading ? (
        <div className="py-10 text-center"><Loader2 className="mx-auto h-5 w-5 animate-spin text-slate-400" aria-label="Loading" /></div>
      ) : q.isError ? (
        <p role="alert" className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">{unpackError(q.error).message}</p>
      ) : items.length === 0 ? (
        <p className="rounded-xl border border-dashed p-8 text-center text-sm text-slate-500">No roster requests match these filters.</p>
      ) : (
        <div className="overflow-x-auto rounded-xl border bg-white">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Number</TableHead><TableHead>Raised by</TableHead><TableHead>Branch / process</TableHead><TableHead>Period</TableHead>
                <TableHead>Raised</TableHead><TableHead>Manager decision</TableHead><TableHead>WFM decision</TableHead><TableHead>Applied</TableHead><TableHead>Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {items.map((s) => (
                <TableRow key={s.id} tabIndex={0} role="button" aria-label={`Open submission ${s.submissionNo ?? s.id}`} className="cursor-pointer hover:bg-slate-50"
                  onClick={() => onOpen(s.id)} onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onOpen(s.id); } }}>
                  <TableCell className="font-medium">{s.submissionNo ?? s.id}</TableCell>
                  <TableCell>{s.submitter.name}{s.submitter.code ? ` (${s.submitter.code})` : ""}</TableCell>
                  <TableCell className="max-w-[260px] text-xs"><div>{s.branches || "-"}</div><div className="text-slate-500">{s.processes || "-"}</div></TableCell>
                  <TableCell className="whitespace-nowrap">{formatDmy(s.from)} - {formatDmy(s.to)}</TableCell>
                  <TableCell>{s.raised} cell{s.raised === 1 ? "" : "s"}<div className="text-xs text-slate-500">{formatDmyTime(s.submittedAt)}</div></TableCell>
                  <TableCell className="text-xs">{decisionText(s.managerDecision, s.managerApprover ? `Waiting: ${s.managerApprover}` : "No manager step")}</TableCell>
                  <TableCell className="text-xs">{decisionText(s.wfmDecision, "Not decided")}</TableCell>
                  <TableCell>{s.applied} of {s.raised}{s.skipped > 0 && <div className="text-xs text-orange-700">{s.skipped} skipped</div>}</TableCell>
                  <TableCell><span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${STATUS_META[s.status]?.className ?? ""}`}>{STATUS_META[s.status]?.label ?? s.status}</span></TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
      {total > limit && (
        <div className="flex items-center justify-between text-sm text-slate-500">
          <span>{offset + 1}-{Math.min(offset + limit, total)} of {total}</span>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" disabled={offset === 0} onClick={() => setOffset(Math.max(offset - limit, 0))}>Previous</Button>
            <Button variant="outline" size="sm" disabled={offset + limit >= total} onClick={() => setOffset(offset + limit)}>Next</Button>
          </div>
        </div>
      )}
    </div>
  );
}
