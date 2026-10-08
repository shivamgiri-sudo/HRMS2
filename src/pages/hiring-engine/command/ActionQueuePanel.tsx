/**
 * "Act now": the recruiter action queue in the Summary section. Read-only list with masked mobiles; "Call" and "WhatsApp" fetch one full
 * link at tap time (never in the list) and open the phone or an anchor. Nothing is sent from here. Switch off: renders nothing.
 */
import { useCallback, useEffect, useRef, useState, type Ref } from "react";
import { AlertTriangle, Check, ExternalLink, Info, Inbox, MessageCircle, PhoneCall, User } from "lucide-react";
import { hrmsApi } from "@/lib/hrmsApi";
import { useHasRole } from "@/hooks/useUserRole";
import Candidate360Drawer from "../Candidate360Drawer";
import { createRequestSequencer, describeError } from "./commandData";
import type { Filters } from "./driveCommandModel";
import type { ActionKind, ActionQueue } from "./driveCommandTypes";
import { createInFlightGuard } from "./inFlight";
import {
  ACTION_EMPTY, ACTION_NOTE, ACTION_TRUNCATED, KIND_LABEL, KIND_ORDER, REFRESH_FAILED, actionQueuePath, actionTitle, chipLabel, contactErrorText, contactPath, filterItems,
  queueKnownOn, queueTotal, rememberQueueEnabled, rowView, safeHref, usableQueue,
} from "./actionQueueModel";

const PULSE = "animate-pulse rounded-lg bg-slate-100 motion-reduce:animate-none dark:bg-slate-800";
const FOCUS = "focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500";
const ACT = `inline-flex min-h-11 cursor-pointer items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 text-sm font-semibold text-slate-900 transition-colors duration-150 hover:bg-slate-50 motion-reduce:transition-none disabled:cursor-not-allowed disabled:opacity-60 sm:min-h-8 ${FOCUS} dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100 dark:hover:bg-slate-800`;
const CHIP = `inline-flex min-h-11 cursor-pointer items-center gap-1.5 rounded-full border px-3 text-xs font-semibold transition-colors duration-150 motion-reduce:transition-none sm:min-h-8 ${FOCUS}`;
const CHIP_ON = "border-blue-600 bg-blue-600 text-white dark:border-blue-400 dark:bg-blue-500 dark:text-slate-950";
const CHIP_OFF = "border-slate-300 bg-white text-slate-900 hover:bg-slate-50 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100 dark:hover:bg-slate-800";

export interface ActionViewProps {
  data: ActionQueue | null | undefined;
  loading: boolean;
  error: string | null;
  kind: ActionKind | "all";
  busyRef?: string | null;
  contactError?: string | null;
  wa?: { ref: string; href: string } | null;
  onKind: (k: ActionKind | "all") => void;
  onCall: (ref: string) => void;
  onWhatsApp: (ref: string) => void;
  onOpen360: (leadId: string) => void;
  onRetry: () => void;
  waLinkRef?: Ref<HTMLAnchorElement>;
  /** False while an earlier answer says the switch is off or unknown: nothing is drawn until the response arrives. Default true. */
  expectOn?: boolean;
  /** Call and WhatsApp need a role that can open contact details. Default true. */
  canContact?: boolean;
}

/** Selected chips also carry a check so the state is not colour alone. */
const Selected = ({ on }: { on: boolean }) => (on ? <Check className="h-3.5 w-3.5 shrink-0" aria-hidden /> : null);

export function ActionQueueView(p: ActionViewProps) {
  const q = usableQueue(p.data);
  if (p.loading && !p.data && !p.error) {
    if (p.expectOn === false) return null;
    return <section aria-busy="true" aria-label="Act now" className={PULSE} style={{ height: 160 }} />;
  }
  if (p.error && !q) {
    return (
      <section aria-labelledby="act-now-h" className="space-y-2">
        <h3 id="act-now-h" className="flex items-center gap-2 text-base font-bold text-slate-900 dark:text-slate-100"><PhoneCall className="h-4 w-4" aria-hidden />Act now</h3>
        <div role="alert" className="flex flex-wrap items-center gap-3 rounded-lg border border-rose-300 bg-rose-50 px-3 py-2 text-sm text-rose-800 dark:border-rose-700 dark:bg-rose-950 dark:text-rose-200">
          <AlertTriangle className="h-4 w-4 shrink-0" aria-hidden />
          <span className="min-w-0 flex-1">Could not load the action queue: {p.error}</span>
          <button type="button" onClick={p.onRetry} className={ACT}>Retry</button>
        </div>
      </section>
    );
  }
  if (!q) return null;
  const rows = filterItems(q.items, p.kind).map(rowView);
  return (
    <section aria-labelledby="act-now-h" aria-busy={p.loading} className="space-y-2 rounded-xl border border-slate-200 p-3 dark:border-slate-700">
      <h3 id="act-now-h" className="flex items-center gap-2 text-base font-bold text-slate-900 dark:text-slate-100"><PhoneCall className="h-4 w-4 shrink-0" aria-hidden />{actionTitle(queueTotal(q), q.truncated)}</h3>
      <p className="flex items-center gap-2 text-xs text-slate-700 dark:text-slate-200"><Info className="h-4 w-4 shrink-0" aria-hidden />{ACTION_NOTE}</p>
      {p.error && (
        <p role="status" className="flex flex-wrap items-center gap-2 text-xs text-rose-800 dark:text-rose-200">
          <AlertTriangle className="h-4 w-4 shrink-0" aria-hidden />{REFRESH_FAILED}
          <button type="button" onClick={p.onRetry} className={ACT}>Retry</button>
        </p>
      )}
      {q.partial && (
        <p role="alert" className="flex items-center gap-2 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:border-amber-700 dark:bg-amber-950 dark:text-amber-200">
          <AlertTriangle className="h-4 w-4 shrink-0" aria-hidden />Partial result: {q.partialReason ? q.partialReason : <>could not read {q.failedSections.length ? q.failedSections.map((s) => KIND_LABEL[s as ActionKind] ?? s).join(", ") : "some sections"}.</>}
          <button type="button" onClick={p.onRetry} className={ACT}>Retry</button>
        </p>
      )}
      <div role="group" aria-label="Filter by reason" className="flex flex-wrap gap-2">
        <button type="button" aria-pressed={p.kind === "all"} onClick={() => p.onKind("all")} className={`${CHIP} ${p.kind === "all" ? CHIP_ON : CHIP_OFF}`}><Selected on={p.kind === "all"} />All, {chipLabel(queueTotal(q))}</button>
        {KIND_ORDER.map((k) => {
          const n = q.counts?.[k] ?? 0;
          return (
            <button key={k} type="button" aria-pressed={p.kind === k} onClick={() => p.onKind(k)} className={`${CHIP} ${p.kind === k ? CHIP_ON : CHIP_OFF}`}>
              <Selected on={p.kind === k} />{KIND_LABEL[k]}, {chipLabel(n)}
            </button>
          );
        })}
      </div>
      <p role="status" className="text-sm text-rose-800 empty:hidden dark:text-rose-200">{p.contactError}</p>
      {rows.length === 0 ? (
        <div className="flex items-center justify-center gap-2 rounded-lg border border-dashed border-slate-300 px-4 text-sm font-semibold text-slate-800 dark:border-slate-600 dark:text-slate-100" style={{ minHeight: 96 }}>
          <Inbox className="h-5 w-5 shrink-0 text-slate-500 dark:text-slate-400" aria-hidden />{ACTION_EMPTY}
        </div>
      ) : (
        <ul className="divide-y divide-slate-200 dark:divide-slate-700">
          {rows.map((r) => {
            const busy = p.busyRef === r.ref;
            return (
              <li key={r.id} className="flex flex-wrap items-center gap-x-4 gap-y-2 py-2">
                <div className="min-w-0 flex-1 space-y-0.5" style={{ minWidth: 220 }}>
                  <p className="text-sm text-slate-900 dark:text-slate-100"><span className="font-semibold">{r.name}</span> <span>{r.mobile}</span></p>
                  <p className="text-sm text-slate-900 dark:text-slate-100">{r.reason}</p>
                  <p className="text-xs text-slate-700 dark:text-slate-200">{r.waiting} · {r.requisition} · {r.branch} · Drive {r.drive}</p>
                  <p className="flex items-center gap-1 text-xs text-slate-700 dark:text-slate-200"><User className="h-3 w-3 shrink-0" aria-hidden />{r.recruiter}</p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  {p.canContact !== false && <button type="button" aria-label={`Call ${r.name}`} disabled={busy} onClick={() => p.onCall(r.ref)} className={ACT}><PhoneCall className="h-4 w-4" aria-hidden />Call</button>}
                  {p.canContact === false ? null : p.wa?.ref === r.ref ? (
                    <a ref={p.waLinkRef} href={p.wa.href} target="_blank" rel="noopener noreferrer" aria-label={`Open WhatsApp chat with ${r.name}`} className={ACT}><ExternalLink className="h-4 w-4" aria-hidden />Open WhatsApp chat</a>
                  ) : (
                    <button type="button" aria-label={`WhatsApp ${r.name}`} disabled={busy} onClick={() => p.onWhatsApp(r.ref)} className={ACT}><MessageCircle className="h-4 w-4" aria-hidden />WhatsApp</button>
                  )}
                  {r.leadId && <button type="button" aria-label={`Open 360 for ${r.name}`} onClick={() => p.onOpen360(r.leadId as string)} className={ACT}>Open 360</button>}
                </div>
              </li>
            );
          })}
        </ul>
      )}
      {q.truncated && <p className="flex items-center gap-2 text-xs text-slate-700 dark:text-slate-200"><Info className="h-4 w-4 shrink-0" aria-hidden />{ACTION_TRUNCATED}</p>}
    </section>
  );
}

export default function ActionQueuePanel({ filters }: { filters: Filters }) {
  const [data, setData] = useState<ActionQueue | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [kind, setKind] = useState<ActionKind | "all">("all");
  const [busyRef, setBusyRef] = useState<string | null>(null);
  const [contactError, setContactError] = useState<string | null>(null);
  const [wa, setWa] = useState<{ ref: string; href: string } | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const guard = useRef(createInFlightGuard());
  const seq = useRef(createRequestSequencer());
  const waLink = useRef<HTMLAnchorElement>(null);
  const path = actionQueuePath(filters);
  const canContact = useHasRole("super_admin", "admin", "hr", "hr_admin", "recruitment_hr"); // same roles as the contact route
  const [expectOn] = useState(queueKnownOn);

  const load = useCallback(async () => {
    const ticket = seq.current.begin();
    setLoading(true);
    try {
      const r = await hrmsApi.get<{ data?: ActionQueue }>(path, undefined, ticket.signal);
      if (!ticket.isCurrent()) return;
      setData(r?.data ?? null); setError(null); setWa(null);
      rememberQueueEnabled(r?.data?.enabled === true);
    } catch (e: unknown) {
      if (ticket.isCurrent()) setError(describeError(e));
    } finally {
      if (ticket.isCurrent()) setLoading(false);
    }
  }, [path]);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => { const s = seq.current; return () => s.cancel(); }, []);
  useEffect(() => { if (wa) waLink.current?.focus(); }, [wa]);

  const fetchLink = (ref: string, k: "tel" | "whatsapp") => guard.current.run(async () => {
    setBusyRef(ref); setContactError(null);
    try {
      const r = await hrmsApi.get<{ data?: { href?: string } }>(contactPath(ref, k));
      const href = safeHref(k, r?.data?.href);
      if (!href) throw new Error("bad link");
      if (k === "tel") window.location.assign(href); else setWa({ ref, href });
    } catch (e: unknown) {
      setContactError(contactErrorText(e));
    } finally {
      setBusyRef(null);
    }
  });

  return (
    <>
      <ActionQueueView expectOn={expectOn} canContact={canContact} data={data} loading={loading} error={error} kind={kind} busyRef={busyRef} contactError={contactError} wa={wa} waLinkRef={waLink}
        onKind={setKind} onCall={(r) => void fetchLink(r, "tel")} onWhatsApp={(r) => void fetchLink(r, "whatsapp")} onOpen360={setOpen} onRetry={() => void load()} />
      <Candidate360Drawer leadId={open} onClose={() => setOpen(null)} />
    </>
  );
}
