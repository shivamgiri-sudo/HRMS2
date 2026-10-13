/**
 * Candidate email replies the reply agent has read: the candidate's words, the agent's draft, and a one-click send (editable) or discard.
 * Replies the agent already sent are not listed. Unmatched senders appear for organisation-wide users with no draft.
 */
import { useCallback, useEffect, useState } from "react";
import { Mail } from "lucide-react";
import { hrmsApi } from "@/lib/hrmsApi";

interface Reply { id: string; mobile: string; fromEmail: string | null; subject: string | null; inbound: string | null; intent: string | null; confidence: number | null; reply: string | null; status: string; holdReason: string | null; role: string | null; branch: string | null; at: string }

const CARD = "rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-900";
const HOLD: Record<string, string> = { needs_human: "Needs a person", low_confidence: "Not sure", draft_mode: "Draft", validation_failed: "Check failed", unknown_sender: "Unknown sender", outside_window: "Waiting for 9 AM", agent_off: "Agent off", no_requisition: "No requisition", opted_out: "Opted out" };

export default function EmailRepliesPanel() {
  const [rows, setRows] = useState<Reply[] | null>(null);
  const [edit, setEdit] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  const load = useCallback(async () => {
    try { const r = await hrmsApi.get<{ data?: Reply[] }>("/he/replies"); setRows(Array.isArray(r?.data) ? r.data : []); } catch { setRows(null); }
  }, []);
  useEffect(() => { void load(); const t = window.setInterval(() => { if (document.visibilityState === "visible") void load(); }, 60_000); return () => window.clearInterval(t); }, [load]);

  const act = async (id: string, kind: "send" | "discard") => {
    setBusy(id); setMsg(null);
    try {
      await hrmsApi.post(`/he/replies/${id}/${kind}`, kind === "send" && edit[id] != null ? { text: edit[id] } : {});
      setMsg(kind === "send" ? "Reply sent" : "Discarded");
      await load();
    } catch (e) { setMsg(e instanceof Error ? e.message : "Could not complete the action"); } finally { setBusy(null); }
  };

  if (!rows || rows.length === 0) return null;
  return (
    <section className={CARD} aria-labelledby="er-title">
      <h2 id="er-title" className="flex items-center gap-2 text-sm font-bold text-slate-900 dark:text-slate-100"><Mail className="h-4 w-4" aria-hidden /> Candidate email replies ({rows.length})</h2>
      <p className="mt-1 text-xs text-slate-600 dark:text-slate-300">What candidates wrote and the draft reply from the agent. Edit if needed, then send. Nothing here has gone out yet.</p>
      {msg && <p role="status" className="mt-2 text-xs text-slate-700 dark:text-slate-200">{msg}</p>}
      <ul className="mt-3 space-y-3">
        {rows.map((r) => (
          <li key={r.id} className="rounded-lg border border-slate-200 p-3 dark:border-slate-700">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-600 dark:text-slate-300">
              <span className="font-semibold text-slate-900 dark:text-slate-100">{r.fromEmail ?? "unknown sender"}</span>
              <span>{r.mobile}</span>{r.role && <span>{r.role}{r.branch ? `, ${r.branch}` : ""}</span>}
              <span className="rounded-full bg-slate-100 px-2 py-0.5 dark:bg-slate-800">{r.intent ?? "unclassified"}{r.confidence != null ? ` ${Math.round(r.confidence * 100)}%` : ""}</span>
              <span className="rounded-full bg-amber-100 px-2 py-0.5 text-amber-900">{HOLD[r.holdReason ?? ""] ?? r.status}</span>
              <span>{r.at.slice(0, 16)}</span>
            </div>
            <p className="mt-2 whitespace-pre-wrap rounded-md bg-slate-50 p-2 text-sm text-slate-800 dark:bg-slate-800 dark:text-slate-100">{r.inbound || "(empty)"}</p>
            {r.reply != null && (
              <div className="mt-2">
                <label htmlFor={`er-${r.id}`} className="text-xs font-semibold text-slate-700 dark:text-slate-200">Draft reply</label>
                <textarea id={`er-${r.id}`} rows={5} className="mt-1 w-full rounded-lg border border-slate-300 bg-white p-2 text-sm text-slate-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100"
                  value={edit[r.id] ?? r.reply} onChange={(e) => setEdit((cur) => ({ ...cur, [r.id]: e.target.value }))} />
              </div>
            )}
            <div className="mt-2 flex flex-wrap gap-2">
              {r.fromEmail && r.reply && (
                <button type="button" disabled={busy === r.id} onClick={() => void act(r.id, "send")} className="min-h-11 cursor-pointer rounded-lg bg-blue-600 px-4 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-60 sm:min-h-9">Send reply</button>
              )}
              <button type="button" disabled={busy === r.id} onClick={() => void act(r.id, "discard")} className="min-h-11 cursor-pointer rounded-lg border border-slate-300 px-4 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-60 dark:border-slate-600 dark:text-slate-200 sm:min-h-9">Discard</button>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
