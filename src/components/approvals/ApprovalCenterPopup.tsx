import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import {
  AlertTriangle,
  Building2,
  CheckCheck,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Clock3,
  ExternalLink,
  Inbox,
  Loader2,
  ShieldCheck,
  XCircle,
} from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { useAuth } from "@/contexts/AuthContext";
import { useApprovalCenter, useDecideApproval, type ApprovalItem } from "@/hooks/useApprovalCenter";

const SHOWN_KEY = "approval_popup_shown";

const CATEGORY_STYLE: Record<string, string> = {
  People: "bg-sky-50 text-sky-700 ring-sky-200 dark:bg-sky-950/40 dark:text-sky-300 dark:ring-sky-900",
  Attendance: "bg-violet-50 text-violet-700 ring-violet-200 dark:bg-violet-950/40 dark:text-violet-300 dark:ring-violet-900",
  Payroll: "bg-emerald-50 text-emerald-700 ring-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-300 dark:ring-emerald-900",
  Finance: "bg-amber-50 text-amber-800 ring-amber-200 dark:bg-amber-950/40 dark:text-amber-300 dark:ring-amber-900",
  Recruitment: "bg-fuchsia-50 text-fuchsia-700 ring-fuchsia-200 dark:bg-fuchsia-950/40 dark:text-fuchsia-300 dark:ring-fuchsia-900",
  Exit: "bg-rose-50 text-rose-700 ring-rose-200 dark:bg-rose-950/40 dark:text-rose-300 dark:ring-rose-900",
  Admin: "bg-slate-100 text-slate-700 ring-slate-200 dark:bg-slate-800 dark:text-slate-300 dark:ring-slate-700",
};
const categoryClass = (c: string) => CATEGORY_STYLE[c] ?? CATEGORY_STYLE.Admin;

function ageLabel(iso?: string | null): { text: string; stale: boolean } | null {
  if (!iso) return null;
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return null;
  const hours = Math.max(0, Math.floor((Date.now() - t) / 3_600_000));
  if (hours < 1) return { text: "Just now", stale: false };
  if (hours < 24) return { text: `${hours}h pending`, stale: false };
  const days = Math.floor(hours / 24);
  return { text: `${days}d pending`, stale: days >= 3 };
}

function initials(name?: string | null) {
  const parts = (name ?? "").trim().split(/\s+/).filter(Boolean);
  return ((parts[0]?.[0] ?? "") + (parts.length > 1 ? parts[parts.length - 1][0] : "")).toUpperCase() || "•";
}

function readShown(): boolean {
  try {
    return sessionStorage.getItem(SHOWN_KEY) === "1";
  } catch {
    return false;
  }
}
function writeShown() {
  try {
    sessionStorage.setItem(SHOWN_KEY, "1");
  } catch {
    /* storage blocked: the popup simply shows again next load */
  }
}

/**
 * Approval Center popup. Opens on every login (and fresh tab) when the signed-in person has anything
 * waiting on them, one card per request with every component, plus Approve / Decline / View.
 * After "Later" a pill stays in the corner to reopen it.
 */
export function ApprovalCenterPopup() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const { data, isLoading } = useApprovalCenter();
  const decide = useDecideApproval();

  const [open, setOpen] = useState(false);
  const [filter, setFilter] = useState<string>("all");
  const [index, setIndex] = useState(0);
  const [declining, setDeclining] = useState(false);
  const [reason, setReason] = useState("");
  const [note, setNote] = useState("");
  const [showNote, setShowNote] = useState(false);
  const [busy, setBusy] = useState<null | "approve" | "reject">(null);
  const [handled, setHandled] = useState(0);

  const all = data?.items ?? [];
  const categories = useMemo(() => {
    const m = new Map<string, number>();
    for (const i of all) m.set(i.category, (m.get(i.category) ?? 0) + 1);
    return [...m.entries()];
  }, [all]);
  const items = useMemo(() => (filter === "all" ? all : all.filter((i) => i.category === filter)), [all, filter]);
  const safeIndex = Math.min(index, Math.max(0, items.length - 1));
  const item: ApprovalItem | undefined = items[safeIndex];

  // First load of the session with something pending -> open (after other login popups had a moment).
  useEffect(() => {
    if (!user?.id || isLoading || !data || readShown()) return;
    if (all.length === 0) return;
    const t = window.setTimeout(() => {
      setOpen(true);
      writeShown();
    }, 1200);
    return () => window.clearTimeout(t);
  }, [user?.id, isLoading, data, all.length]);

  useEffect(() => {
    setDeclining(false);
    setReason("");
    setNote("");
    setShowNote(false);
  }, [item?.uid]);

  useEffect(() => {
    if (index !== safeIndex) setIndex(safeIndex);
  }, [index, safeIndex]);

  if (!user?.id) return null;

  const total = all.length;

  const run = async (action: "approve" | "reject") => {
    if (!item) return;
    const remarks = action === "reject" ? reason.trim() : note.trim();
    const minReason = item.rejectMinLength ?? 3;
    if (action === "reject" && item.rejectNeedsReason && remarks.length < minReason) {
      toast.error(minReason > 3 ? `Please write a reason of at least ${minReason} characters.` : "Please write a reason before declining.");
      return;
    }
    setBusy(action);
    try {
      await decide.mutateAsync({ uid: item.uid, action, remarks });
      setHandled((n) => n + 1);
      toast.success(action === "approve" ? `Approved — ${item.title}` : `Declined — ${item.title}`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Action failed. Nothing was changed.");
    } finally {
      setBusy(null);
    }
  };

  const view = () => {
    if (!item) return;
    setOpen(false);
    navigate(item.viewPath);
  };

  const age = ageLabel(item?.submittedAt);
  const longFields = item?.fields.filter((f) => f.type === "long") ?? [];
  const gridFields = item?.fields.filter((f) => f.type !== "long") ?? [];

  return (
    <>
      {!open && total > 0 && (
        <button
          type="button"
          onClick={() => setOpen(true)}
          aria-label={`${total} approvals waiting for you. Open`}
          className="fixed bottom-4 left-4 z-[60] inline-flex min-h-[44px] cursor-pointer items-center gap-2 rounded-full border border-amber-300 bg-amber-50 px-4 text-sm font-semibold text-amber-900 shadow-lg transition-colors duration-200 hover:bg-amber-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-600 motion-reduce:transition-none dark:border-amber-800 dark:bg-amber-950 dark:text-amber-100"
        >
          <ShieldCheck className="h-4 w-4" aria-hidden />
          {total} approval{total === 1 ? "" : "s"} waiting
        </button>
      )}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[92vh] w-[calc(100vw-1.5rem)] max-w-3xl gap-0 overflow-hidden p-0 sm:w-full">
          <DialogHeader className="border-b bg-muted/40 px-5 py-4 text-left">
            <div className="flex items-center gap-3">
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
                <ShieldCheck className="h-5 w-5" aria-hidden />
              </span>
              <div className="min-w-0">
                <DialogTitle className="text-lg font-semibold leading-tight">Approvals waiting for you</DialogTitle>
                <DialogDescription className="text-sm">
                  {total === 0
                    ? "Nothing pending right now."
                    : `${total} request${total === 1 ? "" : "s"} need your decision${handled ? ` · ${handled} done this session` : ""}`}
                </DialogDescription>
              </div>
            </div>

            {categories.length > 1 && (
              <div className="mt-3 flex flex-wrap gap-1.5" role="tablist" aria-label="Filter by category">
                <FilterChip active={filter === "all"} onClick={() => { setFilter("all"); setIndex(0); }}>All · {total}</FilterChip>
                {categories.map(([c, n]) => (
                  <FilterChip key={c} active={filter === c} onClick={() => { setFilter(c); setIndex(0); }}>
                    {c} · {n}
                  </FilterChip>
                ))}
              </div>
            )}
          </DialogHeader>

          {!item ? (
            <div className="flex flex-col items-center gap-3 px-6 py-14 text-center">
              <CheckCheck className="h-10 w-10 text-emerald-600" aria-hidden />
              <p className="text-base font-semibold">All caught up</p>
              <p className="max-w-sm text-sm text-muted-foreground">
                {handled ? `You actioned ${handled} request${handled === 1 ? "" : "s"}.` : "No approvals are waiting on you."}
              </p>
              <Button onClick={() => setOpen(false)} className="min-h-[44px]">Close</Button>
            </div>
          ) : (
            <>
              <div className="max-h-[56vh] overflow-y-auto px-5 py-4">
                <div className="mb-3 flex flex-wrap items-center gap-2">
                  <span className={cn("inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold ring-1 ring-inset", categoryClass(item.category))}>
                    {item.kindLabel}
                  </span>
                  {item.stage && (
                    <span className="inline-flex items-center rounded-full bg-muted px-2.5 py-0.5 text-xs font-medium text-muted-foreground">
                      {item.stage}
                    </span>
                  )}
                  {age && (
                    <span
                      className={cn(
                        "ml-auto inline-flex items-center gap-1 text-xs font-medium",
                        age.stale || item.priority === "high" ? "text-red-600 dark:text-red-400" : "text-muted-foreground",
                      )}
                    >
                      {age.stale || item.priority === "high" ? <AlertTriangle className="h-3.5 w-3.5" aria-hidden /> : <Clock3 className="h-3.5 w-3.5" aria-hidden />}
                      {age.text}
                    </span>
                  )}
                </div>

                <div className="flex items-start gap-3">
                  <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-primary/10 text-sm font-semibold text-primary" aria-hidden>
                    {initials(item.requester?.name ?? item.title)}
                  </span>
                  <div className="min-w-0">
                    <h3 className="break-words text-base font-semibold leading-snug">{item.title}</h3>
                    {item.subtitle && <p className="mt-0.5 text-sm text-muted-foreground">{item.subtitle}</p>}
                    {(item.requester?.code || item.requester?.branch) && (
                      <p className="mt-1 flex flex-wrap items-center gap-x-3 text-xs text-muted-foreground">
                        {item.requester?.code && <span>{item.requester.code}</span>}
                        {item.requester?.branch && (
                          <span className="inline-flex items-center gap-1"><Building2 className="h-3 w-3" aria-hidden />{item.requester.branch}</span>
                        )}
                      </p>
                    )}
                  </div>
                </div>

                {gridFields.length > 0 && (
                  <dl className="mt-4 grid grid-cols-1 gap-x-6 gap-y-3 rounded-xl border bg-card p-4 sm:grid-cols-2">
                    {gridFields.map((f, i) => (
                      <div key={`${f.label}-${i}`} className="min-w-0">
                        <dt className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">{f.label}</dt>
                        <dd className={cn("mt-0.5 break-words text-sm", f.type === "money" && "font-semibold tabular-nums")}>
                          {f.type === "badge" ? (
                            <span className="rounded-md bg-muted px-1.5 py-0.5 text-xs font-medium">{f.value}</span>
                          ) : (
                            f.value
                          )}
                        </dd>
                      </div>
                    ))}
                  </dl>
                )}

                {longFields.map((f, i) => (
                  <div key={`${f.label}-${i}`} className="mt-3 rounded-xl border bg-muted/30 p-4">
                    <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">{f.label}</p>
                    <p className="mt-1 whitespace-pre-wrap break-words text-sm leading-relaxed">{f.value}</p>
                  </div>
                ))}

                {declining && (
                  <div className="mt-4 rounded-xl border border-red-200 bg-red-50/60 p-4 dark:border-red-900 dark:bg-red-950/30">
                    <label htmlFor="approval-reason" className="text-sm font-semibold text-red-800 dark:text-red-200">
                      Reason for declining{item.rejectNeedsReason ? ` (required${(item.rejectMinLength ?? 3) > 3 ? `, at least ${item.rejectMinLength} characters` : ""})` : ""}
                    </label>
                    <Textarea
                      id="approval-reason"
                      autoFocus
                      value={reason}
                      onChange={(e) => setReason(e.target.value)}
                      placeholder="The requester will see this."
                      className="mt-2 min-h-[84px] bg-background"
                    />
                  </div>
                )}

                {!declining && !item.viewOnly && showNote && (
                  <div className="mt-4">
                    <label htmlFor="approval-note" className="text-sm font-medium">Note (optional)</label>
                    <Textarea id="approval-note" value={note} onChange={(e) => setNote(e.target.value)} className="mt-1.5 min-h-[64px]" />
                  </div>
                )}

                {(item.noReject || item.noApprove) && !item.viewOnly && (
                  <p className="mt-4 rounded-lg border border-dashed p-3 text-sm text-muted-foreground">
                    {item.noReject ? "Declining isn't available here — use View if you need to reject." : "Approving needs details only the request page can collect — use View."}
                  </p>
                )}
                {item.viewOnly && (
                  <p className="mt-4 rounded-lg border border-dashed p-3 text-sm text-muted-foreground">
                    This request needs details that can only be entered on its page. Use <strong>View</strong> to review and decide.
                  </p>
                )}
              </div>

              <div className="border-t bg-background px-5 py-3">
                <div className="flex flex-wrap items-center gap-2">
                  <div className="mr-auto flex items-center gap-1">
                    <Button variant="ghost" size="icon" className="h-11 w-11" disabled={safeIndex === 0 || !!busy} onClick={() => setIndex(safeIndex - 1)} aria-label="Previous request">
                      <ChevronLeft className="h-5 w-5" />
                    </Button>
                    <span className="min-w-[4.5rem] text-center text-sm tabular-nums text-muted-foreground" aria-live="polite">
                      {safeIndex + 1} of {items.length}
                    </span>
                    <Button variant="ghost" size="icon" className="h-11 w-11" disabled={safeIndex >= items.length - 1 || !!busy} onClick={() => setIndex(safeIndex + 1)} aria-label="Next request">
                      <ChevronRight className="h-5 w-5" />
                    </Button>
                  </div>

                  <Button variant="outline" className="min-h-[44px] gap-1.5" onClick={view} disabled={!!busy}>
                    <ExternalLink className="h-4 w-4" aria-hidden /> View
                  </Button>

                  {!item.viewOnly && (
                    declining ? (
                      <>
                        <Button variant="ghost" className="min-h-[44px]" onClick={() => setDeclining(false)} disabled={!!busy}>Back</Button>
                        <Button
                          className="min-h-[44px] gap-1.5 bg-red-600 text-white hover:bg-red-700"
                          onClick={() => void run("reject")}
                          disabled={!!busy || (item.rejectNeedsReason && reason.trim().length < (item.rejectMinLength ?? 3))}
                        >
                          {busy === "reject" ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <XCircle className="h-4 w-4" aria-hidden />}
                          Confirm {item.rejectLabel ?? "decline"}
                        </Button>
                      </>
                    ) : (
                      <>
                        {!showNote && (
                          <Button variant="ghost" className="min-h-[44px] text-muted-foreground" onClick={() => setShowNote(true)} disabled={!!busy}>Add note</Button>
                        )}
                        {!item.noReject && (
                        <Button
                          variant="outline"
                          className="min-h-[44px] gap-1.5 border-red-300 text-red-700 hover:bg-red-50 dark:border-red-800 dark:text-red-300 dark:hover:bg-red-950/40"
                          onClick={() => setDeclining(true)}
                          disabled={!!busy}
                        >
                          <XCircle className="h-4 w-4" aria-hidden /> {item.rejectLabel ?? "Decline"}
                        </Button>
                        )}
                        {!item.noApprove && (
                        <Button
                          className="min-h-[44px] gap-1.5 bg-emerald-600 text-white hover:bg-emerald-700"
                          onClick={() => void run("approve")}
                          disabled={!!busy}
                        >
                          {busy === "approve" ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <CheckCircle2 className="h-4 w-4" aria-hidden />}
                          {item.approveLabel ?? "Approve"}
                        </Button>
                        )}
                      </>
                    )
                  )}
                </div>
                <div className="mt-2 flex items-center justify-between gap-2 text-xs text-muted-foreground">
                  <span className="inline-flex min-w-0 items-center gap-1">
                    <Inbox className="h-3.5 w-3.5 shrink-0" aria-hidden />
                    <span className="min-w-0 truncate">
                      {data?.failed?.length
                        ? `${data.failed.length} queue(s) did not load`
                        : data?.staleHidden
                          ? `${data.staleHidden} older request${data.staleHidden === 1 ? " is" : "s are"} on their pages`
                          : "Only requests waiting on you"}
                    </span>
                  </span>
                  <button type="button" className="shrink-0 cursor-pointer underline-offset-2 hover:underline" onClick={() => setOpen(false)}>Later</button>
                </div>
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}

function FilterChip({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      onClick={onClick}
      className={cn(
        "min-h-[32px] cursor-pointer rounded-full px-3 text-xs font-medium ring-1 ring-inset transition-colors duration-200 motion-reduce:transition-none",
        active ? "bg-primary text-primary-foreground ring-primary" : "bg-background text-muted-foreground ring-border hover:bg-muted",
      )}
    >
      {children}
    </button>
  );
}
