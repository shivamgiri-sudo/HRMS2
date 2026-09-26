import { useCallback, useEffect, useMemo, useState } from "react";
import { Target, IndianRupee, Users, SlidersHorizontal, Pencil, RotateCcw, X, Loader2, Search, AlertTriangle, ArrowUp, ArrowDown, Check, UserPlus, UserCog, Trash2 } from "lucide-react";
import { hrmsApi } from "@/lib/hrmsApi";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Spinner, KpiCard, SectionCard, TableExcelIconButton, formatINR } from "./DashboardKit";
import { useWorkforceAccess } from "@/hooks/useUserRole";

/**
 * "Process Details" -- change the monthly target agent-wise, TL-wise and AM-wise (Housing Owner) / Center-wise (Housing Premium).
 *
 * The uploaded roster (Agent Details) stays the baseline and is never modified; a change here is saved as an
 * effective-dated override (from the chosen month onwards) and every Housing Owner dashboard picks it up.
 * Agents can also be added here by hand (Add agent): they join the roster at read time -- the uploaded roster is never modified.
 * A TL / AM target is the total for that TL / AM: it is shared out over their Active agents in proportion to
 * their roster targets, except agents (and TLs) that have a target of their own, which keep it. See
 * housing-owner-targets.service.ts for the exact rules.
 */

const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const monthLabel = (ym: string) => `${MON[Number(ym.slice(5, 7)) - 1]}-${ym.slice(2, 4)}`;
const currentYm = () => { const n = new Date(); return `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, "0")}`; };
const monthOptions = (): string[] => {
  const now = new Date(); const out: string[] = [];
  for (let i = -8; i <= 6; i++) { const d = new Date(now.getFullYear(), now.getMonth() + i, 1); out.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`); }
  return out;
};
const fmtDateTime = (iso: string | null) => {
  if (!iso) return "—";
  const d = new Date(iso); if (Number.isNaN(d.getTime())) return iso;
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(d.getDate())}/${p(d.getMonth() + 1)}/${d.getFullYear()} ${p(d.getHours())}:${p(d.getMinutes())}`;
};

type Level = "am" | "center" | "tl" | "agent";
interface ManualAgent { id: number; name: string; empId: string | null; tl: string; group: string; status: "Active" | "InActive"; doj: string | null; monthlyTarget: number; effectiveFrom: string }
interface OverrideInfo { id: number; monthlyTarget: number; effectiveMonth: string; updatedBy: string | null; updatedAt: string | null }
interface Entity {
  level: Level; name: string; tl: string | null; group: string | null; status: string | null;
  agentCount: number; baselineTarget: number; effectiveTarget: number; override: OverrideInfo | null; overridden: boolean; manual: ManualAgent | null;
}
interface PageData {
  month: string; tableAvailable: boolean; manualAvailable: boolean;
  totals: { baseline: number; effective: number; overrides: number; activeAgents: number };
  groups: Entity[]; tls: Entity[]; agents: Entity[];
}
interface Detail {
  entity: Entity;
  children: Array<{ name: string; kind: "TL" | "Agent"; effectiveTarget: number; baselineTarget: number }>;
  history: Array<{ id: number; effectiveMonth: string; monthlyTarget: number; updatedAt: string | null; updatedByLabel: string | null }>;
  audit: Array<{ at: string; action: string; actor: string; reason: string | null; oldValue: unknown; newValue: unknown }>;
}

function Diff({ base, eff }: { base: number; eff: number }) {
  const d = Math.round((eff - base) * 100) / 100;
  if (Math.abs(d) < 0.005) return null;
  const up = d > 0;
  const Icon = up ? ArrowUp : ArrowDown;
  return <span className={`ml-1.5 inline-flex items-center gap-0.5 rounded-full px-1.5 py-0.5 text-[10px] font-bold ${up ? "bg-emerald-50 text-emerald-700" : "bg-rose-50 text-rose-700"}`}><Icon className="h-2.5 w-2.5" />{formatINR(Math.abs(d))}</span>;
}

/* ------------------------------- detail drawer ------------------------------- */

function TargetDrawer({ api: API, topLevel, topLabel, target, month, tableAvailable, onClose, onSaved, onOpen }: {
  api: string; topLevel: Level; topLabel: string;
  target: { level: Level; name: string }; month: string; tableAvailable: boolean; onClose: () => void; onSaved: () => void; onOpen: (t: { level: Level; name: string }) => void;
}) {
  const levelLabel = (l: Level) => (l === "tl" ? "TL" : l === "agent" ? "Agent" : topLabel);
  const [detail, setDetail] = useState<Detail | null>(null);
  const [error, setError] = useState("");
  const [value, setValue] = useState("");
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState("");
  const [shown, setShown] = useState(false);
  const [reload, setReload] = useState(0);
  useEffect(() => { const t = requestAnimationFrame(() => setShown(true)); return () => cancelAnimationFrame(t); }, []);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey); return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  useEffect(() => {
    let cancelled = false;
    setDetail(null); setError("");
    hrmsApi.get<{ success: boolean; data: Detail }>(`${API}/detail?level=${target.level}&name=${encodeURIComponent(target.name)}&month=${month}`)
      .then((r) => { if (!cancelled) { setDetail(r.data); setValue(String(Math.round(r.data.entity.effectiveTarget))); } })
      .catch((e) => { if (!cancelled) setError(e instanceof Error ? e.message : "Unable to load the detail."); });
    return () => { cancelled = true; };
  }, [target.level, target.name, month, reload]);

  async function save() {
    setSaving(true); setSaveError("");
    try {
      await hrmsApi.put(API, { level: target.level, name: target.name, month, target: Number(value), reason: reason.trim() || undefined });
      setReason(""); setReload((n) => n + 1); onSaved();
    } catch (e) { setSaveError(e instanceof Error ? e.message : "Unable to save."); }
    finally { setSaving(false); }
  }
  async function reset(id: number) {
    setSaving(true); setSaveError("");
    try { await hrmsApi.delete(`${API}/${id}`); setReload((n) => n + 1); onSaved(); }
    catch (e) { setSaveError(e instanceof Error ? e.message : "Unable to reset."); }
    finally { setSaving(false); }
  }

  const e = detail?.entity;
  const label = "text-xs font-bold uppercase tracking-wide text-slate-400";
  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <div className={`absolute inset-0 bg-slate-900/40 transition-opacity duration-200 ${shown ? "opacity-100" : "opacity-0"}`} onClick={onClose} />
      <aside className={`relative flex h-full w-full max-w-2xl flex-col overflow-y-auto bg-white shadow-2xl transition-transform duration-200 ${shown ? "translate-x-0" : "translate-x-full"}`}>
        <div className="sticky top-0 z-10 flex items-center justify-between gap-3 border-b border-slate-100 bg-white px-5 py-3">
          <div className="min-w-0">
            <p className="flex items-center gap-2 truncate text-sm font-bold text-slate-800">
              {target.name}
              <span className="rounded-full bg-orange-100 px-2 py-0.5 text-[10px] font-bold text-orange-700">{levelLabel(target.level)}</span>
              {e?.overridden && <span className="rounded-full bg-violet-100 px-2 py-0.5 text-[10px] font-bold text-violet-700">Changed</span>}
            </p>
            <p className="text-[11px] text-slate-400">Target · {monthLabel(month)}{e?.group && target.level !== topLevel ? ` · ${topLabel} ${e.group}` : ""}{e?.tl && target.level === "agent" ? ` · TL ${e.tl}` : ""}</p>
          </div>
          <button type="button" onClick={onClose} className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700" aria-label="Close"><X className="h-4 w-4" /></button>
        </div>

        <div className="space-y-5 p-5">
          {error && <p className="rounded-lg bg-rose-50 px-3 py-2 text-xs text-rose-700">{error}</p>}
          {!detail && !error && <div className="flex justify-center py-16 text-slate-400"><Loader2 className="h-6 w-6 animate-spin" /></div>}
          {detail && e && (
            <>
              <section className="space-y-2">
                <p className={label}>Target this month</p>
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                  {[
                    ["Roster (uploaded)", formatINR(e.baselineTarget)], ["Effective", formatINR(e.effectiveTarget)],
                    ["Override", e.override ? formatINR(e.override.monthlyTarget) : "None"], ["Active agents", String(e.agentCount)],
                  ].map(([k, v]) => <div key={k} className="rounded-xl border border-slate-100 bg-slate-50/60 p-3"><p className="text-[11px] font-medium text-slate-500">{k}</p><p className="mt-0.5 text-base font-bold text-slate-800">{v}</p></div>)}
                </div>
              </section>

              <section className="space-y-2">
                <p className={label}>Change target</p>
                <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)]">
                  <div>
                    <p className="mb-1 text-[11px] font-semibold text-slate-500">{target.level === "agent" ? "Monthly target (₹)" : "Total monthly target (₹)"} — from {monthLabel(month)}</p>
                    <Input inputMode="decimal" value={value} onChange={(ev) => setValue(ev.target.value)} />
                  </div>
                  <div>
                    <p className="mb-1 text-[11px] font-semibold text-slate-500">Reason (optional)</p>
                    <Input value={reason} onChange={(ev) => setReason(ev.target.value)} maxLength={500} placeholder="e.g. headcount change" />
                  </div>
                </div>
                {target.level !== "agent" && <p className="text-[11px] text-slate-400">Shared over the {levelLabel(target.level)}'s Active {target.level === topLevel ? "TLs and agents" : "agents"} in proportion to their roster targets; ones with a target of their own keep it.</p>}
                {saveError && <p className="rounded-lg bg-rose-50 px-3 py-2 text-xs text-rose-700">{saveError}</p>}
                <div className="flex flex-wrap items-center gap-2">
                  <Button onClick={save} disabled={saving || !tableAvailable || !(Number(value) >= 0) || value.trim() === ""} className="h-9">{saving && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />}Save target</Button>
                  {e.override && <Button variant="outline" onClick={() => reset(e.override!.id)} disabled={saving || !tableAvailable} className="h-9"><RotateCcw className="mr-1.5 h-3.5 w-3.5" />Reset to roster</Button>}
                </div>
              </section>

              {target.level !== "agent" && (
                <section className="space-y-2">
                  <div className="flex items-center justify-between gap-2">
                  <p className={label}>{target.level === topLevel ? `TLs under this ${topLabel}` : "Agents under this TL"} (click to open)</p>
                  {detail.children.length > 0 && (
                    <TableExcelIconButton
                      fileBase={`Target_${target.name}_${monthLabel(month)}`}
                      getSheets={() => [{ name: "Children", columns: [target.level === topLevel ? "TL" : "Agent", "Roster target", "Effective target"], rows: detail.children.map((c) => [c.name, Math.round(c.baselineTarget), Math.round(c.effectiveTarget)]) }]}
                    />
                  )}
                </div>
                  {detail.children.length === 0 ? <p className="rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-400">None</p> : (
                    <div className="overflow-hidden rounded-xl border border-slate-100">
                      <table className="w-full text-xs">
                        <thead><tr className="bg-slate-50 text-[10px] uppercase tracking-wide text-slate-400"><th className="px-3 py-2 text-left font-semibold">{target.level === topLevel ? "TL" : "Agent"}</th><th className="px-3 py-2 font-semibold">Roster</th><th className="px-3 py-2 font-semibold">Effective</th></tr></thead>
                        <tbody>
                          {detail.children.map((c) => (
                            <tr key={c.name} onClick={() => onOpen({ level: c.kind === "TL" ? "tl" : "agent", name: c.name })} className="cursor-pointer border-t border-slate-50 hover:bg-orange-50/50">
                              <td className="px-3 py-2 font-medium text-slate-700">{c.name}</td>
                              <td className="px-3 py-2 text-center text-slate-500">{formatINR(c.baselineTarget)}</td>
                              <td className="px-3 py-2 text-center font-bold text-slate-800">{formatINR(c.effectiveTarget)}<Diff base={c.baselineTarget} eff={c.effectiveTarget} /></td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </section>
              )}

              <section className="space-y-2">
                <p className={label}>Overrides on record</p>
                {detail.history.length === 0 ? <p className="rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-400">None — using the uploaded roster target</p> : (
                  <ul className="space-y-1.5">
                    {detail.history.map((h) => (
                      <li key={h.id} className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-slate-100 px-3 py-2 text-xs">
                        <span className="font-semibold text-slate-700">From {monthLabel(h.effectiveMonth)}: {formatINR(h.monthlyTarget)}</span>
                        <span className="text-slate-400">{fmtDateTime(h.updatedAt)} · {h.updatedByLabel ?? "—"}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </section>

              <section className="space-y-2">
                <p className={label}>Change history</p>
                {detail.audit.length === 0 ? <p className="rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-400">None</p> : (
                  <ul className="space-y-1.5">
                    {detail.audit.map((a, i) => {
                      const nv = a.newValue as { monthlyTarget?: number } | null; const ov = a.oldValue as { monthlyTarget?: number } | null;
                      return (
                        <li key={i} className="rounded-xl border border-slate-100 p-3 text-xs">
                          <p className="flex flex-wrap items-center justify-between gap-2"><span className="font-bold text-slate-700">{a.action.replace(/^HOUSING_(OWNER|PREMIUM)_TARGET_/, "").toLowerCase()}</span><span className="text-slate-400">{fmtDateTime(a.at)} · {a.actor}</span></p>
                          <p className="mt-1 text-slate-600">{ov?.monthlyTarget != null ? `${formatINR(ov.monthlyTarget)} → ` : ""}{nv?.monthlyTarget != null ? formatINR(nv.monthlyTarget) : "reset to roster"}{a.reason ? ` · ${a.reason}` : ""}</p>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </section>
            </>
          )}
        </div>
      </aside>
    </div>
  );
}

/* ------------------------------- add / edit agent ------------------------------- */

function AgentFormDrawer({ api: API, topLabel, month, months, tls, groups, agent, onClose, onSaved }: {
  api: string; topLabel: string; month: string; months: string[]; tls: string[]; groups: string[]; agent: ManualAgent | null; onClose: () => void; onSaved: () => void;
}) {
  const [name, setName] = useState(agent?.name ?? "");
  const [empId, setEmpId] = useState(agent?.empId ?? "");
  const [tl, setTl] = useState(agent?.tl ?? "");
  const [group, setGroup] = useState(agent?.group ?? "");
  const [status, setStatus] = useState<"Active" | "InActive">(agent?.status ?? "Active");
  const [doj, setDoj] = useState(agent?.doj ?? "");
  const [target, setTarget] = useState(agent ? String(agent.monthlyTarget) : "");
  const [from, setFrom] = useState(agent?.effectiveFrom ?? month);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [shown, setShown] = useState(false);
  useEffect(() => { const t = requestAnimationFrame(() => setShown(true)); return () => cancelAnimationFrame(t); }, []);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey); return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const ready = name.trim() !== "" && tl.trim() !== "" && group.trim() !== "" && target.trim() !== "" && Number(target) >= 0;
  async function save() {
    setSaving(true); setError("");
    const body = { name: name.trim(), empId: empId.trim() || null, tl: tl.trim(), group: group.trim(), status, doj: doj || null, target: Number(target), month: from };
    try {
      if (agent) await hrmsApi.put(`${API}/agents/${agent.id}`, body); else await hrmsApi.post(`${API}/agents`, body);
      onSaved(); onClose();
    } catch (e) { setError(e instanceof Error ? e.message : "Unable to save the agent."); }
    finally { setSaving(false); }
  }
  const lbl = "mb-1 text-[11px] font-semibold text-slate-500";
  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <div className={`absolute inset-0 bg-slate-900/40 transition-opacity duration-200 ${shown ? "opacity-100" : "opacity-0"}`} onClick={onClose} />
      <aside className={`relative flex h-full w-full max-w-2xl flex-col overflow-y-auto bg-white shadow-2xl transition-transform duration-200 ${shown ? "translate-x-0" : "translate-x-full"}`}>
        <div className="sticky top-0 z-10 flex items-center justify-between gap-3 border-b border-slate-100 bg-white px-5 py-3">
          <div>
            <p className="text-sm font-bold text-slate-800">{agent ? `Edit agent · ${agent.name}` : "Add agent"}</p>
            <p className="text-[11px] text-slate-400">Joins the roster from the chosen month; the uploaded roster is not changed</p>
          </div>
          <button type="button" onClick={onClose} className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700" aria-label="Close"><X className="h-4 w-4" /></button>
        </div>
        <div className="space-y-4 p-5">
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="sm:col-span-2"><p className={lbl}>Agent name (same spelling as on the sale / call uploads)</p><Input value={name} onChange={(e) => setName(e.target.value)} maxLength={255} placeholder="e.g. Rahul Sharma" /></div>
            <div><p className={lbl}>Employee ID (optional)</p><Input value={empId} onChange={(e) => setEmpId(e.target.value)} maxLength={50} placeholder="e.g. MAS12345" /></div>
            <div>
              <p className={lbl}>Status</p>
              <Select value={status} onValueChange={(v) => setStatus(v as "Active" | "InActive")}>
                <SelectTrigger className="h-9" aria-label="Status"><SelectValue /></SelectTrigger>
                <SelectContent><SelectItem value="Active">Active</SelectItem><SelectItem value="InActive">InActive</SelectItem></SelectContent>
              </Select>
            </div>
            <div>
              <p className={lbl}>TL</p>
              <Input list="pt-tl-options" value={tl} onChange={(e) => setTl(e.target.value)} maxLength={255} placeholder="Pick or type a TL" />
              <datalist id="pt-tl-options">{tls.map((t) => <option key={t} value={t} />)}</datalist>
            </div>
            <div>
              <p className={lbl}>{topLabel}</p>
              <Input list="pt-group-options" value={group} onChange={(e) => setGroup(e.target.value)} maxLength={255} placeholder={`Pick or type an ${topLabel}`} />
              <datalist id="pt-group-options">{groups.map((g) => <option key={g} value={g} />)}</datalist>
            </div>
            <div><p className={lbl}>Date of joining (optional)</p><Input type="date" value={doj} onChange={(e) => setDoj(e.target.value)} /></div>
            <div><p className={lbl}>Monthly target (₹)</p><Input inputMode="decimal" value={target} onChange={(e) => setTarget(e.target.value)} placeholder="e.g. 130000" /></div>
            <div className="sm:col-span-2">
              <p className={lbl}>Effective from (month)</p>
              <Select value={from} onValueChange={setFrom}>
                <SelectTrigger className="h-9" aria-label="Effective month"><SelectValue /></SelectTrigger>
                <SelectContent>{months.map((m) => <SelectItem key={m} value={m}>{monthLabel(m)}</SelectItem>)}</SelectContent>
              </Select>
            </div>
          </div>
          <p className="text-[11px] text-slate-400">Once added, the agent appears in every dashboard of this process (headline, {topLabel} / TL / agent tables, TQ-MQ-BQ) and can have its target changed like any other agent. Only Active agents count in target totals.</p>
          {error && <p className="rounded-lg bg-rose-50 px-3 py-2 text-xs text-rose-700">{error}</p>}
          <div className="flex gap-2">
            <Button onClick={save} disabled={saving || !ready} className="h-9">{saving && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />}{agent ? "Save changes" : "Add agent"}</Button>
            <Button variant="outline" onClick={onClose} className="h-9">Cancel</Button>
          </div>
        </div>
      </aside>
    </div>
  );
}

/* ---------------------------------- the page ---------------------------------- */

export function ProcessTargetsPage({ api: API, topLevel, topLabel, title, pageCode }: { api: string; topLevel: "am" | "center"; topLabel: string; title: string; pageCode: string }) {
  // Viewing needs the page grant; changing targets / adding agents needs its Edit permission (both enforced again by the API).
  const access = useWorkforceAccess();
  const canEdit = access.isResolved && access.canEditPage(pageCode);
  const levelLabel = (l: Level) => (l === "tl" ? "TL" : l === "agent" ? "Agent" : topLabel);
  const months = useMemo(monthOptions, []);
  const [month, setMonth] = useState(currentYm());
  const [level, setLevel] = useState<Level>(topLevel);
  const [data, setData] = useState<PageData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [editing, setEditing] = useState<{ key: string; value: string } | null>(null);
  const [rowBusy, setRowBusy] = useState<string | null>(null);
  const [rowError, setRowError] = useState("");
  const [drawer, setDrawer] = useState<{ level: Level; name: string } | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [agentForm, setAgentForm] = useState<{ agent: ManualAgent | null } | null>(null);
  const [confirmRemove, setConfirmRemove] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true); setError("");
    hrmsApi.get<{ success: boolean; data: PageData }>(`${API}?month=${month}`)
      .then((r) => { if (!cancelled) setData(r.data); })
      .catch((e) => { if (!cancelled) setError(e instanceof Error ? e.message : "Unable to load the targets."); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [API, month, reloadKey]);
  const refresh = useCallback(() => setReloadKey((k) => k + 1), []);

  const rows = useMemo(() => {
    const list = data ? (level === topLevel ? data.groups : level === "tl" ? data.tls : data.agents) : [];
    const q = search.trim().toLowerCase();
    return q ? list.filter((r) => r.name.toLowerCase().includes(q) || (r.tl ?? "").toLowerCase().includes(q) || (r.group ?? "").toLowerCase().includes(q)) : list;
  }, [data, level, search, topLevel]);

  async function saveRow(r: Entity) {
    if (!editing) return;
    setRowBusy(r.name); setRowError("");
    try { await hrmsApi.put(API, { level: r.level, name: r.name, month, target: Number(editing.value) }); setEditing(null); refresh(); }
    catch (e) { setRowError(e instanceof Error ? e.message : "Unable to save."); }
    finally { setRowBusy(null); }
  }
  async function removeAgent(r: Entity) {
    if (!r.manual) return;
    setRowBusy(r.name); setRowError("");
    try { await hrmsApi.delete(`${API}/agents/${r.manual.id}`); setConfirmRemove(null); refresh(); }
    catch (e) { setRowError(e instanceof Error ? e.message : "Unable to remove the agent."); }
    finally { setRowBusy(null); }
  }
  async function resetRow(r: Entity) {
    if (!r.override) return;
    setRowBusy(r.name); setRowError("");
    try { await hrmsApi.delete(`${API}/${r.override.id}`); refresh(); }
    catch (e) { setRowError(e instanceof Error ? e.message : "Unable to reset."); }
    finally { setRowBusy(null); }
  }

  if (loading && !data) return <Spinner />;
  if (error) return <div className="rounded-xl border border-red-100 bg-red-50 p-4 text-sm text-red-700">{error}</div>;
  if (!data) return null;

  const t = data.totals;
  const diffTotal = Math.round((t.effective - t.baseline) * 100) / 100;
  const cols = level === "agent" ? ["Agent", "TL", topLabel, "Status", "Roster target", "Effective target", "Change"] : level === "tl" ? ["TL", topLabel, "Active agents", "Roster target", "Effective target", "Change"] : [topLabel, "Active agents", "Roster target", "Effective target", "Change"];

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-slate-100 bg-white p-4 shadow-sm">
        <div className="flex items-center gap-3">
          <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-orange-100 text-orange-600"><SlidersHorizontal className="h-5 w-5" /></span>
          <div>
            <h2 className="text-base font-bold text-slate-800">{title}</h2>
            <p className="text-[11px] text-slate-500">Change the monthly target agent-wise, TL-wise or {topLabel}-wise. Every dashboard of this process uses the result.</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-[11px] font-semibold text-slate-500">Month</span>
          <Select value={month} onValueChange={setMonth}>
            <SelectTrigger className="h-9 w-[130px]" aria-label="Month"><SelectValue /></SelectTrigger>
            <SelectContent>{months.map((m) => <SelectItem key={m} value={m}>{monthLabel(m)}</SelectItem>)}</SelectContent>
          </Select>
        </div>
      </div>

      {access.isResolved && !canEdit && (
        <p className="flex items-start gap-2 rounded-xl border border-slate-200 bg-slate-50 p-3 text-xs text-slate-600"><AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />You have view-only access to Process Details. Ask an admin for the Edit permission to change targets or add agents.</p>
      )}

      {!data.tableAvailable && (
        <p className="flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800"><AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          The target-change table (db_masmis.process_target_override) was not found, so targets can be viewed but not changed. Dashboards keep using the uploaded roster targets.</p>
      )}

      {data.tableAvailable && !data.manualAvailable && (
        <p className="flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800"><AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          Adding agents needs the table db_masmis.process_manual_agent, which has not been created yet (sql/dba/1873_process_manual_agent.sql, run by a DBA). Target changes work without it.</p>
      )}

      <div className="grid grid-cols-2 gap-2.5 md:grid-cols-4">
        <KpiCard icon={IndianRupee} label="Roster target (uploaded)" value={formatINR(t.baseline)} sub="Active agents" tone="sky" />
        <KpiCard icon={Target} label="Effective target" value={formatINR(t.effective)} sub={diffTotal === 0 ? "same as roster" : `${diffTotal > 0 ? "+" : "−"}${formatINR(Math.abs(diffTotal))} vs roster`} tone="emerald" />
        <KpiCard icon={SlidersHorizontal} label="Targets changed" value={String(t.overrides)} sub={`for ${monthLabel(month)}`} tone="violet" />
        <KpiCard icon={Users} label="Active agents" value={String(t.activeAgents)} tone="amber" />
      </div>

      <SectionCard icon={Target} title={`Targets — ${monthLabel(month)}`} tone="amber"
        action={
          <div className="flex flex-wrap items-center gap-2">
            <div className="inline-flex rounded-lg bg-slate-100 p-1" role="group" aria-label="Level">
              {([topLevel, "tl", "agent"] as Level[]).map((l) => (
                <button key={l} type="button" onClick={() => { setLevel(l); setEditing(null); setRowError(""); }}
                  className={`rounded-md px-3 py-1 text-xs font-semibold transition-colors ${level === l ? "bg-white text-slate-800 shadow-sm" : "text-slate-500"}`}>{levelLabel(l)}-wise</button>
              ))}
            </div>
            <Button size="sm" variant="outline" className="h-8" disabled={!data.manualAvailable || !canEdit} onClick={() => setAgentForm({ agent: null })}><UserPlus className="mr-1 h-3.5 w-3.5" />Add agent</Button>
            <TableExcelIconButton
              fileBase={`${title.split(" — ")[0].replace(/\s+/g, "_")}_targets_${levelLabel(level)}_${monthLabel(month)}`}
              getSheets={() => [{
                name: `${levelLabel(level)}-wise`,
                columns: level === "agent" ? ["Agent", "TL", topLabel, "Status", "Roster target", "Effective target", "Changed", "Override from"] : level === "tl" ? ["TL", topLabel, "Active agents", "Roster target", "Effective target", "Changed", "Override from"] : [topLabel, "Active agents", "Roster target", "Effective target", "Changed", "Override from"],
                rows: rows.map((r) => [
                  r.name, ...(level === "agent" ? [r.tl ?? "", r.group ?? "", r.status ?? ""] : level === "tl" ? [r.group ?? "", r.agentCount] : [r.agentCount]),
                  Math.round(r.baselineTarget), Math.round(r.effectiveTarget), r.overridden ? "Yes" : "No", r.override ? monthLabel(r.override.effectiveMonth) : "",
                ]),
              }]}
            />
            <div className="relative">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
              <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search name…" className="w-[180px] rounded-lg border border-slate-200 bg-white py-1.5 pl-8 pr-2 text-xs text-slate-700 focus:border-orange-400 focus:outline-none" />
            </div>
          </div>
        }
        footnote="Click a row for its full detail and history. Pencil = change the target from the chosen month onwards (it replaces the roster target; the uploaded roster is not touched). A TL / {topLabel} target is the total for that TL / {topLabel} and is shared over their Active agents; agents and TLs with a target of their own keep it.">
        {rowError && <p className="mb-2 rounded-lg bg-rose-50 px-3 py-2 text-xs text-rose-700">{rowError}</p>}
        <div className="max-h-[560px] overflow-auto rounded-lg border border-slate-100">
          <table className="w-full text-center text-xs">
            <thead><tr className="sticky top-0 z-10 bg-slate-800 text-white">{[...cols, ""].map((h, i) => <th key={i} className={`whitespace-nowrap px-3 py-2 font-semibold text-white ${i === 0 ? "text-left" : ""}`}>{h}</th>)}</tr></thead>
            <tbody>
              {rows.map((r, i) => {
                const key = `${r.level}|${r.name}`;
                const isEditing = editing?.key === key;
                return (
                  <tr key={key} onClick={() => setDrawer({ level: r.level, name: r.name })} className={`cursor-pointer hover:bg-orange-50/60 ${i % 2 ? "bg-slate-50/60" : "bg-white"}`}>
                    <td className="whitespace-nowrap px-3 py-2 text-left font-semibold text-slate-700">{r.name}{r.manual && <span className="ml-1.5 rounded-full bg-sky-50 px-1.5 py-0.5 text-[9px] font-bold text-sky-700">Added here</span>}</td>
                    {level === "agent" && <><td className="px-3 py-2 text-slate-500">{r.tl}</td><td className="px-3 py-2 text-slate-500">{r.group}</td><td className="px-3 py-2"><span className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${r.status === "Active" ? "bg-emerald-50 text-emerald-700" : "bg-slate-100 text-slate-500"}`}>{r.status}</span></td></>}
                    {level === "tl" && <><td className="px-3 py-2 text-slate-500">{r.group}</td><td className="px-3 py-2 text-slate-600">{r.agentCount}</td></>}
                    {level === topLevel && <td className="px-3 py-2 text-slate-600">{r.agentCount}</td>}
                    <td className="px-3 py-2 text-slate-500">{formatINR(r.baselineTarget)}</td>
                    <td className="px-3 py-2" onClick={isEditing ? (e) => e.stopPropagation() : undefined}>
                      {isEditing ? (
                        <span className="inline-flex items-center gap-1">
                          <Input autoFocus inputMode="decimal" value={editing!.value} onChange={(e) => setEditing({ key, value: e.target.value })}
                            onKeyDown={(e) => { if (e.key === "Enter") void saveRow(r); if (e.key === "Escape") setEditing(null); }} className="h-8 w-[120px] text-center" />
                          <button type="button" disabled={rowBusy === r.name} onClick={() => void saveRow(r)} className="rounded-md bg-emerald-600 p-1.5 text-white hover:bg-emerald-700 disabled:opacity-50" aria-label="Save">{rowBusy === r.name ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}</button>
                          <button type="button" onClick={() => setEditing(null)} className="rounded-md p-1.5 text-slate-400 hover:bg-slate-100" aria-label="Cancel"><X className="h-3.5 w-3.5" /></button>
                        </span>
                      ) : (
                        <span className="font-bold text-slate-800">{formatINR(r.effectiveTarget)}</span>
                      )}
                    </td>
                    <td className="px-3 py-2">
                      {r.overridden ? <span className="inline-flex items-center rounded-full bg-violet-50 px-2 py-0.5 text-[10px] font-bold text-violet-700">Changed<Diff base={r.baselineTarget} eff={r.effectiveTarget} /></span> : <span className="text-slate-300">—</span>}
                    </td>
                    <td className="whitespace-nowrap px-2 py-2 text-right" onClick={(e) => e.stopPropagation()}>
                      {!isEditing && (
                        <>
                          <button type="button" disabled={!data.tableAvailable || !canEdit} onClick={() => { setRowError(""); setEditing({ key, value: String(Math.round(r.effectiveTarget)) }); }} className="rounded-md p-1.5 text-slate-400 hover:bg-orange-50 hover:text-orange-600 disabled:opacity-40" title="Change target" aria-label={`Change target of ${r.name}`}><Pencil className="h-3.5 w-3.5" /></button>
                          {r.manual && canEdit && <button type="button" onClick={() => setAgentForm({ agent: r.manual })} className="rounded-md p-1.5 text-slate-400 hover:bg-sky-50 hover:text-sky-600" title="Edit this agent" aria-label={`Edit agent ${r.name}`}><UserCog className="h-3.5 w-3.5" /></button>}
                          {r.manual && canEdit && (confirmRemove === r.name
                            ? <button type="button" disabled={rowBusy === r.name} onClick={() => void removeAgent(r)} className="rounded-md bg-rose-600 px-2 py-1 text-[10px] font-bold text-white hover:bg-rose-700 disabled:opacity-50">Confirm remove</button>
                            : <button type="button" onClick={() => setConfirmRemove(r.name)} className="rounded-md p-1.5 text-slate-400 hover:bg-rose-50 hover:text-rose-600" title="Remove this agent (added here)" aria-label={`Remove ${r.name}`}><Trash2 className="h-3.5 w-3.5" /></button>)}
                          {r.override && canEdit && <button type="button" disabled={!data.tableAvailable || rowBusy === r.name} onClick={() => void resetRow(r)} className="rounded-md p-1.5 text-slate-400 hover:bg-rose-50 hover:text-rose-600 disabled:opacity-40" title="Reset to the roster target" aria-label={`Reset ${r.name}`}><RotateCcw className="h-3.5 w-3.5" /></button>}
                        </>
                      )}
                    </td>
                  </tr>
                );
              })}
              {rows.length === 0 && <tr><td colSpan={cols.length + 1} className="py-6 text-slate-400">None</td></tr>}
            </tbody>
          </table>
        </div>
      </SectionCard>

      {agentForm && (
        <AgentFormDrawer key={agentForm.agent?.id ?? "new"} api={API} topLabel={topLabel} month={month} months={months} tls={data.tls.map((t) => t.name)} groups={data.groups.map((g) => g.name)}
          agent={agentForm.agent} onClose={() => setAgentForm(null)} onSaved={refresh} />
      )}

      {drawer && (
        <TargetDrawer key={`${drawer.level}|${drawer.name}`} api={API} topLevel={topLevel} topLabel={topLabel} target={drawer} month={month} tableAvailable={data.tableAvailable && canEdit}
          onClose={() => setDrawer(null)} onSaved={refresh} onOpen={setDrawer} />
      )}
    </div>
  );
}
