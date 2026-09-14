import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, Loader2, Send, ShieldAlert } from "lucide-react";
import { hrmsApi } from "@/lib/hrmsApi";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import {
  scoreQaAudit,
  type QaFormParameter,
  type QaParameterScore,
} from "../../backend/src/modules/quality-dashboard/qa-audit-scoring";

/**
 * Score one interaction against a process's QA form.
 *
 * The form builder and the metric config screens let people define what is
 * measured; until this existed nothing could actually measure it. The API had
 * been proven end-to-end and no QA analyst could reach it.
 *
 * The running total is computed with the SERVER's own scoring function, imported
 * rather than reimplemented — the same cross-boundary import the dashboards use
 * for their shared contracts. A second copy of these rules would drift, and the
 * one place it must not drift is the number an agent is judged on.
 *
 * The submitted total is still ignored by the API. What is shown here is a
 * preview; what is stored is whatever the server computes from the marks.
 */

type ProcessOption = { id: string; process_name: string };
type FormParameter = {
  id: string; section: string | null; parameter_text: string;
  max_score: number; weightage: number; is_fatal: number | boolean; display_order: number;
};
type ActiveForm = { id: string; form_name: string; version_no: number; parameters: FormParameter[] };
type Mark = { score: string; notApplicable: boolean };

export default function NativeQAFileAudit() {
  const [processes, setProcesses] = useState<ProcessOption[]>([]);
  const [processId, setProcessId] = useState("");
  const [form, setForm] = useState<ActiveForm | null>(null);
  const [noForm, setNoForm] = useState(false);
  const [employeeCode, setEmployeeCode] = useState("");
  const [auditDate, setAuditDate] = useState(new Date().toISOString().slice(0, 10));
  const [callReference, setCallReference] = useState("");
  const [remarks, setRemarks] = useState("");
  const [marks, setMarks] = useState<Record<string, Mark>>({});
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ tone: "ok" | "error"; text: string } | null>(null);

  useEffect(() => {
    hrmsApi.get<{ data?: ProcessOption[] } | ProcessOption[]>("/api/processes")
      .then((r) => setProcesses((Array.isArray(r) ? r : r?.data) ?? []))
      .catch(() => setProcesses([]));
  }, []);

  useEffect(() => {
    setForm(null); setNoForm(false); setMarks({});
    if (!processId) return;
    hrmsApi.get<{ data: ActiveForm | null; reason?: string }>(`/api/qa/audit-forms?processId=${processId}`)
      .then((r) => {
        if (!r?.data) { setNoForm(true); return; }
        setForm(r.data);
        setMarks(Object.fromEntries(r.data.parameters.map((p) => [p.id, { score: "", notApplicable: false }])));
      })
      .catch(() => setNoForm(true));
  }, [processId]);

  const parameters: QaFormParameter[] = useMemo(
    () => (form?.parameters ?? []).map((p) => ({
      id: p.id, maxScore: Number(p.max_score), isFatal: Boolean(Number(p.is_fatal)),
    })),
    [form],
  );

  const scores: QaParameterScore[] = useMemo(
    () => Object.entries(marks).map(([id, m]) => ({
      formParameterId: id,
      score: m.notApplicable || m.score === "" ? null : Number(m.score),
      notApplicable: m.notApplicable,
    })),
    [marks],
  );

  const preview = useMemo(() => scoreQaAudit(parameters, scores), [parameters, scores]);

  function setMark(id: string, patch: Partial<Mark>) {
    setMarks((prev) => ({ ...prev, [id]: { ...prev[id], ...patch } }));
  }

  const overMax = (form?.parameters ?? []).filter((p) => {
    const m = marks[p.id];
    return m && !m.notApplicable && m.score !== "" && Number(m.score) > Number(p.max_score);
  });

  const canSubmit = Boolean(form && employeeCode.trim() && auditDate && !overMax.length && preview.assessedCount > 0);

  async function submit() {
    if (!form) return;
    setBusy(true); setNotice(null);
    try {
      const res = await hrmsApi.post<{ data: { id: string; qualityPercentage: number | null; fatalTriggered: boolean; assessedCount: number } }>(
        "/api/qa/audits",
        {
          formId: form.id,
          employeeCode: employeeCode.trim(),
          auditDate,
          callReference: callReference.trim() || null,
          remarks: remarks.trim() || null,
          scores: scores.filter((s) => s.notApplicable || s.score !== null),
        },
      );
      const d = res.data;
      setNotice({
        tone: "ok",
        text: d.qualityPercentage === null
          ? `Filed. Nothing was assessable on this call, so it carries no score — that is recorded as a gap, not as zero.`
          : `Filed at ${d.qualityPercentage}%${d.fatalTriggered ? " — a fatal parameter failed, so the audit scores zero" : ""}, on ${d.assessedCount} assessed parameter${d.assessedCount === 1 ? "" : "s"}.`,
      });
      setMarks(Object.fromEntries((form.parameters ?? []).map((p) => [p.id, { score: "", notApplicable: false }])));
      setCallReference(""); setRemarks("");
    } catch (err) {
      setNotice({ tone: "error", text: (err as Error).message || "Could not file the audit" });
    } finally {
      setBusy(false);
    }
  }

  const sections = useMemo(() => {
    const map = new Map<string, FormParameter[]>();
    for (const p of form?.parameters ?? []) {
      const key = p.section?.trim() || "";
      map.set(key, [...(map.get(key) ?? []), p]);
    }
    return [...map.entries()];
  }, [form]);

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Score a call</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Mark each parameter against the process's active form. Anything that did not apply to this
          call should be marked N/A rather than zero — a zero says they failed it.
        </p>
      </div>

      {notice && (
        <div role="status" className={`rounded-md border px-4 py-3 text-sm ${
          notice.tone === "ok" ? "border-emerald-200 bg-emerald-50 text-emerald-900"
                               : "border-red-200 bg-red-50 text-red-900"}`}>
          {notice.text}
        </div>
      )}

      <div className="grid gap-4 sm:grid-cols-4 max-w-4xl">
        <div className="sm:col-span-2">
          <label htmlFor="process" className="text-sm font-medium">Process</label>
          <select id="process" value={processId} onChange={(e) => setProcessId(e.target.value)}
            className="mt-1 h-10 w-full rounded-md border border-input bg-background px-3 text-sm cursor-pointer">
            <option value="">Select a process…</option>
            {processes.map((p) => <option key={p.id} value={p.id}>{p.process_name}</option>)}
          </select>
        </div>
        <div>
          <label htmlFor="agent" className="text-sm font-medium">Agent code</label>
          <Input id="agent" value={employeeCode} onChange={(e) => setEmployeeCode(e.target.value)}
            placeholder="MAS57576" className="mt-1" />
        </div>
        <div>
          <label htmlFor="auditDate" className="text-sm font-medium">Call date</label>
          <Input id="auditDate" type="date" value={auditDate} onChange={(e) => setAuditDate(e.target.value)} className="mt-1" />
        </div>
      </div>

      {noForm && (
        <div className="rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          This process has no active QA form, so nothing can be scored against it yet. Define one
          under QA Audit Forms first.
        </div>
      )}

      {form && (
        <>
          <div className="rounded-lg border">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b px-4 py-3">
              <div className="text-sm font-medium">
                {form.form_name} · v{form.version_no}
                <span className="ml-2 font-normal text-muted-foreground">
                  {preview.assessedCount} assessed
                  {preview.notApplicableCount > 0 && ` · ${preview.notApplicableCount} N/A`}
                </span>
              </div>
              <div className="text-sm" aria-live="polite">
                {preview.fatalTriggered ? (
                  <span className="inline-flex items-center gap-1.5 font-medium text-red-700">
                    <ShieldAlert className="h-4 w-4" aria-hidden="true" />
                    Fatal failed — scores 0%
                  </span>
                ) : preview.qualityPercentage === null ? (
                  <span className="text-muted-foreground">No score yet</span>
                ) : (
                  <span className="font-medium">
                    {preview.qualityPercentage}%
                    <span className="ml-1 font-normal text-muted-foreground">
                      ({preview.totalScore} of {preview.maxScore})
                    </span>
                  </span>
                )}
              </div>
            </div>

            {overMax.length > 0 && (
              <div className="flex items-start gap-2 border-b bg-red-50 px-4 py-2 text-sm text-red-900">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
                <span>
                  {overMax.length} mark{overMax.length === 1 ? " is" : "s are"} above the parameter maximum.
                  The server rejects these rather than trimming them.
                </span>
              </div>
            )}

            {sections.map(([section, params]) => (
              <div key={section || "_"}>
                {section && (
                  <div className="border-b bg-muted/40 px-4 py-1.5 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                    {section}
                  </div>
                )}
                <ul className="divide-y">
                  {params.map((p) => {
                    const m = marks[p.id] ?? { score: "", notApplicable: false };
                    const isOver = !m.notApplicable && m.score !== "" && Number(m.score) > Number(p.max_score);
                    return (
                      <li key={p.id} className="flex flex-wrap items-center gap-4 px-4 py-3">
                        <div className="min-w-0 flex-1">
                          <span className="text-sm">{p.parameter_text}</span>
                          {Boolean(Number(p.is_fatal)) && (
                            <span className="ml-2 rounded-full bg-red-100 px-2 py-0.5 text-xs font-medium text-red-800">
                              fatal
                            </span>
                          )}
                        </div>
                        <div className="flex items-center gap-2">
                          <Input
                            type="number" min={0} max={Number(p.max_score)} step="0.5"
                            aria-label={`Score for ${p.parameter_text}`}
                            aria-invalid={isOver || undefined}
                            className={`h-9 w-24 ${isOver ? "border-red-400" : ""}`}
                            value={m.score}
                            disabled={m.notApplicable}
                            onChange={(e) => setMark(p.id, { score: e.target.value })}
                          />
                          <span className="text-sm text-muted-foreground w-12">/ {Number(p.max_score)}</span>
                          <label className="flex items-center gap-1.5 text-sm cursor-pointer">
                            <Checkbox
                              checked={m.notApplicable}
                              onCheckedChange={(v) => setMark(p.id, { notApplicable: Boolean(v), score: "" })}
                              className="cursor-pointer"
                              aria-label={`Not applicable: ${p.parameter_text}`}
                            />
                            N/A
                          </label>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              </div>
            ))}
          </div>

          <div className="grid gap-4 sm:grid-cols-2 max-w-3xl">
            <div>
              <label htmlFor="callRef" className="text-sm font-medium">Call reference</label>
              <Input id="callRef" value={callReference} onChange={(e) => setCallReference(e.target.value)}
                placeholder="Dialer id, ticket, recording name" className="mt-1" />
            </div>
            <div>
              <label htmlFor="remarks" className="text-sm font-medium">Remarks</label>
              <Input id="remarks" value={remarks} onChange={(e) => setRemarks(e.target.value)}
                placeholder="Context for the agent" className="mt-1" />
            </div>
          </div>

          <div className="flex items-center gap-3">
            <Button onClick={submit} disabled={!canSubmit || busy} className="cursor-pointer">
              {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />}
              <Send className="mr-1.5 h-4 w-4" aria-hidden="true" />
              File audit
            </Button>
            <p className="text-sm text-muted-foreground">
              The percentage above is a preview. The score that is stored is the one the server
              computes from these marks.
            </p>
          </div>
        </>
      )}
    </div>
  );
}
