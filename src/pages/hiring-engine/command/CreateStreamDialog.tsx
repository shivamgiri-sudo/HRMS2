/**
 * "Open a stream" dialog (the repo's Radix Dialog: focus trap and Escape built in). Requisition, source type (three radio buttons),
 * origin (the requisition's linked live campaigns, its campaign / batch launches, or the pool), start date, days, daily invites and
 * Open now. The readiness problems load BEFORE submit whenever the requisition or type changes; the "Override (admins only)" box
 * appears only when every blocking problem is overridable (the server ignores it for non-admins). Writes POST /requisition-streams.
 */
import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { Loader2, ShieldAlert } from "lucide-react";
import { hrmsApi } from "@/lib/hrmsApi";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { SOURCE_TYPES, TYPE_LABEL, isUuidShape } from "./driveCommandModel";
import { describeError } from "./commandData";
import type { RequisitionOption } from "./commandData";
import type { ReadinessProblem, SourceType, StreamView } from "./driveCommandTypes";
import {
  CAMPAIGNS_PATH, LAUNCHES_PATH, STREAMS_PATH, canOverride, createBody, createErrors, createSuccessText, defaultCreateForm, errorText, originOptions,
  parseReadiness, readinessPath, toCreateForm, type CampaignOption, type CreateFormText, type LaunchOption,
} from "./streamActionsModel";
import { BTN, FIELD, FormErrors, LABEL, PRIMARY, ProblemList } from "./StreamActions";

export type { CreateFormText };

export interface ReadinessState { loading: boolean; error: string | null; problems: ReadinessProblem[]; neverOverride: string[] }
type Origin = { id: string; label: string };

export interface CreateStreamFormProps {
  form: CreateFormText; requisitions: RequisitionOption[]; lockRequisition: boolean; today: string;
  origins: Origin[]; originsLoading: boolean; originsError: string | null; readiness: ReadinessState;
  errors: string[]; showErrors: boolean; serverError: { text: string; problems: ReadinessProblem[] } | null; busy: boolean;
  onChange: (next: CreateFormText) => void; onCancel?: () => void; idPrefix: string;
}

const NO_ORIGIN: Record<SourceType, string> = {
  meta_live: "No live campaign is linked to this requisition. Link one in the campaign settings first.",
  meta_old: "No campaign or batch launch of this requisition among the latest 40 launches. Paste the launch drive id instead.",
  he: "",
};

/** Presentational form (static-markup tested); the dialog wrapper holds the state and the requests. */
export function CreateStreamForm({ form, requisitions, lockRequisition, today, origins, originsLoading, originsError, readiness, errors, showErrors, serverError, busy, onChange, onCancel, idPrefix }: CreateStreamFormProps) {
  const set = (p: Partial<CreateFormText>) => onChange({ ...form, ...p });
  const id = (k: string) => `${idPrefix}-${k}`;
  const req = requisitions.find((r) => r.id === form.requisitionId);
  const overridable = canOverride(readiness.problems, readiness.neverOverride);
  const blocking = readiness.problems.some((p) => p.severity === "blocking");
  return (
    <div className="space-y-4">
      <div className="space-y-1">
        {lockRequisition
          ? <><p className={LABEL}>Requisition</p><p className="text-sm font-semibold text-slate-900 dark:text-slate-100">{req?.label ?? "This requisition"}</p></>
          : (<>
            <label htmlFor={id("req")} className={LABEL}>Requisition</label>
            <select id={id("req")} className={FIELD} value={form.requisitionId} disabled={busy} onChange={(e) => set({ requisitionId: e.target.value, originId: form.sourceType === "he" ? "pool" : "", override: false })}>
              <option value="">Pick a requisition</option>
              {requisitions.map((r) => <option key={r.id} value={r.id}>{r.branch ? `${r.label} · ${r.branch}` : r.label}</option>)}
            </select>
          </>)}
      </div>

      <fieldset className="space-y-1">
        <legend className={LABEL}>Source</legend>
        <div className="flex flex-wrap gap-2">
          {SOURCE_TYPES.map((t) => (
            <label key={t} className={`inline-flex min-h-11 cursor-pointer items-center gap-2 rounded-lg border px-3 text-sm text-slate-800 dark:text-slate-100 sm:min-h-9 ${form.sourceType === t ? "border-blue-600 font-semibold dark:border-blue-400" : "border-slate-300 dark:border-slate-600"}`}>
              <input type="radio" name={id("type")} value={t} checked={form.sourceType === t} disabled={busy} className="h-4 w-4 cursor-pointer accent-blue-700"
                onChange={() => set({ sourceType: t, originId: t === "he" ? "pool" : "", override: false })} />
              {TYPE_LABEL[t]}
            </label>
          ))}
        </div>
      </fieldset>

      <div className="space-y-1">
        <label htmlFor={id("origin")} className={LABEL}>{form.sourceType === "meta_live" ? "Campaign" : form.sourceType === "meta_old" ? "Launch to re-run" : "Pool"}</label>
        {originsLoading && <p role="status" className="text-xs text-slate-600 dark:text-slate-300">Loading the sources…</p>}
        {originsError && <p role="alert" className="text-xs text-rose-800 dark:text-rose-200">Could not load the sources: {originsError}</p>}
        {origins.length > 0 && (
          <select id={id("origin")} className={FIELD} value={form.originId} disabled={busy} onChange={(e) => set({ originId: e.target.value })}>
            {form.sourceType !== "he" && <option value="">Pick a source</option>}
            {origins.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
          </select>
        )}
        {!originsLoading && origins.length === 0 && form.sourceType !== "he" && (
          <p className="text-xs text-slate-700 dark:text-slate-200">{form.requisitionId ? NO_ORIGIN[form.sourceType] : "Pick a requisition first."}</p>
        )}
        {!originsLoading && origins.length === 0 && form.sourceType === "meta_old" && form.requisitionId && (
          <div className="space-y-1">
            <label htmlFor={id("origin-typed")} className={LABEL}>Launch drive id</label>
            <input id={id("origin-typed")} className={FIELD} value={form.originId} disabled={busy} maxLength={36} autoComplete="off" spellCheck={false}
              aria-invalid={form.originId !== "" && !isUuidShape(form.originId)} onChange={(e) => set({ originId: e.target.value.trim() })} />
          </div>
        )}
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <div className="space-y-1">
          <label htmlFor={id("from")} className={LABEL}>Start date</label>
          <input id={id("from")} type="date" min={today} className={FIELD} value={form.openFrom} disabled={busy} onChange={(e) => set({ openFrom: e.target.value })} />
        </div>
        <div className="space-y-1">
          <label htmlFor={id("days")} className={LABEL}>Working days (1 to 60)</label>
          <input id={id("days")} type="number" inputMode="numeric" min={1} max={60} step={1} className={FIELD} value={form.openDays} disabled={busy} onChange={(e) => set({ openDays: e.target.value })} />
        </div>
        <div className="space-y-1">
          <label htmlFor={id("invites")} className={LABEL}>Daily invites</label>
          <input id={id("invites")} type="number" inputMode="numeric" min={1} max={500} step={1} placeholder="Plan default" className={FIELD} value={form.dailyInvites} disabled={busy} onChange={(e) => set({ dailyInvites: e.target.value })} />
        </div>
      </div>

      <section aria-label="Readiness" aria-busy={readiness.loading} className="space-y-1 rounded-lg border border-slate-200 p-3 dark:border-slate-700">
        <h4 className={LABEL}>Readiness</h4>
        {readiness.loading && <p role="status" className="flex items-center gap-2 text-xs text-slate-700 dark:text-slate-200"><Loader2 className="h-3.5 w-3.5 animate-spin motion-reduce:animate-none" aria-hidden /> Checking readiness…</p>}
        {readiness.error && <p role="alert" className="text-xs text-rose-800 dark:text-rose-200">Could not check readiness: {readiness.error}. The server still checks it when the stream opens.</p>}
        {!readiness.loading && !readiness.error && form.requisitionId && readiness.problems.length === 0 && <p className="text-xs text-slate-700 dark:text-slate-200">No problems found.</p>}
        <ProblemList problems={readiness.problems} />
        {blocking && !overridable && <p className="text-xs text-slate-700 dark:text-slate-200">At least one blocking problem can never be overridden: the stream can be saved as a draft only.</p>}
      </section>

      <div className="space-y-2">
        <label className="flex min-h-11 cursor-pointer items-center gap-2 text-sm text-slate-800 dark:text-slate-100 sm:min-h-8">
          <input type="checkbox" className="h-4 w-4 cursor-pointer accent-blue-700" checked={form.open} disabled={busy} onChange={(e) => set({ open: e.target.checked, override: e.target.checked && form.override })} />
          Open now (otherwise it is saved as a draft)
        </label>
        {overridable && form.open && (
          <label className="flex min-h-11 cursor-pointer items-center gap-2 text-sm text-slate-800 dark:text-slate-100 sm:min-h-8">
            <input type="checkbox" className="h-4 w-4 cursor-pointer accent-blue-700" checked={form.override} disabled={busy} onChange={(e) => set({ override: e.target.checked })} />
            <ShieldAlert className="h-4 w-4 text-amber-700 dark:text-amber-300" aria-hidden /> Override (admins only)
          </label>
        )}
      </div>

      <div className="space-y-1">
        <label htmlFor={id("reason")} className={LABEL}>Reason (optional)</label>
        <textarea id={id("reason")} rows={2} maxLength={255} className={`${FIELD} py-2`} value={form.reason} disabled={busy} onChange={(e) => set({ reason: e.target.value })} />
      </div>

      <FormErrors errors={errors} show={showErrors} serverError={serverError} />

      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        {onCancel && <button type="button" className={BTN} disabled={busy} onClick={onCancel}>Cancel</button>}
        <button type="submit" className={PRIMARY} disabled={busy}>
          {busy ? <><Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none" aria-hidden /> Creating…</> : form.open ? "Create and open" : "Create draft"}
        </button>
      </div>
    </div>
  );
}

export interface CreateStreamDialogProps {
  open: boolean; onOpenChange: (open: boolean) => void; requisitions: RequisitionOption[]; requisitionId?: string | null;
  sourceType?: SourceType; lockRequisition?: boolean; today: string; onCreated: (s: StreamView, text: string) => void;
}

/** State, the three reads (campaigns, launches, readiness) and the write. Mounted only while open, so each opening starts fresh. */
function CreatePanel({ requisitions, requisitionId, sourceType, lockRequisition = false, today, onCreated, onCancel, onBusy }: Omit<CreateStreamDialogProps, "open" | "onOpenChange"> & { onCancel: () => void; onBusy: (b: boolean) => void }) {
  const idPrefix = `cs-${useId().replaceAll(":", "")}`;
  const [form, setForm] = useState<CreateFormText>(() => {
    const d = defaultCreateForm(today, requisitionId ?? "", sourceType ?? "meta_live");
    return { ...d, openDays: String(d.openDays), dailyInvites: "" };
  });
  const [campaigns, setCampaigns] = useState<CampaignOption[] | null>(null);
  const [launches, setLaunches] = useState<LaunchOption[] | null>(null);
  const [listError, setListError] = useState<string | null>(null);
  const [readiness, setReadiness] = useState<ReadinessState>({ loading: false, error: null, problems: [], neverOverride: [] });
  const [busy, setBusy] = useState(false);
  const [tried, setTried] = useState(false);
  const [serverError, setServerError] = useState<{ text: string; problems: ReadinessProblem[] } | null>(null);

  useEffect(() => { onBusy(busy); }, [busy, onBusy]);
  const t = form.sourceType;
  useEffect(() => {
    const need = t === "meta_live" ? campaigns === null : t === "meta_old" ? launches === null : false;
    if (!need) return;
    const c = new AbortController();
    setListError(null);
    hrmsApi.get<{ data?: unknown }>(t === "meta_live" ? CAMPAIGNS_PATH : LAUNCHES_PATH, undefined, c.signal)
      .then((r) => {
        if (c.signal.aborted) return;
        const list = Array.isArray(r?.data) ? r.data : [];
        if (t === "meta_live") setCampaigns(list as CampaignOption[]); else setLaunches(list as LaunchOption[]);
      })
      .catch((e: unknown) => { if (!c.signal.aborted) { setListError(describeError(e)); if (t === "meta_live") setCampaigns([]); else setLaunches([]); } });
    return () => c.abort();
  }, [t, campaigns, launches]);

  useEffect(() => {
    if (!isUuidShape(form.requisitionId || null)) { setReadiness({ loading: false, error: null, problems: [], neverOverride: [] }); return; }
    const c = new AbortController();
    setReadiness((r) => ({ ...r, loading: true, error: null }));
    hrmsApi.get<{ data?: unknown }>(readinessPath(form.requisitionId, t), undefined, c.signal)
      .then((r) => {
        if (c.signal.aborted) return;
        const parsed = parseReadiness(r?.data);
        setReadiness(parsed ? { loading: false, error: null, ...parsed } : { loading: false, error: "Unexpected response from the server", problems: [], neverOverride: [] });
      })
      .catch((e: unknown) => { if (!c.signal.aborted) setReadiness({ loading: false, error: errorText(e, { what: "create" }).text, problems: [], neverOverride: [] }); });
    return () => c.abort();
  }, [form.requisitionId, t]);

  const req = requisitions.find((r) => r.id === form.requisitionId);
  const origins = useMemo(() => originOptions(t, { code: req?.code ?? "" }, campaigns ?? [], launches ?? []), [t, req?.code, campaigns, launches]);
  const originsLoading = t === "meta_live" ? campaigns === null : t === "meta_old" ? launches === null : false;
  const parsed = toCreateForm(form);
  const errors = createErrors(parsed, today, readiness.problems, readiness.neverOverride);

  const submit = async () => {
    if (busy) return;
    setTried(true);
    if (errors.length) return;
    setBusy(true);
    setServerError(null);
    try {
      const r = await hrmsApi.post<{ data?: StreamView }>(STREAMS_PATH, createBody(parsed));
      if (!r?.data) { setServerError(errorText(null)); return; }
      onCreated(r.data, createSuccessText(r.data));
    } catch (e: unknown) {
      setServerError(errorText(e, { what: "create", overrideAsked: parsed.open && parsed.override }));
    } finally {
      setBusy(false);
    }
  };

  return (
    <form noValidate aria-busy={busy} onSubmit={(e) => { e.preventDefault(); void submit(); }}>
      <CreateStreamForm form={form} requisitions={requisitions} lockRequisition={lockRequisition && !!req} today={today} origins={origins} originsLoading={originsLoading}
        originsError={listError} readiness={readiness} errors={errors} showErrors={tried} serverError={serverError} busy={busy} onChange={setForm} onCancel={onCancel} idPrefix={idPrefix} />
    </form>
  );
}

export default function CreateStreamDialog({ open, onOpenChange, ...rest }: CreateStreamDialogProps) {
  // While the request runs the dialog stays open (Escape, outside click and the close button are ignored).
  const busy = useRef(false);
  const setBusy = useCallback((b: boolean) => { busy.current = b; }, []);
  return (
    <Dialog open={open} onOpenChange={(o) => { if (!busy.current) onOpenChange(o); }}>
      <DialogContent className="max-h-screen max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Open a stream</DialogTitle>
          <DialogDescription className="text-slate-700 dark:text-slate-200">A stream plans drive days for one requisition from one source. Readiness is checked before it opens.</DialogDescription>
        </DialogHeader>
        {open && <CreatePanel {...rest} onBusy={setBusy} onCancel={() => onOpenChange(false)} />}
      </DialogContent>
    </Dialog>
  );
}
