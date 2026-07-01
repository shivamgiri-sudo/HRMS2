import { useEffect, useState } from "react";
import {
  AlertTriangle, ArrowLeft, EyeOff, Loader,
  MessageSquare, Plus, RefreshCcw, Search, X,
} from "lucide-react";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { hrmsApi } from "@/lib/hrmsApi";
import { StatusBadge as SmartHRStatusBadge, normalizeStatus } from "@/components/ui/status-badge";

// ─── Types ────────────────────────────────────────────────────────────────────

type Ticket = {
  id: string;
  ticket_number?: string;
  category: string;
  subject: string;
  description: string;
  priority: "low" | "medium" | "high" | "urgent";
  status: "open" | "in_progress" | "resolved" | "closed";
  assigned_to?: string;
  assigned_name?: string;
  created_by?: string;
  created_at: string;
  updated_at?: string;
};

type Comment = {
  id: string;
  text: string;
  is_internal: boolean;
  created_by?: string;
  author_name?: string;
  created_at: string;
};

type TicketDetail = Ticket & { comments?: Comment[] };

type Grievance = {
  id: string;
  subject: string;
  description: string;
  grievance_type: string;
  status: string;
  is_anonymous: boolean;
  created_at: string;
};

type TicketForm = {
  category: string;
  subject: string;
  description: string;
  priority: string;
};

type GrievanceForm = {
  subject: string;
  description: string;
  grievance_type: string;
  severity: string;
  is_anonymous: boolean;
};

// ─── Badge helpers ────────────────────────────────────────────────────────────

const PRIORITY_STYLES: Record<string, string> = {
  low:    "bg-slate-100 text-slate-600",
  medium: "bg-blue-50 text-blue-700",
  high:   "bg-amber-50 text-amber-700",
  urgent: "bg-red-50 text-red-700",
};

const STATUS_STYLES: Record<string, string> = {
  open:        "bg-emerald-50 text-emerald-700",
  in_progress: "bg-amber-50 text-amber-700",
  resolved:    "bg-blue-50 text-blue-700",
  closed:      "bg-slate-100 text-slate-500",
  pending:     "bg-violet-50 text-violet-700",
  under_review:"bg-orange-50 text-orange-700",
};

function PriorityBadge({ priority }: { priority: string }) {
  const cls = PRIORITY_STYLES[priority] ?? "bg-slate-100 text-slate-600";
  return <span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold capitalize ${cls}`}>{priority}</span>;
}

function StatusBadge({ status }: { status: string }) {
  const statusMap: Record<string, string> = {
    open: "in_progress",
    in_progress: "in_progress",
    resolved: "success",
    closed: "cancelled",
    pending: "pending",
    under_review: "warning",
  };

  return (
    <SmartHRStatusBadge
      status={normalizeStatus(statusMap[status] || status)}
      label={status.replace(/_/g, " ")}
    />
  );
}

const inputCls = "w-full rounded-2xl border px-4 py-3 text-sm outline-none focus:border-blue-400 transition-colors";

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-sm font-semibold text-slate-700 mb-1.5">{label}</label>
      {children}
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

type Tab = "tickets" | "grievances";

export default function NativeHelpdesk() {
  const [tab, setTab] = useState<Tab>("tickets");
  const [message, setMessage] = useState("");

  // ── Tickets state ────────────────────────────────────────────────────────────

  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [ticketsLoading, setTicketsLoading] = useState(false);
  const [ticketSearch, setTicketSearch] = useState("");
  const [selectedTicket, setSelectedTicket] = useState<TicketDetail | null>(null);
  const [ticketDetailLoading, setTicketDetailLoading] = useState(false);

  const [showRaiseTicket, setShowRaiseTicket] = useState(false);
  const [ticketForm, setTicketForm] = useState<TicketForm>({ category: "IT", subject: "", description: "", priority: "medium" });
  const [ticketBusy, setTicketBusy] = useState(false);

  const [commentText, setCommentText] = useState("");
  const [commentBusy, setCommentBusy] = useState(false);

  // ── Grievances state ─────────────────────────────────────────────────────────

  const [grievances, setGrievances] = useState<Grievance[]>([]);
  const [grievancesLoading, setGrievancesLoading] = useState(false);

  const [showRaiseGrievance, setShowRaiseGrievance] = useState(false);
  const [grievanceForm, setGrievanceForm] = useState<GrievanceForm>({
    subject: "", description: "", grievance_type: "workplace", severity: "medium", is_anonymous: false,
  });
  const [grievanceBusy, setGrievanceBusy] = useState(false);

  // ── Loaders ──────────────────────────────────────────────────────────────────

  const loadTickets = async () => {
    setTicketsLoading(true);
    setMessage("");
    try {
      const res = await hrmsApi.get<{ success: boolean; data: Ticket[] }>("/api/helpdesk/tickets");
      setTickets(res.data ?? []);
    } catch (err: unknown) {
      setMessage(err instanceof Error ? err.message : "Failed to load tickets");
    } finally {
      setTicketsLoading(false);
    }
  };

  const loadTicketDetail = async (id: string) => {
    setTicketDetailLoading(true);
    try {
      const res = await hrmsApi.get<{ success: boolean; data: TicketDetail }>(`/api/helpdesk/tickets/${id}`);
      setSelectedTicket(res.data);
    } catch (err: unknown) {
      setMessage(err instanceof Error ? err.message : "Failed to load ticket");
    } finally {
      setTicketDetailLoading(false);
    }
  };

  const loadGrievances = async () => {
    setGrievancesLoading(true);
    setMessage("");
    try {
      const res = await hrmsApi.get<{ success: boolean; data: Grievance[] }>("/api/helpdesk/grievances");
      setGrievances(res.data ?? []);
    } catch (err: unknown) {
      setMessage(err instanceof Error ? err.message : "Failed to load grievances");
    } finally {
      setGrievancesLoading(false);
    }
  };

  useEffect(() => {
    if (tab === "tickets") void loadTickets();
    else void loadGrievances();
  }, [tab]);

  // ── Actions ──────────────────────────────────────────────────────────────────

  const submitTicket = async () => {
    if (!ticketForm.subject.trim() || !ticketForm.description.trim()) {
      return setMessage("Subject and description are required.");
    }
    setTicketBusy(true);
    try {
      await hrmsApi.post("/api/helpdesk/tickets", ticketForm);
      setShowRaiseTicket(false);
      setTicketForm({ category: "IT", subject: "", description: "", priority: "medium" });
      setMessage("Ticket raised successfully.");
      await loadTickets();
    } catch (err: unknown) {
      setMessage(err instanceof Error ? err.message : "Failed to raise ticket.");
    } finally {
      setTicketBusy(false);
    }
  };

  const submitComment = async () => {
    if (!selectedTicket || !commentText.trim()) return;
    setCommentBusy(true);
    try {
      await hrmsApi.post(`/api/helpdesk/tickets/${selectedTicket.id}/comments`, {
        text: commentText.trim(),
        is_internal: false,
      });
      setCommentText("");
      await loadTicketDetail(selectedTicket.id);
    } catch (err: unknown) {
      setMessage(err instanceof Error ? err.message : "Failed to add comment.");
    } finally {
      setCommentBusy(false);
    }
  };

  const submitGrievance = async () => {
    if (!grievanceForm.subject.trim() || !grievanceForm.description.trim()) {
      return setMessage("Subject and description are required.");
    }
    setGrievanceBusy(true);
    try {
      await hrmsApi.post("/api/helpdesk/grievances", grievanceForm);
      setShowRaiseGrievance(false);
      setGrievanceForm({ subject: "", description: "", grievance_type: "workplace", severity: "medium", is_anonymous: false });
      setMessage("Grievance submitted.");
      await loadGrievances();
    } catch (err: unknown) {
      setMessage(err instanceof Error ? err.message : "Failed to submit grievance.");
    } finally {
      setGrievanceBusy(false);
    }
  };

  // ── Filtered ─────────────────────────────────────────────────────────────────

  const filteredTickets = tickets.filter((t) => {
    const q = ticketSearch.trim().toLowerCase();
    const text = [t.subject, t.category, t.status, t.priority, t.ticket_number].join(" ").toLowerCase();
    return !q || text.includes(q);
  });

  // ── Render ───────────────────────────────────────────────────────────────────

  return (
    <DashboardLayout>
      <div className="space-y-6">

        {/* Header */}
        <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <p className="text-sm font-black uppercase tracking-[0.2em] text-blue-600">Support</p>
            <h1 className="mt-2 text-3xl font-black text-slate-950">Helpdesk</h1>
            <p className="mt-2 max-w-4xl text-slate-600">
              Raise and track support tickets, and submit grievances.
            </p>
          </div>
          <div className="flex items-center gap-3">
            <button
              onClick={() => void (tab === "tickets" ? loadTickets() : loadGrievances())}
              className="inline-flex items-center gap-2 rounded-2xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 shadow-sm hover:bg-slate-50 transition-colors cursor-pointer"
            >
              <RefreshCcw className="h-4 w-4" />
              Refresh
            </button>
            {tab === "tickets" ? (
              <button
                onClick={() => { setShowRaiseTicket(true); setMessage(""); }}
                className="inline-flex items-center gap-2 rounded-2xl bg-slate-950 px-5 py-2.5 text-sm font-bold text-white hover:bg-slate-800 transition-colors cursor-pointer"
              >
                <Plus className="h-4 w-4" />
                Raise Ticket
              </button>
            ) : (
              <button
                onClick={() => { setShowRaiseGrievance(true); setMessage(""); }}
                className="inline-flex items-center gap-2 rounded-2xl bg-slate-950 px-5 py-2.5 text-sm font-bold text-white hover:bg-slate-800 transition-colors cursor-pointer"
              >
                <Plus className="h-4 w-4" />
                Raise Grievance
              </button>
            )}
          </div>
        </div>

        {/* Message */}
        {message && (
          <div className="flex items-center gap-3 rounded-2xl border border-blue-200 bg-blue-50 p-4 text-sm font-bold text-blue-800">
            <AlertTriangle className="h-4 w-4 flex-shrink-0" />
            {message}
          </div>
        )}

        {/* Tab switcher */}
        <div className="flex gap-1 rounded-2xl border bg-slate-50 p-1 w-fit">
          {(["tickets", "grievances"] as Tab[]).map((t) => (
            <button
              key={t}
              onClick={() => { setTab(t); setSelectedTicket(null); setMessage(""); }}
              className={`rounded-xl px-5 py-2 text-sm font-bold capitalize cursor-pointer transition-colors ${tab === t ? "bg-white text-slate-950 shadow-sm" : "text-slate-500 hover:text-slate-700"}`}
            >
              {t}
            </button>
          ))}
        </div>

        {/* ── Ticket Detail View ──────────────────────────────────────────────── */}
        {tab === "tickets" && selectedTicket ? (
          <div className="space-y-4">
            <button
              onClick={() => setSelectedTicket(null)}
              className="inline-flex items-center gap-2 text-sm font-semibold text-slate-600 hover:text-slate-900 cursor-pointer transition-colors"
            >
              <ArrowLeft className="h-4 w-4" />
              Back to Tickets
            </button>

            {ticketDetailLoading ? (
              <div className="flex items-center justify-center py-16">
                <Loader className="h-8 w-8 animate-spin text-slate-400" />
              </div>
            ) : (
              <div className="rounded-3xl border bg-white shadow-sm">
                {/* Ticket header */}
                <div className="border-b p-6">
                  <div className="flex flex-wrap items-start justify-between gap-4">
                    <div>
                      <div className="flex items-center gap-3 mb-1">
                        {selectedTicket.ticket_number && (
                          <span className="font-mono text-xs font-bold text-slate-400">#{selectedTicket.ticket_number}</span>
                        )}
                        <PriorityBadge priority={selectedTicket.priority} />
                        <StatusBadge status={selectedTicket.status} />
                      </div>
                      <h2 className="text-xl font-black text-slate-950">{selectedTicket.subject}</h2>
                      <p className="text-sm text-slate-500 mt-1">
                        {selectedTicket.category} · {selectedTicket.created_at?.slice(0, 10)}
                        {selectedTicket.assigned_name && ` · Assigned to: ${selectedTicket.assigned_name}`}
                      </p>
                    </div>
                  </div>
                  <p className="mt-4 text-sm text-slate-700 leading-relaxed">{selectedTicket.description}</p>
                </div>

                {/* Comments */}
                <div className="p-6 space-y-4">
                  <h3 className="font-black text-slate-950">Comments ({selectedTicket.comments?.length ?? 0})</h3>
                  {(selectedTicket.comments ?? []).length === 0 ? (
                    <p className="text-sm text-slate-400">No comments yet.</p>
                  ) : (
                    <div className="space-y-3">
                      {(selectedTicket.comments ?? []).map((c) => (
                        <div key={c.id} className={`rounded-2xl p-4 text-sm ${c.is_internal ? "bg-amber-50 border border-amber-100" : "bg-slate-50"}`}>
                          <div className="flex items-center justify-between mb-1.5">
                            <span className="font-bold text-slate-800">{c.author_name ?? "Agent"}</span>
                            <div className="flex items-center gap-2">
                              {c.is_internal && (
                                <span className="text-xs font-semibold text-amber-600 flex items-center gap-1">
                                  <EyeOff className="h-3 w-3" /> Internal
                                </span>
                              )}
                              <span className="text-xs text-slate-400 font-mono">{c.created_at?.slice(0, 16)}</span>
                            </div>
                          </div>
                          <p className="text-slate-700">{c.text}</p>
                        </div>
                      ))}
                    </div>
                  )}

                  {/* Add comment */}
                  <div className="rounded-2xl border p-4 space-y-3">
                    <h4 className="font-bold text-slate-800 text-sm">Add Comment</h4>
                    <textarea
                      value={commentText}
                      onChange={(e) => setCommentText(e.target.value)}
                      rows={3}
                      placeholder="Write your comment…"
                      className={`${inputCls} resize-none`}
                    />
                    <button
                      onClick={() => void submitComment()}
                      disabled={commentBusy || !commentText.trim()}
                      className="inline-flex items-center gap-2 rounded-2xl bg-slate-950 px-5 py-2.5 text-sm font-bold text-white hover:bg-slate-800 transition-colors cursor-pointer disabled:opacity-50"
                    >
                      <MessageSquare className="h-4 w-4" />
                      {commentBusy ? "Posting…" : "Post Comment"}
                    </button>
                  </div>
                </div>
              </div>
            )}
          </div>

        ) : tab === "tickets" ? (
          /* ── Tickets List ─────────────────────────────────────────────────── */
          <div className="space-y-4">
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <input
                value={ticketSearch}
                onChange={(e) => setTicketSearch(e.target.value)}
                placeholder="Search subject, category, status…"
                className="h-11 w-full rounded-2xl border bg-white pl-10 pr-4 text-sm outline-none focus:border-blue-400 transition-colors shadow-sm"
              />
            </div>
            <div className="overflow-hidden rounded-3xl border bg-white shadow-sm">
              <div className="border-b p-5">
                <h2 className="font-black text-slate-950">Support Tickets</h2>
                <p className="text-sm text-slate-500">{filteredTickets.length} tickets</p>
              </div>
              {ticketsLoading ? (
                <div className="flex items-center justify-center py-16">
                  <Loader className="h-8 w-8 animate-spin text-slate-400" />
                </div>
              ) : filteredTickets.length === 0 ? (
                <div className="py-16 text-center text-slate-400">
                  <MessageSquare className="mx-auto mb-3 h-10 w-10 opacity-30" />
                  <p className="font-semibold">No tickets found.</p>
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[700px] text-sm">
                    <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
                      <tr>
                        {["Ticket", "Category", "Priority", "Status", "Assigned To", "Raised On", ""].map((h) => (
                          <th key={h} className="p-4 font-semibold">{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {filteredTickets.map((t) => (
                        <tr
                          key={t.id}
                          onClick={() => { void loadTicketDetail(t.id); }}
                          className="border-t hover:bg-slate-50/80 transition-colors cursor-pointer"
                        >
                          <td className="p-4">
                            <div className="font-semibold text-slate-900">{t.subject}</div>
                            {t.ticket_number && <div className="font-mono text-xs text-slate-400">#{t.ticket_number}</div>}
                          </td>
                          <td className="p-4 text-slate-600">{t.category}</td>
                          <td className="p-4"><PriorityBadge priority={t.priority} /></td>
                          <td className="p-4"><StatusBadge status={t.status} /></td>
                          <td className="p-4 text-slate-500">{t.assigned_name ?? "–"}</td>
                          <td className="p-4 font-mono text-xs text-slate-400">{t.created_at?.slice(0, 10)}</td>
                          <td className="p-4 text-blue-600 text-xs font-bold">View →</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>

        ) : (
          /* ── Grievances List ──────────────────────────────────────────────── */
          <div className="overflow-hidden rounded-3xl border bg-white shadow-sm">
            <div className="border-b p-5">
              <h2 className="font-black text-slate-950">Grievances</h2>
              <p className="text-sm text-slate-500">{grievances.length} submitted</p>
            </div>
            {grievancesLoading ? (
              <div className="flex items-center justify-center py-16">
                <Loader className="h-8 w-8 animate-spin text-slate-400" />
              </div>
            ) : grievances.length === 0 ? (
              <div className="py-16 text-center text-slate-400">
                <MessageSquare className="mx-auto mb-3 h-10 w-10 opacity-30" />
                <p className="font-semibold">No grievances found.</p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[700px] text-sm">
                  <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
                    <tr>
                      {["Subject", "Type", "Status", "Anonymous", "Submitted On"].map((h) => (
                        <th key={h} className="p-4 font-semibold">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {grievances.map((g) => (
                      <tr key={g.id} className="border-t hover:bg-slate-50/80 transition-colors">
                        <td className="p-4">
                          <div className="font-semibold text-slate-900">{g.subject}</div>
                          <div className="text-xs text-slate-400 mt-0.5 line-clamp-1">{g.description}</div>
                        </td>
                        <td className="p-4 text-slate-600 capitalize">{g.grievance_type.replace(/_/g, " ")}</td>
                        <td className="p-4"><StatusBadge status={g.status} /></td>
                        <td className="p-4">
                          {g.is_anonymous ? (
                            <span className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2.5 py-0.5 text-xs font-semibold text-slate-600">
                              <EyeOff className="h-3 w-3" /> Anonymous
                            </span>
                          ) : (
                            <span className="text-slate-400 text-xs">Named</span>
                          )}
                        </td>
                        <td className="p-4 font-mono text-xs text-slate-400">{g.created_at?.slice(0, 10)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}
      </div>

      {/* ── Raise Ticket Modal ────────────────────────────────────────────────── */}
      {showRaiseTicket && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 backdrop-blur-sm p-4">
          <div className="w-full max-w-lg rounded-3xl bg-white shadow-2xl">
            <div className="flex items-center justify-between border-b p-6">
              <h2 className="text-lg font-black text-slate-950">Raise Support Ticket</h2>
              <button onClick={() => setShowRaiseTicket(false)} className="cursor-pointer text-slate-400 hover:text-slate-700 transition-colors">
                <X className="h-5 w-5" />
              </button>
            </div>
            <div className="p-6 space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <Field label="Category">
                  <select value={ticketForm.category} onChange={(e) => setTicketForm({ ...ticketForm, category: e.target.value })} className={inputCls}>
                    {["IT", "HR", "Payroll", "Admin", "Other"].map((c) => (
                      <option key={c} value={c}>{c}</option>
                    ))}
                  </select>
                </Field>
                <Field label="Priority">
                  <select value={ticketForm.priority} onChange={(e) => setTicketForm({ ...ticketForm, priority: e.target.value })} className={inputCls}>
                    <option value="low">Low</option>
                    <option value="medium">Medium</option>
                    <option value="high">High</option>
                    <option value="urgent">Urgent</option>
                  </select>
                </Field>
              </div>
              <Field label="Subject *">
                <input value={ticketForm.subject} onChange={(e) => setTicketForm({ ...ticketForm, subject: e.target.value })} placeholder="Brief summary of the issue" className={inputCls} />
              </Field>
              <Field label="Description *">
                <textarea value={ticketForm.description} onChange={(e) => setTicketForm({ ...ticketForm, description: e.target.value })} rows={4} placeholder="Describe the issue in detail…" className={`${inputCls} resize-none`} />
              </Field>
            </div>
            <div className="flex gap-3 border-t p-6">
              <button onClick={() => setShowRaiseTicket(false)} className="flex-1 cursor-pointer rounded-2xl border border-slate-200 py-3 text-sm font-semibold text-slate-700 hover:bg-slate-50 transition-colors">
                Cancel
              </button>
              <button onClick={() => void submitTicket()} disabled={ticketBusy} className="flex-1 cursor-pointer rounded-2xl bg-slate-950 py-3 text-sm font-bold text-white hover:bg-slate-800 transition-colors disabled:opacity-50">
                {ticketBusy ? "Submitting…" : "Submit Ticket"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Raise Grievance Modal ─────────────────────────────────────────────── */}
      {showRaiseGrievance && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 backdrop-blur-sm p-4">
          <div className="w-full max-w-lg rounded-3xl bg-white shadow-2xl">
            <div className="flex items-center justify-between border-b p-6">
              <h2 className="text-lg font-black text-slate-950">Submit Grievance</h2>
              <button onClick={() => setShowRaiseGrievance(false)} className="cursor-pointer text-slate-400 hover:text-slate-700 transition-colors">
                <X className="h-5 w-5" />
              </button>
            </div>
            <div className="p-6 space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <Field label="Category">
                  <select value={grievanceForm.grievance_type} onChange={(e) => setGrievanceForm({ ...grievanceForm, grievance_type: e.target.value })} className={inputCls}>
                    {["workplace", "harassment", "discrimination", "policy", "compensation", "safety", "other"].map((t) => (
                      <option key={t} value={t} className="capitalize">{t}</option>
                    ))}
                  </select>
                </Field>
                <Field label="Severity">
                  <select value={grievanceForm.severity} onChange={(e) => setGrievanceForm({ ...grievanceForm, severity: e.target.value })} className={inputCls}>
                    <option value="low">Low</option>
                    <option value="medium">Medium</option>
                    <option value="high">High</option>
                    <option value="critical">Critical</option>
                  </select>
                </Field>
              </div>
              <div className="flex items-center gap-3 py-1">
                <label className="flex items-center gap-3 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={grievanceForm.is_anonymous}
                    onChange={(e) => setGrievanceForm({ ...grievanceForm, is_anonymous: e.target.checked })}
                    className="h-4 w-4 rounded"
                  />
                  <span className="text-sm text-slate-700 font-semibold">Submit anonymously (your identity will not be revealed to management)</span>
                </label>
              </div>
              <Field label="Subject *">
                <input value={grievanceForm.subject} onChange={(e) => setGrievanceForm({ ...grievanceForm, subject: e.target.value })} placeholder="Brief subject" className={inputCls} />
              </Field>
              <Field label="Description *">
                <textarea value={grievanceForm.description} onChange={(e) => setGrievanceForm({ ...grievanceForm, description: e.target.value })} rows={4} placeholder="Describe your grievance…" className={`${inputCls} resize-none`} />
              </Field>
            </div>
            <div className="flex gap-3 border-t p-6">
              <button onClick={() => setShowRaiseGrievance(false)} className="flex-1 cursor-pointer rounded-2xl border border-slate-200 py-3 text-sm font-semibold text-slate-700 hover:bg-slate-50 transition-colors">
                Cancel
              </button>
              <button onClick={() => void submitGrievance()} disabled={grievanceBusy} className="flex-1 cursor-pointer rounded-2xl bg-slate-950 py-3 text-sm font-bold text-white hover:bg-slate-800 transition-colors disabled:opacity-50">
                {grievanceBusy ? "Submitting…" : "Submit Grievance"}
              </button>
            </div>
          </div>
        </div>
      )}
    </DashboardLayout>
  );
}
