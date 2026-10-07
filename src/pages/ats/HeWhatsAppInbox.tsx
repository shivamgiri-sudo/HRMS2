/**
 * WhatsApp Inbox, "Hiring Engine candidates" source: every candidate the engine has written to or heard from, the whole conversation
 * (WhatsApp and email) and a typed reply. Reads /api/he/inbox*. Sits beside the Meta campaign source on the same page.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { Check, CheckCheck, Clock, Mail, RefreshCcw, Search, Send, XCircle } from "lucide-react";
import { hrmsApi } from "@/lib/hrmsApi";

interface Row { leadId: string; name: string; mobile: string; branch: string | null; role: string | null; lastText: string; lastDirection: "in" | "out"; lastChannel: string; lastAt: string; lastStatus: string | null; unread: number; windowOpen: boolean }
interface Msg { id: string; channel: "whatsapp" | "email"; direction: "in" | "out"; text: string; kind: string | null; status: string | null; error: string | null; at: string }
interface Thread { lead: { id: string; name: string; mobile: string; status: string; branch: string | null; role: string | null }; window: { open: boolean; lastInboundAt: string | null; closesAt: string | null }; messages: Msg[] }

const clock = (iso: string) => new Date(iso).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" });
const dayOf = (iso: string) => new Date(iso).toLocaleDateString("en-IN", { weekday: "short", day: "numeric", month: "short" });
const when = (iso: string) => { const d = new Date(iso), t = new Date(); return d.toDateString() === t.toDateString() ? clock(iso) : dayOf(iso); };

function Ticks({ status }: { status: string | null }) {
  if (status === "failed") return <span title="Not delivered" className="inline-flex items-center gap-0.5 text-[10px] text-rose-600"><XCircle className="h-3 w-3" aria-hidden />failed</span>;
  if (status === "read") return <CheckCheck className="h-3.5 w-3.5 text-sky-500" aria-label="Read" />;
  if (status === "delivered") return <CheckCheck className="h-3.5 w-3.5 text-slate-400" aria-label="Delivered" />;
  if (status === "sent") return <Check className="h-3.5 w-3.5 text-slate-400" aria-label="Sent" />;
  return <Clock className="h-3 w-3 text-slate-400" aria-label="Queued" />;
}

export default function HeWhatsAppInbox() {
  const [rows, setRows] = useState<Row[]>([]);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [sel, setSel] = useState<string | null>(null);
  const [thread, setThread] = useState<Thread | null>(null);
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [sendErr, setSendErr] = useState<string | null>(null);
  const [mobileView, setMobileView] = useState<"list" | "thread">("list");
  const endRef = useRef<HTMLDivElement>(null);

  const loadList = useCallback(async () => {
    try { const r = await hrmsApi.get<{ data: Row[] }>(`/api/he/inbox${search ? `?search=${encodeURIComponent(search)}` : ""}`); setRows(r.data ?? []); setErr(null); }
    catch (e: unknown) { setErr((e as { message?: string })?.message || "Could not load the conversations"); }
    finally { setLoading(false); }
  }, [search]);
  const loadThread = useCallback(async (id: string) => {
    try { const t = await hrmsApi.get<Thread>(`/api/he/inbox/${id}/messages`); setThread(t); } catch { setThread(null); }
  }, []);
  useEffect(() => { const t = setTimeout(() => void loadList(), 250); return () => clearTimeout(t); }, [loadList]);
  useEffect(() => { const i = setInterval(() => { void loadList(); if (sel) void loadThread(sel); }, 15000); return () => clearInterval(i); }, [loadList, loadThread, sel]);
  useEffect(() => { endRef.current?.scrollIntoView({ block: "end" }); }, [thread?.messages.length]);

  const open = async (id: string) => { setSel(id); setMobileView("thread"); setSendErr(null); setText(""); await loadThread(id); void loadList(); };
  const send = async () => {
    if (!sel || !text.trim()) return; setSending(true); setSendErr(null);
    try { await hrmsApi.post(`/api/he/inbox/${sel}/reply`, { message: text.trim() }); setText(""); await loadThread(sel); void loadList(); }
    catch (e: unknown) { setSendErr((e as { message?: string })?.message || "Could not send"); }
    finally { setSending(false); }
  };

  let lastDay = "";
  return (
    <div className="flex min-h-0 flex-1 overflow-hidden bg-white" aria-label="Hiring Engine conversations">
      <div className={`flex w-full flex-shrink-0 flex-col border-r border-[#d1d7db] md:w-[360px] lg:w-[380px] ${mobileView === "thread" ? "hidden md:flex" : "flex"}`}>
        <div className="flex items-center justify-between border-b border-[#d1d7db] bg-[#f0f2f5] px-4 py-3">
          <div><div className="text-[15px] font-semibold text-[#111b21]">Hiring Engine candidates</div><div className="text-[11px] text-[#54656f]">{rows.reduce((s, r) => s + r.unread, 0)} unread · {rows.length} conversations</div></div>
          <button type="button" onClick={() => { setLoading(true); void loadList(); }} className="rounded-full p-2 text-[#54656f] hover:bg-[#dfe5e7] focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500" aria-label="Refresh"><RefreshCcw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} aria-hidden /></button>
        </div>
        <div className="border-b border-[#e9edef] bg-[#f0f2f5] px-3 py-2">
          <label className="relative block"><span className="sr-only">Search candidates</span><Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-[#54656f]" aria-hidden />
            <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search name or mobile" className="w-full rounded-lg border-0 bg-white py-2 pl-9 pr-3 text-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500" /></label>
        </div>
        <div className="flex-1 overflow-y-auto" role="list">
          {err && <p role="alert" className="p-4 text-sm text-rose-700">{err}</p>}
          {!err && !loading && rows.length === 0 && <p className="p-6 text-center text-sm text-[#54656f]">No conversations yet. Messages the engine sends to candidates, and their replies, appear here.</p>}
          {rows.map((r) => (
            <button key={r.leadId} type="button" role="listitem" onClick={() => void open(r.leadId)} className={`flex w-full cursor-pointer items-start gap-3 border-b border-[#f0f2f5] px-4 py-3 text-left hover:bg-[#f5f6f6] focus:outline-none focus-visible:bg-[#f5f6f6] ${sel === r.leadId ? "bg-[#f0f2f5]" : ""}`}>
              <span className="flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-full bg-[#dfe5e7] text-sm font-bold text-[#54656f]" aria-hidden>{r.name.slice(0, 1).toUpperCase()}</span>
              <span className="min-w-0 flex-1">
                <span className="flex items-baseline justify-between gap-2"><span className="truncate text-[15px] font-medium text-[#111b21]">{r.name}</span><span className={`flex-shrink-0 text-[11px] ${r.unread ? "font-semibold text-[#25d366]" : "text-[#667781]"}`}>{when(r.lastAt)}</span></span>
                <span className="flex items-center gap-1 text-[13px] text-[#667781]">{r.lastDirection === "out" && <Ticks status={r.lastStatus} />}{r.lastChannel === "email" && <Mail className="h-3 w-3 flex-shrink-0" aria-label="Email" />}<span className="truncate">{r.lastText}</span></span>
                <span className="mt-0.5 flex items-center justify-between gap-2"><span className="truncate text-[11px] text-[#8696a0]">{[r.role, r.branch].filter(Boolean).join(" · ") || `+91 ${r.mobile.slice(0, 2)}xxxxxx${r.mobile.slice(-2)}`}</span>{r.unread > 0 && <span className="flex h-5 min-w-5 items-center justify-center rounded-full bg-[#25d366] px-1.5 text-[11px] font-bold text-white">{r.unread}</span>}</span>
              </span>
            </button>
          ))}
        </div>
      </div>

      <div className={`min-w-0 flex-1 flex-col bg-[#efeae2] ${mobileView === "list" ? "hidden md:flex" : "flex"}`}>
        {!thread || !sel ? <div className="m-auto max-w-xs p-6 text-center text-sm text-[#54656f]">Pick a candidate to see everything the engine sent and what they replied, and to answer them.</div> : (
          <>
            <div className="flex items-center gap-3 border-b border-[#d1d7db] bg-[#f0f2f5] px-4 py-2.5">
              <button type="button" onClick={() => setMobileView("list")} className="text-sm text-blue-700 md:hidden">Back</button>
              <span className="flex h-10 w-10 items-center justify-center rounded-full bg-[#dfe5e7] text-sm font-bold text-[#54656f]" aria-hidden>{thread.lead.name.slice(0, 1).toUpperCase()}</span>
              <div className="min-w-0"><div className="truncate text-[15px] font-semibold text-[#111b21]">{thread.lead.name}</div><div className="truncate text-xs text-[#54656f]">+91 {thread.lead.mobile.slice(0, 2)}xxxxxx{thread.lead.mobile.slice(-2)}{thread.lead.role ? ` · ${thread.lead.role}` : ""}{thread.lead.branch ? ` · ${thread.lead.branch}` : ""} · {thread.lead.status.replace(/_/g, " ")}</div></div>
            </div>
            <div className="flex-1 space-y-1 overflow-y-auto px-4 py-3" aria-label="Conversation">
              {thread.messages.map((m) => {
                const d = dayOf(m.at); const head = d !== lastDay; lastDay = d; const mine = m.direction === "out";
                return (
                  <div key={m.id}>
                    {head && <div className="my-2 text-center"><span className="rounded-lg bg-white/90 px-3 py-1 text-[11px] text-[#54656f] shadow-sm">{d}</span></div>}
                    <div className={`flex ${mine ? "justify-end" : "justify-start"}`}>
                      <div className={`max-w-[78%] rounded-lg px-3 py-1.5 text-[14px] shadow-sm ${m.channel === "email" ? "border border-sky-200 bg-sky-50" : mine ? "bg-[#d9fdd3]" : "bg-white"}`}>
                        {m.channel === "email" && <div className="mb-0.5 flex items-center gap-1 text-[11px] font-semibold text-sky-700"><Mail className="h-3 w-3" aria-hidden /> Email sent</div>}
                        <div className="whitespace-pre-wrap break-words text-[#111b21]">{m.text}</div>
                        {m.error && <div className="mt-0.5 text-[11px] text-rose-600">Not delivered: {m.error}</div>}
                        <div className="mt-0.5 flex items-center justify-end gap-1 text-[10px] text-[#667781]">{m.kind && m.kind !== "manual_reply" && mine && <span className="mr-auto rounded bg-black/5 px-1">{m.kind.replace(/^he_/, "").replace(/:en$|:hi$/, "").replace(/_/g, " ")}</span>}{clock(m.at)}{mine && <Ticks status={m.status} />}</div>
                      </div>
                    </div>
                  </div>
                );
              })}
              <div ref={endRef} />
            </div>
            <div className="border-t border-[#d1d7db] bg-[#f0f2f5] p-3">
              {!thread.window.open && <p role="note" className="mb-2 rounded-md bg-amber-50 px-3 py-2 text-xs text-amber-900">{thread.window.lastInboundAt ? "The candidate last wrote more than 24 hours ago" : "The candidate has not written to us yet"}, so WhatsApp only allows approved templates now. The automatic follow-ups send those. You can type again as soon as they reply.</p>}
              {sendErr && <p role="alert" className="mb-2 text-xs text-rose-700">{sendErr}</p>}
              <div className="flex items-end gap-2">
                <label className="sr-only" htmlFor="he-reply">Reply</label>
                <textarea id="he-reply" rows={2} value={text} disabled={!thread.window.open || sending} onChange={(e) => setText(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); void send(); } }} placeholder={thread.window.open ? "Type a reply (Enter to send)" : "Reply is closed until the candidate writes"} className="min-h-[44px] flex-1 resize-none rounded-lg border-0 bg-white px-3 py-2 text-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 disabled:cursor-not-allowed disabled:bg-slate-100" />
                <button type="button" onClick={() => void send()} disabled={!thread.window.open || sending || !text.trim()} className="flex h-11 w-11 cursor-pointer items-center justify-center rounded-full bg-[#00a884] text-white hover:bg-[#008f6f] disabled:cursor-not-allowed disabled:opacity-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-[#00a884] focus-visible:ring-offset-2" aria-label="Send reply"><Send className="h-5 w-5" aria-hidden /></button>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
