/** The criteria editor drawer (S16): loads the requisition's criteria and the saved preview, checks every draft with the server
 * (dry run, never saved), offers templates and copy-from, and saves with a version and audit. */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import CriteriaEditorBody from "./CriteriaEditorBody";
import EditorTools from "./EditorTools";
import { initDraft, toPatch, type Draft } from "./criteriaEditorModel";
import { selectionApi } from "./selectionApi";
import type { CriteriaIssue, CriteriaResponse, PreviewResult } from "./selectionTypes";

const errText = (e: unknown) => (e as { message?: string })?.message ?? "Something went wrong";

export default function RequisitionCriteriaEditor({ requisitionId, open, onOpenChange, focusRule, onSaved }:
  { requisitionId: string | null; open: boolean; onOpenChange: (o: boolean) => void; focusRule?: string | null; onSaved?: () => void }) {
  const [resp, setResp] = useState<CriteriaResponse | null>(null);
  const [initial, setInitial] = useState<Draft | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [saved, setSaved] = useState<PreviewResult | null>(null);
  const [whatIf, setWhatIf] = useState<PreviewResult | null>(null);
  const [issues, setIssues] = useState<CriteriaIssue[]>([]);
  const [checking, setChecking] = useState(false);
  const [reason, setReason] = useState("");
  const [ack, setAck] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!requisitionId) return;
    setError(null);
    try {
      const r = await selectionApi.criteria(requisitionId);
      const d = initDraft(r);
      setResp(r); setInitial(d); setDraft(d); setIssues(r.issues); setWhatIf(null); setAck(false);
      selectionApi.preview(requisitionId, "he", "all").then(setSaved).catch(() => setSaved(null));
    } catch (e) { setError(errText(e)); }
  }, [requisitionId]);
  useEffect(() => { if (open) { setMessage(null); setReason(""); void load(); } }, [open, load]);
  useEffect(() => {
    if (open && focusRule && resp) window.setTimeout(() => document.getElementById(`rule-${focusRule}`)?.scrollIntoView({ block: "center" }), 50);
  }, [open, focusRule, resp]);

  // every draft is checked by the server (dry run): the same validation the save applies
  const patch = useMemo(() => (draft && initial ? toPatch(draft, initial) : {}), [draft, initial]);
  const timer = useRef<number | null>(null);
  useEffect(() => {
    if (!requisitionId || !draft?.canEdit || !Object.keys(patch).length) return;
    if (timer.current) window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => {
      setChecking(true);
      selectionApi.save(requisitionId, patch, reason || null, true)
        .then((r) => setIssues(r.issues))
        .catch((e: unknown) => setIssues(((e as { payload?: { issues?: CriteriaIssue[] } })?.payload?.issues) ?? [{ level: "error", keys: [], text: errText(e) }]))
        .finally(() => setChecking(false));
    }, 400);
    return () => { if (timer.current) window.clearTimeout(timer.current); };
  }, [patch, requisitionId, draft?.canEdit]); // eslint-disable-line react-hooks/exhaustive-deps

  const save = async () => {
    if (!requisitionId || !draft || !initial) return;
    setBusy(true); setMessage(null);
    try {
      const r = await selectionApi.save(requisitionId, toPatch(draft, initial), reason.trim() || null);
      setMessage(r.versionNo ? `Saved as version ${r.versionNo}` : "No change to save");
      await load();
      onSaved?.();
    } catch (e) {
      const found = (e as { payload?: { issues?: CriteriaIssue[] } })?.payload?.issues;
      if (found) setIssues(found); else setError(errText(e));
    } finally { setBusy(false); }
  };
  const previewDraft = async () => {
    if (!requisitionId) return;
    setBusy(true);
    try { setWhatIf(await selectionApi.preview(requisitionId, "he", "all", patch)); } catch (e) { setError(errText(e)); } finally { setBusy(false); }
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="flex w-full flex-col overflow-hidden p-0 sm:max-w-3xl">
        <SheetHeader className="border-b border-slate-200 px-4 py-3 dark:border-slate-700">
          <SheetTitle>Selection criteria</SheetTitle>
          <SheetDescription>Who this requisition shortlists, one rule at a time. Changes are versioned and audited.</SheetDescription>
        </SheetHeader>
        <div className="flex-1 overflow-y-auto overflow-x-hidden px-4 py-3">
          {error && <p role="alert" className="mb-3 rounded-lg border border-rose-300 bg-rose-50 px-3 py-2 text-sm text-rose-900 dark:border-rose-700 dark:bg-rose-950 dark:text-rose-100">{error}</p>}
          {!resp || !draft || !initial ? (
            <div aria-busy="true" aria-label="Loading criteria" className="space-y-2">{[0, 1, 2, 3, 4].map((i) => <div key={i} className="h-16 animate-pulse rounded-lg bg-slate-100 motion-reduce:animate-none dark:bg-slate-800" />)}</div>
          ) : (
            <CriteriaEditorBody resp={resp} draft={draft} initial={initial} onDraft={(d) => { setDraft(d); setWhatIf(null); }} issues={issues} checking={checking}
              reason={reason} onReason={setReason} ack={ack} onAck={setAck} saved={saved} whatIf={whatIf} busy={busy} message={message} onSave={save} onPreviewDraft={previewDraft}
              tools={<EditorTools requisitionId={requisitionId!} reason={reason} approved={draft.approvalStatus === "approved"} onApplied={async (text) => { setMessage(text); await load(); onSaved?.(); }} />} />
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
