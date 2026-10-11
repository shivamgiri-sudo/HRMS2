/**
 * Hiring Engine - open requisitions that still have no assessment (BMI) link. Each row edits the link in place with the same editor the
 * requisition page uses (PATCH /api/job-requisition/:id). The follow-up reads the link from the requisition at every send, so a link saved
 * here is used from the next message, even while the requisition is live. Hidden when nothing is missing or the user cannot edit.
 */
import { useCallback, useEffect, useState } from "react";
import { hrmsApi } from "@/lib/hrmsApi";
import { useWorkforceAccess } from "@/hooks/useUserRole";
import AssessmentLinkEditor from "@/components/requisition/AssessmentLinkEditor";
import { ASSESSMENT_LINK_EDIT_ROLES, validateAssessmentLink } from "@/components/requisition/assessmentLink.model";

interface Req { id: string; requisition_code: string; designation_name: string | null; branch_name: string | null; process_name: string | null; approval_status: string; active_status: number | null; requested_headcount: number; fulfilled_headcount: number; bmi_assessment_url: string | null; requisition_validity: string | null }

export default function BmiLinksCard() {
  const { roleKeys } = useWorkforceAccess();
  const canEdit = (roleKeys ?? []).some((r: string) => (ASSESSMENT_LINK_EDIT_ROLES as readonly string[]).includes(r));
  const [rows, setRows] = useState<Req[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [bulkLink, setBulkLink] = useState("");
  const [bulkMsg, setBulkMsg] = useState<string | null>(null);
  const [bulkBusy, setBulkBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const r = await hrmsApi.get<{ data?: Req[] }>("/api/job-requisition?approval_status=approved&limit=200");
      const all = Array.isArray(r?.data) ? r.data : [];
      setRows(all.filter((x) => Number(x.active_status ?? 1) === 1 && x.fulfilled_headcount < x.requested_headcount && !String(x.bmi_assessment_url ?? "").trim()));
      setFailed(false);
    } catch { setFailed(true); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  // One link for everything that shares a process and role (the Onfido requisitions all use the same assessment).
  const applyAll = async () => {
    const problem = validateAssessmentLink(bulkLink);
    if (problem) { setBulkMsg(problem); return; }
    const targets = rows ?? [];
    if (!window.confirm(`Save this link on ${targets.length} requisitions?`)) return;
    setBulkBusy(true); setBulkMsg(null);
    let ok = 0; const done = new Set<string>();
    for (const r of targets) {
      try { await hrmsApi.patch(`/api/job-requisition/${r.id}`, { bmi_assessment_url: bulkLink.trim() }); ok++; done.add(r.id); } catch { /* counted below */ }
    }
    setRows((cur) => (cur ?? []).filter((x) => !done.has(x.id)));
    setBulkMsg(`Saved on ${ok} of ${targets.length} requisitions${ok < targets.length ? "; the rest need the edit one by one" : ""}.`);
    setBulkBusy(false);
  };

  if (failed || !rows || rows.length === 0) return null;
  return (
    <section className="rounded-xl border border-amber-300 bg-amber-50 p-4 dark:border-amber-700 dark:bg-amber-950" aria-labelledby="bmi-missing-title">
      <h2 id="bmi-missing-title" className="text-sm font-bold text-amber-900 dark:text-amber-100">{rows.length} open requisition{rows.length === 1 ? "" : "s"} without an assessment (BMI) link</h2>
      <p className="mt-1 text-xs text-amber-900 dark:text-amber-100">Invites for these go out without the link. Save a link and it is used from the next message, even while the requisition is live.</p>
      {canEdit && rows.length > 1 && (
        <div className="mt-3 flex flex-wrap items-end gap-2 rounded-lg border border-amber-200 bg-white p-3 dark:border-amber-800 dark:bg-slate-900">
          <label className="min-w-[16rem] flex-1 text-xs font-semibold text-slate-700 dark:text-slate-200">Same link for all {rows.length}
            <input type="url" value={bulkLink} onChange={(e) => setBulkLink(e.target.value)} placeholder="https://..." className="mt-1 block h-10 w-full rounded-lg border border-slate-300 px-3 text-sm font-normal text-slate-900 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100" />
          </label>
          <button type="button" disabled={bulkBusy || !bulkLink.trim()} onClick={() => void applyAll()} className="h-10 cursor-pointer rounded-lg bg-blue-600 px-4 text-sm font-semibold text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50">{bulkBusy ? "Saving..." : "Save on all"}</button>
          {bulkMsg && <p role="status" className="basis-full text-xs text-slate-700 dark:text-slate-200">{bulkMsg}</p>}
        </div>
      )}
      <ul className="mt-3 space-y-3">
        {rows.map((r) => (
          <li key={r.id} className="rounded-lg border border-amber-200 bg-white p-3 dark:border-amber-800 dark:bg-slate-900">
            <p className="text-sm font-semibold text-slate-900 dark:text-slate-100">
              {r.requisition_code} <span className="font-normal text-slate-600 dark:text-slate-300">· {r.designation_name ?? "-"} · {r.branch_name ?? "-"}{r.process_name ? ` · ${r.process_name}` : ""} · {r.requested_headcount - r.fulfilled_headcount} seats open{r.requisition_validity ? ` · deadline ${String(r.requisition_validity).slice(0, 10)}` : ""}</span>
            </p>
            <AssessmentLinkEditor requisitionId={r.id} initialValue={null} canEdit={canEdit} onSaved={(v) => { if (v) setRows((cur) => (cur ?? []).filter((x) => x.id !== r.id)); }} />
          </li>
        ))}
      </ul>
    </section>
  );
}
