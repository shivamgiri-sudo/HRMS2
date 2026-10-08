import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { hrmsApi } from "@/lib/hrmsApi";
import { useProcesses } from "@/hooks/useOrgMasters";
import { KIND_LABEL, type RequestKind } from "./types";
import { AUTO_KINDS, DEFAULT_RULE, ruleFor, validateAutoRule, type AutoRuleDraft, type AutoRuleRow } from "./autoRuleForm";

/** Exact behaviour of roster-requests.auto.ts: only requests with no blockers/warnings, future-dated. */
export const AUTO_RULE_WARNING =
  "When enabled, requests of that type that pass every roster rule (no blockers or warnings, future date) are approved automatically and the employee is notified. " +
  "An auto-approved week-off rejection is recorded as a manager force-approve. Swaps always still need the counterpart's acceptance. " +
  "Max coverage drop is stored but does not restrict anything yet. Default is off.";

export function RuleRow({ processId, kind, rows }: { processId: string; kind: RequestKind; rows: AutoRuleRow[] }) {
  const qc = useQueryClient();
  const [draft, setDraft] = useState<AutoRuleDraft>(DEFAULT_RULE);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  useEffect(() => { setDraft(ruleFor(rows, processId, kind)); setMsg(null); }, [rows, processId, kind]);
  const save = useMutation({
    mutationFn: (body: unknown) => hrmsApi.put("/api/roster-requests/auto-rules", body),
    onSuccess: () => { setMsg({ ok: true, text: "Saved." }); qc.invalidateQueries({ queryKey: ["rr", "auto-rules"] }); },
    onError: (e) => setMsg({ ok: false, text: (e as Error).message || "Could not save." }),
  });
  const submit = () => {
    const v = validateAutoRule(processId, kind, draft);
    if (v.ok === false) return setMsg({ ok: false, text: v.error });
    setMsg(null);
    save.mutate(v.body);
  };
  return (
    <div className="flex flex-wrap items-center gap-4 rounded border p-3 text-sm">
      <span className="w-36 font-medium">{KIND_LABEL[kind]}</span>
      <label className="flex items-center gap-1"><input type="checkbox" checked={draft.enabled} onChange={(e) => setDraft({ ...draft, enabled: e.target.checked })} /> Auto-approve</label>
      <label className="flex items-center gap-1">Max coverage drop
        <input aria-label={`Max coverage drop for ${KIND_LABEL[kind]}`} className="w-16 rounded border px-1 py-0.5" inputMode="numeric" value={draft.maxCoverageDrop} onChange={(e) => setDraft({ ...draft, maxCoverageDrop: e.target.value })} />
      </label>
      <label className="flex items-center gap-1"><input type="checkbox" checked={draft.requireCounterpartAccept} onChange={(e) => setDraft({ ...draft, requireCounterpartAccept: e.target.checked })} /> Require counterpart accept</label>
      <button type="button" className="rounded bg-slate-900 px-3 py-1 text-white disabled:opacity-50" disabled={save.isPending} onClick={submit}>Save</button>
      {msg ? <span role={msg.ok ? "status" : "alert"} className={msg.ok ? "text-emerald-700" : "text-red-600"}>{msg.text}</span> : null}
    </div>
  );
}

export function AutoRulesPanel() {
  const processes = useProcesses();
  const [processId, setProcessId] = useState("");
  const rules = useQuery({
    queryKey: ["rr", "auto-rules"],
    queryFn: async () => (await hrmsApi.get<{ data?: AutoRuleRow[] }>("/api/roster-requests/auto-rules")).data ?? [],
  });
  return (
    <div className="mt-4 space-y-3">
      <p className="rounded border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">{AUTO_RULE_WARNING}</p>
      {rules.isError ? <p role="alert" className="text-sm text-red-600">Could not load rules: {(rules.error as Error).message}</p> : null}
      <select aria-label="Process" className="rounded border bg-white px-2 py-1 text-sm" value={processId} onChange={(e) => setProcessId(e.target.value)}>
        <option value="">Choose a process</option>
        {(processes.data ?? []).map((p) => <option key={p.id} value={p.id}>{p.process_name ?? p.name ?? p.id}</option>)}
      </select>
      {processId ? AUTO_KINDS.map((k) => <RuleRow key={k} processId={processId} kind={k} rows={rules.data ?? []} />) : null}
    </div>
  );
}
