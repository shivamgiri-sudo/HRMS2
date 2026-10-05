/**
 * Candidate-facing "I'm on my way" page (public, opened from the WhatsApp link, no login).
 * The candidate must tap Share before anything is sent; location is posted only while this page is open, can be
 * stopped at any time, and stops by itself on arrival. Talks to /api/he-public/loc/:token only.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { useParams } from "react-router-dom";
import { CheckCircle2, MapPin, ShieldCheck, XCircle } from "lucide-react";

interface Ctx { firstName: string; branchName: string; address: string | null; slotAt: string | null; open: boolean; sharing: boolean }
type Phase = "loading" | "invalid" | "closed" | "ready" | "sharing" | "arrived" | "stopped" | "denied";

const api = (token: string, path = "") => `/api/he-public/loc/${encodeURIComponent(token)}${path}`;
const post = (url: string, body?: unknown) => fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body ?? {}) });
const MIN_GAP_MS = 20_000;

export default function LocationSharePage() {
  const { token = "" } = useParams();
  const [ctx, setCtx] = useState<Ctx | null>(null);
  const [phase, setPhase] = useState<Phase>("loading");
  const [eta, setEta] = useState<{ km: number | null; min: number | null } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const watchId = useRef<number | null>(null);
  const lastSent = useRef(0);

  useEffect(() => {
    document.title = "Share your arrival";
    const meta = document.createElement("meta");
    meta.name = "robots"; meta.content = "noindex";
    document.head.appendChild(meta);
    return () => { document.head.removeChild(meta); };
  }, []);

  const stopWatch = useCallback(() => {
    if (watchId.current != null) { navigator.geolocation.clearWatch(watchId.current); watchId.current = null; }
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

  const ping = useCallback(async (pos: GeolocationPosition) => {
    const now = Date.now();
    if (now - lastSent.current < MIN_GAP_MS) return;
    lastSent.current = now;
    try {
      const r = await post(api(token, "/ping"), { lat: pos.coords.latitude, lng: pos.coords.longitude, accuracy: pos.coords.accuracy });
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
      (p) => { setPhase((cur) => (cur === "arrived" ? cur : "sharing")); void ping(p); },
      (e) => { stopWatch(); void post(api(token, "/stop")); setPhase(e.code === e.PERMISSION_DENIED ? "denied" : "ready"); if (e.code !== e.PERMISSION_DENIED) setError("We could not get your location. Please try again."); },
      { enableHighAccuracy: true, maximumAge: 15_000, timeout: 30_000 },
    );
  };

  const stop = async () => { stopWatch(); await post(api(token, "/stop")).catch(() => undefined); setPhase("stopped"); };

  const Card = ({ children }: { children: React.ReactNode }) => (
    <main className="flex min-h-screen items-center justify-center bg-slate-50 px-4 py-8">
      <div className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">{children}</div>
    </main>
  );
  const btn = "w-full cursor-pointer rounded-xl px-4 py-3.5 text-base font-semibold focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2";

  if (phase === "loading") return <Card><p className="text-center text-slate-500">Loading…</p></Card>;
  if (phase === "invalid") return <Card><div className="text-center"><XCircle className="mx-auto h-10 w-10 text-rose-500" aria-hidden /><h1 className="mt-3 text-lg font-bold text-slate-900">This link is not valid</h1><p className="mt-1 text-slate-600">Please use the latest message we sent you.</p></div></Card>;
  if (phase === "closed") return <Card><div className="text-center"><MapPin className="mx-auto h-10 w-10 text-slate-400" aria-hidden /><h1 className="mt-3 text-lg font-bold text-slate-900">Location sharing is not active right now</h1><p className="mt-1 text-slate-600">It opens a few hours before your walk-in time. You can still just come to the branch on time.</p></div></Card>;
  if (phase === "arrived") return <Card><div className="text-center"><CheckCircle2 className="mx-auto h-10 w-10 text-emerald-600" aria-hidden /><h1 className="mt-3 text-lg font-bold text-slate-900">You have reached {ctx?.branchName}</h1><p className="mt-1 text-slate-600">Sharing has stopped. Please register at the reception. Good luck!</p></div></Card>;
  if (phase === "stopped") return <Card><div className="text-center"><ShieldCheck className="mx-auto h-10 w-10 text-slate-500" aria-hidden /><h1 className="mt-3 text-lg font-bold text-slate-900">Sharing stopped</h1><p className="mt-1 text-slate-600">We are no longer using your location. See you at the branch.</p></div></Card>;
  if (phase === "denied") return <Card><div className="text-center"><XCircle className="mx-auto h-10 w-10 text-amber-500" aria-hidden /><h1 className="mt-3 text-lg font-bold text-slate-900">Location permission is off</h1><p className="mt-1 text-slate-600">No problem. You can still come to {ctx?.branchName} at your time. If you change your mind, allow location for this page and reload.</p></div></Card>;

  return (
    <Card>
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
    </Card>
  );
}
