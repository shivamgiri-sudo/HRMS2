/**
 * Presentational pieces of the candidate invitation page (/w/:token). All state and network calls live in
 * LocationSharePage; these only render. Mobile first: a candidate opens this from an email or WhatsApp on a phone.
 */
import type { ReactNode } from "react";
import { CalendarCheck, CheckCircle2, Clock, FileText, MapPin, MessageCircle, Navigation, ShieldCheck, XCircle } from "lucide-react";

export interface Invitation {
  firstName: string; role: string | null; branchName: string; address: string | null; slotAt: string | null;
  reference: string; mapsUrl: string | null; docs: string[];
}
export type Answer = "yes" | "later" | "no";

export const ANSWERS: Array<{ k: Answer; label: string; hint: string; done: string }> = [
  { k: "yes", label: "Yes, I will come", hint: "The branch will expect you", done: "Thank you! The branch will expect you. Please reach 10 minutes early with your documents." },
  { k: "later", label: "I need another time", hint: "A recruiter will call you with a new time", done: "Noted. Our recruiter will call you to fix a better time." },
  { k: "no", label: "I cannot come", hint: "Your slot is given to someone else", done: "Thanks for letting us know. Your slot is freed for someone else." },
];
const ANSWER_STYLE: Record<Answer, { icon: typeof CheckCircle2; on: string; icon_on: string }> = {
  yes: { icon: CheckCircle2, on: "border-emerald-600 bg-emerald-50 ring-1 ring-emerald-600", icon_on: "text-emerald-600" },
  later: { icon: Clock, on: "border-blue-700 bg-blue-50 ring-1 ring-blue-700", icon_on: "text-blue-700" },
  no: { icon: XCircle, on: "border-rose-600 bg-rose-50 ring-1 ring-rose-600", icon_on: "text-rose-600" },
};

const fmtDate = (slot: string) => new Date(`${slot.slice(0, 10)}T00:00:00Z`).toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });
const fmtTime = (slot: string) => { const [h, m] = slot.slice(11, 16).split(":").map(Number); return `${h % 12 || 12}:${String(m).padStart(2, "0")} ${h >= 12 ? "PM" : "AM"}`; };

const focus = "focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 focus-visible:ring-offset-2";
export const primaryBtn = `w-full cursor-pointer rounded-xl bg-blue-800 px-4 py-3.5 text-base font-semibold text-white transition-colors duration-200 hover:bg-blue-900 disabled:cursor-not-allowed disabled:opacity-50 ${focus}`;
export const quietBtn = `w-full cursor-pointer rounded-xl border border-slate-300 bg-white px-4 py-3.5 text-base font-semibold text-slate-800 transition-colors duration-200 hover:bg-slate-50 ${focus}`;
const card = "rounded-2xl border border-slate-200 bg-white p-5 shadow-sm";

/** Page frame: brand band, content column, footer. */
export function Shell({ children, sample }: { children: ReactNode; sample?: boolean }) {
  return (
    <div className="min-h-screen bg-slate-100">
      <header className="bg-blue-900 text-white">
        <div className="mx-auto flex max-w-md items-center justify-between px-4 py-3.5">
          <span className="text-base font-semibold tracking-wide">MAS Callnet</span>
          <span className="text-xs uppercase tracking-widest text-blue-200">Careers</span>
        </div>
      </header>
      {sample && <div role="note" className="bg-amber-100 px-4 py-2 text-center text-xs font-semibold text-amber-900">SAMPLE PAGE for testing. Nothing you tap here is saved or sent to anyone.</div>}
      <main className="mx-auto flex max-w-md flex-col gap-4 px-4 py-5">{children}</main>
      <footer className="mx-auto max-w-md px-4 pb-10 text-center text-xs leading-relaxed text-slate-500">
        Mas Callnet India Pvt Ltd. This page is only for you. Interviews are free of charge; we never ask for money.
      </footer>
    </div>
  );
}

/** One screen-sized message (invalid link, location stopped, arrived...). */
export function StatusCard({ icon, tone, title, children }: { icon: ReactNode; tone: "ok" | "warn" | "bad" | "plain"; title: string; children?: ReactNode }) {
  const ring = tone === "ok" ? "bg-emerald-50 text-emerald-600" : tone === "warn" ? "bg-amber-50 text-amber-600" : tone === "bad" ? "bg-rose-50 text-rose-600" : "bg-slate-100 text-slate-500";
  return (
    <section className={`${card} text-center`}>
      <span className={`mx-auto flex h-12 w-12 items-center justify-center rounded-full ${ring}`} aria-hidden>{icon}</span>
      <h1 className="mt-3 text-lg font-semibold text-slate-900">{title}</h1>
      {children && <div className="mt-1 text-sm leading-relaxed text-slate-600">{children}</div>}
    </section>
  );
}

/** What and when: date and time up front, then where, what to carry and the reference to quote at reception. */
export function InterviewCard({ inv }: { inv: Invitation }) {
  return (
    <section className={card} aria-label="Your interview">
      <p className="flex items-center gap-2 text-xs font-semibold uppercase tracking-widest text-blue-800"><CalendarCheck className="h-4 w-4" aria-hidden /> Walk-in interview</p>
      {inv.role && <h1 className="mt-1 text-xl font-semibold leading-snug text-slate-900">{inv.role}</h1>}
      {inv.slotAt && (
        <div className="mt-3 rounded-xl border border-blue-200 bg-blue-50 p-4">
          <p className="text-sm text-blue-900">{fmtDate(inv.slotAt)}</p>
          <p className="mt-0.5 flex items-center gap-2 text-2xl font-bold tabular-nums text-blue-950"><Clock className="h-5 w-5 text-blue-800" aria-hidden /> {fmtTime(inv.slotAt)}</p>
        </div>
      )}
      <dl className="mt-4 space-y-3 text-sm">
        <div className="flex gap-3">
          <MapPin className="mt-0.5 h-4 w-4 shrink-0 text-slate-500" aria-hidden />
          <div className="min-w-0">
            <dt className="sr-only">Venue</dt>
            <dd className="text-slate-700"><b className="font-semibold text-slate-900">{inv.branchName}</b>{inv.address ? <><br />{inv.address}</> : null}</dd>
            {inv.mapsUrl && <a href={inv.mapsUrl} target="_blank" rel="noopener noreferrer" className={`mt-1.5 inline-flex items-center gap-1.5 rounded-lg px-1 py-0.5 text-sm font-medium text-blue-800 underline underline-offset-2 hover:text-blue-950 ${focus}`}><Navigation className="h-3.5 w-3.5" aria-hidden /> Open in Maps</a>}
          </div>
        </div>
        {inv.docs.length > 0 && (
          <div className="flex gap-3">
            <FileText className="mt-0.5 h-4 w-4 shrink-0 text-slate-500" aria-hidden />
            <div className="min-w-0">
              <dt className="text-slate-500">Please carry</dt>
              <dd className="mt-1 flex flex-wrap gap-1.5">{inv.docs.map((d) => <span key={d} className="rounded-full bg-slate-100 px-2.5 py-0.5 text-xs font-medium text-slate-700">{d}</span>)}</dd>
            </div>
          </div>
        )}
        <div className="flex items-center justify-between gap-3 border-t border-slate-100 pt-3">
          <dt className="text-slate-500">Reference</dt>
          <dd className="text-right"><span className="rounded-md bg-slate-100 px-2 py-1 font-mono text-sm font-medium text-slate-900">{inv.reference}</span><span className="ml-2 text-xs text-slate-500">show this at reception</span></dd>
        </div>
      </dl>
    </section>
  );
}

/** Yes / another time / cannot come. Shows the current answer instead of a dead button once the candidate has answered. */
export function RsvpCard(p: {
  firstName: string; state: string | undefined; picked: Answer | null; answered: Answer | null; showOptions: boolean; busy: boolean; error: string | null;
  onPick: (a: Answer) => void; onSend: () => void; onChange: () => void;
}) {
  const known = p.answered ?? (p.state === "confirmed" ? "yes" : p.state === "declined" ? "no" : null);
  return (
    <section className={card} aria-label="Will you come">
      <h2 className="text-lg font-semibold text-slate-900">Hi {p.firstName}, will you come?</h2>
      {!p.showOptions && known ? (
        <div className="mt-3 space-y-3">
          <div className={`flex gap-3 rounded-xl p-4 ${known === "yes" ? "bg-emerald-50 text-emerald-900" : known === "no" ? "bg-rose-50 text-rose-900" : "bg-blue-50 text-blue-900"}`} role="status">
            <CheckCircle2 className="h-5 w-5 shrink-0" aria-hidden />
            <p className="text-sm leading-relaxed">{p.answered ? ANSWERS.find((x) => x.k === known)?.done : known === "yes" ? "You have confirmed. The branch is expecting you." : "You told us you cannot come."}</p>
          </div>
          <button type="button" onClick={p.onChange} className={quietBtn}>Change my answer</button>
        </div>
      ) : (
        <>
          <div role="radiogroup" aria-label="Your answer" className="mt-3 space-y-2">
            {ANSWERS.map((a) => {
              const st = ANSWER_STYLE[a.k], Icon = st.icon, on = p.picked === a.k;
              return (
                <button key={a.k} type="button" role="radio" aria-checked={on} onClick={() => p.onPick(a.k)}
                  className={`flex w-full cursor-pointer items-center gap-3 rounded-xl border px-4 py-3 text-left transition-colors duration-150 ${focus} ${on ? st.on : "border-slate-300 bg-white hover:bg-slate-50"}`}>
                  <Icon className={`h-5 w-5 shrink-0 ${on ? st.icon_on : "text-slate-400"}`} aria-hidden />
                  <span className="min-w-0"><span className="block text-base font-medium text-slate-900">{a.label}</span><span className="block text-xs text-slate-500">{a.hint}</span></span>
                </button>
              );
            })}
          </div>
          {p.error && <p role="alert" className="mt-2 text-sm text-rose-700">{p.error}</p>}
          <button type="button" disabled={!p.picked || p.busy} onClick={p.onSend} className={`${primaryBtn} mt-3`}>{p.busy ? "Saving…" : "Send my answer"}</button>
        </>
      )}
    </section>
  );
}

/** Optional, explicit WhatsApp opt-in. */
export function WhatsAppCard({ state, onOptIn }: { state: "idle" | "busy" | "done" | "failed"; onOptIn: () => void }) {
  if (state === "done") {
    return <section className={`${card} flex gap-3 border-emerald-200 bg-emerald-50 text-emerald-900`} role="status"><CheckCircle2 className="h-5 w-5 shrink-0" aria-hidden /><p className="text-sm leading-relaxed">Done. We will send your reminder and directions on WhatsApp. Reply STOP there any time to stop.</p></section>;
  }
  return (
    <section className={card} aria-label="WhatsApp updates">
      <p className="flex items-center gap-2 font-semibold text-slate-900"><MessageCircle className="h-5 w-5 text-emerald-600" aria-hidden /> Get interview updates on WhatsApp?</p>
      <p className="mt-1 text-sm leading-relaxed text-slate-600">Reminders, directions and a quick way to change your time. Optional, and you can reply STOP any time.</p>
      <button type="button" disabled={state === "busy"} onClick={onOptIn} className={`mt-3 w-full cursor-pointer rounded-xl bg-emerald-700 px-4 py-3 text-base font-semibold text-white transition-colors duration-200 hover:bg-emerald-800 disabled:opacity-60 ${focus}`}>{state === "busy" ? "Saving…" : "Yes, send me updates on WhatsApp"}</button>
      {state === "failed" && <p role="alert" className="mt-2 text-sm text-rose-700">That did not work. Please try again.</p>}
    </section>
  );
}

/** "On your way?": share live location with consent, or skip. */
export function LocationCard(p: {
  firstName: string; sharing: boolean; eta: { km: number | null; min: number | null } | null; error: string | null;
  onStart: () => void; onStop: () => void; onSkip: () => void;
}) {
  return (
    <section className={card} aria-label="On your way">
      <h2 className="text-lg font-semibold text-slate-900">Hi {p.firstName}, on your way?</h2>
      {p.sharing ? (
        <div className="mt-3 space-y-3" aria-live="polite">
          <div className="rounded-xl bg-emerald-50 p-4 text-sm text-emerald-900">
            <b className="font-semibold">Sharing your live location.</b> Keep this page open while you travel.
            {p.eta && p.eta.min != null ? <div className="mt-1">About {p.eta.km != null ? `${p.eta.km} km` : ""} away{p.eta.min > 0 ? `, around ${p.eta.min} min` : ""}.</div> : null}
          </div>
          {p.error && <p role="status" className="text-sm text-amber-800">{p.error}</p>}
          <button type="button" onClick={p.onStop} className={quietBtn}>Stop sharing</button>
        </div>
      ) : (
        <div className="mt-3 space-y-3">
          <div className="flex gap-3 rounded-xl bg-slate-50 p-4 text-sm leading-relaxed text-slate-700">
            <ShieldCheck className="mt-0.5 h-5 w-5 shrink-0 text-blue-800" aria-hidden />
            <p>If you tap Share, your phone's location is sent to Mas Callnet <b>only while this page is open</b>, so the branch can prepare for your arrival. It stops when you reach the branch, or whenever you tap Stop. It is optional.</p>
          </div>
          {p.error && <p role="alert" className="text-sm text-rose-700">{p.error}</p>}
          <button type="button" onClick={p.onStart} className={primaryBtn}>Share my location</button>
          <button type="button" onClick={p.onSkip} className="w-full cursor-pointer rounded-xl px-4 py-3 text-base font-medium text-slate-600 transition-colors duration-200 hover:bg-slate-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-600">No thanks</button>
        </div>
      )}
    </section>
  );
}
