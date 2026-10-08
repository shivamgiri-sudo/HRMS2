// Drill-down drawer for one Ops Control Tower cell: ageing chips, filters, deep links, and — on
// joiner-actionable blocks — a WhatsApp Notify per row plus "Notify all" (cooldown enforced server-side).
import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Copy, Download, ExternalLink, Mail, MessageCircle, Wrench } from "lucide-react";
import { hrmsApi } from "@/lib/hrmsApi";
import { useWorkforceAccess } from "@/hooks/useUserRole";
import { OpsAttendanceActions } from "./OpsAttendanceActions";
import { BACKFILL_ROLES, CLOSE_ROLES, guideFor } from "./attendanceGuide";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { formatDate } from "./opsControlTowerFormat";
import {
  countByBucket, filterRows, isNudgeableBlock, neglected, nudgeLabel, nudgeSummary, nudgeTally, rowLinks, rowsToCsv,
  type BucketFilter, type NudgeFilter, type Row,
} from "./opsControlTowerAnalytics";
import type {
  AttendanceMismatchDetailRow, DetailBlockKey, FnfDetailRow, NocDetailRow, NudgeResult, SlaDetailRow,
} from "./opsControlTowerTypes";

const BASE = "/api/ops-control-tower";

export interface Selected { block: DetailBlockKey; branchId: string; branchName: string; title: string }
interface DetailResponse { rows: Row[]; nudge: { supported: boolean; whatsappConfigured: boolean } }

/** docs-pending rows carry "N pending: A, B, C" in `status`; show just the names. */
function pendingDocNames(row: Row): string[] {
  const text = String((row as unknown as { status?: string }).status ?? "");
  const names = text.includes(":") ? text.slice(text.indexOf(":") + 1) : text;
  return names.split(",").map((n) => n.trim()).filter(Boolean);
}

function rowNote(block: DetailBlockKey, row: Row): string {
  switch (block) {
    case "attendance-mismatch": return guideFor(String((row as unknown as AttendanceMismatchDetailRow).issueType ?? "")).label;
    case "fnf-pending": { const r = row as unknown as FnfDetailRow; return `${r.status} · ₹${Number(r.netPayable ?? 0).toLocaleString("en-IN")}`; }
    case "esign-pending": return `Day 3 was ${formatDate((row as unknown as SlaDetailRow).dueDateMs)}`;
    case "appointment-letter": return `Day 7 was ${formatDate((row as unknown as SlaDetailRow).dueDateMs)}`;
    default: return String((row as unknown as NocDetailRow).status ?? "").replace(/_/g, " ");
  }
}

const AGE_CLASS: Record<string, string> = { "8+": "bg-red-50 text-red-700", "3-7": "bg-orange-50 text-orange-700", "0-2": "bg-emerald-50 text-emerald-700" };
const BUCKETS: BucketFilter[] = ["all", "0-2", "3-7", "8+"];
const NUDGE_FILTERS: Array<[NudgeFilter, string]> = [["all", "All"], ["never", "Never notified"], ["due", "Due now"]];

function downloadCsv(name: string, csv: string) {
  const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
  const a = document.createElement("a");
  a.href = url; a.download = name; a.click();
  URL.revokeObjectURL(url);
}

/** Asks the server for a fresh onboarding link and copies it, so HR can read it out or paste it into a chat. */
async function copyOnboardingLink(employeeId: string, issue: DetailBlockKey) {
  try {
    const out = await hrmsApi.post<{ link: string; expiresAt: string }>(`${BASE}/onboarding-link`, { employeeId, issue });
    await navigator.clipboard.writeText(out.link);
    toast.success(`Link copied — valid until ${formatDate(Date.parse(out.expiresAt))}`);
  } catch (e) {
    toast.error(e instanceof Error ? e.message : "Could not create the link");
  }
}

/** Emails the joiner their onboarding link; the server reports the real delivery outcome. */
async function emailOnboardingLinkTo(employeeId: string, issue: DetailBlockKey) {
  try {
    const out = await hrmsApi.post<{ status: string; sentTo?: string }>(`${BASE}/onboarding-link/email`, { employeeId, issue });
    toast.success(`Link emailed to ${out.sentTo ?? "the employee"}`);
  } catch (e) {
    toast.error(e instanceof Error ? e.message : "Could not email the link");
  }
}

export function DetailRowItem({ block, row, supported, pending, onNotify }: {
  block: DetailBlockKey; row: Row; supported: boolean; pending: boolean; onNotify: (employeeId: string) => void;
}) {
  const selected = { block };
  return (
    <li className={`rounded-md border p-2.5 ${neglected(row) ? "border-red-200 bg-red-50/40" : ""}`}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-sm font-semibold text-slate-900">{row.employeeName || "—"}</div>
          <div className="font-mono text-xs text-slate-500">{row.employeeCode}</div>
          {selected.block === "docs-pending" ? (
            <div className="mt-1 flex flex-wrap gap-1" aria-label="Pending documents">
              {pendingDocNames(row).map((name) => (
                <span key={name} className="rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-[11px] text-amber-800">{name}</span>
              ))}
            </div>
          ) : (
            <div className="text-xs text-slate-500">{rowNote(selected.block, row)}</div>
          )}
        </div>
        <span className={`whitespace-nowrap rounded px-2 py-0.5 font-mono text-xs font-semibold ${AGE_CLASS[row.ageBucket ?? "0-2"]}`}>{row.daysOpen ?? 0}d</span>
      </div>
      <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
        {rowLinks(selected.block, { employeeId: row.employeeId, candidateId: row.candidateId }).map((l) => (
          l.primary ? (
            <Button key={l.href} asChild size="sm" className="h-7 px-2.5 text-xs">
              <Link to={l.href}><Wrench className="mr-1 h-3 w-3" aria-hidden /> {l.label}</Link>
            </Button>
          ) : (
            <Link key={l.href} to={l.href} className="inline-flex items-center gap-0.5 text-blue-700 hover:underline">{l.label}<ExternalLink className="h-3 w-3" aria-hidden /></Link>
          )
        ))}
        {supported && (
          <>
            <span className={neglected(row) ? "font-medium text-red-700" : "text-slate-500"}>{nudgeLabel(row.nudge)}</span>
            <Button size="sm" variant="ghost" className="ml-auto h-6 px-2 text-xs" title="Create a fresh onboarding link and copy it"
              onClick={() => void copyOnboardingLink(row.employeeId, selected.block)}>
              <Copy className="mr-1 h-3 w-3" aria-hidden /> Copy link
            </Button>
            <Button size="sm" variant="ghost" className="h-6 px-2 text-xs" title="Email the onboarding link to the employee"
              onClick={() => void emailOnboardingLinkTo(row.employeeId, selected.block)}>
              <Mail className="mr-1 h-3 w-3" aria-hidden /> Email link
            </Button>
            <Button size="sm" variant="outline" className="h-6 px-2 text-xs" disabled={pending || row.nudge?.due === false}
              title={row.nudge?.due === false ? "Notified in the last 24h" : "Send WhatsApp reminder"}
              onClick={() => onNotify(row.employeeId)}>
              <MessageCircle className="mr-1 h-3 w-3" /> {(row.nudge?.count ?? 0) > 0 ? "Resend" : "Notify"}
            </Button>
          </>
        )}
      </div>
    </li>
  );
}

export function OpsDetailDrawer({ selected, onClose }: { selected: Selected | null; onClose: () => void }) {
  const qc = useQueryClient();
  const { hasAnyRole } = useWorkforceAccess();
  const canClose = hasAnyRole(...CLOSE_ROLES);
  const canBackfill = hasAnyRole(...BACKFILL_ROLES);
  const [bucket, setBucket] = useState<BucketFilter>("all");
  const [nudgeF, setNudgeF] = useState<NudgeFilter>("all");
  const queryKey = ["ops-control-tower-detail", selected?.block, selected?.branchId];
  const query = useQuery({
    queryKey, enabled: selected !== null,
    queryFn: () => hrmsApi.get<DetailResponse>(`${BASE}/${selected!.block}/${selected!.branchId}`),
  });
  const rows = query.data?.rows ?? [];
  const supported = query.data?.nudge.supported === true && selected !== null && isNudgeableBlock(selected.block);
  const configured = query.data?.nudge.whatsappConfigured === true;
  const visible = useMemo(() => filterRows(rows, bucket, nudgeF), [rows, bucket, nudgeF]);
  const buckets = useMemo(() => countByBucket(rows), [rows]);

  const report = (results: NudgeResult[]) => {
    const s = nudgeSummary(nudgeTally(results));
    (s.tone === "success" ? toast.success : s.tone === "error" ? toast.error : toast.warning)(s.text);
    void qc.invalidateQueries({ queryKey });
  };
  const one = useMutation({
    mutationFn: (employeeId: string) => hrmsApi.post<NudgeResult>(`${BASE}/nudge`, { employeeId, issue: selected!.block }),
    onSuccess: (r) => report([r]),
    onError: (e) => toast.error(e instanceof Error ? e.message : "Could not send the notification"),
  });
  const all = useMutation({
    mutationFn: () => hrmsApi.post<{ results: NudgeResult[] }>(`${BASE}/nudge/bulk`, { branchId: selected!.branchId, issue: selected!.block }),
    onSuccess: (r) => report(r.results),
    onError: (e) => toast.error(e instanceof Error ? e.message : "Could not send the notifications"),
  });

  return (
    <Sheet open={selected !== null} onOpenChange={(open) => { if (!open) { setBucket("all"); setNudgeF("all"); onClose(); } }}>
      <SheetContent side="right" className="w-full max-w-2xl overflow-y-auto sm:max-w-2xl">
        <SheetHeader className="pr-10">
          <SheetTitle>{selected ? `${selected.title} — ${selected.branchName}` : ""}</SheetTitle>
          <SheetDescription>{query.data ? `${visible.length} of ${rows.length} record${rows.length === 1 ? "" : "s"}` : "Loading…"}</SheetDescription>
        </SheetHeader>

        {query.isLoading && <p className="mt-6 text-sm text-slate-500">Loading…</p>}
        {query.isError && <p className="mt-6 text-sm text-red-600">{query.error instanceof Error ? query.error.message : "Could not load this list."}</p>}

        {query.data && (
          <>
            {selected?.block === "attendance-mismatch" && (
              <OpsAttendanceActions branchId={selected.branchId} branchName={selected.branchName} rows={rows as never[]}
                canClose={canClose} canBackfill={canBackfill} onChanged={() => void query.refetch()} />
            )}
            <div className="mt-3 flex flex-wrap items-center gap-1.5 text-xs">
              {BUCKETS.map((b) => (
                <button key={b} type="button" onClick={() => setBucket(b)} aria-pressed={bucket === b}
                  className={`rounded-full border px-2.5 py-0.5 ${bucket === b ? "border-slate-900 bg-slate-900 text-white" : "bg-white text-slate-600"}`}>
                  {b === "all" ? `All ${rows.length}` : `${b}d · ${buckets[b]}`}
                </button>
              ))}
              {supported && <span className="mx-1 h-4 w-px bg-slate-200" />}
              {supported && NUDGE_FILTERS.map(([k, label]) => (
                <button key={k} type="button" onClick={() => setNudgeF(k)} aria-pressed={nudgeF === k}
                  className={`rounded-full border px-2.5 py-0.5 ${nudgeF === k ? "border-emerald-700 bg-emerald-700 text-white" : "bg-white text-slate-600"}`}>{label}</button>
              ))}
              <Button size="sm" variant="ghost" className="ml-auto h-7" disabled={visible.length === 0}
                onClick={() => downloadCsv(`${selected!.block}-${selected!.branchName}.csv`, rowsToCsv(visible))}>
                <Download className="mr-1 h-3.5 w-3.5" /> CSV
              </Button>
            </div>

            {supported && (
              <div className="mt-2 flex flex-wrap items-center justify-between gap-2 rounded-md border bg-slate-50 p-2 text-xs text-slate-600">
                <span>
                  {configured ? "WhatsApp is on — joiners are also reminded automatically every 24h while pending." : "WhatsApp is not configured yet — Notify will be logged but nothing is sent."}
                </span>
                <Button size="sm" className="h-7" disabled={all.isPending || rows.length === 0}
                  onClick={() => { if (window.confirm(`Send a WhatsApp reminder to every pending joiner in ${selected!.branchName}? Anyone notified in the last 24h is skipped.`)) all.mutate(); }}>
                  <MessageCircle className="mr-1 h-3.5 w-3.5" /> {all.isPending ? "Sending…" : "Notify all"}
                </Button>
              </div>
            )}

            <ul className="mt-3 space-y-2">
              {visible.map((row, i) => (
                <DetailRowItem key={row.employeeId ?? i} block={selected!.block} row={row} supported={supported}
                  pending={one.isPending} onNotify={(id) => one.mutate(id)} />
              ))}
              {visible.length === 0 && (
                <p className="rounded-md border border-dashed p-6 text-center text-sm text-slate-500">
                  {rows.length === 0 ? "Nothing pending here — all caught up." : "No records match these filters."}
                </p>
              )}
            </ul>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}
