/**
 * Configure who receives each branch's provisioning notifications.
 *
 * The "who actually gets this" panel is the point of the screen, not a nicety.
 * Recipients were previously inferred from three different tables with nothing
 * showing the result, so a wrong routing stayed invisible until someone noticed
 * the mail arriving at the wrong desk — one joiner's tasks reached 51 people,
 * and a branch's admin task went to a Training & Quality employee for months.
 * Every change here re-reads the resolved outcome.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertTriangle, ArrowUpRight, Building2, CheckCircle2, Loader2, Mail, Plus,
  Search, Trash2, UserPlus,
} from "lucide-react";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { hrmsApi } from "@/lib/hrmsApi";

type Branch = { id: string; branch_name: string; branch_code: string | null; headcount: number };
type EventDef = { code: string; label: string; fallbackRole: string };
type Recipient = {
  id: string; eventCode: string; recipientType: "to" | "cc";
  employeeId: string | null; email: string | null; resolvedEmail: string | null;
  name: string | null; employeeCode: string | null; remarks: string | null; active: boolean;
};
type Effective = {
  eventCode: string; label: string;
  basis: "configured" | "branch_spoc" | "branch_head_escalation" | "none";
  to: string[]; cc: string[];
};
type EmpHit = {
  id: string; employee_code: string; full_name: string;
  email: string | null; branch_name: string | null; designation_name: string | null;
};

const BASIS_META: Record<Effective["basis"], { label: string; tone: string; note: string }> = {
  configured: {
    label: "Configured", tone: "border-emerald-200 bg-emerald-50 text-emerald-800",
    note: "Set explicitly below.",
  },
  branch_spoc: {
    label: "Auto — branch SPOC", tone: "border-blue-200 bg-blue-50 text-blue-800",
    note: "Derived from the branch role mapping. Configure it here to make it explicit.",
  },
  branch_head_escalation: {
    label: "Escalating to branch head", tone: "border-amber-200 bg-amber-50 text-amber-900",
    note: "No SPOC for this branch, so the branch head is told and the task is left unassigned.",
  },
  none: {
    label: "Nobody", tone: "border-red-200 bg-red-50 text-red-800",
    note: "No recipient at all — this task will be raised with nobody notified.",
  },
};

export default function NativeProvisioningRecipients() {
  const [branches, setBranches] = useState<Branch[]>([]);
  const [events, setEvents] = useState<EventDef[]>([]);
  const [branchId, setBranchId] = useState<string>("");
  const [rows, setRows] = useState<Recipient[]>([]);
  const [effective, setEffective] = useState<Effective[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  // add form
  const [addFor, setAddFor] = useState<{ eventCode: string; type: "to" | "cc" } | null>(null);
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<EmpHit[]>([]);
  const [manualEmail, setManualEmail] = useState("");

  useEffect(() => {
    void (async () => {
      try {
        const [b, e] = await Promise.all([
          hrmsApi.get<{ data: Branch[] }>("/api/notification-recipients/branches"),
          hrmsApi.get<{ data: EventDef[] }>("/api/notification-recipients/events"),
        ]);
        setBranches(b.data ?? []);
        setEvents(e.data ?? []);
        if ((b.data ?? []).length) setBranchId(b.data[0].id);
      } catch (err: unknown) {
        setError(err instanceof Error ? err.message : "Could not load branches.");
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const load = useCallback(async () => {
    if (!branchId) return;
    setError(null);
    try {
      const [r, eff] = await Promise.all([
        hrmsApi.get<{ data: Recipient[] }>(`/api/notification-recipients/${branchId}`),
        hrmsApi.get<{ data: Effective[] }>(`/api/notification-recipients/${branchId}/effective`),
      ]);
      setRows((r.data ?? []).filter((x) => x.active));
      setEffective(eff.data ?? []);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Could not load recipients.");
    }
  }, [branchId]);

  useEffect(() => { void load(); }, [load]);

  // Debounced employee search.
  useEffect(() => {
    if (query.trim().length < 2) { setHits([]); return; }
    const t = setTimeout(() => {
      void hrmsApi
        .get<{ data: EmpHit[] }>(`/api/notification-recipients/lookup/employees?q=${encodeURIComponent(query)}&branchId=${branchId}`)
        .then((r) => setHits(r.data ?? []))
        .catch(() => setHits([]));
    }, 250);
    return () => clearTimeout(t);
  }, [query, branchId]);

  const add = async (payload: { employeeId?: string; email?: string }) => {
    if (!addFor) return;
    setBusy(true);
    setError(null);
    try {
      await hrmsApi.post("/api/notification-recipients", {
        branchId, eventCode: addFor.eventCode, recipientType: addFor.type, ...payload,
      });
      setNotice("Recipient added.");
      setAddFor(null); setQuery(""); setHits([]); setManualEmail("");
      await load();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Could not add that recipient.");
    } finally {
      setBusy(false);
    }
  };

  const remove = async (r: Recipient) => {
    if (!window.confirm(`Stop sending ${r.eventCode} to ${r.name ?? r.resolvedEmail}?`)) return;
    setBusy(true);
    try {
      await hrmsApi.delete(`/api/notification-recipients/${r.id}`);
      await load();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Could not remove that recipient.");
    } finally {
      setBusy(false);
    }
  };

  const byEvent = useMemo(() => {
    const m = new Map<string, { to: Recipient[]; cc: Recipient[] }>();
    for (const ev of events) m.set(ev.code, { to: [], cc: [] });
    for (const r of rows) {
      const slot = m.get(r.eventCode);
      if (slot) slot[r.recipientType].push(r);
    }
    return m;
  }, [rows, events]);

  const branch = branches.find((b) => b.id === branchId);

  return (
    <DashboardLayout>
      <div className="space-y-4 p-6">
        <div>
          <p className="text-xs font-bold uppercase tracking-widest text-blue-600">Super Admin</p>
          <h1 className="mt-1 text-2xl font-bold text-slate-900">Provisioning notification recipients</h1>
          <p className="mt-1 max-w-3xl text-sm text-slate-500">
            Who is emailed when a new employee is created — per branch, per task. Configuration here
            overrides the automatic branch-role lookup. Anything left unconfigured keeps using that
            lookup, and falls back to the branch head if the branch has no SPOC.
          </p>
        </div>

        {error && (
          <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
            <span className="inline-flex items-start gap-2">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />{error}
            </span>
          </div>
        )}
        {notice && (
          <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
            <span className="inline-flex items-start gap-2">
              <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />{notice}
            </span>
          </div>
        )}

        {loading ? (
          <div className="flex h-64 items-center justify-center rounded-xl border bg-white">
            <Loader2 className="h-6 w-6 animate-spin text-slate-400" aria-label="Loading" />
          </div>
        ) : (
          <>
            {/* Branch picker */}
            <div className="rounded-xl border bg-white p-4 shadow-sm">
              <label className="mb-1.5 block text-xs font-bold uppercase tracking-wide text-slate-500">
                Branch
              </label>
              <div className="flex flex-wrap gap-2">
                {branches.map((b) => (
                  <button
                    key={b.id} type="button" onClick={() => setBranchId(b.id)}
                    className={`inline-flex min-h-[44px] cursor-pointer items-center gap-2 rounded-lg border px-3 text-sm font-semibold transition-colors ${
                      b.id === branchId
                        ? "border-blue-500 bg-blue-50 text-blue-800"
                        : "border-slate-200 bg-white text-slate-700 hover:bg-slate-50"
                    }`}
                  >
                    <Building2 className="h-4 w-4" aria-hidden="true" />
                    {b.branch_name}
                    <span className="text-xs font-normal text-slate-400">{b.headcount}</span>
                  </button>
                ))}
              </div>
            </div>

            {/* What actually happens — read this before trusting the config below. */}
            <div className="rounded-xl border bg-white shadow-sm">
              <div className="border-b px-5 py-3">
                <h2 className="font-bold text-slate-900">Who actually gets these emails</h2>
                <p className="text-xs text-slate-500">
                  Resolved live for {branch?.branch_name ?? "this branch"} — configuration first, then the
                  automatic lookup, then branch-head escalation.
                </p>
              </div>
              <div className="divide-y">
                {effective.map((e) => {
                  const meta = BASIS_META[e.basis];
                  return (
                    <div key={e.eventCode} className="px-5 py-3">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-sm font-semibold text-slate-900">{e.label}</span>
                        <span className={`rounded border px-2 py-0.5 text-[10px] font-bold uppercase ${meta.tone}`}>
                          {meta.label}
                        </span>
                      </div>
                      <p className="mt-1 text-sm text-slate-700">
                        <span className="text-xs font-bold text-slate-400">TO </span>
                        {e.to.length ? e.to.join(", ") : <span className="text-red-700">nobody</span>}
                      </p>
                      {e.cc.length > 0 && (
                        <p className="text-sm text-slate-600">
                          <span className="text-xs font-bold text-slate-400">CC </span>{e.cc.join(", ")}
                        </p>
                      )}
                      {e.basis !== "configured" && (
                        <p className="mt-1 inline-flex items-center gap-1 text-[11px] text-slate-500">
                          <ArrowUpRight className="h-3 w-3" aria-hidden="true" />{meta.note}
                        </p>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Configuration */}
            {events.map((ev) => {
              const slot = byEvent.get(ev.code) ?? { to: [], cc: [] };
              return (
                <div key={ev.code} className="rounded-xl border bg-white shadow-sm">
                  <div className="border-b px-5 py-3">
                    <h3 className="font-bold text-slate-900">{ev.label}</h3>
                    <p className="font-mono text-[11px] text-slate-400">{ev.code}</p>
                  </div>
                  <div className="grid gap-4 p-5 md:grid-cols-2">
                    {(["to", "cc"] as const).map((type) => (
                      <div key={type}>
                        <div className="mb-2 flex items-center justify-between">
                          <span className="text-xs font-bold uppercase tracking-wide text-slate-500">
                            {type === "to" ? "To — acts on the task" : "CC — kept informed"}
                          </span>
                          <Button
                            type="button" size="sm" variant="outline"
                            className="min-h-[36px] cursor-pointer gap-1"
                            onClick={() => { setAddFor({ eventCode: ev.code, type }); setQuery(""); setManualEmail(""); }}
                          >
                            <Plus className="h-3.5 w-3.5" aria-hidden="true" /> Add
                          </Button>
                        </div>
                        {slot[type].length === 0 ? (
                          <p className="text-xs text-slate-400">
                            {type === "to" ? "Not configured — the automatic lookup is used." : "None."}
                          </p>
                        ) : (
                          <ul className="space-y-1.5">
                            {slot[type].map((r) => (
                              <li key={r.id} className="flex items-center justify-between gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
                                <div className="min-w-0">
                                  <p className="truncate text-sm font-medium text-slate-900">
                                    {r.name ?? r.resolvedEmail}
                                    {!r.employeeId && (
                                      <Badge variant="outline" className="ml-2 border-slate-300 text-[10px]">
                                        mailbox
                                      </Badge>
                                    )}
                                  </p>
                                  <p className="truncate text-xs text-slate-500">{r.resolvedEmail}</p>
                                </div>
                                <button
                                  type="button" onClick={() => void remove(r)} disabled={busy}
                                  aria-label={`Remove ${r.name ?? r.resolvedEmail}`}
                                  className="shrink-0 cursor-pointer rounded p-1.5 text-slate-400 transition-colors hover:bg-red-50 hover:text-red-600"
                                >
                                  <Trash2 className="h-4 w-4" aria-hidden="true" />
                                </button>
                              </li>
                            ))}
                          </ul>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              );
            })}
          </>
        )}

        {/* Add dialog */}
        {addFor && (
          <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/40 p-4 pt-24" role="dialog" aria-modal="true">
            <div className="w-full max-w-lg rounded-xl border bg-white shadow-xl">
              <div className="border-b px-5 py-3">
                <h3 className="font-bold text-slate-900">
                  Add {addFor.type === "to" ? "recipient" : "CC"} — {addFor.eventCode}
                </h3>
              </div>
              <div className="space-y-4 p-5">
                <div>
                  <label className="mb-1.5 block text-xs font-bold uppercase tracking-wide text-slate-500">
                    Find an employee
                  </label>
                  <div className="relative">
                    <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" aria-hidden="true" />
                    <Input
                      value={query} onChange={(e) => setQuery(e.target.value)} autoFocus
                      placeholder="Name or employee code" className="min-h-[44px] pl-9"
                    />
                  </div>
                  {hits.length > 0 && (
                    <ul className="mt-2 max-h-56 overflow-y-auto rounded-lg border">
                      {hits.map((e) => (
                        <li key={e.id}>
                          <button
                            type="button" disabled={busy || !e.email}
                            onClick={() => void add({ employeeId: e.id })}
                            className="w-full cursor-pointer px-3 py-2 text-left transition-colors hover:bg-slate-50 disabled:opacity-50"
                          >
                            <p className="text-sm font-medium text-slate-900">
                              {e.full_name} <span className="font-mono text-xs text-slate-400">{e.employee_code}</span>
                            </p>
                            <p className="text-xs text-slate-500">
                              {e.designation_name ?? "—"} · {e.branch_name ?? "—"} · {e.email ?? "no login email"}
                            </p>
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>

                <div className="border-t pt-4">
                  <label className="mb-1.5 block text-xs font-bold uppercase tracking-wide text-slate-500">
                    Or a plain address
                  </label>
                  <p className="mb-2 text-xs text-slate-500">
                    For shared mailboxes with no employee record — it.jaipur@teammas.in, for instance.
                  </p>
                  <div className="flex gap-2">
                    <div className="relative flex-1">
                      <Mail className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" aria-hidden="true" />
                      <Input
                        value={manualEmail} onChange={(e) => setManualEmail(e.target.value)}
                        placeholder="name@teammas.in" className="min-h-[44px] pl-9"
                      />
                    </div>
                    <Button
                      type="button" disabled={busy || !manualEmail.includes("@")}
                      onClick={() => void add({ email: manualEmail })}
                      className="min-h-[44px] cursor-pointer gap-1"
                    >
                      <UserPlus className="h-4 w-4" aria-hidden="true" /> Add
                    </Button>
                  </div>
                </div>
              </div>
              <div className="flex justify-end border-t px-5 py-3">
                <Button type="button" variant="outline" onClick={() => setAddFor(null)} className="min-h-[44px] cursor-pointer">
                  Cancel
                </Button>
              </div>
            </div>
          </div>
        )}
      </div>
    </DashboardLayout>
  );
}
