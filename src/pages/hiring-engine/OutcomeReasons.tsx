/**
 * "Did not come or declined": one-tap reason chips for no-shows and declines of the last 3 days, below the walk-in board.
 * Taps do not update optimistically: a row changes from the server's answer. Each row has its own in-flight guard. Switch off: renders nothing.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { AlertTriangle, Check, Info, MessageSquarePlus, UserX, XCircle } from "lucide-react";
import { hrmsApi } from "@/lib/hrmsApi";
import { createRequestSequencer, describeError } from "./command/commandData";
import { createInFlightGuard, type InFlightGuard } from "./command/inFlight";
import {
  EMPTY_TEXT, NOTE_MAX, OUTCOMES_PATH, PARTIAL_TEXT, REASON_CHIPS, SECTION_TITLE, TRUNCATED_TEXT, counterText, groupByDrive, nameOf, outcomeWord, reasonBody,
  reasonLabel, reasonPath, reasonsKnownOff, rememberReasonsEnabled, saveErrorText, savedText, slotText, withBusy, withoutBusy,
  type OutcomeList, type OutcomeReasonCode, type OutcomeRow,
} from "./outcomeReasonsModel";

const FOCUS = "focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500";
const BTN = `inline-flex min-h-11 items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 text-sm font-semibold text-slate-900 transition-colors duration-150 hover:bg-slate-50 motion-reduce:transition-none sm:min-h-8 ${FOCUS} dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100 dark:hover:bg-slate-800`;
const CHIP = `inline-flex min-h-11 items-center gap-1.5 rounded-full border px-3 text-xs font-semibold transition-colors duration-150 motion-reduce:transition-none sm:min-h-8 ${FOCUS}`;
const READY = "cursor-pointer";
const BUSY = "cursor-wait opacity-60";
const IDLE_OFF = "cursor-not-allowed opacity-60";
const CHIP_ON = "border-blue-600 bg-blue-600 text-white dark:border-blue-400 dark:bg-blue-500 dark:text-slate-950";
const CHIP_OFF = "border-slate-300 bg-white text-slate-900 hover:bg-slate-50 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100 dark:hover:bg-slate-800";
const PULSE = "animate-pulse rounded-lg bg-slate-100 motion-reduce:animate-none dark:bg-slate-800";

export interface ReasonsViewProps {
  data: OutcomeList | null | undefined;
  loading: boolean;
  error: string | null;
  /** Rows with a save in flight: their controls get aria-disabled (not disabled), so focus stays on the tapped control. */
  busyIds?: ReadonlySet<string>;
  status?: string | null;
  noteOpen?: Record<string, boolean>;
  noteText?: Record<string, string>;
  onPick: (row: OutcomeRow, code: OutcomeReasonCode) => void;
  onNoteToggle: (row: OutcomeRow) => void;
  onNoteChange: (row: OutcomeRow, text: string) => void;
  onNoteSave: (row: OutcomeRow) => void;
  onRetry: () => void;
  /** False once the switch is known to be off: no skeleton while the first answer is pending. Default true. */
  expectOn?: boolean;
}

function Heading({ id }: { id: string }) {
  return <h3 id={id} className="flex items-center gap-2 text-base font-bold text-slate-900 dark:text-slate-100"><UserX className="h-4 w-4 shrink-0" aria-hidden />{SECTION_TITLE}</h3>;
}

function RowView({ r, p }: { r: OutcomeRow; p: ReasonsViewProps }) {
  const name = nameOf(r), busy = p.busyIds?.has(r.matchId) === true, open = p.noteOpen?.[r.matchId] === true, text = p.noteText?.[r.matchId] ?? r.note ?? "";
  const noteId = `note-${r.matchId}`;
  return (
    <tr className="align-top">
      <td className="px-3 py-2"><div className="font-medium text-slate-900 dark:text-slate-100">{name}</div><div className="text-xs text-slate-700 dark:text-slate-200">{r.mobileMasked}</div></td>
      <td className="px-3 py-2 tabular-nums text-slate-900 dark:text-slate-100">{slotText(r.slotAt)}</td>
      <td className="px-3 py-2 text-slate-900 dark:text-slate-100"><span className="inline-flex items-center gap-1.5"><XCircle className="h-4 w-4 shrink-0" aria-hidden />{outcomeWord(r.outcome)}</span></td>
      <td className="px-3 py-2" style={{ minWidth: 300 }}>
        <div role="group" aria-label={`Reason for ${name}`} className="flex flex-wrap gap-2">
          {REASON_CHIPS.map((c) => {
            const on = r.reason === c.code;
            return (
              <button key={c.code} type="button" aria-pressed={on} aria-disabled={busy || undefined} onClick={() => { if (!busy) p.onPick(r, c.code); }} className={`${CHIP} ${on ? CHIP_ON : CHIP_OFF} ${busy ? BUSY : READY}`}>
                {on && <Check className="h-3.5 w-3.5 shrink-0" aria-hidden />}{c.label}
              </button>
            );
          })}
        </div>
        <div className="mt-2">
          <button type="button" aria-expanded={open} aria-controls={noteId} onClick={() => p.onNoteToggle(r)} className={`${BTN} ${READY}`}><MessageSquarePlus className="h-4 w-4" aria-hidden />Add a note</button>
          {open && (
            <div id={noteId} className="mt-2 flex flex-wrap items-end gap-2">
              <label className="text-xs font-semibold text-slate-900 dark:text-slate-100">
                Note for {name}
                <input type="text" maxLength={NOTE_MAX} value={text} onChange={(e) => p.onNoteChange(r, e.target.value)}
                  className={`mt-1 block min-h-11 w-64 max-w-full rounded-lg border border-slate-300 bg-white px-3 text-sm font-normal text-slate-900 sm:min-h-8 ${FOCUS} dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100`} />
              </label>
              <span className="pb-3 text-xs tabular-nums text-slate-700 sm:pb-1.5 dark:text-slate-200">{counterText(text.length)}</span>
              <button type="button" aria-disabled={busy || !r.reason || undefined} onClick={() => { if (!busy && r.reason) p.onNoteSave(r); }} className={`${BTN} ${busy ? BUSY : !r.reason ? IDLE_OFF : READY}`}>Save note</button>
              {!r.reason && <span className="pb-3 text-xs text-slate-700 sm:pb-1.5 dark:text-slate-200">Pick a reason first</span>}
            </div>
          )}
        </div>
      </td>
    </tr>
  );
}

export function OutcomeReasonsView(p: ReasonsViewProps) {
  const d = p.data;
  if (d && d.enabled === false) return null;
  if (p.loading && !d && !p.error) {
    if (p.expectOn === false) return null;
    return <section aria-busy="true" aria-label={SECTION_TITLE} className={PULSE} style={{ height: 160 }} />;
  }
  if (p.error && !d) {
    return (
      <section aria-labelledby="outcome-h" className="space-y-2">
        <Heading id="outcome-h" />
        <div role="alert" className="flex flex-wrap items-center gap-3 rounded-lg border border-rose-300 bg-rose-50 px-3 py-2 text-sm text-rose-800 dark:border-rose-700 dark:bg-rose-950 dark:text-rose-200">
          <AlertTriangle className="h-4 w-4 shrink-0" aria-hidden />
          <span className="min-w-0 flex-1">Could not load the list: {p.error}</span>
          <button type="button" onClick={p.onRetry} className={`${BTN} ${READY}`}>Retry</button>
        </div>
      </section>
    );
  }
  if (!d) return null;
  const groups = groupByDrive(d.rows);
  return (
    <section aria-labelledby="outcome-h" aria-busy={p.loading} className="space-y-3 rounded-xl border border-slate-200 bg-white p-3 shadow-sm dark:border-slate-700 dark:bg-slate-900">
      <Heading id="outcome-h" />
      {d.partial && (
        <p role="alert" className="flex flex-wrap items-center gap-2 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:border-amber-700 dark:bg-amber-950 dark:text-amber-200">
          <AlertTriangle className="h-4 w-4 shrink-0" aria-hidden />{PARTIAL_TEXT}
          <button type="button" onClick={p.onRetry} className={`${BTN} ${READY}`}>Retry</button>
        </p>
      )}
      <p role="status" className="min-h-5 text-sm font-semibold text-slate-900 dark:text-slate-100">{p.status}</p>
      {groups.length === 0 ? (
        !d.partial && (
          <div className="flex items-center justify-center gap-2 rounded-lg border border-dashed border-slate-300 px-4 text-sm font-semibold text-slate-800 dark:border-slate-600 dark:text-slate-100" style={{ minHeight: 96 }}>
            <Info className="h-5 w-5 shrink-0 text-slate-500 dark:text-slate-400" aria-hidden />{EMPTY_TEXT}
          </div>
        )
      ) : groups.map((g) => (
        <div key={g.driveId} className="overflow-hidden rounded-lg border border-slate-200 dark:border-slate-700">
          <h4 className="border-b border-slate-200 bg-slate-50 px-3 py-2 text-sm font-semibold text-slate-900 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100">{g.title}</h4>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] text-left text-sm">
              <thead className="text-xs font-bold uppercase tracking-wider text-slate-700 dark:text-slate-200"><tr><th className="px-3 py-2">Candidate</th><th className="px-3 py-2">Slot</th><th className="px-3 py-2">Outcome</th><th className="px-3 py-2">Reason</th></tr></thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-700">{g.rows.map((r) => <RowView key={r.matchId} r={r} p={p} />)}</tbody>
            </table>
          </div>
        </div>
      ))}
      {d.truncated && <p className="flex items-center gap-2 text-xs text-slate-700 dark:text-slate-200"><Info className="h-4 w-4 shrink-0" aria-hidden />{TRUNCATED_TEXT}</p>}
    </section>
  );
}

export default function OutcomeReasons() {
  const [data, setData] = useState<OutcomeList | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyIds, setBusyIds] = useState<ReadonlySet<string>>(() => new Set());
  const [status, setStatus] = useState<string | null>(null);
  const [noteOpen, setNoteOpen] = useState<Record<string, boolean>>({});
  const [noteText, setNoteText] = useState<Record<string, string>>({});
  const guards = useRef(new Map<string, InFlightGuard>());
  const seq = useRef(createRequestSequencer());
  const [expectOn] = useState(() => !reasonsKnownOff());

  const load = useCallback(async () => {
    const ticket = seq.current.begin();
    setLoading(true);
    try {
      const r = await hrmsApi.get<{ data?: OutcomeList }>(OUTCOMES_PATH, undefined, ticket.signal);
      if (!ticket.isCurrent()) return;
      setData(r?.data ?? null); setError(null);
      rememberReasonsEnabled(r?.data?.enabled === true);
    } catch (e: unknown) {
      if (ticket.isCurrent()) setError(describeError(e));
    } finally {
      if (ticket.isCurrent()) setLoading(false);
    }
  }, []);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => { const s = seq.current; return () => s.cancel(); }, []);

  const save = (row: OutcomeRow, code: OutcomeReasonCode, note: string) => {
    let g = guards.current.get(row.matchId);
    if (!g) { g = createInFlightGuard(); guards.current.set(row.matchId, g); }
    return g.run(async () => {
      setBusyIds((b) => withBusy(b, row.matchId)); setStatus(null);
      try {
        const r = await hrmsApi.post<{ data?: { outcome?: "no_show" | "declined"; reason?: OutcomeReasonCode; note?: string | null } }>(reasonPath(row.matchId), reasonBody(code, note));
        const saved = r?.data;
        if (!saved?.reason) throw new Error("empty");
        const reason = saved.reason, savedNote = saved.note ?? null;
        setData((d) => (d ? { ...d, rows: d.rows.map((x) => (x.matchId === row.matchId ? { ...x, reason, note: savedNote, outcome: saved.outcome ?? x.outcome } : x)) } : d));
        setNoteText((t) => Object.fromEntries(Object.entries(t).filter(([k]) => k !== row.matchId)));
        setStatus(savedText(row.name, reasonLabel(reason), row.reason !== null && row.reason !== reason));
      } catch (e: unknown) {
        setStatus(saveErrorText(e));
      } finally {
        setBusyIds((b) => withoutBusy(b, row.matchId));
      }
    });
  };

  return (
    <OutcomeReasonsView data={data} loading={loading} error={error} busyIds={busyIds} status={status} noteOpen={noteOpen} noteText={noteText} expectOn={expectOn}
      onPick={(r, c) => void save(r, c, noteText[r.matchId] ?? r.note ?? "")}
      onNoteToggle={(r) => setNoteOpen((o) => ({ ...o, [r.matchId]: !o[r.matchId] }))}
      onNoteChange={(r, t) => setNoteText((n) => ({ ...n, [r.matchId]: t.slice(0, NOTE_MAX) }))}
      onNoteSave={(r) => { if (r.reason) void save(r, r.reason, noteText[r.matchId] ?? r.note ?? ""); }}
      onRetry={() => void load()} />
  );
}
