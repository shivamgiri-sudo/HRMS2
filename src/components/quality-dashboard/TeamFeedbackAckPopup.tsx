import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, CheckCheck, CheckCircle2, ExternalLink } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/contexts/AuthContext";
import { hrmsApi } from "@/lib/hrmsApi";

/** Matches TL_ACK_INBOX_TYPE in backend agent-feedback-ack.service.ts. */
const TYPE = "quality_feedback_ack";
const SESSION_SHOWN = "team_feedback_ack_popup_shown";
const SESSION_RED_SEEN = "team_feedback_ack_red_ids";

type InboxItem = {
  id: string;
  title: string;
  description: string | null;
  action_url: string | null;
  priority: "low" | "normal" | "high" | "urgent";
  is_read: number | boolean;
  created_at: string;
};

const readSession = (k: string) => { try { return sessionStorage.getItem(k); } catch { return null; } };
const writeSession = (k: string, v: string) => { try { sessionStorage.setItem(k, v); } catch { /* storage blocked */ } };

function when(iso: string) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleString("en-GB", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit", timeZone: "Asia/Kolkata" }).replace(",", "");
}

/**
 * Team leader popup: their agents' acknowledgements of quality-audit feedback, from the TL's
 * in-app inbox (items created by the backend when an agent acknowledges). Opens on the first page
 * load of a session when anything is unread, and again whenever new red feedback (CQ below 70% or
 * a fatal call) arrives. "Mark as seen" marks the inbox items read, so they stop appearing.
 * Renders nothing for anyone with no such items.
 */
export function TeamFeedbackAckPopup() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  const q = useQuery({
    queryKey: ["team-feedback-ack", user?.id],
    queryFn: async () => {
      const res = await hrmsApi.get<{ success: boolean; data: InboxItem[] }>(`/api/inbox?type=${TYPE}&is_read=0`);
      return (res.data ?? []).filter((i) => !i.is_read);
    },
    enabled: !!user?.id,
    refetchInterval: 60_000,
    retry: false,
  });

  const items = useMemo(() => q.data ?? [], [q.data]);
  const red = items.filter((i) => i.priority === "urgent");
  const normal = items.filter((i) => i.priority !== "urgent");

  useEffect(() => {
    if (items.length === 0) return;
    const seenRed = new Set((readSession(SESSION_RED_SEEN) ?? "").split(",").filter(Boolean));
    const newRed = red.filter((i) => !seenRed.has(i.id));
    const firstThisSession = readSession(SESSION_SHOWN) !== "1";
    if (!firstThisSession && newRed.length === 0) return;
    const t = window.setTimeout(() => {
      setOpen(true);
      writeSession(SESSION_SHOWN, "1");
      writeSession(SESSION_RED_SEEN, [...seenRed, ...red.map((i) => i.id)].join(","));
    }, 1500);
    return () => window.clearTimeout(t);
  }, [items, red]);

  const markRead = async (ids: string[]) => {
    setBusy(true);
    try {
      await Promise.all(ids.map((id) => hrmsApi.patch(`/api/inbox/${id}/read`)));
    } finally {
      setBusy(false);
      qc.invalidateQueries({ queryKey: ["team-feedback-ack"] });
      qc.invalidateQueries({ queryKey: ["notifications"] });
    }
  };

  const view = async (item: InboxItem) => {
    await markRead([item.id]);
    setOpen(false);
    if (item.action_url) navigate(item.action_url);
  };

  if (items.length === 0) return null;

  const Row = ({ item }: { item: InboxItem }) => {
    const isRed = item.priority === "urgent";
    return (
      <li className={`rounded-xl border p-3 ${isRed ? "border-rose-300 bg-rose-50" : "border-slate-200 bg-white"}`}>
        <div className="flex items-start gap-2">
          {isRed ? <AlertTriangle className="mt-0.5 shrink-0 text-rose-600" size={18} /> : <CheckCircle2 className="mt-0.5 shrink-0 text-emerald-600" size={18} />}
          <div className="min-w-0 flex-1">
            <p className={`text-sm font-semibold ${isRed ? "text-rose-800" : "text-slate-800"}`}>{item.title}</p>
            {item.description && <p className="mt-1 whitespace-pre-line text-xs text-slate-600">{item.description}</p>}
            <p className="mt-1 text-[11px] text-slate-400">{when(item.created_at)}</p>
          </div>
        </div>
        <div className="mt-2 flex justify-end gap-2">
          <Button size="sm" variant="ghost" disabled={busy} onClick={() => markRead([item.id])}>Mark as seen</Button>
          <Button size="sm" variant={isRed ? "destructive" : "outline"} disabled={busy} onClick={() => view(item)}>
            <ExternalLink size={14} className="mr-1" /> View call
          </Button>
        </div>
      </li>
    );
  };

  return (
    <>
      {!open && (
        <button
          onClick={() => setOpen(true)}
          className={`fixed bottom-6 left-1/2 z-40 -translate-x-1/2 flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-semibold shadow-lg ${red.length ? "bg-rose-600 text-white" : "bg-white text-slate-700 ring-1 ring-slate-200"}`}
        >
          {red.length ? <AlertTriangle size={14} /> : <CheckCircle2 size={14} className="text-emerald-600" />}
          {items.length} feedback acknowledgement{items.length === 1 ? "" : "s"}{red.length ? ` · ${red.length} red` : ""}
        </button>
      )}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[85vh] max-w-xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              {red.length ? <AlertTriangle className="text-rose-600" size={20} /> : <CheckCheck className="text-emerald-600" size={20} />}
              Your agents acknowledged feedback
            </DialogTitle>
            <DialogDescription>
              {items.length} new acknowledgement{items.length === 1 ? "" : "s"}
              {red.length ? ` — ${red.length} on red feedback (CQ below 70% or a fatal call) that need your attention.` : "."}
            </DialogDescription>
          </DialogHeader>

          {red.length > 0 && (
            <section className="space-y-2">
              <h3 className="text-xs font-bold uppercase tracking-wide text-rose-600">Red feedback</h3>
              <ul className="space-y-2">{red.map((i) => <Row key={i.id} item={i} />)}</ul>
            </section>
          )}
          {normal.length > 0 && (
            <section className="space-y-2">
              <h3 className="text-xs font-bold uppercase tracking-wide text-slate-400">Acknowledged</h3>
              <ul className="space-y-2">{normal.map((i) => <Row key={i.id} item={i} />)}</ul>
            </section>
          )}

          <div className="flex justify-end gap-2 border-t pt-3">
            <Button variant="ghost" onClick={() => setOpen(false)}>Later</Button>
            <Button disabled={busy} onClick={async () => { await markRead(items.map((i) => i.id)); setOpen(false); }}>
              <CheckCheck size={16} className="mr-1" /> Mark all as seen
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
