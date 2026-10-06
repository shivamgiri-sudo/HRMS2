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
import { CheckCircle2, MapPin, ShieldCheck, XCircle } from "lucide-react";
import { ANSWERS, InterviewCard, LocationCard, RsvpCard, Shell, StatusCard, WhatsAppCard, type Answer, type Invitation } from "./InvitationParts";

interface Ctx extends Invitation { open: boolean; sharing: boolean; waConsent?: boolean; optInOpen?: boolean; state?: string; rsvpOpen?: boolean }
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
  const [editing, setEditing] = useState(false);
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
        setError(null);
        setPhase((cur) => (cur === "arrived" ? cur : "sharing"));
        void ping(lastPos.current);
      },
      (e) => {
        if (e.code === e.PERMISSION_DENIED) { stopWatch(); void post(api(token, "/stop")); setPhase("denied"); return; }
        // A weak GPS signal or a timeout on the road is temporary: the browser keeps the watch alive and the 30 s heartbeat keeps
        // re-sending the last known position, so keep sharing and just say we are waiting.
        setError("Waiting for a GPS signal. Keep this page open.");
      },
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
      if (r.ok) { setAnswered(a); setEditing(false); } else setAnswerErr(r.status === 403 ? "Your slot time has passed, so this can no longer be changed here." : "That did not work. Please try again.");
    } catch { setAnswerErr("No connection. Please try again."); }
    setAnswerBusy(false);
  };
  // Not offered once they have said they cannot come or want another time: the server refuses opt-in for a released slot.
  const showOptIn = Boolean(ctx?.optInOpen && !ctx?.waConsent && (answered == null || answered === "yes"));
  const stop = async () => { stopWatch(); await post(api(token, "/stop")).catch(() => undefined); setPhase("stopped"); };

  if (phase === "loading") return <Shell><StatusCard tone="plain" icon={<MapPin className="h-6 w-6" />} title="Loading your interview…" /></Shell>;
  if (phase === "invalid" || !ctx) return <Shell><StatusCard tone="bad" icon={<XCircle className="h-6 w-6" />} title="This link is not valid">Please use the latest message we sent you.</StatusCard></Shell>;

  // The interview card, the answer card and the optional WhatsApp card are shared by every state where the invitation is still live.
  const interview = <InterviewCard inv={ctx} />;
  const rsvp = ctx.rsvpOpen ? (
    <RsvpCard firstName={ctx.firstName} state={ctx.state} picked={picked} answered={answered}
      showOptions={editing || (!answered && (pre != null || !["confirmed", "declined"].includes(ctx.state ?? "")))}
      busy={answerBusy} error={answerErr} onPick={setPicked} onSend={() => picked && void sendAnswer(picked)}
      onChange={() => { setAnswered(null); setEditing(true); }} />
  ) : null;
  const whatsapp = showOptIn ? <WhatsAppCard state={optIn} onOptIn={() => void optInWhatsApp()} /> : null;

  if (phase === "arrived") return <Shell><StatusCard tone="ok" icon={<CheckCircle2 className="h-6 w-6" />} title={`You have reached ${ctx.branchName}`}>Sharing has stopped. Please register at the reception and quote your reference {ctx.reference}. Good luck!</StatusCard></Shell>;
  if (phase === "stopped") return <Shell>{interview}<StatusCard tone="plain" icon={<ShieldCheck className="h-6 w-6" />} title="Sharing stopped">We are no longer using your location. See you at the branch.</StatusCard>{whatsapp}</Shell>;
  if (phase === "denied") return <Shell>{interview}<StatusCard tone="warn" icon={<XCircle className="h-6 w-6" />} title="Location permission is off">No problem. You can still come to {ctx.branchName} at your time. If you change your mind, allow location for this page and reload.</StatusCard>{whatsapp}</Shell>;
  if (phase === "closed") {
    return (
      <Shell>
        {interview}{rsvp}
        {!ctx.rsvpOpen && <StatusCard tone="plain" icon={<MapPin className="h-6 w-6" />} title={showOptIn ? `Hi ${ctx.firstName}, your walk-in is booked` : "Location sharing is not active right now"}>{showOptIn ? "Live location sharing opens a few hours before your time." : "It opens a few hours before your walk-in time. You can still just come to the branch on time."}</StatusCard>}
        {whatsapp}
      </Shell>
    );
  }
  return (
    <Shell>
      {interview}{rsvp}
      <LocationCard firstName={ctx.firstName} sharing={phase === "sharing"} eta={eta} error={error} onStart={() => void start()} onStop={() => void stop()} onSkip={() => setPhase("stopped")} />
      {whatsapp}
    </Shell>
  );
}
