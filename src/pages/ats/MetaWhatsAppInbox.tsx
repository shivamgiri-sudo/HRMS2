/**
 * WhatsApp Inbox — META Campaign Leads
 *
 * Branch HR sees conversations from their branch only.
 * Admin / HR / Super Admin see all branches.
 *
 * Split-panel: conversation list on left, chat thread on right.
 * Auto-refreshes every 30 seconds.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import {
  MessageCircle,
  RefreshCcw,
  Search,
  Send,
  User,
  PhoneCall,
  X,
  ChevronLeft,
} from "lucide-react";
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
  if (isToday) {
    return d.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" });
  }
  return d.toLocaleDateString("en-IN", { day: "2-digit", month: "short" });
}

function fmtFull(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function initials(name: string | null): string {
  if (!name) return "?";
  return name
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? "")
    .join("");
}

const SCREENING_COLOR: Record<string, string> = {
  qualified: "bg-emerald-100 text-emerald-700",
  disqualified: "bg-rose-100 text-rose-700",
  pending: "bg-amber-100 text-amber-700",
};

// ── sub-components ────────────────────────────────────────────────────────────

function ConversationItem({
  conv,
  selected,
  onClick,
}: {
  conv: Conversation;
  selected: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`w-full text-left px-4 py-3 border-b border-slate-100 hover:bg-blue-50 transition-colors duration-150 ${
        selected ? "bg-blue-50 border-l-4 border-l-blue-600" : ""
      }`}
    >
      <div className="flex items-start gap-3">
        <div className="w-10 h-10 rounded-full bg-gradient-to-br from-blue-500 to-indigo-600 flex items-center justify-center text-white text-sm font-bold flex-shrink-0">
          {initials(conv.parsedName)}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center justify-between gap-2">
            <span className="font-semibold text-slate-800 text-sm truncate">
              {conv.parsedName ?? "Unknown Candidate"}
            </span>
            <span className="text-xs text-slate-400 flex-shrink-0">
              {fmtTime(conv.lastMessageAt)}
            </span>
          </div>
          <div className="flex items-center justify-between gap-2 mt-0.5">
            <span className="text-xs text-slate-500 truncate">
              {conv.lastDirection === "outbound" && (
                <span className="text-slate-400 mr-1">You:</span>
              )}
              {conv.lastMessageText ?? "No messages yet"}
            </span>
            {conv.unreadCount > 0 && (
              <span className="bg-blue-600 text-white text-xs font-bold rounded-full px-1.5 py-0.5 flex-shrink-0 min-w-[20px] text-center">
                {conv.unreadCount}
              </span>
            )}
          </div>
          <div className="flex items-center gap-2 mt-1">
            {conv.branchName && (
              <span className="text-xs text-slate-400">{conv.branchName}</span>
            )}
            {conv.designationName && (
              <>
                <span className="text-slate-300">·</span>
                <span className="text-xs text-slate-400 truncate">{conv.designationName}</span>
              </>
            )}
          </div>
        </div>
      </div>
    </button>
  );
}

function ChatBubble({ msg }: { msg: Message }) {
  const isOut = msg.direction === "outbound";
  const label =
    msg.senderType === "system"
      ? "System"
      : msg.senderType === "hr"
      ? msg.senderName ?? "HR"
      : "Candidate";

  return (
    <div className={`flex ${isOut ? "justify-end" : "justify-start"} mb-2`}>
      <div className={`max-w-[75%] ${isOut ? "items-end" : "items-start"} flex flex-col`}>
        <span className="text-xs text-slate-400 mb-1 px-1">{label}</span>
        <div
          className={`px-4 py-2.5 rounded-2xl text-sm leading-relaxed whitespace-pre-wrap shadow-sm ${
            isOut
              ? "bg-blue-600 text-white rounded-tr-sm"
              : "bg-white border border-slate-200 text-slate-800 rounded-tl-sm"
          }`}
        >
          {msg.messageText}
        </div>
        <span className="text-xs text-slate-400 mt-1 px-1">{fmtFull(msg.createdAt)}</span>
      </div>
    </div>
  );
}

// ── main component ────────────────────────────────────────────────────────────

export function MetaWhatsAppInbox() {
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [search, setSearch] = useState("");
  const [loadingList, setLoadingList] = useState(true);

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [loadingThread, setLoadingThread] = useState(false);
  const [replyText, setReplyText] = useState("");
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);

  // Mobile: show list or thread
  const [mobileView, setMobileView] = useState<"list" | "thread">("list");

  const threadEndRef = useRef<HTMLDivElement>(null);
  const refreshRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const selectedConv = conversations.find((c) => c.leadId === selectedId) ?? null;

  // ── data fetching ────────────────────────────────────────────────────────

  const fetchInbox = useCallback(async () => {
    try {
      const params = search ? `?search=${encodeURIComponent(search)}` : "";
      const res = await hrmsApi.get(`/meta/inbox${params}`);
      setConversations(res.data.data ?? []);
    } catch {
      // silent — keep stale data
    } finally {
      setLoadingList(false);
    }
  }, [search]);

  const fetchThread = useCallback(async (leadId: string) => {
    setLoadingThread(true);
    try {
      const res = await hrmsApi.get(`/meta/leads/${leadId}/messages`);
      setMessages(res.data.data ?? []);
      // mark read
      await hrmsApi.patch(`/meta/leads/${leadId}/messages/read`).catch(() => {});
      // update unread count locally
      setConversations((prev) =>
        prev.map((c) => (c.leadId === leadId ? { ...c, unreadCount: 0 } : c))
      );
    } catch {
      setMessages([]);
    } finally {
      setLoadingThread(false);
    }
  }, []);

  // Initial load
  useEffect(() => {
    void fetchInbox();
  }, [fetchInbox]);

  // Auto-refresh every 30s
  useEffect(() => {
    refreshRef.current = setInterval(() => {
      void fetchInbox();
      if (selectedId) void fetchThread(selectedId);
    }, 30000);
    return () => {
      if (refreshRef.current) clearInterval(refreshRef.current);
    };
  }, [fetchInbox, fetchThread, selectedId]);

  // Scroll to bottom when thread loads
  useEffect(() => {
    threadEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  // ── handlers ────────────────────────────────────────────────────────────

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
      await hrmsApi.post(`/meta/leads/${selectedId}/reply`, { message: replyText.trim() });
      setReplyText("");
      await fetchThread(selectedId);
      await fetchInbox();
    } catch (err: unknown) {
      const msg =
        err && typeof err === "object" && "response" in err
          ? (err as { response?: { data?: { message?: string } } }).response?.data?.message
          : undefined;
      setSendError(msg ?? "Failed to send. Please try again.");
    } finally {
      setSending(false);
    }
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      void handleSend();
    }
  }

  // ── render ───────────────────────────────────────────────────────────────

  return (
    <DashboardLayout title="WhatsApp Inbox" subtitle="META campaign candidate conversations">
      <div className="flex flex-col h-[calc(100vh-130px)] bg-slate-50">
        {/* Header bar */}
        <div className="flex items-center justify-between px-4 py-3 bg-white border-b border-slate-200 flex-shrink-0">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg bg-emerald-500 flex items-center justify-center">
              <MessageCircle className="w-4 h-4 text-white" />
            </div>
            <div>
              <h1 className="font-bold text-slate-800 text-base leading-tight">WhatsApp Inbox</h1>
              <p className="text-xs text-slate-500">META campaign candidate conversations</p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => { setLoadingList(true); void fetchInbox(); }}
            className="p-2 rounded-lg hover:bg-slate-100 text-slate-500 transition-colors"
            title="Refresh"
          >
            <RefreshCcw className={`w-4 h-4 ${loadingList ? "animate-spin" : ""}`} />
          </button>
        </div>

        {/* Body */}
        <div className="flex flex-1 min-h-0">
          {/* ── Conversation List ── */}
          <div
            className={`flex flex-col border-r border-slate-200 bg-white ${
              mobileView === "thread" ? "hidden md:flex" : "flex"
            } w-full md:w-80 lg:w-96 flex-shrink-0`}
          >
            {/* Search */}
            <div className="p-3 border-b border-slate-100">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                <input
                  type="text"
                  placeholder="Search name or phone…"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="w-full pl-9 pr-3 py-2 text-sm rounded-lg border border-slate-200 bg-slate-50 focus:outline-none focus:ring-2 focus:ring-blue-200 focus:border-blue-400"
                />
                {search && (
                  <button
                    type="button"
                    onClick={() => setSearch("")}
                    className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
                  >
                    <X className="w-4 h-4" />
                  </button>
                )}
              </div>
            </div>

            {/* List */}
            <div className="flex-1 overflow-y-auto">
              {loadingList && conversations.length === 0 ? (
                <div className="flex items-center justify-center h-40 text-slate-400 text-sm">
                  Loading…
                </div>
              ) : conversations.length === 0 ? (
                <div className="flex flex-col items-center justify-center h-40 text-slate-400 gap-2">
                  <MessageCircle className="w-8 h-8 opacity-30" />
                  <span className="text-sm">No conversations yet</span>
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

          {/* ── Thread Panel ── */}
          <div
            className={`flex flex-col flex-1 min-w-0 ${
              mobileView === "list" ? "hidden md:flex" : "flex"
            }`}
          >
            {selectedConv ? (
              <>
                {/* Thread header */}
                <div className="flex items-center gap-3 px-4 py-3 bg-white border-b border-slate-200 flex-shrink-0">
                  {/* Back button — mobile only */}
                  <button
                    type="button"
                    onClick={() => setMobileView("list")}
                    className="md:hidden p-1 rounded text-slate-500 hover:bg-slate-100"
                  >
                    <ChevronLeft className="w-5 h-5" />
                  </button>
                  <div className="w-9 h-9 rounded-full bg-gradient-to-br from-blue-500 to-indigo-600 flex items-center justify-center text-white text-sm font-bold flex-shrink-0">
                    {initials(selectedConv.parsedName)}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="font-semibold text-slate-800 text-sm truncate">
                      {selectedConv.parsedName ?? "Unknown Candidate"}
                    </p>
                    <div className="flex items-center gap-2 flex-wrap">
                      {selectedConv.parsedPhone && (
                        <span className="flex items-center gap-1 text-xs text-slate-500">
                          <PhoneCall className="w-3 h-3" />
                          {selectedConv.parsedPhone}
                        </span>
                      )}
                      {selectedConv.branchName && (
                        <span className="text-xs text-slate-400">{selectedConv.branchName}</span>
                      )}
                      {selectedConv.screeningResult && (
                        <span
                          className={`text-xs font-semibold px-2 py-0.5 rounded-full ${
                            SCREENING_COLOR[selectedConv.screeningResult] ?? "bg-slate-100 text-slate-600"
                          }`}
                        >
                          {selectedConv.screeningResult}
                        </span>
                      )}
                    </div>
                  </div>
                </div>

                {/* Messages */}
                <div className="flex-1 overflow-y-auto px-4 py-4 bg-slate-50">
                  {loadingThread ? (
                    <div className="flex items-center justify-center h-32 text-slate-400 text-sm">
                      Loading…
                    </div>
                  ) : messages.length === 0 ? (
                    <div className="flex flex-col items-center justify-center h-32 text-slate-400 gap-2">
                      <MessageCircle className="w-8 h-8 opacity-30" />
                      <span className="text-sm">No messages yet</span>
                    </div>
                  ) : (
                    messages.map((msg) => <ChatBubble key={msg.id} msg={msg} />)
                  )}
                  <div ref={threadEndRef} />
                </div>

                {/* Reply box */}
                <div className="border-t border-slate-200 bg-white p-3 flex-shrink-0">
                  {sendError && (
                    <p className="text-xs text-rose-500 mb-2 px-1">{sendError}</p>
                  )}
                  <div className="flex items-end gap-2">
                    <textarea
                      value={replyText}
                      onChange={(e) => setReplyText(e.target.value)}
                      onKeyDown={handleKeyDown}
                      placeholder="Type a message… (Enter to send, Shift+Enter for new line)"
                      rows={2}
                      className="flex-1 resize-none text-sm px-3 py-2 rounded-xl border border-slate-200 bg-slate-50 focus:outline-none focus:ring-2 focus:ring-blue-200 focus:border-blue-400 placeholder-slate-400"
                    />
                    <button
                      type="button"
                      onClick={() => void handleSend()}
                      disabled={!replyText.trim() || sending}
                      className="flex-shrink-0 w-10 h-10 rounded-xl bg-blue-600 hover:bg-blue-700 disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center text-white transition-colors shadow-sm"
                    >
                      <Send className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              </>
            ) : (
              <div className="flex-1 flex flex-col items-center justify-center text-slate-400 gap-3 bg-slate-50">
                <div className="w-16 h-16 rounded-full bg-slate-100 flex items-center justify-center">
                  <MessageCircle className="w-8 h-8 opacity-40" />
                </div>
                <div className="text-center">
                  <p className="font-medium text-slate-500">Select a conversation</p>
                  <p className="text-sm text-slate-400 mt-1">
                    Choose a candidate from the left to view their messages
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
