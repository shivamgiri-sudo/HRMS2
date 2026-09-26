import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { hrmsApi } from "@/lib/hrmsApi";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { DASH, fmtDate, fmtDateTime, fmtHc, fmtInt } from "./onfidoReportShared";

/**
 * Approved HC per queue, effective-dated (onfido_manpower_plan). This is the one figure the
 * Overview's Required HC / Buffer % / Shortfall cannot get from any uploaded report, so WFM
 * enters it here. Required HC is always Approved x 120%, computed on read, never stored.
 */

export type PlanQueue = "EXTRACTION" | "POA" | "ENCORD";

export interface PlanRecord {
  id: string; processQueue: PlanQueue; effectiveFrom: string; approvedHc: number; activeHc: number | null;
  remarks: string | null; createdBy: string | null; createdAt: string | null; updatedBy: string | null; updatedAt: string | null;
}

export const QUEUE_OPTIONS: { key: PlanQueue; label: string }[] = [
  { key: "EXTRACTION", label: "EWYS Queue" },
  { key: "POA", label: "POA Queue" },
  { key: "ENCORD", label: "Encord" },
];

export function usePlanRecords() {
  return useQuery({
    queryKey: ["onfido-process", "wfm-manpower-plan"],
    queryFn: () => hrmsApi.get<{ data: PlanRecord[] }>("/api/onfido-process/wfm-inputs/manpower-plan"),
  });
}

export function useCanEditWfmInputs(): boolean {
  const q = useQuery({
    queryKey: ["onfido-process", "wfm-can-edit"],
    queryFn: () => hrmsApi.get<{ data: { canEdit: boolean } }>("/api/onfido-process/wfm-inputs/can-edit"),
    staleTime: 5 * 60 * 1000,
  });
  return q.data?.data.canEdit === true;
}

const todayIso = () => new Date().toISOString().slice(0, 10);

export function OnfidoManpowerPlanSheet({ open, onOpenChange, canEdit }: { open: boolean; onOpenChange: (v: boolean) => void; canEdit: boolean }) {
  const qc = useQueryClient();
  const plan = usePlanRecords();
  const [queue, setQueue] = useState<PlanQueue>("EXTRACTION");
  const [effectiveFrom, setEffectiveFrom] = useState(todayIso());
  const [approved, setApproved] = useState("");
  const [active, setActive] = useState("");
  const [remarks, setRemarks] = useState("");
  const [message, setMessage] = useState<{ tone: "ok" | "error"; text: string } | null>(null);

  const save = useMutation({
    mutationFn: () => hrmsApi.put("/api/onfido-process/wfm-inputs/manpower-plan", {
      processQueue: queue, effectiveFrom, approvedHc: approved, activeHc: queue === "ENCORD" ? active : null, remarks,
    }),
    onSuccess: async () => {
      setMessage({ tone: "ok", text: "Saved." });
      setApproved(""); setActive(""); setRemarks("");
      await qc.invalidateQueries({ queryKey: ["onfido-process"] });
    },
    onError: (e: unknown) => setMessage({ tone: "error", text: e instanceof Error ? e.message : "Could not save." }),
  });

  const rows = plan.data?.data ?? [];
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="onfido-central-theme oc-sheet w-full overflow-y-auto sm:max-w-2xl">
        <SheetHeader>
          <SheetTitle className="!text-[color:var(--text)]">Approved headcount by queue</SheetTitle>
          <SheetDescription className="!text-[color:var(--muted)]">
            Required HC = Approved HC x 120%. A value applies from its effective date until the next one for the same queue.
          </SheetDescription>
        </SheetHeader>

        {canEdit ? (
          <form
            className="mt-4 grid grid-cols-2 gap-3"
            onSubmit={(e) => { e.preventDefault(); setMessage(null); save.mutate(); }}
          >
            <div className="oc-field">
              <label htmlFor="plan-queue">Queue</label>
              <select id="plan-queue" className="oc-select" value={queue} onChange={(e) => setQueue(e.target.value as PlanQueue)}>
                {QUEUE_OPTIONS.map((o) => <option key={o.key} value={o.key}>{o.label}</option>)}
              </select>
            </div>
            <div className="oc-field">
              <label htmlFor="plan-date">Effective from</label>
              <input id="plan-date" type="date" className="oc-input" value={effectiveFrom} onChange={(e) => setEffectiveFrom(e.target.value)} required />
            </div>
            <div className="oc-field">
              <label htmlFor="plan-approved">Approved HC</label>
              <input id="plan-approved" type="number" min={0} step={1} className="oc-input" value={approved} onChange={(e) => setApproved(e.target.value)} required />
            </div>
            {queue === "ENCORD" && (
              <div className="oc-field">
                <label htmlFor="plan-active">Active HC (Encord, entered)</label>
                <input id="plan-active" type="number" min={0} step={1} className="oc-input" value={active} onChange={(e) => setActive(e.target.value)} />
              </div>
            )}
            <div className="oc-field col-span-2">
              <label htmlFor="plan-remarks">Remarks</label>
              <input id="plan-remarks" type="text" maxLength={255} className="oc-input" value={remarks} onChange={(e) => setRemarks(e.target.value)} />
            </div>
            <div className="col-span-2 flex items-center gap-3">
              <button type="submit" className="oc-pill-btn active" disabled={save.isPending}>{save.isPending ? "Saving..." : "Save"}</button>
              {message && (
                <span role="status" style={{ fontSize: 12, color: message.tone === "ok" ? "var(--green)" : "var(--red)" }}>{message.text}</span>
              )}
            </div>
          </form>
        ) : (
          <div className="mt-4 text-sm" style={{ color: "var(--muted)" }}>Your role can view approved HC but not change it.</div>
        )}

        <div className="oc-kv-label mt-6">Entered so far</div>
        <div style={{ overflowX: "auto" }}>
          <table className="oc-table">
            <thead>
              <tr><th>Queue</th><th>Effective from</th><th className="oc-right">Approved HC</th><th className="oc-right">Required HC</th><th className="oc-right">Active HC (entered)</th><th>Entered</th></tr>
            </thead>
            <tbody>
              {rows.length === 0 && <tr className="oc-empty-row"><td colSpan={6}>None</td></tr>}
              {rows.map((r) => (
                <tr key={r.id}>
                  <td>{QUEUE_OPTIONS.find((o) => o.key === r.processQueue)?.label}</td>
                  <td>{fmtDate(r.effectiveFrom)}</td>
                  <td className="oc-right">{fmtInt(r.approvedHc)}</td>
                  <td className="oc-right">{fmtHc(r.approvedHc * 1.2)}</td>
                  <td className="oc-right">{r.activeHc === null ? DASH : fmtInt(r.activeHc)}</td>
                  <td>{fmtDateTime(r.updatedAt ?? r.createdAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </SheetContent>
    </Sheet>
  );
}
