/**
 * WhatsApp Inbox — META Campaign Leads
 *
 * Exact WhatsApp visual design. Branch HR sees only their branch.
 * Admin / HR / Super Admin see all branches.
 * All API calls unchanged; only the presentation layer is redesigned.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { Check, CheckCheck, ChevronLeft, Paperclip, RefreshCcw, Search, Send, X } from "lucide-react";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { hrmsApi } from "@/lib/hrmsApi";

// ── types ─────────────────────────────────────────────────────────────────────

type Conversation = {
  leadId: string;
  parsedName: string | null;
  parsedPhone: string | null;
  screeningResult: string;
  branchName: string | null;
  designationName: string | null;
  campaignName: string | null;
  requisitionId: string | null;
  requisitionCode: string | null;
  lastMessageText: string | null;
  lastMessageAt: string | null;
  lastDirection: "inbound" | "outbound" | null;
  unreadCount: number;
};

type Message = {
  id: string;
  leadId: string;
  direction: "inbound" | "outbound";
  messageText: string;
  senderType: "system" | "hr" | "candidate";
  senderId: string | null;
  senderName: string | null;
  readAt: string | null;
  createdAt: string;
};

// ── helpers ───────────────────────────────────────────────────────────────────

function fmtTime(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const now = new Date();
  const isToday =
    d.getDate() === now.getDate() &&
    d.getMonth() === now.getMonth() &&
    d.getFullYear() === now.getFullYear();
  if (isToday) return d.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", hour12: true });
  return d.toLocaleDateString("en-IN", { day: "2-digit", month: "short" });
}

function fmtBubbleTime(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", hour12: true });
}

function fmtDateSeparator(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  const diff = Math.floor((now.getTime() - d.getTime()) / 86400000);
  if (diff === 0) return "Today";
  if (diff === 1) return "Yesterday";
  return d.toLocaleDateString("en-IN", { day: "2-digit", month: "long", year: "numeric" });
}

function initials(name: string | null): string {
  if (!name) return "?";
  return name.split(" ").filter(Boolean).slice(0, 2).map((w) => w[0]?.toUpperCase() ?? "").join("");
}

function avatarBg(name: string | null): string {
  const colors = [
    "bg-[#b39ddb]", "bg-[#80cbc4]", "bg-[#ef9a9a]", "bg-[#ffe082]",
    "bg-[#80deea]", "bg-[#a5d6a7]", "bg-[#ffab91]", "bg-[#90caf9]",
  ];
  if (!name) return colors[0];
  return colors[name.charCodeAt(0) % colors.length];
}

// Group messages by date for separator display
function groupByDate(messages: Message[]): Array<{ date: string; msgs: Message[] }> {
  const map = new Map<string, Message[]>();
  for (const m of messages) {
    const key = new Date(m.createdAt).toDateString();
    if (!map.has(key)) map.set(key, []);
    map.get(key)!.push(m);
  }
  return Array.from(map.entries()).map(([, msgs]) => ({ date: msgs[0].createdAt, msgs }));
}

// ── sub-components ────────────────────────────────────────────────────────────

function ConversationItem({ conv, selected, onClick }: {
  conv: Conversation; selected: boolean; onClick: () => void;
}) {
  const hasUnread = conv.unreadCount > 0;
  return (
    <button
      type="button"
      onClick={onClick}
      className={`w-full text-left transition-colors duration-100 ${selected ? "bg-[#f0f2f5]" : "hover:bg-[#f5f5f5]"}`}
    >
      <div className="flex items-center gap-3 px-3 py-3 border-b border-[#e9edef]">
        {/* Avatar */}
        <div className={`w-12 h-12 rounded-full ${avatarBg(conv.parsedName)} flex items-center justify-center text-white text-sm font-bold flex-shrink-0 uppercase`}>
          {initials(conv.parsedName)}
        </div>
        {/* Content */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center justify-between gap-1">
            <span className={`text-[15px] truncate ${hasUnread ? "font-bold text-[#111b21]" : "font-medium text-[#111b21]"}`}>
              {conv.parsedName ?? "Unknown"}
            </span>
            <span className={`text-[11px] flex-shrink-0 ${hasUnread ? "text-[#25d366] font-semibold" : "text-[#667781]"}`}>
              {fmtTime(conv.lastMessageAt)}
            </span>
          </div>
          <div className="flex items-center justify-between gap-1 mt-0.5">
            <div className="flex items-center gap-1 min-w-0">
              {conv.lastDirection === "outbound" && (
                <CheckCheck className="w-3.5 h-3.5 flex-shrink-0 text-[#53bdeb]" />
              )}
              <span className="text-[13px] text-[#667781] truncate">
                {conv.lastMessageText
                  ? conv.lastMessageText.length > 45
                    ? conv.lastMessageText.slice(0, 45) + "…"
                    : conv.lastMessageText
                  : <span className="italic opacity-60">No messages</span>}
              </span>
            </div>
            {hasUnread && (
              <span className="flex-shrink-0 min-w-[20px] h-5 rounded-full bg-[#25d366] text-white text-[11px] font-bold flex items-center justify-center px-1.5">
                {conv.unreadCount > 99 ? "99+" : conv.unreadCount}
              </span>
            )}
          </div>
          {(conv.branchName || conv.designationName) && (
            <div className="mt-0.5 text-[11px] text-[#8696a0] truncate">
              {[conv.designationName, conv.branchName].filter(Boolean).join(" · ")}
            </div>
          )}
        </div>
      </div>
    </button>
  );
}

function ChatBubble({ msg }: { msg: Message }) {
  const isOut = msg.direction === "outbound";
  const isSystem = msg.senderType === "system";

  if (isSystem) {
    return (
      <div className="flex justify-center my-1">
        <div className="bg-[#fff3cd] text-[#7d6608] text-[11px] px-3 py-1 rounded-full shadow-sm max-w-[80%] text-center">
          {msg.messageText}
        </div>
      </div>
    );
  }

  return (
    <div className={`flex ${isOut ? "justify-end" : "justify-start"} mb-1 px-3`}>
      <div
        className={`relative max-w-[65%] px-3 py-2 shadow-sm ${
          isOut
            ? "bg-[#d9fdd3] rounded-tl-xl rounded-bl-xl rounded-br-xl"
            : "bg-white rounded-tr-xl rounded-bl-xl rounded-br-xl"
        }`}
        style={{
          // WhatsApp message tail using CSS
          filter: "drop-shadow(0 1px 1px rgba(0,0,0,.08))",
        }}
      >
        {/* Sender label for HR messages */}
        {isOut && msg.senderName && (
          <div className="text-[11px] font-semibold text-[#25d366] mb-0.5 leading-none">
            {msg.senderName.split("@")[0]}
          </div>
        )}
        {/* Message text */}
        <p className="text-[14px] leading-[1.45] text-[#111b21] whitespace-pre-wrap break-words pr-10">
          {msg.messageText}
        </p>
        {/* Time + ticks */}
        <div className="absolute bottom-1.5 right-2 flex items-center gap-1">
          <span className="text-[10px] text-[#667781] leading-none">{fmtBubbleTime(msg.createdAt)}</span>
          {isOut && (
            msg.readAt
              ? <CheckCheck className="w-3.5 h-3.5 text-[#53bdeb]" />
              : <CheckCheck className="w-3.5 h-3.5 text-[#667781]" />
          )}
        </div>
      </div>
    </div>
  );
}

// ── main component ────────────────────────────────────────────────────────────

export function MetaWhatsAppInbox() {
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [search, setSearch] = useState("");
  const [loadingList, setLoadingList] = useState(true);
  // Load failures used to be swallowed, so a 403 looked exactly like an empty inbox.
  const [loadError, setLoadError] = useState<string | null>(null);

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [loadingThread, setLoadingThread] = useState(false);
  const [replyText, setReplyText] = useState("");
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);

  const [mobileView, setMobileView] = useState<"list" | "thread">("list");
  const [attachedFile, setAttachedFile] = useState<File | null>(null);
  const [sendingFile, setSendingFile] = useState(false);

  const [filterRequisitionId, setFilterRequisitionId] = useState<string | null>(null);
  const [requisitions, setRequisitions] = useState<Array<{ id: string; requisitionCode: string; designationName: string | null; branchName: string | null }>>([]);

  const threadEndRef = useRef<HTMLDivElement>(null);
  const refreshRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const selectedConv = conversations.find((c) => c.leadId === selectedId) ?? null;
  const totalUnread = conversations.reduce((s, c) => s + c.unreadCount, 0);

  // ── data fetching ─────────────────────────────────────────────────────────

  const fetchInbox = useCallback(async () => {
    try {
      const qp = new URLSearchParams();
      if (search) qp.set("search", search);
      if (filterRequisitionId) qp.set("requisitionId", filterRequisitionId);
      const qs = qp.toString() ? `?${qp.toString()}` : "";
      const res = await hrmsApi.get(`/api/meta/inbox${qs}`);
      setConversations(res.data ?? []);
      setLoadError(null);
    } catch (err: unknown) {
      setLoadError(err instanceof Error ? err.message : "Could not load conversations.");
    } finally {
      setLoadingList(false);
    }
  }, [search, filterRequisitionId]);

  const fetchThread = useCallback(async (leadId: string) => {
    setLoadingThread(true);
    try {
      const res = await hrmsApi.get(`/api/meta/leads/${leadId}/messages`);
      setMessages(res.data ?? []);
      setLoadError(null);
      // Only mark as read when the tab is actually visible — the 30s refresh runs in background
      // tabs too and would otherwise clear unread flags for messages nobody has seen.
      if (!document.hidden) {
        await hrmsApi.patch(`/api/meta/leads/${leadId}/messages/read`).catch(() => {});
        setConversations((prev) =>
          prev.map((c) => (c.leadId === leadId ? { ...c, unreadCount: 0 } : c))
        );
      }
    } catch (err: unknown) {
      setMessages([]);
      setLoadError(err instanceof Error ? err.message : "Could not load this conversation.");
    } finally { setLoadingThread(false); }
  }, []);

  useEffect(() => { void fetchInbox(); }, [fetchInbox]);

  useEffect(() => {
    hrmsApi
      .get<{ success: boolean; data: Array<{ id: string; requisition_code: string; designation_name: string | null; branch_name: string | null }> }>("/api/job-requisition?limit=100&approval_status=approved")
      .then((res) => {
        setRequisitions((res.data ?? []).map((r) => ({
          id: String(r.id),
          requisitionCode: r.requisition_code,
          designationName: r.designation_name ?? null,
          branchName: r.branch_name ?? null,
        })));
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    refreshRef.current = setInterval(() => {
      void fetchInbox();
      if (selectedId) void fetchThread(selectedId);
    }, 30000);
    return () => { if (refreshRef.current) clearInterval(refreshRef.current); };
  }, [fetchInbox, fetchThread, selectedId]);

  useEffect(() => {
    threadEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  // ── handlers ──────────────────────────────────────────────────────────────

  function handleSelectConversation(leadId: string) {
    setSelectedId(leadId);
    setReplyText("");
    setSendError(null);
    setMobileView("thread");
    void fetchThread(leadId);
  }

  async function handleSend() {
    if (!selectedId || !replyText.trim()) return;
    setSending(true);
    setSendError(null);
    try {
      await hrmsApi.post(`/api/meta/leads/${selectedId}/reply`, { message: replyText.trim() });
      setReplyText("");
      textareaRef.current?.focus();
      await fetchThread(selectedId);
      await fetchInbox();
    } catch (err: unknown) {
      const msg = err && typeof err === "object" && "response" in err
        ? (err as { response?: { data?: { message?: string } } }).response?.data?.message
        : undefined;
      setSendError(msg ?? "Failed to send. Try again.");
    } finally { setSending(false); }
  }

  async function handleSendFile(file: File) {
    if (!selectedId) return;
    setSendingFile(true);
    setSendError(null);
    try {
      const form = new FormData();
      form.append("file", file);
      if (replyText.trim()) form.append("caption", replyText.trim());
      // Use native fetch for multipart (hrmsApi.post doesn't handle FormData natively)
      const token = localStorage.getItem("hrms_access_token");
      const res = await fetch(`/api/meta/leads/${selectedId}/send-file`, {
        method: "POST",
        headers: token ? { Authorization: `Bearer ${token}` } : {},
        body: form,
      });
      if (!res.ok) {
        if (res.status === 401) throw new Error("Session expired — refresh the page and sign in again.");
        const err = await res.json().catch(() => ({ message: "Upload failed" }));
        throw new Error(err.message ?? "Upload failed");
      }
      setAttachedFile(null);
      setReplyText("");
      if (fileInputRef.current) fileInputRef.current.value = "";
      await fetchThread(selectedId);
      await fetchInbox();
    } catch (err: unknown) {
      setSendError(err instanceof Error ? err.message : "File send failed. Try again.");
    } finally { setSendingFile(false); }
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); void handleSend(); }
  }

  // ── render ────────────────────────────────────────────────────────────────

  const grouped = groupByDate(messages);

  return (
    <DashboardLayout>
      {/* Outer container — fill available height */}
      <div className="flex flex-col rounded-xl overflow-hidden border border-[#d1d7db] shadow-md" style={{ height: "calc(100vh - 110px)" }}>

        {/* ══ LEFT PANEL + RIGHT PANEL side by side ══ */}
        <div className="flex flex-1 min-h-0">

          {/* ══ LEFT: Conversation list ══ */}
          <div className={`flex flex-col bg-white border-r border-[#d1d7db] flex-shrink-0 w-full md:w-[360px] lg:w-[380px] ${mobileView === "thread" ? "hidden md:flex" : "flex"}`}>

            {/* WhatsApp-style header */}
            <div className="flex items-center justify-between px-4 py-3 bg-[#f0f2f5] border-b border-[#d1d7db] flex-shrink-0">
              <div className="flex items-center gap-2">
                <div className="w-9 h-9 rounded-full bg-[#dfe5e7] flex items-center justify-center text-[#54656f] text-xs font-bold">
                  HR
                </div>
                <div>
                  <div className="text-[15px] font-semibold text-[#111b21]">WhatsApp Inbox</div>
                  {totalUnread > 0 && (
                    <div className="text-[11px] text-[#25d366] font-semibold">{totalUnread} unread</div>
                  )}
                </div>
              </div>
              <button
                type="button"
                onClick={() => { setLoadingList(true); void fetchInbox(); }}
                className="p-2 rounded-full hover:bg-[#dfe5e7] text-[#54656f] transition-colors"
                title="Refresh"
              >
                <RefreshCcw className={`w-4 h-4 ${loadingList ? "animate-spin" : ""}`} />
              </button>
            </div>

            {/* JR filter */}
            <div className="bg-[#f0f2f5] border-b border-[#e9edef] px-3 py-2">
              <select
                value={filterRequisitionId ?? ""}
                onChange={(e) => {
                  const val = e.target.value;
                  setFilterRequisitionId(val || null);
                  setSelectedId(null);
                }}
                className="w-full text-sm bg-[#f0f2f5] border-0 outline-none text-[#111b21] rounded-lg px-2 py-1.5"
              >
                <option value="">All Requisitions</option>
                {requisitions.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.requisitionCode}{r.designationName ? ` — ${r.designationName}` : ""}{r.branchName ? ` · ${r.branchName}` : ""}
                  </option>
                ))}
              </select>
            </div>

            {/* Search bar */}
            <div className="px-2 py-2 bg-white border-b border-[#e9edef]">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[#54656f]" />
                <input
                  type="text"
                  placeholder="Search or start new chat"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="w-full pl-9 pr-8 py-1.5 text-[14px] rounded-lg bg-[#f0f2f5] border-0 outline-none placeholder-[#8696a0] text-[#111b21]"
                />
                {search && (
                  <button type="button" onClick={() => setSearch("")} className="absolute right-2 top-1/2 -translate-y-1/2 text-[#54656f]">
                    <X className="w-4 h-4" />
                  </button>
                )}
              </div>
            </div>

            {/* Conversation list */}
            <div className="flex-1 overflow-y-auto">
              {loadError && (
                <div role="alert" className="px-4 py-2 bg-rose-50 border-b border-rose-100 text-xs text-rose-600">
                  {loadError}
                </div>
              )}
              {loadingList && conversations.length === 0 ? (
                <div className="flex items-center justify-center h-32 text-[#8696a0] text-sm">Loading…</div>
              ) : conversations.length === 0 ? (
                <div className="flex flex-col items-center justify-center h-48 gap-3 text-[#8696a0]">
                  <div className="w-16 h-16 rounded-full bg-[#f0f2f5] flex items-center justify-center">
                    <svg viewBox="0 0 24 24" className="w-8 h-8 fill-[#8696a0]">
                      <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-1 14H9V8h2v8zm4 0h-2V8h2v8z" />
                    </svg>
                  </div>
                  <p className="text-[14px]">No conversations yet</p>
                  <p className="text-[12px] text-center px-6">
                    When candidates reply to your META campaign WhatsApp messages, they'll appear here.
                  </p>
                </div>
              ) : (
                conversations.map((conv) => (
                  <ConversationItem
                    key={conv.leadId}
                    conv={conv}
                    selected={selectedId === conv.leadId}
                    onClick={() => handleSelectConversation(conv.leadId)}
                  />
                ))
              )}
            </div>
          </div>

          {/* ══ RIGHT: Chat thread ══ */}
          <div className={`flex flex-col flex-1 min-w-0 ${mobileView === "list" ? "hidden md:flex" : "flex"}`}>
            {selectedConv ? (
              <>
                {/* Chat header — WhatsApp green */}
                <div className="flex items-center gap-3 px-3 py-2 bg-[#075e54] flex-shrink-0">
                  <button
                    type="button"
                    onClick={() => setMobileView("list")}
                    className="md:hidden p-1 text-white/80 hover:text-white"
                  >
                    <ChevronLeft className="w-5 h-5" />
                  </button>
                  <div className={`w-10 h-10 rounded-full ${avatarBg(selectedConv.parsedName)} flex items-center justify-center text-white text-sm font-bold flex-shrink-0 uppercase`}>
                    {initials(selectedConv.parsedName)}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-[15px] font-semibold text-white leading-tight truncate">
                      {selectedConv.parsedName ?? "Unknown Candidate"}
                    </div>
                    <div className="text-[12px] text-[#b2dfdb] truncate">
                      {selectedConv.parsedPhone ?? "no phone"}
                      {selectedConv.branchName ? ` · ${selectedConv.branchName}` : ""}
                      {selectedConv.designationName ? ` · ${selectedConv.designationName}` : ""}
                    </div>
                  </div>
                  <div>
                    {selectedConv.screeningResult === "qualified" && (
                      <span className="text-[10px] bg-[#25d366] text-white font-bold px-2 py-0.5 rounded-full">qualified</span>
                    )}
                    {selectedConv.screeningResult === "disqualified" && (
                      <span className="text-[10px] bg-rose-500 text-white font-bold px-2 py-0.5 rounded-full">disqualified</span>
                    )}
                  </div>
                </div>

                {/* Chat body — WhatsApp wallpaper bg */}
                <div
                  className="flex-1 overflow-y-auto py-3"
                  style={{
                    background: "#efeae2",
                    backgroundImage: `url("data:image/svg+xml,%3Csvg width='60' height='60' viewBox='0 0 60 60' xmlns='http://www.w3.org/2000/svg'%3E%3Cg fill='none' fill-rule='evenodd'%3E%3Cg fill='%23c9c3ba' fill-opacity='0.12'%3E%3Cpath d='M36 34v-4h-2v4h-4v2h4v4h2v-4h4v-2h-4zm0-30V0h-2v4h-4v2h4v4h2V6h4V4h-4zM6 34v-4H4v4H0v2h4v4h2v-4h4v-2H6zM6 4V0H4v4H0v2h4v4h2V6h4V4H6z'/%3E%3C/g%3E%3C/g%3E%3C/svg%3E")`,
                  }}
                >
                  {loadingThread ? (
                    <div className="flex items-center justify-center h-32">
                      <div className="w-6 h-6 border-2 border-[#25d366] border-t-transparent rounded-full animate-spin" />
                    </div>
                  ) : messages.length === 0 ? (
                    <div className="flex justify-center mt-8">
                      <div className="bg-[#fffeee] border border-[#e8e8a0] text-[#5c5c00] text-[12px] px-4 py-2 rounded-lg max-w-xs text-center shadow-sm">
                        No messages yet. Send a WhatsApp shortlist notification to start the conversation.
                      </div>
                    </div>
                  ) : (
                    grouped.map(({ date, msgs }) => (
                      <div key={date}>
                        {/* Date separator */}
                        <div className="flex justify-center my-3">
                          <span className="bg-[#e1f3fb] text-[#54656f] text-[11px] font-medium px-3 py-1 rounded-full shadow-sm">
                            {fmtDateSeparator(date)}
                          </span>
                        </div>
                        {msgs.map((msg) => (
                          <ChatBubble key={msg.id} msg={msg} />
                        ))}
                      </div>
                    ))
                  )}
                  <div ref={threadEndRef} />
                </div>

                {/* Reply input bar */}
                <div className="flex-shrink-0 bg-[#f0f2f5] border-t border-[#d1d7db]">
                  {sendError && (
                    <div className="px-4 py-1.5 bg-rose-50 border-b border-rose-100 text-xs text-rose-600 flex items-center justify-between">
                      <span>{sendError}</span>
                      <button type="button" onClick={() => setSendError(null)} className="text-rose-400 hover:text-rose-600">×</button>
                    </div>
                  )}
                  {/* File preview strip */}
                  {attachedFile && (
                    <div className="flex items-center gap-2 px-4 py-2 bg-[#e7f3ef] border-b border-[#d1d7db]">
                      <Paperclip className="w-4 h-4 text-[#00a884] flex-shrink-0" />
                      <span className="text-[13px] text-[#111b21] truncate flex-1">{attachedFile.name}</span>
                      <span className="text-[11px] text-[#667781]">
                        {(attachedFile.size / 1024 / 1024).toFixed(1)} MB
                      </span>
                      <button
                        type="button"
                        onClick={() => { setAttachedFile(null); if (fileInputRef.current) fileInputRef.current.value = ""; }}
                        className="text-[#667781] hover:text-rose-500"
                      >
                        <X className="w-4 h-4" />
                      </button>
                    </div>
                  )}
                  {/* Hidden file input */}
                  <input
                    ref={fileInputRef}
                    type="file"
                    className="hidden"
                    accept="image/*,.pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt,.csv"
                    onChange={(e) => {
                      const f = e.target.files?.[0];
                      if (f) setAttachedFile(f);
                    }}
                  />
                  <div className="flex items-end gap-2 px-3 py-2">
                    {/* Attachment button */}
                    <button
                      type="button"
                      onClick={() => fileInputRef.current?.click()}
                      className="w-10 h-10 rounded-full flex items-center justify-center text-[#54656f] hover:bg-[#dfe5e7] flex-shrink-0 transition-colors"
                      title="Attach file (PDF, image, document)"
                    >
                      <Paperclip className="w-5 h-5" />
                    </button>
                    <div className="flex-1 bg-white rounded-[22px] px-4 py-2 shadow-sm min-h-[44px] flex items-end">
                      <textarea
                        ref={textareaRef}
                        rows={1}
                        value={replyText}
                        onChange={(e) => setReplyText(e.target.value)}
                        onKeyDown={handleKeyDown}
                        placeholder={attachedFile ? "Add a caption (optional)" : "Type a message"}
                        className="w-full resize-none outline-none text-[14px] text-[#111b21] placeholder-[#8696a0] leading-snug max-h-32 overflow-y-auto bg-transparent"
                        style={{ lineHeight: "1.4" }}
                      />
                    </div>
                    <button
                      type="button"
                      onClick={() => {
                        if (attachedFile) void handleSendFile(attachedFile);
                        else void handleSend();
                      }}
                      disabled={(!replyText.trim() && !attachedFile) || sending || sendingFile}
                      className="w-11 h-11 rounded-full bg-[#00a884] flex items-center justify-center text-white flex-shrink-0 shadow-md hover:bg-[#008f72] disabled:bg-[#ccc] disabled:cursor-not-allowed transition-colors"
                    >
                      {sending || sendingFile ? (
                        <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                      ) : (
                        <Send className="w-4 h-4" />
                      )}
                    </button>
                  </div>
                  <p className="text-center text-[10px] text-[#8696a0] pb-1">
                    Enter to send · Shift+Enter for new line · 📎 Max 20 MB · Delivered via Wassenger
                  </p>
                </div>
              </>
            ) : (
              /* Empty state — no conversation selected */
              <div
                className="flex flex-col items-center justify-center flex-1"
                style={{ background: "#f0f2f5" }}
              >
                <div className="flex flex-col items-center gap-4 max-w-xs text-center">
                  <div className="w-24 h-24 rounded-full bg-[#dfe5e7] flex items-center justify-center">
                    <svg viewBox="0 0 212 212" className="w-14 h-14 fill-[#8696a0]">
                      <path d="M106.005 8C52.813 8 9.5 51.296 9.5 104.505c0 18.328 4.978 35.502 13.684 50.224L8.5 203.5l50.022-14.43c14.214 8.127 30.593 12.835 48.021 12.835 53.188 0 96.5-43.296 96.5-96.4C202.5 52.28 159.2 8 106.005 8z" opacity=".08"/>
                    </svg>
                  </div>
                  <h2 className="text-[22px] font-light text-[#41525d]">WhatsApp Inbox</h2>
                  <p className="text-[14px] text-[#667781]">
                    Select a conversation from the left to read messages and reply to candidates.
                  </p>
                  <p className="text-[12px] text-[#8696a0]">
                    Branch HR sees conversations from their branch only. Messages are sent and received via Wassenger.
                  </p>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </DashboardLayout>
  );
}

export default MetaWhatsAppInbox;
