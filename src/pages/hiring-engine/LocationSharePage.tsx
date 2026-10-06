/**
 * Candidate-facing "I'm on my way" page (public, opened from the WhatsApp link, no login).
 * The candidate must tap Share before anything is sent; location is posted only while this page is open, can be
 * stopped at any time, and stops by itself on arrival. The same page offers an explicit, optional WhatsApp opt-in (linked
 * from the invite email), so no separate page exists for it. The invite email's Yes / Another time / Cannot come buttons
 * land here too (?a=yes|later|no): the answer is recorded only after one more tap, so mail scanners that pre-open links
 * never answer for the candidate. Talks to /api/he-public/loc/:token only.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { useParams, useSearchParams } from "react-router-dom";
import { CalendarCheck, CheckCircle2, MapPin, MessageCircle, ShieldCheck, XCircle } from "lucide-react";

interface Ctx { firstName: string; branchName: string; address: string | null; slotAt: string | null; open: boolean; sharing: boolean; waConsent?: boolean; optInOpen?: boolean; state?: string; role?: string | null; rsvpOpen?: boolean }
type Answer = "yes" | "later" | "no";
const ANSWERS: Array<{ k: Answer; label: string; done: string }> = [
  { k: "yes", label: "Yes, I will come", done: "Thank you! The branch will expect you. Please reach 10 minutes early with your documents." },
  { k: "later", label: "I need another time", done: "Noted. Our recruiter will call you to fix a better time." },
  { k: "no", label: "I cannot come", done: "Thanks for letting us know. Your slot is freed for someone else." },
];
type Phase = "loading" | "invalid" | "closed" | "ready" | "sharing" | "arrived" | "stopped" | "denied";

const api = (token: string, path = "") => `/api/he-public/loc/${encodeURIComponent(token)}${path}`;
const post = (url: string, body?: unknown) => fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body ?? {}) });
const MIN_GAP_MS = 20_000;

export default function LocationSharePage() {
  const { token = "" } = useParams();
  const [search] = useSearchParams();
  const pre = search.get("a");
  const [picked, setPicked] = useState<Answer | null>(pre === "yes" || pre === "later" || pre === "no" ? pre : null);
  const [answered, setAnswered] = useState<Answer | null>(null);
  const [answerBusy, setAnswerBusy] = useState(false);
  const [answerErr, setAnswerErr] = useState<string | null>(null);
  const [ctx, setCtx] = useState<Ctx | null>(null);
  const [phase, setPhase] = useState<Phase>("loading");
  const [eta, setEta] = useState<{ km: number | null; min: number | null } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [optIn, setOptIn] = useState<"idle" | "busy" | "done" | "failed">("idle");
  const watchId = useRef<number | null>(null);
  const heartbeat = useRef<ReturnType<typeof setInterval> | null>(null);
  const lastPos = useRef<{ lat: number; lng: number; accuracy: number } | null>(null);
  const lastSent = useRef(0);

  useEffect(() => {
    document.title = "Your walk-in interview";
    const meta = document.createElement("meta");
    meta.name = "robots"; meta.content = "noindex";
    document.head.appendChild(meta);
    return () => { document.head.removeChild(meta); };
  }, []);

  const stopWatch = useCallback(() => {
    if (watchId.current != null) { navigator.geolocation.clearWatch(watchId.current); watchId.current = null; }
    if (heartbeat.current != null) { clearInterval(heartbeat.current); heartbeat.current = null; }
  }, []);

  useEffect(() => {
    let alive = true;
    fetch(api(token)).then(async (r) => {
      if (!alive) return;
      if (!r.ok) return setPhase("invalid");
      const j = (await r.json()) as { data: Ctx };
      setCtx(j.data);
      setPhase(!j.data.open ? "closed" : "ready");
    }).catch(() => alive && setPhase("invalid"));
    return () => { alive = false; stopWatch(); };
  }, [token, stopWatch]);

  const ping = useCallback(async (pos: { lat: number; lng: number; accuracy: number }) => {
    const now = Date.now();
    if (now - lastSent.current < MIN_GAP_MS) return;
    lastSent.current = now;
    try {
      const r = await post(api(token, "/ping"), { lat: pos.lat, lng: pos.lng, accuracy: pos.accuracy });
      if (r.status === 429) return;
      if (!r.ok) { stopWatch(); setPhase("closed"); return; }
      const j = (await r.json()) as { data: { distanceKm: number | null; etaMin: number | null; arrived: boolean } };
      setEta({ km: j.data.distanceKm, min: j.data.etaMin });
      if (j.data.arrived) { stopWatch(); setPhase("arrived"); void post(api(token, "/stop")); }
    } catch { /* offline for a moment: the next position retries */ }
  }, [token, stopWatch]);

  const start = async () => {
    setError(null);
    if (!("geolocation" in navigator)) { setError("This browser cannot share location."); return; }
    const r = await post(api(token, "/start"));
    if (!r.ok) { setPhase("closed"); return; }
    watchId.current = navigator.geolocation.watchPosition(
      (p) => {
        lastPos.current = { lat: p.coords.latitude, lng: p.coords.longitude, accuracy: p.coords.accuracy };
        setPhase((cur) => (cur === "arrived" ? cur : "sharing"));
        void ping(lastPos.current);
      },
      (e) => { stopWatch(); void post(api(token, "/stop")); setPhase(e.code === e.PERMISSION_DENIED ? "denied" : "ready"); if (e.code !== e.PERMISSION_DENIED) setError("We could not get your location. Please try again."); },
      { enableHighAccuracy: true, maximumAge: 15_000, timeout: 30_000 },
    );
    // watchPosition only fires when the position CHANGES, so someone waiting at home would go silent and the branch
    // board would drop them after 10 minutes. The heartbeat re-sends the last known position (still correct for a
    // stationary phone) instead of calling getCurrentPosition, which browsers answer unreliably while a watch is active.
    heartbeat.current = setInterval(() => { if (lastPos.current) void ping(lastPos.current); }, 30_000);
  };

  const optInWhatsApp = async () => {
    setOptIn("busy");
    try { const r = await post(api(token, "/optin")); setOptIn(r.ok ? "done" : "failed"); } catch { setOptIn("failed"); }
  };
  const sendAnswer = async (a: Answer) => {
    setAnswerBusy(true); setAnswerErr(null);
    try {
      const r = await post(api(token, "/answer"), { answer: a });
      if (r.ok) setAnswered(a); else setAnswerErr(r.status === 403 ? "Your slot time has passed, so this can no longer be changed here." : "That did not work. Please try again.");
    } catch { setAnswerErr("No connection. Please try again."); }
    setAnswerBusy(false);
  };
  const slotText = ctx?.slotAt ? `${new Date(ctx.slotAt.slice(0, 10) + "T00:00:00Z").toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" })}, ${ctx.slotAt.slice(11, 16)}` : null;
  const RsvpBlock = () => {
    if (!ctx?.rsvpOpen) return null;
    if (answered) return <div className="mb-5 flex gap-3 rounded-xl bg-emerald-50 p-4 text-emerald-800" role="status"><CheckCircle2 className="h-5 w-5 shrink-0" aria-hidden /><p>{ANSWERS.find((x) => x.k === answered)?.done}</p></div>;
    const current = ctx.state === "confirmed" ? "You have confirmed. You can still change it below." : ctx.state === "declined" ? "You said you cannot come. Changed your mind? Pick below." : null;
    return (
      <section aria-label="Will you come" className="mb-5">
        <p className="flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-blue-700"><CalendarCheck className="h-4 w-4" aria-hidden /> Walk-in interview</p>
        <h1 className="mt-1 text-xl font-bold text-slate-900">Hi {ctx.firstName}, will you come?</h1>
        <p className="mt-1 text-slate-700">{ctx.role ? <><b>{ctx.role}</b> · </> : null}{ctx.branchName}{slotText ? <><br /><b>{slotText}</b></> : null}{ctx.address ? <><br /><span className="text-sm text-slate-500">{ctx.address}</span></> : null}</p>
        {current && <p className="mt-2 text-sm text-slate-600">{current}</p>}
        <div role="radiogroup" aria-label="Your answer" className="mt-4 space-y-2">
          {ANSWERS.map((a) => (
            <button key={a.k} type="button" role="radio" aria-checked={picked === a.k} onClick={() => setPicked(a.k)}
              className={`w-full cursor-pointer rounded-xl border px-4 py-3 text-left text-base font-medium transition-colors duration-150 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 ${picked === a.k ? (a.k === "yes" ? "border-emerald-600 bg-emerald-50 text-emerald-900" : a.k === "no" ? "border-rose-500 bg-rose-50 text-rose-900" : "border-blue-600 bg-blue-50 text-blue-900") : "border-slate-300 bg-white text-slate-800 hover:bg-slate-50"}`}>{a.label}</button>
          ))}
        </div>
        {answerErr && <p role="alert" className="mt-2 text-sm text-rose-600">{answerErr}</p>}
        <button type="button" disabled={!picked || answerBusy} onClick={() => picked && void sendAnswer(picked)} className="mt-3 w-full cursor-pointer rounded-xl bg-blue-700 px-4 py-3.5 text-base font-semibold text-white transition-colors duration-200 hover:bg-blue-800 disabled:cursor-not-allowed disabled:opacity-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2">{answerBusy ? "Saving…" : "Send my answer"}</button>
      </section>
    );
  };
  const showOptIn = Boolean(ctx?.optInOpen && !ctx?.waConsent);
  const OptInBlock = () => !showOptIn ? null : optIn === "done" ? (
    <div className="mt-5 flex gap-3 rounded-xl bg-emerald-50 p-4 text-sm text-emerald-800" role="status"><CheckCircle2 className="h-5 w-5 shrink-0" aria-hidden /><p>Done. We will send your reminder and directions on WhatsApp. Reply STOP there any time to stop.</p></div>
  ) : (
    <div className="mt-5 rounded-xl border border-emerald-200 bg-emerald-50/60 p-4">
      <p className="flex items-center gap-2 font-semibold text-slate-900"><MessageCircle className="h-5 w-5 text-emerald-600" aria-hidden /> Get interview updates on WhatsApp?</p>
      <p className="mt-1 text-sm text-slate-700">Reminders, directions and a quick way to change your time. Optional, and you can reply STOP any time.</p>
      <button type="button" disabled={optIn === "busy"} onClick={() => void optInWhatsApp()} className="mt-3 w-full cursor-pointer rounded-xl bg-emerald-600 px-4 py-3 text-base font-semibold text-white transition-colors duration-200 hover:bg-emerald-700 disabled:opacity-60 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 focus-visible:ring-offset-2">{optIn === "busy" ? "Saving…" : "Yes, send me updates on WhatsApp"}</button>
      {optIn === "failed" && <p role="alert" className="mt-2 text-sm text-rose-600">That did not work. Please try again.</p>}
    </div>
  );

  const stop = async () => { stopWatch(); await post(api(token, "/stop")).catch(() => undefined); setPhase("stopped"); };

  const Card = ({ children }: { children: React.ReactNode }) => (
    <main className="flex min-h-screen items-center justify-center bg-slate-50 px-4 py-8">
      <div className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">{children}</div>
    </main>
  );
  const btn = "w-full cursor-pointer rounded-xl px-4 py-3.5 text-base font-semibold focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2";

  if (phase === "loading") return <Card><p className="text-center text-slate-500">Loading…</p></Card>;
  if (phase === "invalid") return <Card><div className="text-center"><XCircle className="mx-auto h-10 w-10 text-rose-500" aria-hidden /><h1 className="mt-3 text-lg font-bold text-slate-900">This link is not valid</h1><p className="mt-1 text-slate-600">Please use the latest message we sent you.</p></div></Card>;
  if (phase === "closed" && ctx?.rsvpOpen) return <Card><RsvpBlock /><OptInBlock /></Card>;
  if (phase === "closed") return <Card><div className="text-center"><MapPin className="mx-auto h-10 w-10 text-slate-400" aria-hidden /><h1 className="mt-3 text-lg font-bold text-slate-900">{showOptIn ? `Hi ${ctx?.firstName}, your walk-in is booked` : "Location sharing is not active right now"}</h1><p className="mt-1 text-slate-600">{showOptIn ? <>{ctx?.branchName}{ctx?.slotAt ? <>, {ctx.slotAt.slice(0, 10)} at {ctx.slotAt.slice(11, 16)}</> : null}. Live location sharing opens a few hours before your time.</> : "It opens a few hours before your walk-in time. You can still just come to the branch on time."}</p></div><OptInBlock /></Card>;
  if (phase === "arrived") return <Card><div className="text-center"><CheckCircle2 className="mx-auto h-10 w-10 text-emerald-600" aria-hidden /><h1 className="mt-3 text-lg font-bold text-slate-900">You have reached {ctx?.branchName}</h1><p className="mt-1 text-slate-600">Sharing has stopped. Please register at the reception. Good luck!</p></div></Card>;
  if (phase === "stopped") return <Card><div className="text-center"><ShieldCheck className="mx-auto h-10 w-10 text-slate-500" aria-hidden /><h1 className="mt-3 text-lg font-bold text-slate-900">Sharing stopped</h1><p className="mt-1 text-slate-600">We are no longer using your location. See you at the branch.</p></div></Card>;
  if (phase === "denied") return <Card><div className="text-center"><XCircle className="mx-auto h-10 w-10 text-amber-500" aria-hidden /><h1 className="mt-3 text-lg font-bold text-slate-900">Location permission is off</h1><p className="mt-1 text-slate-600">No problem. You can still come to {ctx?.branchName} at your time. If you change your mind, allow location for this page and reload.</p></div></Card>;

  return (
    <Card>
      <RsvpBlock />
      <h1 className="text-xl font-bold text-slate-900">Hi {ctx?.firstName}, on your way?</h1>
      <p className="mt-1 text-slate-600">Your walk-in is at <b>{ctx?.branchName}</b>{ctx?.slotAt ? <> at <b>{ctx.slotAt.slice(11, 16)}</b></> : null}.{ctx?.address ? <><br /><span className="text-sm">{ctx.address}</span></> : null}</p>
      {phase === "sharing" ? (
        <div className="mt-5 space-y-4" aria-live="polite">
          <div className="rounded-xl bg-emerald-50 p-4 text-emerald-800"><b>Sharing your live location.</b> Keep this page open while you travel.{eta && eta.min != null ? <div className="mt-1 text-sm">About {eta.km != null ? `${eta.km} km` : ""} away{eta.min > 0 ? `, around ${eta.min} min` : ""}.</div> : null}</div>
          <button type="button" onClick={() => void stop()} className={`${btn} border border-slate-300 bg-white text-slate-800 hover:bg-slate-50`}>Stop sharing</button>
        </div>
      ) : (
        <div className="mt-5 space-y-4">
          <div className="flex gap-3 rounded-xl bg-slate-50 p-4 text-sm text-slate-700"><ShieldCheck className="mt-0.5 h-5 w-5 shrink-0 text-blue-600" aria-hidden /><p>If you tap Share, your phone's location is sent to Mas Callnet <b>only while this page is open</b>, so the branch can prepare for your arrival. It stops when you reach the branch, or whenever you tap Stop. It is optional.</p></div>
          {error && <p role="alert" className="text-sm text-rose-600">{error}</p>}
          <button type="button" onClick={() => void start()} className={`${btn} bg-blue-600 text-white hover:bg-blue-700`}>Share my location</button>
          <button type="button" onClick={() => setPhase("stopped")} className={`${btn} bg-white text-slate-600 hover:bg-slate-50`}>No thanks</button>
        </div>
      )}
      <OptInBlock />
    </Card>
  );
}
