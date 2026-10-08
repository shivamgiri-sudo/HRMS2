/**
 * Stream actions: the Extend menu (a real button with aria-haspopup / aria-expanded; menu items are buttons; Escape closes and
 * returns focus; arrow keys move between items), one confirmation dialog per change (the repo's Radix AlertDialog: focus trap and
 * Escape built in) with a date / days field when needed and an optional reason. The request is never optimistic: the confirm button
 * shows a busy label while it runs, the server's stream replaces the row, and failures stay in the dialog with the server's reason.
 */
import { useCallback, useEffect, useId, useRef, useState, type KeyboardEvent, type RefObject } from "react";
import { AlertTriangle, CalendarPlus, CheckCircle2, ChevronDown, Loader2, Plus, RefreshCw, XCircle } from "lucide-react";
import { hrmsApi } from "@/lib/hrmsApi";
import {
  AlertDialog, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  STATUS_WORD, changeBody, changePath, confirmView, errorText, menuItems, needsDate, problemRows, streamLabel, streamPath, streamStatus,
  successText, windowEnded, type ActionInput, type MenuAction,
} from "./streamActionsModel";
import { createRequestSequencer } from "./commandData";
import { createInFlightGuard } from "./inFlight";
import type { ReadinessProblem, StreamView } from "./driveCommandTypes";

export const BTN = "inline-flex min-h-11 cursor-pointer items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 text-sm font-semibold text-slate-800 transition-colors duration-150 hover:bg-slate-100 motion-reduce:transition-none focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 disabled:cursor-not-allowed disabled:opacity-60 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100 dark:hover:bg-slate-800 sm:min-h-8";
export const PRIMARY = "inline-flex min-h-11 cursor-pointer items-center justify-center gap-1.5 rounded-lg bg-blue-700 px-4 text-sm font-semibold text-white transition-colors duration-150 hover:bg-blue-800 motion-reduce:transition-none focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60 dark:bg-blue-600 dark:hover:bg-blue-500 sm:min-h-9";
export const FIELD = "min-h-11 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm text-slate-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100 sm:min-h-9";
export const LABEL = "text-xs font-semibold text-slate-800 dark:text-slate-100";
const ITEM = "flex min-h-11 w-full cursor-pointer items-center rounded-md px-3 text-left text-sm text-slate-800 transition-colors duration-150 hover:bg-slate-100 motion-reduce:transition-none focus:bg-slate-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 dark:text-slate-100 dark:hover:bg-slate-800 dark:focus:bg-slate-800 sm:min-h-8";

/** Readiness problems, blocking first; severity is an icon plus a word, never colour alone. */
export function ProblemList({ problems }: { problems: ReadinessProblem[] }) {
  const rows = problemRows(problems);
  if (rows.length === 0) return null;
  return (
    <ul className="space-y-1 text-sm">
      {rows.map((p) => (
        <li key={`${p.severity}:${p.code}`} className="flex items-start gap-2">
          {p.severity === "blocking"
            ? <XCircle className="mt-0.5 h-4 w-4 shrink-0 text-rose-700 dark:text-rose-300" aria-hidden />
            : <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-700 dark:text-amber-300" aria-hidden />}
          <span className="min-w-0 text-slate-800 dark:text-slate-100"><span className="font-semibold">{p.word}:</span> {p.message}</span>
        </li>
      ))}
    </ul>
  );
}

/** Client checks (shown after a first submit) and the server's answer, as one alert. */
export function FormErrors({ errors, show, serverError }: { errors: string[]; show: boolean; serverError: { text: string; problems: ReadinessProblem[] } | null }) {
  const list = show ? errors : [];
  if (list.length === 0 && !serverError) return null;
  return (
    <div role="alert" className="space-y-2 rounded-lg border border-rose-300 bg-rose-50 px-3 py-2 text-sm text-rose-800 dark:border-rose-700 dark:bg-rose-950 dark:text-rose-200">
      {list.length > 0 && <ul className="list-disc space-y-0.5 pl-4">{list.map((e) => <li key={e}>{e}</li>)}</ul>}
      {serverError && <p className="flex items-start gap-2"><XCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden /> {serverError.text}</p>}
      {serverError && serverError.problems.length > 0 && <div className="rounded-md bg-white p-2 dark:bg-slate-900"><ProblemList problems={serverError.problems} /></div>}
    </div>
  );
}

export interface StreamMenuProps {
  stream: StreamView; onPick: (a: MenuAction) => void; disabled?: boolean;
  /** Static-markup / preview hook: render with the list open. */
  initiallyOpen?: boolean;
  buttonRef?: RefObject<HTMLButtonElement>;
  /** Told when the list opens or closes (a host dialog keeps Escape for the menu while it is open). */
  onOpenChange?: (open: boolean) => void;
}

/** The Extend menu. Only the actions the stream's status allows are listed. */
export function StreamMenu({ stream, onPick, disabled = false, initiallyOpen = false, buttonRef, onOpenChange }: StreamMenuProps) {
  const [open, setOpen] = useState(initiallyOpen);
  const notify = useRef(onOpenChange);
  notify.current = onOpenChange;
  useEffect(() => { notify.current?.(open); }, [open]);
  const ownRef = useRef<HTMLButtonElement>(null);
  const btn = buttonRef ?? ownRef;
  const wrap = useRef<HTMLDivElement>(null);
  const list = useRef<HTMLUListElement>(null);
  const menuId = `stream-menu-${useId().replaceAll(":", "")}`;
  const items = menuItems(stream).filter((i) => i.enabled);

  const close = useCallback((refocus: boolean) => { setOpen(false); if (refocus) btn.current?.focus(); }, [btn]);
  useEffect(() => {
    if (!open) return;
    list.current?.querySelector<HTMLButtonElement>("button")?.focus();
    const outside = (e: MouseEvent) => { if (wrap.current && !wrap.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("mousedown", outside);
    return () => document.removeEventListener("mousedown", outside);
  }, [open]);

  const onKey = (e: KeyboardEvent<HTMLUListElement>) => {
    const buttons = Array.from(list.current?.querySelectorAll<HTMLButtonElement>("button") ?? []);
    const at = buttons.indexOf(document.activeElement as HTMLButtonElement);
    if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); close(true); }
    else if (e.key === "ArrowDown") { e.preventDefault(); buttons[(at + 1) % buttons.length]?.focus(); }
    else if (e.key === "ArrowUp") { e.preventDefault(); buttons[(at - 1 + buttons.length) % buttons.length]?.focus(); }
    else if (e.key === "Home") { e.preventDefault(); buttons[0]?.focus(); }
    else if (e.key === "End") { e.preventDefault(); buttons[buttons.length - 1]?.focus(); }
    else if (e.key === "Tab") setOpen(false);
  };

  return (
    <div ref={wrap} className="relative inline-block">
      <button
        ref={btn} type="button" className={BTN} disabled={disabled} aria-haspopup="menu" aria-expanded={open} aria-controls={open ? menuId : undefined}
        onClick={() => setOpen((v) => !v)} onKeyDown={(e) => { if (e.key === "ArrowDown" && !open) { e.preventDefault(); setOpen(true); } }}
      >
        <CalendarPlus className="h-4 w-4" aria-hidden /> Extend <ChevronDown className="h-3.5 w-3.5" aria-hidden />
      </button>
      {open && (
        <ul ref={list} id={menuId} role="menu" aria-label={`Change ${streamLabel(stream)}`} onKeyDown={onKey}
          className="absolute right-0 z-20 mt-1 max-h-80 w-56 max-w-xs space-y-0.5 overflow-y-auto rounded-lg border border-slate-200 bg-white p-1 shadow-lg dark:border-slate-700 dark:bg-slate-900">
          {items.map((i) => (
            <li key={i.action} role="none">
              <button type="button" role="menuitem" tabIndex={-1} className={ITEM} onClick={() => { close(false); onPick(i.action); }}>{i.label}</button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export interface ConfirmBodyProps {
  action: MenuAction; stream: StreamView; input: ActionInput; today: string; errors: string[]; showErrors: boolean;
  serverError: { text: string; problems: ReadinessProblem[] } | null; busy: boolean; onInput: (next: ActionInput) => void; idPrefix: string;
}

/** Fields of the confirmation (static-markup tested; the title and description live in the dialog). */
export function ConfirmBody({ action, stream, input, today, errors, showErrors, serverError, busy, onInput, idPrefix }: ConfirmBodyProps) {
  return (
    <div className="space-y-3">
      {needsDate(action) && (
        <div className="space-y-1">
          <label htmlFor={`${idPrefix}-date`} className={LABEL}>{action === "skip_day" ? "Day to skip" : action === "add_day" ? "Day to add" : "New last day"}</label>
          <input id={`${idPrefix}-date`} type="date" min={today} value={input.date ?? ""} disabled={busy} required className={FIELD} onChange={(e) => onInput({ ...input, date: e.target.value })} />
        </div>
      )}
      {action === "reopen" && input.ended && (
        <div className="space-y-1">
          <label htmlFor={`${idPrefix}-days`} className={LABEL}>Days to add (the window has ended)</label>
          <input id={`${idPrefix}-days`} type="number" inputMode="numeric" min={1} max={60} step={1} value={String(input.days ?? 3)} disabled={busy} className={FIELD}
            onChange={(e) => onInput({ ...input, days: e.target.value === "" ? Number.NaN : Number(e.target.value) })} />
        </div>
      )}
      <div className="space-y-1">
        <label htmlFor={`${idPrefix}-reason`} className={LABEL}>Reason (optional)</label>
        <textarea id={`${idPrefix}-reason`} rows={2} maxLength={255} value={input.reason ?? ""} disabled={busy} className={`${FIELD} py-2`} onChange={(e) => onInput({ ...input, reason: e.target.value })} />
      </div>
      {stream.warnings?.length > 0 && <div className="space-y-1"><p className={LABEL}>Open readiness notes</p><ProblemList problems={stream.warnings} /></div>}
      <FormErrors errors={errors} show={showErrors} serverError={serverError} />
    </div>
  );
}

export interface StreamActionsProps { stream: StreamView; today: string; onDone: (after: StreamView, text: string) => void; onMenuOpenChange?: (open: boolean) => void }

/** Extend menu + confirmation + the write for one stream. */
export default function StreamActions({ stream, today, onDone, onMenuOpenChange }: StreamActionsProps) {
  const [action, setAction] = useState<MenuAction | null>(null);
  // The row may be stale (another tab changed the stream): the dialog re-reads it and words and validates the change on that copy.
  const [fresh, setFresh] = useState<StreamView | null>(null);
  const guard = useRef(createInFlightGuard());
  const reads = useRef(createRequestSequencer());
  useEffect(() => () => reads.current.cancel(), []);
  const [input, setInput] = useState<ActionInput>({});
  const [busy, setBusy] = useState(false);
  const [tried, setTried] = useState(false);
  const [serverError, setServerError] = useState<{ text: string; problems: ReadinessProblem[] } | null>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const idPrefix = `sa-${useId().replaceAll(":", "")}`;

  const pick = (a: MenuAction) => {
    setInput({ date: "", reason: "", days: 3, ended: a === "reopen" && windowEnded(stream, today) });
    setTried(false);
    setServerError(null);
    setFresh(null);
    setAction(a);
    const ticket = reads.current.begin();
    hrmsApi.get<{ data?: StreamView }>(streamPath(stream.id), undefined, ticket.signal)
      .then((r) => {
        if (!ticket.isCurrent()) return;
        if (!r?.data) { setServerError(errorText(null)); return; }
        setFresh(r.data);
        setInput((i) => ({ ...i, ended: a === "reopen" && windowEnded(r.data as StreamView, today) }));
      })
      .catch((e: unknown) => { if (ticket.isCurrent()) setServerError(errorText(e, { what: "change" })); });
  };
  const view = action ? confirmView(action, stream, fresh, input, today) : null;

  const submit = () => guard.current.run(async () => {
    if (!action || !view) return;
    setTried(true);
    if (!view.ready || view.errors.length) return;
    setBusy(true);
    setServerError(null);
    try {
      const r = await hrmsApi.post<{ success?: boolean; changed?: boolean; data?: StreamView }>(changePath(stream.id), changeBody(action, input));
      if (!r?.data) { setServerError(errorText(null)); return; }
      const done = action;
      setAction(null);
      onDone(r.data, successText(done, r.data, r.changed !== false, input));
    } catch (e: unknown) {
      setServerError(errorText(e, { what: "change" }));
    } finally {
      setBusy(false);
    }
  });

  return (
    <>
      <StreamMenu stream={stream} onPick={pick} disabled={busy} buttonRef={trigger} onOpenChange={onMenuOpenChange} />
      <AlertDialog open={action !== null} onOpenChange={(o) => { if (!o && !busy) { reads.current.cancel(); setAction(null); } }}>
        <AlertDialogContent
          className="max-h-screen overflow-y-auto"
          onEscapeKeyDown={(e) => { if (busy) e.preventDefault(); }}
          onCloseAutoFocus={(e) => { e.preventDefault(); trigger.current?.focus(); }}
        >
          {action && view && (
            <form noValidate onSubmit={(e) => { e.preventDefault(); void submit(); }} className="space-y-4" aria-busy={busy}>
              <AlertDialogHeader>
                <AlertDialogTitle>{view.text.title}</AlertDialogTitle>
                <AlertDialogDescription className="text-slate-700 dark:text-slate-200">{view.text.body}</AlertDialogDescription>
              </AlertDialogHeader>
              {!view.ready && !serverError && <p role="status" className="text-xs text-slate-700 dark:text-slate-200">Checking the latest version of this stream…</p>}
              <ConfirmBody action={action} stream={view.stream} input={input} today={today} errors={view.errors} showErrors={tried} serverError={serverError} busy={busy} onInput={setInput} idPrefix={idPrefix} />
              <AlertDialogFooter>
                <AlertDialogCancel type="button" disabled={busy} className="min-h-11 sm:min-h-9">Cancel</AlertDialogCancel>
                <button type="submit" className={PRIMARY} disabled={busy || !view.ready}>
                  {busy ? <><Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none" aria-hidden /> Saving…</> : view.text.confirm}
                </button>
              </AlertDialogFooter>
            </form>
          )}
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

export interface RowStreamActionsViewProps {
  streams: StreamView[]; today: string; loading: boolean; error: string | null; note: string | null;
  onRetry: () => void; onDone: (after: StreamView, text: string) => void; onCreate: () => void;
}

/** Presentational stream list of an expanded row (static-markup tested). The status line is always mounted so it is announced. */
export function RowStreamActionsView({ streams, today, loading, error, note, onRetry, onDone, onCreate }: RowStreamActionsViewProps) {
  return (
    <section aria-label="Streams" className="space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h4 className="text-xs font-bold text-slate-900 dark:text-slate-100">Streams</h4>
        <button type="button" className={BTN} onClick={onCreate}><Plus className="h-4 w-4" aria-hidden /> Open a stream</button>
      </div>
      <p role="status" className="text-sm text-emerald-800 empty:hidden dark:text-emerald-200">
        {note && <><CheckCircle2 className="mr-1 inline h-4 w-4 align-text-bottom" aria-hidden />{note}</>}
      </p>
      {loading && streams.length === 0 && <div aria-busy="true" aria-label="Loading streams" className="animate-pulse rounded-lg bg-slate-100 motion-reduce:animate-none dark:bg-slate-800" style={{ height: 48 }} />}
      {error && (
        <div role="alert" className="flex flex-wrap items-center gap-2 text-xs text-rose-800 dark:text-rose-200">
          <AlertTriangle className="h-4 w-4 shrink-0" aria-hidden /> Could not load the streams: {error}
          <button type="button" className={BTN} onClick={onRetry}><RefreshCw className="h-3.5 w-3.5" aria-hidden /> Retry</button>
        </div>
      )}
      {!loading && !error && streams.length === 0 && <p className="text-xs text-slate-600 dark:text-slate-300">No stream of this type yet. Open one to plan days for this requisition.</p>}
      {streams.length > 0 && (
        <ul className="space-y-2">
          {streams.map((s) => (
            <li key={s.id} role="group" aria-label={streamLabel(s)} className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg border border-slate-200 px-3 py-2 dark:border-slate-700">
              <span className="min-w-0 break-words text-sm font-semibold text-slate-900 dark:text-slate-100">{streamLabel(s)}</span>
              <span className="rounded border border-slate-400 px-1.5 text-xs font-semibold text-slate-800 dark:border-slate-500 dark:text-slate-100">{STATUS_WORD[streamStatus(s)]}</span>
              <span className="text-xs text-slate-700 dark:text-slate-200">{s.label}</span>
              <span className="ml-auto"><StreamActions stream={s} today={today} onDone={onDone} /></span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
