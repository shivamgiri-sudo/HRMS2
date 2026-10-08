/** "Why not shortlisted?" (S19): search by mobile or name across open requisitions in scope; every rule written out. */
import { useId, useState } from "react";
import { Search } from "lucide-react";
import OverrideDialog from "./OverrideDialog";
import { FIELD, SMALL_BTN } from "./RuleRow";
import { whyNotView } from "./approvalModel";
import { selectionApi } from "./selectionApi";
import type { Permissions, WhyNotPerson } from "./selectionTypes";

export function WhyNotResults({ people, permissions, onOverride }: { people: WhyNotPerson[]; permissions: Permissions; onOverride: (p: WhyNotPerson, requisitionId: string, code: string) => void }) {
  if (!people.length) return <p className="text-sm text-slate-600 dark:text-slate-300">Nobody found with that mobile or name in the requisitions you can see.</p>;
  return (
    <ul className="space-y-3">
      {people.map((p, i) => (
        <li key={i} className="space-y-2 rounded-lg border border-slate-200 px-3 py-2 dark:border-slate-700">
          <p className="text-sm font-semibold">{p.person.maskedMobile} · {p.person.name || "Name not known"}</p>
          {p.perRequisition.length === 0 && <p className="text-sm">Not part of any open requisition you can see.</p>}
          {whyNotView(p).map((r) => (
            <section key={r.requisitionId} aria-label={r.code} className="space-y-1 border-t border-slate-100 pt-2 text-sm dark:border-slate-800">
              <p><span className="font-semibold">{r.code}:</span> {r.headline}</p>
              {r.explanation && <p className="text-xs text-slate-700 dark:text-slate-200">{r.explanation}</p>}
              {r.lines.length > 0 && <ul className="list-inside list-disc text-xs">{r.lines.map((l, k) => <li key={k}>{l}</li>)}</ul>}
              {[r.override, r.lastDecision, r.journey].filter(Boolean).map((t, k) => <p key={k} className="text-xs">{t}</p>)}
              {permissions.override && p.person.fullMobileIfSearched && (
                <button type="button" className={SMALL_BTN} onClick={() => onOverride(p, r.requisitionId, r.code)}>Override for {r.code}</button>
              )}
            </section>
          ))}
        </li>
      ))}
    </ul>
  );
}

export default function WhyNotLookup({ permissions, requisitionId }: { permissions: Permissions; requisitionId?: string }) {
  const id = useId();
  const [q, setQ] = useState("");
  const [people, setPeople] = useState<WhyNotPerson[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [target, setTarget] = useState<{ p: WhyNotPerson; requisitionId: string; code: string } | null>(null);
  const run = async () => {
    if (q.trim().length < 3) { setError("Type at least 3 characters"); return; }
    setBusy(true); setError(null);
    try { setPeople(await selectionApi.why(q.trim(), requisitionId)); } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  };
  return (
    <section aria-labelledby={`${id}-t`} className="space-y-2 text-slate-900 dark:text-slate-100">
      <h3 id={`${id}-t`} className="text-sm font-bold">Why not shortlisted?</h3>
      <form className="flex flex-wrap items-end gap-2" onSubmit={(e) => { e.preventDefault(); void run(); }}>
        <div className="min-w-0 flex-1">
          <label htmlFor={`${id}-q`} className="block text-xs font-semibold text-slate-700 dark:text-slate-200">Mobile or name</label>
          <input id={`${id}-q`} value={q} onChange={(e) => setQ(e.target.value)} className={FIELD} autoComplete="off" inputMode="search" />
        </div>
        <button type="submit" className={SMALL_BTN} disabled={busy}><Search className="h-4 w-4" aria-hidden="true" />Look up</button>
      </form>
      <div aria-live="polite">
        {error && <p role="alert" className="text-sm font-semibold text-rose-800 dark:text-rose-200">{error}</p>}
        {busy && <div aria-busy="true" aria-label="Looking up" className="h-16 animate-pulse rounded-lg bg-slate-100 motion-reduce:animate-none dark:bg-slate-800" />}
        {people && !busy && <WhyNotResults people={people} permissions={permissions} onOverride={(p, rid, code) => setTarget({ p, requisitionId: rid, code })} />}
      </div>
      {target && target.p.person.fullMobileIfSearched && (
        <OverrideDialog open onOpenChange={(o) => { if (!o) setTarget(null); }} mobile={target.p.person.fullMobileIfSearched} maskedMobile={target.p.person.maskedMobile}
          requisitionId={target.requisitionId} code={target.code} onDone={() => void run()} />
      )}
    </section>
  );
}
