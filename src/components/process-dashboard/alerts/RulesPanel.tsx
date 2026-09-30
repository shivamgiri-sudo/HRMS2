import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Pencil, Plus, Send, Trash2 } from "lucide-react";
import { Empty, ErrorBox, Skeleton, btn } from "../ui";
import { alertsKey, deleteRule, fetchRules, testRule, updateRule, type AlertRule, type MetricChoice, type SendSummary } from "./api";
import { describeRule, errMsg, primaryBtn, when } from "./alertUi";
import { SeverityBadge } from "./SeverityBadge";
import { RuleBuilder } from "./RuleBuilder";

interface Props { processId: string; metrics: MetricChoice[]; tlOptions: string[]; lobOptions: string[]; canManage: boolean }

export function RulesPanel({ processId, metrics, tlOptions, lobOptions, canManage }: Props) {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: alertsKey(processId, "rules"), queryFn: () => fetchRules(processId) });
  const [editing, setEditing] = useState<AlertRule | "new" | null>(null);
  const [confirmDel, setConfirmDel] = useState<string | null>(null);
  const [testResult, setTestResult] = useState<{ id: string; r: SendSummary } | null>(null);
  const inv = () => void qc.invalidateQueries({ queryKey: alertsKey(processId) });
  const toggle = useMutation({ mutationFn: (r: AlertRule) => updateRule(processId, r.id, { ...r, enabled: !r.enabled }), onSuccess: inv });
  const del = useMutation({ mutationFn: (id: string) => deleteRule(processId, id), onSuccess: () => { setConfirmDel(null); inv(); } });
  const test = useMutation({ mutationFn: (id: string) => testRule(processId, id).then((r) => ({ id, r })), onSuccess: (v) => setTestResult(v) });
  const err = toggle.error ?? del.error ?? test.error;
  return (
    <section aria-label="Alert rules" className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-slate-700">Rules are checked against the same numbers as the dashboard tiles, every 15 minutes.</p>
        {canManage && <button type="button" onClick={() => setEditing("new")} className={primaryBtn}><Plus className="h-4 w-4" aria-hidden="true" />New rule</button>}
      </div>
      {err && <ErrorBox message={errMsg(err)} />}
      {q.isLoading ? <div className="space-y-2"><Skeleton className="h-20" /><Skeleton className="h-20" /></div>
        : q.isError ? <ErrorBox message={errMsg(q.error, "Could not load rules.")} onRetry={() => void q.refetch()} />
        : !q.data?.length ? <Empty>{canManage ? "No alert rules yet. Create one to be told when a KPI slips." : "No alert rules have been set up for this process."}</Empty>
        : (
          <ul className="space-y-2">
            {q.data.map((r) => (
              <li key={r.id} className={`rounded-xl border bg-white p-3 ${r.enabled ? "border-slate-200" : "border-slate-200 opacity-70"}`}>
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0 flex-1">
                    <p className="flex flex-wrap items-center gap-2 text-sm font-bold text-slate-900">{r.name}<SeverityBadge s={r.severity} />{!r.enabled && <span className="rounded-full bg-slate-200 px-2 py-0.5 text-[11px] font-bold text-slate-800">Off</span>}</p>
                    <p className="mt-0.5 text-sm text-slate-800">{describeRule(r, metrics)}</p>
                    <p className="mt-1 text-xs text-slate-700">{r.scopeTl || r.scopeLob ? `Scope: ${[r.scopeTl && `TL ${r.scopeTl}`, r.scopeLob && `LOB ${r.scopeLob}`].filter(Boolean).join(", ")} · ` : ""}
                      {r.channels.map((c) => (c === "in_app" ? "In-app" : "E-mail")).join(" + ")} · {r.recipients.roles.length + r.recipients.tls.length + r.recipients.employeeIds.length} recipient group{r.recipients.roles.length + r.recipients.tls.length + r.recipients.employeeIds.length === 1 ? "" : "s"} · last fired {when(r.lastFiredAt)}</p>
                  </div>
                  {canManage && (
                    <div className="flex flex-wrap items-center gap-1.5">
                      <label className="inline-flex min-h-[36px] cursor-pointer items-center gap-1.5 text-xs font-semibold text-slate-800"><input type="checkbox" role="switch" checked={r.enabled} disabled={toggle.isPending} onChange={() => toggle.mutate(r)} className="h-4 w-4" />Enabled<span className="sr-only"> {r.name}</span></label>
                      <button type="button" onClick={() => test.mutate(r.id)} disabled={test.isPending} className={btn}><Send className="h-3.5 w-3.5" aria-hidden="true" />Send test<span className="sr-only"> for {r.name}</span></button>
                      <button type="button" onClick={() => setEditing(r)} className={btn}><Pencil className="h-3.5 w-3.5" aria-hidden="true" />Edit<span className="sr-only"> {r.name}</span></button>
                      {confirmDel === r.id ? (
                        <><button type="button" onClick={() => del.mutate(r.id)} disabled={del.isPending} className={`${btn} border-red-400 text-red-800`}>Confirm delete</button>
                          <button type="button" onClick={() => setConfirmDel(null)} className={btn}>Keep</button></>
                      ) : <button type="button" onClick={() => setConfirmDel(r.id)} className={`${btn} text-red-800`}><Trash2 className="h-3.5 w-3.5" aria-hidden="true" />Delete<span className="sr-only"> {r.name}</span></button>}
                    </div>
                  )}
                </div>
                {testResult?.id === r.id && (
                  <p role="status" className="mt-2 rounded-lg bg-emerald-50 px-3 py-2 text-xs text-emerald-900">Test sent to you only: {testResult.r.inApp} in-app, {testResult.r.email} e-mail{testResult.r.emailSkippedNoAddress ? " (you have no official e-mail on file)" : ""}{testResult.r.emailFailed ? `; e-mail failed: ${testResult.r.emailError ?? "transport error"}` : ""}.</p>
                )}
              </li>
            ))}
          </ul>
        )}
      {editing && <RuleBuilder key={editing === "new" ? "new" : editing.id} processId={processId} rule={editing === "new" ? null : editing} metrics={metrics} tlOptions={tlOptions} lobOptions={lobOptions} onClose={() => setEditing(null)} />}
    </section>
  );
}
