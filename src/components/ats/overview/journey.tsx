import { useState } from "react";
import { AlertTriangle, Banknote, CheckCircle2, CircleDot, Clock, Mail, Phone, ShieldCheck, Ticket, UserCheck, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { hrmsApi } from "@/lib/hrmsApi";
import { useCandidateJourney } from "@/hooks/useAtsDashboards";
import { Empty, V, fmt } from "./viz";

export const isoDay = (offset = 0) => new Date(Date.now() - offset * 86_400_000).toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });

const STATUS_STYLE: Record<string, { cls: string; Icon: typeof CircleDot }> = {
  Selected: { cls: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300", Icon: CheckCircle2 },
  Rejected: { cls: "bg-red-500/15 text-red-700 dark:text-red-300", Icon: X },
  "No Show": { cls: "bg-orange-500/15 text-orange-700 dark:text-orange-300", Icon: AlertTriangle },
  Hold: { cls: "bg-amber-500/15 text-amber-700 dark:text-amber-300", Icon: Clock },
  Waiting: { cls: "bg-blue-500/15 text-blue-700 dark:text-blue-300", Icon: Clock },
};
export function StatusPill({ status }: { status: string }) {
  const s = STATUS_STYLE[status] ?? { cls: "bg-muted text-muted-foreground", Icon: CircleDot };
  return <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold ${s.cls}`}><s.Icon className="h-3 w-3" aria-hidden />{status}</span>;
}

export const when = (v?: string | null) => (v ? new Date(v).toLocaleString("en-IN", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }) : "-");
export const waited = (v: string) => { const m = Math.max(0, Math.floor((Date.now() - new Date(v).getTime()) / 60000)); return m < 60 ? `${m}m` : m < 1440 ? `${Math.floor(m / 60)}h` : `${Math.floor(m / 1440)}d`; };

export function Journey({ id, onClose, onChanged }: { id: string; onClose: () => void; onChanged: () => void }) {
  const { data: j, isLoading } = useCandidateJourney(id);
  const [busy, setBusy] = useState(false);
  const c = j?.candidate;
  const canHandOff = c?.status === "Selected";

  const handOff = async () => {
    setBusy(true);
    try {
      await hrmsApi.post("/api/ats/onboarding-bridge", { candidateId: id, bridgeDate: isoDay(0) });
      toast.success("Moved to HRMS onboarding. HR can now assign an employee code.");
      onChanged();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Unable to move candidate to onboarding");
    } finally { setBusy(false); }
  };

  const rounds = j?.submission ? [
    ["HR screening", j.submission.round1_result, j.submission.round1_voc], ["Skill test", j.submission.skilltest_result, j.submission.skilltest_voc],
    ["Ops round", j.submission.round2_result, j.submission.round2_voc], ["Client round", j.submission.round3_result, j.submission.round3_voc],
  ].filter(([, r]) => r) : [];

  return (
    <Sheet open onOpenChange={(o) => !o && onClose()}>
      <SheetContent className="w-full overflow-y-auto sm:w-[60vw] sm:max-w-[60vw]">
        <SheetHeader><SheetTitle className="text-left">{c?.full_name ?? "Candidate journey"}</SheetTitle></SheetHeader>
        {isLoading || !j ? <div className="mt-4 space-y-3"><Skeleton className="h-16" /><Skeleton className="h-40" /><Skeleton className="h-32" /></div> : !c ? <Empty text="Candidate not found" /> : (
          <div className="mt-4 space-y-5 text-sm">
            <div className="flex flex-wrap items-center gap-2"><StatusPill status={c.status} /><span className="rounded-full bg-muted px-2 py-0.5 text-[11px]">{c.stage}</span><span className="text-xs text-muted-foreground">{c.candidate_code}</span></div>
            <div className="grid grid-cols-2 gap-2 text-xs">
              <div className="flex items-center gap-1.5"><Phone className="h-3.5 w-3.5 text-muted-foreground" aria-hidden />{c.mobile}</div>
              {c.email && <div className="flex items-center gap-1.5 truncate"><Mail className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden /><span className="truncate">{c.email}</span></div>}
              <div>{c.branch} · {c.process ?? "-"}</div><div>Source: {c.source ?? "-"} · {c.recruiter ?? "Unassigned"}</div>
              <div>{c.experience ?? "-"} · {c.education ?? "-"}</div>
            </div>

            {j.queueToken && <div className="flex items-center gap-2 rounded-xl bg-muted/50 p-3 text-xs"><Ticket className="h-4 w-4 text-primary" aria-hidden />Token <b>{j.queueToken.token_number ?? "-"}</b> · arrived {when(j.queueToken.arrival_time)}{j.queueToken.interview_completed_at && <> · interviewed {when(j.queueToken.interview_completed_at)}</>}</div>}

            <section aria-label="Timeline">
              <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Timeline</h3>
              <ol className="relative space-y-3 border-l pl-4">
                <li><span className="absolute -left-[5px] mt-1 h-2.5 w-2.5 rounded-full" style={{ background: V.blue }} aria-hidden /><div className="font-medium">Registered</div><div className="text-xs text-muted-foreground">{when(c.created_at)}</div></li>
                {j.stageLogs.map((l, i) => (
                  <li key={i}><span className="absolute -left-[5px] mt-1 h-2.5 w-2.5 rounded-full" style={{ background: V.aqua }} aria-hidden />
                    <div className="font-medium">{l.to_stage}</div><div className="text-xs text-muted-foreground">{when(l.at)}{l.from_stage ? ` · from ${l.from_stage}` : ""}</div>{l.remarks && <div className="text-xs">{l.remarks}</div>}</li>
                ))}
              </ol>
            </section>

            {rounds.length > 0 && (
              <section aria-label="Interview rounds"><h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Interview rounds</h3>
                <ul className="space-y-1.5">{rounds.map(([n, r, voc]) => <li key={String(n)} className="flex items-center justify-between gap-2 rounded-lg bg-muted/40 px-3 py-2"><span>{n}</span><span className="flex items-center gap-2">{voc ? <span className="max-w-[160px] truncate text-xs text-muted-foreground" title={String(voc)}>{voc}</span> : null}<StatusPill status={String(r)} /></span></li>)}</ul>
                {j.submission?.skilltest_typing != null && <p className="mt-2 text-xs text-muted-foreground">Typing {j.submission.skilltest_typing} WPM · AI score {j.submission.skilltest_ai ?? "-"}</p>}
              </section>
            )}

            <div className="grid grid-cols-2 gap-3">
              <div className="rounded-xl border p-3"><div className="mb-1 flex items-center gap-1.5 text-xs text-muted-foreground"><Banknote className="h-3.5 w-3.5" aria-hidden />Offer</div>{j.offer ? <><div className="font-semibold">₹{fmt(j.offer.offered_ctc)}</div><div className="text-xs text-muted-foreground">{j.offer.status.replace("_", " ")}</div></> : j.submission?.offer_salary ? <div className="font-semibold">₹{fmt(Number(j.submission.offer_salary))}</div> : <div className="text-xs text-muted-foreground">No offer yet</div>}</div>
              <div className="rounded-xl border p-3"><div className="mb-1 flex items-center gap-1.5 text-xs text-muted-foreground"><ShieldCheck className="h-3.5 w-3.5" aria-hidden />Background check</div>{j.bgv ? <><div className="font-semibold capitalize">{j.bgv.overall_status.replace("_", " ")}</div>{j.bgv.bgv_score != null && <div className="text-xs text-muted-foreground">Score {j.bgv.bgv_score}</div>}</> : <div className="text-xs text-muted-foreground">Not started</div>}</div>
            </div>

            {canHandOff && <Button className="w-full" onClick={handOff} disabled={busy}><UserCheck className="mr-2 h-4 w-4" aria-hidden />{busy ? "Moving…" : "Move to HRMS onboarding"}</Button>}
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}

