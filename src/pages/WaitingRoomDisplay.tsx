import { useEffect, useRef, useState, useCallback } from "react";
import { useSearchParams } from "react-router-dom";
import mcnLogo from "@/assets/brand/mcn-logo.png";

// ── Brand Colors (exact from MCN logo) ────────────────────────────────────────
// Blue  #1565C0  · Red  #E53935  · Green  #43A047

// ── Types ─────────────────────────────────────────────────────────────────────

interface SafeQueueEntry {
  token_number: string;
  queue_status: "waiting" | "called" | "in_interview" | "completed" | "no_show";
  estimated_wait_time: number | null;
  position_in_queue: number;
  applied_role: string | null;
  branch_name: string | null;
  called_at: string | null;
  interview_started_at: string | null;
  candidate_name: string | null;
}

interface QueueMetrics {
  total_waiting: number;
  total_in_interview: number;
  total_completed_today: number;
  average_wait_time: number;
  average_interview_duration: number;
  active_recruiters: number;
}

interface DisplayPayload {
  queue: SafeQueueEntry[];
  metrics: QueueMetrics;
  ts: number;
}

interface DisplayStreamEvent {
  success?: boolean;
  data?: Omit<DisplayPayload, "ts">;
  ts?: number;
}

// ── Constants ─────────────────────────────────────────────────────────────────

const TICKER_TIPS = [
  "Please keep your original ID proof and a photocopy ready",
  "Dress professionally — first impressions count!",
  "MAS Callnet — one of India's leading BPO organisations",
  "Our team is here to help — ask at the front desk anytime",
  "Interview rounds typically take 30–45 minutes",
  "We offer PF, ESIC, incentives and strong career growth",
  "Thank you for your patience — we will call your token shortly",
  "Please keep your mobile on silent during the interview",
  "Bring your educational certificates for verification today",
  "Welcome to MAS Callnet — we are excited to meet you!",
];

const POLL_INTERVAL = 5_000;
const TICKER_INTERVAL = 7_000;
const BASE_URL = "";

// ── Audio helpers ─────────────────────────────────────────────────────────────

let audioCtx: AudioContext | null = null;

function getAudioCtx(): AudioContext {
  if (!audioCtx) audioCtx = new AudioContext();
  return audioCtx;
}

function playChime() {
  try {
    const ctx = getAudioCtx();
    const notes = [523.25, 659.25, 783.99, 1046.5]; // C5 E5 G5 C6
    notes.forEach((freq, i) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.type = "sine";
      osc.frequency.value = freq;
      const t = ctx.currentTime + i * 0.22;
      gain.gain.setValueAtTime(0, t);
      gain.gain.linearRampToValueAtTime(0.35, t + 0.06);
      gain.gain.exponentialRampToValueAtTime(0.001, t + 0.7);
      osc.start(t);
      osc.stop(t + 0.7);
    });
  } catch {/* silent */}
}

function buildAnnouncementText(tokenNumber: string, candidateName: string | null, role: string | null): string {
  const digits = tokenNumber.slice(-3).split("").join(" ");
  const namePhrase = candidateName ? `, ${candidateName},` : "";
  const rolePhrase = role ? ` for the position of ${role}` : "";
  return `Attention please. Token number ${digits}${namePhrase}${rolePhrase}. Please approach the Interview Room for your interview. Thank you.`;
}

// Microsoft Neural voice priority list
const MS_NEURAL_PRIORITY = [
  "Microsoft Neerja Online (Natural) - English (India)",
  "Microsoft Prabhat Online (Natural) - English (India)",
  "Microsoft Aria Online (Natural) - English (United States)",
  "Microsoft Jenny Online (Natural) - English (United States)",
  "Microsoft Guy Online (Natural) - English (United States)",
  "Microsoft Libby Online (Natural) - English (United Kingdom)",
  "Microsoft Ryan Online (Natural) - English (United Kingdom)",
  "Microsoft Neerja - English (India)",
  "Microsoft Prabhat - English (India)",
  "Microsoft Aria - English (United States)",
  "Microsoft Jenny - English (United States)",
  "Microsoft Zira - English (United States)",
  "Microsoft David - English (United States)",
];

function pickBestVoice(voices: SpeechSynthesisVoice[]): SpeechSynthesisVoice | null {
  for (const name of MS_NEURAL_PRIORITY) {
    const v = voices.find((v) => v.name === name);
    if (v) return v;
  }
  const msOnlineIN = voices.find((v) => /microsoft/i.test(v.name) && /online/i.test(v.name) && v.lang === "en-IN");
  if (msOnlineIN) return msOnlineIN;
  const msOnlineEN = voices.find((v) => /microsoft/i.test(v.name) && /online/i.test(v.name) && v.lang.startsWith("en"));
  if (msOnlineEN) return msOnlineEN;
  const msIN = voices.find((v) => /microsoft/i.test(v.name) && v.lang === "en-IN");
  if (msIN) return msIN;
  const msEN = voices.find((v) => /microsoft/i.test(v.name) && v.lang.startsWith("en"));
  if (msEN) return msEN;
  const gIN = voices.find((v) => /google/i.test(v.name) && v.lang === "en-IN");
  if (gIN) return gIN;
  const anyIN = voices.find((v) => v.lang === "en-IN");
  if (anyIN) return anyIN;
  return voices.find((v) => v.lang.startsWith("en")) ?? null;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function formatClock(date: Date): string {
  return date.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false });
}

function formatDate(date: Date): string {
  return date.toLocaleDateString("en-IN", { weekday: "long", day: "numeric", month: "long", year: "numeric" });
}

function formatWait(minutes: number | null): string {
  if (minutes == null || minutes <= 0) return "< 1 min";
  if (minutes < 60) return `${minutes} min`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m > 0 ? `${h}h ${m}m` : `${h}h`;
}

function last3(token: string): string {
  return token.slice(-3);
}

function statusLabel(status: SafeQueueEntry["queue_status"]): string {
  const map: Record<string, string> = {
    waiting: "Waiting",
    called: "Called",
    in_interview: "In Interview",
    completed: "Done",
    no_show: "No Show",
  };
  return map[status] ?? status;
}

// ── Slot-machine digit component ─────────────────────────────────────────────

function SlotDigit({ target, animKey, delay }: { target: string; animKey: number; delay: number }) {
  const [display, setDisplay] = useState(target);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (timerRef.current) clearInterval(timerRef.current);
    const CHARS = "0123456789";
    let count = 0;
    const TOTAL = 10 + delay; // more steps for later digits
    const startDelay = setTimeout(() => {
      timerRef.current = setInterval(() => {
        count++;
        if (count >= TOTAL) {
          setDisplay(target);
          clearInterval(timerRef.current!);
        } else {
          setDisplay(CHARS[(count * 3 + delay * 7) % 10]);
        }
      }, 55);
    }, delay * 80);
    return () => { clearTimeout(startDelay); if (timerRef.current) clearInterval(timerRef.current); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [animKey]);

  return <span className="wr-slot-digit">{display}</span>;
}

// ── Main Component ────────────────────────────────────────────────────────────

export default function WaitingRoomDisplay() {
  const [searchParams] = useSearchParams();
  const urlBranch = searchParams.get("branch") ?? "";
  const isBranchLocked = urlBranch !== "";

  const [clock, setClock] = useState(new Date());
  const [branches, setBranches] = useState<string[]>([]);
  const [selectedBranch, setSelectedBranch] = useState<string>(
    () => urlBranch || (localStorage.getItem("wr_branch") ?? "")
  );
  const [queue, setQueue] = useState<SafeQueueEntry[]>([]);
  const [metrics, setMetrics] = useState<QueueMetrics | null>(null);
  const [tickerIdx, setTickerIdx] = useState(0);
  const [tickerVisible, setTickerVisible] = useState(true);
  const [displayToken, setDisplayToken] = useState<{ token: string; name: string | null; role: string | null } | null>(null);
  const [tokenAnimKey, setTokenAnimKey] = useState(0);
  const [flashKey, setFlashKey] = useState(0);
  const [sseConnected, setSseConnected] = useState(false);
  const [audioReady, setAudioReady] = useState(false);
  const [metricKeys, setMetricKeys] = useState({ waiting: 0, inRoom: 0, done: 0 });
  const prevMetricsRef = useRef<{ waiting: number; inRoom: number; done: number }>({ waiting: 0, inRoom: 0, done: 0 });

  // Announcement queue
  const seenCalledRef = useRef<Set<string>>(new Set());
  const announceQueueRef = useRef<Array<{ token: string; name: string | null; role: string | null }>>([]);
  const isSpeakingRef = useRef(false);

  const esRef = useRef<EventSource | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Unlock audio on first interaction
  useEffect(() => {
    const unlock = () => {
      try { getAudioCtx().resume(); setAudioReady(true); } catch {/* */}
      document.removeEventListener("click", unlock);
      document.removeEventListener("keydown", unlock);
    };
    document.addEventListener("click", unlock);
    document.addEventListener("keydown", unlock);
    return () => {
      document.removeEventListener("click", unlock);
      document.removeEventListener("keydown", unlock);
    };
  }, []);

  useEffect(() => {
    const t = setInterval(() => setClock(new Date()), 1000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    const t = setInterval(() => {
      setTickerVisible(false);
      setTimeout(() => { setTickerIdx((i) => (i + 1) % TICKER_TIPS.length); setTickerVisible(true); }, 400);
    }, TICKER_INTERVAL);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    fetch(`${BASE_URL}/api/ats/queue/branches`)
      .then((r) => r.json())
      .then((j) => {
        if (j.success && Array.isArray(j.data)) {
          setBranches(j.data);
          const saved = localStorage.getItem("wr_branch") ?? "";
          if (saved && !j.data.includes(saved)) { localStorage.removeItem("wr_branch"); setSelectedBranch(""); }
        }
      })
      .catch(() => {});
  }, []);

  // Drain announcement queue one token at a time
  const drainQueue = useCallback(() => {
    if (isSpeakingRef.current) return;
    const next = announceQueueRef.current.shift();
    if (!next) return;

    isSpeakingRef.current = true;
    setDisplayToken(next);
    setTokenAnimKey((k) => k + 1);
    setFlashKey((k) => k + 1);
    playChime();

    setTimeout(() => {
      if (!window.speechSynthesis) { isSpeakingRef.current = false; drainQueue(); return; }
      const text = buildAnnouncementText(next.token, next.name, next.role);
      const voices = window.speechSynthesis.getVoices();
      const doSpeak = () => {
        const utt = new SpeechSynthesisUtterance(text);
        const voice = pickBestVoice(window.speechSynthesis.getVoices());
        if (voice) utt.voice = voice;
        utt.lang = voice?.lang ?? "en-IN";
        utt.rate = 0.88;
        utt.pitch = 1.0;
        utt.volume = 1.0;
        utt.onend = () => { isSpeakingRef.current = false; drainQueue(); };
        utt.onerror = () => { isSpeakingRef.current = false; drainQueue(); };
        window.speechSynthesis.speak(utt);
      };
      if (voices.length === 0) {
        window.speechSynthesis.onvoiceschanged = () => { window.speechSynthesis.onvoiceschanged = null; doSpeak(); };
      } else {
        doSpeak();
      }
    }, 1800);
  }, []);

  const applyPayload = useCallback((payload: DisplayPayload) => {
    setQueue(payload.queue ?? []);

    const m = payload.metrics ?? null;
    setMetrics(m);
    if (m) {
      const prev = prevMetricsRef.current;
      setMetricKeys((k) => ({
        waiting: m.total_waiting !== prev.waiting ? k.waiting + 1 : k.waiting,
        inRoom: m.total_in_interview !== prev.inRoom ? k.inRoom + 1 : k.inRoom,
        done: m.total_completed_today !== prev.done ? k.done + 1 : k.done,
      }));
      prevMetricsRef.current = { waiting: m.total_waiting, inRoom: m.total_in_interview, done: m.total_completed_today };
    }

    const calledEntries = payload.queue.filter((q) => q.queue_status === "called");
    calledEntries.forEach((entry) => {
      if (!seenCalledRef.current.has(entry.token_number)) {
        seenCalledRef.current.add(entry.token_number);
        announceQueueRef.current.push({
          token: entry.token_number,
          name: (entry as any).candidate_name ?? null,
          role: entry.applied_role ?? null,
        });
      }
    });

    const activeTokens = new Set(payload.queue.map((q) => q.token_number));
    seenCalledRef.current.forEach((t) => { if (!activeTokens.has(t)) seenCalledRef.current.delete(t); });

    if (calledEntries.length === 0 && announceQueueRef.current.length === 0 && !isSpeakingRef.current) {
      setDisplayToken(null);
    }

    drainQueue();
  }, [drainQueue]);

  const fetchSnapshot = useCallback(() => {
    const params = new URLSearchParams();
    if (selectedBranch) params.set("branch", selectedBranch);
    fetch(`${BASE_URL}/api/ats/queue/public-display?${params}`)
      .then((r) => r.json())
      .then((j) => { if (j.success) applyPayload({ ...j.data, ts: Date.now() }); })
      .catch(() => {});
  }, [selectedBranch, applyPayload]);

  useEffect(() => {
    if (esRef.current) { esRef.current.close(); esRef.current = null; }
    if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
    const params = new URLSearchParams();
    if (selectedBranch) params.set("branch", selectedBranch);
    const es = new EventSource(`${BASE_URL}/api/ats/queue/display-stream?${params}`);
    esRef.current = es;
    es.onopen = () => setSseConnected(true);
    es.onmessage = (e) => {
      try {
        const payload: DisplayStreamEvent = JSON.parse(e.data);
        if (payload.data) applyPayload({ ...payload.data, ts: payload.ts ?? Date.now() });
      } catch {/* */}
    };
    es.onerror = () => {
      setSseConnected(false);
      es.close();
      esRef.current = null;
      fetchSnapshot();
      pollRef.current = setInterval(fetchSnapshot, POLL_INTERVAL);
    };
    return () => { es.close(); if (pollRef.current) clearInterval(pollRef.current); };
  }, [selectedBranch, applyPayload, fetchSnapshot]);

  const handleBranchChange = (b: string) => {
    setSelectedBranch(b);
    b ? localStorage.setItem("wr_branch", b) : localStorage.removeItem("wr_branch");
  };

  const waitingQueue = queue.filter((q) => q.queue_status === "waiting").slice(0, 7);
  const inInterviewQueue = queue.filter((q) => q.queue_status === "in_interview").slice(0, 4);
  const nextUpEntry = waitingQueue[0];
  const digits3 = displayToken ? last3(displayToken.token).split("") : ["—", "—", "—"];

  return (
    <>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Poppins:wght@400;500;600;700;800;900&display=swap');

        *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

        .wr {
          width: 100vw;
          height: 100dvh;
          overflow: hidden;
          background: linear-gradient(145deg, #071A40 0%, #0A2460 30%, #0D3080 60%, #1565C0 100%);
          color: #FFFFFF;
          font-family: 'Poppins', system-ui, sans-serif;
          display: flex;
          flex-direction: column;
          position: relative;
        }

        /* ── Scan-line TV overlay ── */
        .wr-scanlines {
          position: fixed;
          inset: 0;
          background: repeating-linear-gradient(
            transparent 0px, transparent 3px,
            rgba(0,0,0,0.035) 3px, rgba(0,0,0,0.035) 4px
          );
          pointer-events: none;
          z-index: 200;
        }

        /* ── Attention flash on call ── */
        .wr-flash {
          position: fixed;
          inset: 0;
          background: radial-gradient(ellipse at center, rgba(229,57,53,0.55) 0%, rgba(229,57,53,0.1) 50%, transparent 75%);
          pointer-events: none;
          z-index: 150;
          opacity: 0;
          animation: wr-flash-anim 1.2s ease-out forwards;
        }
        @keyframes wr-flash-anim {
          0%   { opacity: 0; }
          12%  { opacity: 1; }
          100% { opacity: 0; }
        }

        /* ── Aurora blobs (replace dot particles) ── */
        .wr-blob {
          position: absolute;
          border-radius: 50%;
          pointer-events: none;
          filter: blur(90px);
          will-change: transform;
        }
        .wr-blob-1 {
          width: 650px; height: 650px;
          background: rgba(229,57,53,0.09);
          top: -20%; left: -12%;
          animation: wr-drift1 28s linear infinite;
        }
        .wr-blob-2 {
          width: 500px; height: 500px;
          background: rgba(67,160,71,0.07);
          top: 35%; right: -14%;
          animation: wr-drift2 22s linear infinite;
        }
        .wr-blob-3 {
          width: 420px; height: 420px;
          background: rgba(255,255,255,0.04);
          bottom: -8%; left: 28%;
          animation: wr-drift3 34s linear infinite;
        }
        @keyframes wr-drift1 {
          0%   { transform: translate(0,0) rotate(0deg); }
          33%  { transform: translate(70px,-50px) rotate(120deg); }
          66%  { transform: translate(-40px,80px) rotate(240deg); }
          100% { transform: translate(0,0) rotate(360deg); }
        }
        @keyframes wr-drift2 {
          0%   { transform: translate(0,0) rotate(0deg); }
          33%  { transform: translate(-60px,40px) rotate(120deg); }
          66%  { transform: translate(50px,-60px) rotate(240deg); }
          100% { transform: translate(0,0) rotate(360deg); }
        }
        @keyframes wr-drift3 {
          0%   { transform: translate(0,0) rotate(0deg); }
          33%  { transform: translate(40px,60px) rotate(120deg); }
          66%  { transform: translate(-60px,-30px) rotate(240deg); }
          100% { transform: translate(0,0) rotate(360deg); }
        }

        /* ── Header ── */
        .wr-header {
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: 0 32px;
          height: 70px;
          background: rgba(0,0,0,0.30);
          backdrop-filter: blur(12px);
          border-bottom: 1px solid rgba(255,255,255,0.12);
          flex-shrink: 0;
          z-index: 10;
        }
        .wr-header-left { display: flex; align-items: center; gap: 14px; }
        .wr-logo { height: 44px; width: auto; object-fit: contain; }
        .wr-company {
          font-size: 19px; font-weight: 800;
          letter-spacing: 0.07em; color: #FFFFFF; line-height: 1.1;
        }
        .wr-tagline {
          font-size: 9px; font-weight: 600; color: rgba(255,255,255,0.75);
          letter-spacing: 0.14em; text-transform: uppercase; margin-top: 2px;
        }
        .wr-header-right { display: flex; align-items: center; gap: 20px; }
        .wr-live-badge {
          display: flex; align-items: center; gap: 6px;
          background: rgba(255,255,255,0.08);
          border: 1px solid rgba(255,255,255,0.18);
          border-radius: 999px; padding: 4px 12px;
          font-size: 10px; font-weight: 700;
          letter-spacing: 0.1em; text-transform: uppercase;
        }
        .wr-live-dot {
          width: 7px; height: 7px; border-radius: 50%;
          background: #43A047; animation: wr-live-pulse 1.5s ease-in-out infinite;
        }
        .wr-live-dot.offline { background: #E53935; animation: none; }
        @keyframes wr-live-pulse {
          0%, 100% { opacity: 1; transform: scale(1); }
          50%       { opacity: 0.4; transform: scale(0.8); }
        }
        .wr-branch-select {
          background: rgba(255,255,255,0.1);
          border: 1px solid rgba(255,255,255,0.22);
          color: #FFFFFF; padding: 6px 28px 6px 12px;
          border-radius: 10px; font-size: 13px; font-weight: 500;
          font-family: 'Poppins', sans-serif; cursor: pointer;
          outline: none; appearance: none; -webkit-appearance: none;
          background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='8' viewBox='0 0 12 8'%3E%3Cpath d='M1 1l5 5 5-5' stroke='white' stroke-width='1.5' fill='none' stroke-linecap='round'/%3E%3C/svg%3E");
          background-repeat: no-repeat; background-position: right 10px center; min-width: 150px;
        }
        .wr-branch-select option { background: #0D3080; color: #fff; }
        .wr-branch-locked {
          display: flex; flex-direction: column; align-items: flex-end; gap: 2px;
          background: rgba(255,255,255,0.08); border: 1px solid rgba(255,255,255,0.18);
          border-radius: 10px; padding: 5px 14px; min-width: 120px;
          font-family: 'Poppins', sans-serif; color: #FFFFFF; font-size: 13px; font-weight: 700;
        }
        .wr-clock { text-align: right; }
        .wr-time {
          font-size: 28px; font-weight: 800;
          color: #FFFFFF; letter-spacing: 0.06em; line-height: 1;
        }
        .wr-date { font-size: 10px; font-weight: 600; color: rgba(255,255,255,0.8); margin-top: 2px; }

        /* ── Body ── */
        .wr-body {
          flex: 1; display: grid; grid-template-columns: 1fr 1fr;
          gap: 20px; padding: 18px 28px;
          overflow: hidden; min-height: 0;
        }

        /* ── Left panel ── */
        .wr-left {
          display: flex; flex-direction: column;
          align-items: center; justify-content: center; gap: 18px;
        }

        /* LED-style NOW CALLING header */
        .wr-now-calling-header {
          display: flex; align-items: center; gap: 10px;
          font-size: 10px; font-weight: 800;
          letter-spacing: 0.28em; text-transform: uppercase; color: #FFFFFF;
        }
        .wr-led-dot {
          width: 10px; height: 10px; border-radius: 50%;
          background: #E53935;
          box-shadow: 0 0 8px #E53935, 0 0 16px rgba(229,57,53,0.5);
          animation: wr-led-blink 0.9s ease-in-out infinite;
        }
        @keyframes wr-led-blink {
          0%, 100% { opacity: 1; box-shadow: 0 0 8px #E53935, 0 0 18px rgba(229,57,53,0.6); }
          50%       { opacity: 0.35; box-shadow: 0 0 4px #E53935; }
        }
        .wr-now-calling-header-line {
          flex: 1; height: 1px; background: rgba(255,255,255,0.2); max-width: 50px;
        }

        /* Calling card + spotlight */
        .wr-card-wrap {
          position: relative; width: 100%; max-width: 440px;
        }
        .wr-spotlight {
          position: absolute; inset: -50px; border-radius: 50%;
          background: radial-gradient(circle, rgba(229,57,53,0.22) 0%, transparent 68%);
          pointer-events: none; opacity: 0;
          transition: opacity 0.4s ease;
        }
        .wr-card-wrap.active .wr-spotlight {
          opacity: 1; animation: wr-spotlight-pulse 2.2s ease-in-out infinite;
        }
        @keyframes wr-spotlight-pulse {
          0%, 100% { transform: scale(1); opacity: 0.9; }
          50%       { transform: scale(1.12); opacity: 0.5; }
        }
        .wr-calling-card {
          position: relative; overflow: hidden;
          width: 100%; background: #FFFFFF;
          border-radius: 24px; padding: 26px 32px 22px;
          text-align: center;
          border-top: 6px solid #E53935;
          box-shadow: 0 12px 50px rgba(0,0,0,0.3), 0 0 0 1px rgba(255,255,255,0.08);
          transition: box-shadow 0.4s ease;
        }
        .wr-calling-card.active {
          box-shadow: 0 12px 50px rgba(229,57,53,0.35), 0 0 80px rgba(229,57,53,0.18);
        }
        .wr-calling-card.idle {
          border-top-color: rgba(255,255,255,0.25);
          background: rgba(255,255,255,0.06);
          box-shadow: 0 4px 20px rgba(0,0,0,0.15);
        }
        .wr-card-accent {
          position: absolute; top: 0; left: 0; right: 0; height: 3px;
          background: linear-gradient(90deg, #E53935, #FF5252, #E53935);
          background-size: 200% 100%;
          animation: wr-shimmer 2s linear infinite;
        }
        @keyframes wr-shimmer {
          0%   { background-position: 100% 0; }
          100% { background-position: -100% 0; }
        }
        .wr-badge-now-calling {
          display: inline-flex; align-items: center; gap: 6px;
          background: #E53935; color: #FFFFFF;
          font-size: 10px; font-weight: 700;
          letter-spacing: 0.18em; text-transform: uppercase;
          padding: 4px 14px; border-radius: 999px; margin-bottom: 14px;
        }
        .wr-badge-dot {
          width: 6px; height: 6px; border-radius: 50%; background: #FFFFFF;
          animation: wr-badge-blink 0.8s ease-in-out infinite;
        }
        @keyframes wr-badge-blink {
          0%, 100% { opacity: 1; }
          50%       { opacity: 0.25; }
        }

        /* Slot-machine token digits */
        .wr-token-slots {
          display: flex; justify-content: center; gap: 6px;
          margin-bottom: 4px;
        }
        .wr-slot-digit {
          display: inline-flex; align-items: center; justify-content: center;
          font-size: clamp(64px, 8.5vw, 112px);
          font-weight: 900; color: #E53935; line-height: 1;
          letter-spacing: 0;
          width: clamp(52px, 7vw, 88px);
          background: #FFF5F5;
          border-radius: 10px;
          border: 2px solid rgba(229,57,53,0.15);
        }
        .wr-token-full {
          font-size: 12px; font-weight: 600; color: #1565C0;
          margin-top: 4px; letter-spacing: 0.05em;
        }
        .wr-candidate-name {
          font-size: 17px; font-weight: 700; color: #1565C0;
          margin-top: 8px; letter-spacing: 0.02em;
        }
        .wr-token-role {
          font-size: 14px; font-weight: 700; color: #1565C0; margin-top: 6px;
        }
        .wr-token-instruction {
          font-size: 13px; font-weight: 500; color: #546E7A;
          margin-top: 6px; line-height: 1.4;
        }

        /* Idle card */
        .wr-idle-wrap { padding: 8px 0; }
        .wr-idle-icon {
          width: 52px; height: 52px; border-radius: 50%;
          background: rgba(255,255,255,0.08);
          display: flex; align-items: center; justify-content: center;
          margin: 0 auto 12px;
        }
        .wr-idle-text {
          font-size: 22px; font-weight: 700; color: rgba(255,255,255,0.9);
          letter-spacing: 0.06em;
        }
        .wr-idle-sub {
          font-size: 12px; font-weight: 500; color: rgba(255,255,255,0.55); margin-top: 6px;
        }

        /* Next-up teaser */
        .wr-next-up {
          display: flex; align-items: center; gap: 8px;
          background: rgba(255,255,255,0.07);
          border: 1px solid rgba(255,255,255,0.15);
          border-radius: 999px; padding: 6px 16px;
          font-size: 12px; font-weight: 600; color: rgba(255,255,255,0.85);
          animation: wr-next-pulse 2.5s ease-in-out infinite;
          max-width: 440px; width: 100%;
        }
        .wr-next-dot {
          width: 7px; height: 7px; border-radius: 50%;
          background: #FFA726; flex-shrink: 0;
          animation: wr-live-pulse 1.6s ease-in-out infinite;
        }
        @keyframes wr-next-pulse {
          0%, 100% { border-color: rgba(255,255,255,0.15); }
          50%       { border-color: rgba(255,167,38,0.4); }
        }

        /* In interview strip */
        .wr-in-interview-wrap { width: 100%; max-width: 440px; }
        .wr-section-label {
          font-size: 9px; font-weight: 800; letter-spacing: 0.22em;
          text-transform: uppercase; color: rgba(255,255,255,0.7); margin-bottom: 8px;
        }
        .wr-interview-pill {
          display: flex; align-items: center; gap: 10px;
          background: rgba(67,160,71,0.12);
          border: 1px solid rgba(67,160,71,0.3);
          border-radius: 12px; padding: 8px 14px; margin-bottom: 6px;
        }
        .wr-green-dot {
          width: 8px; height: 8px; border-radius: 50%; background: #43A047;
          flex-shrink: 0; animation: wr-live-pulse 1.5s ease-in-out infinite;
        }
        .wr-interview-token { font-size: 14px; font-weight: 700; color: #FFFFFF; flex: 1; }
        .wr-interview-badge { font-size: 10px; font-weight: 600; color: #43A047; letter-spacing: 0.06em; text-transform: uppercase; }

        /* ── Right panel ── */
        .wr-right { display: flex; flex-direction: column; gap: 14px; min-height: 0; overflow: hidden; }

        /* Queue list */
        .wr-queue-scroll {
          flex: 1; display: flex; flex-direction: column; gap: 6px;
          overflow: hidden; min-height: 0;
        }
        .wr-queue-row {
          display: flex; align-items: center; gap: 12px;
          background: rgba(255,255,255,0.1);
          border: 1px solid rgba(255,255,255,0.2);
          border-radius: 14px; padding: 10px 16px;
          animation: wr-slide-in 0.35s ease-out both;
          backdrop-filter: blur(6px); flex-shrink: 0;
          transition: background 0.3s ease, border-color 0.3s ease;
        }
        .wr-queue-row.is-next {
          background: rgba(255,213,79,0.12);
          border-color: rgba(255,213,79,0.45);
          border-left: 3px solid #FFD54F;
        }
        .wr-queue-row:nth-child(1) { animation-delay: 0ms; }
        .wr-queue-row:nth-child(2) { animation-delay: 40ms; }
        .wr-queue-row:nth-child(3) { animation-delay: 80ms; }
        .wr-queue-row:nth-child(4) { animation-delay: 120ms; }
        .wr-queue-row:nth-child(5) { animation-delay: 160ms; }
        .wr-queue-row:nth-child(6) { animation-delay: 200ms; }
        .wr-queue-row:nth-child(7) { animation-delay: 240ms; }
        @keyframes wr-slide-in {
          from { transform: translateX(28px); opacity: 0; }
          to   { transform: translateX(0); opacity: 1; }
        }
        .wr-row-pos {
          font-size: 11px; font-weight: 800; color: rgba(255,255,255,0.6);
          width: 20px; text-align: center; flex-shrink: 0;
        }
        .wr-row-pos.is-next { color: #FFD54F; }
        .wr-next-badge {
          font-size: 8px; font-weight: 800; letter-spacing: 0.12em;
          text-transform: uppercase; color: #FFD54F;
          background: rgba(255,213,79,0.15);
          border: 1px solid rgba(255,213,79,0.4);
          border-radius: 4px; padding: 1px 5px;
          flex-shrink: 0;
          animation: wr-live-pulse 1.8s ease-in-out infinite;
        }
        .wr-row-indicator { width: 9px; height: 9px; border-radius: 50%; flex-shrink: 0; }
        .wr-row-indicator.waiting    { background: #FFA726; animation: wr-live-pulse 1.4s ease-in-out infinite; }
        .wr-row-indicator.called     { background: #42A5F5; }
        .wr-row-indicator.in_interview { background: #43A047; }
        .wr-row-body { flex: 1; min-width: 0; }
        .wr-row-token-text {
          font-size: 17px; font-weight: 700; color: #FFFFFF;
          letter-spacing: 0.04em; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
        }
        .wr-row-role-text {
          font-size: 11px; font-weight: 600; color: rgba(255,255,255,0.8);
          margin-top: 1px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
        }
        .wr-row-right { text-align: right; flex-shrink: 0; }
        .wr-row-wait { font-size: 12px; font-weight: 700; color: #FFFFFF; }
        .wr-row-status {
          font-size: 9px; font-weight: 700; text-transform: uppercase;
          letter-spacing: 0.08em; padding: 2px 8px; border-radius: 999px;
          margin-top: 3px; display: inline-block;
        }
        .wr-row-status.waiting    { background: rgba(255,167,38,0.15); color: #FFA726; }
        .wr-row-status.in_interview { background: rgba(67,160,71,0.15); color: #43A047; }
        .wr-row-status.called     { background: rgba(66,165,245,0.15); color: #42A5F5; }
        .wr-empty-queue {
          flex: 1; display: flex; flex-direction: column;
          align-items: center; justify-content: center;
          color: rgba(255,255,255,0.5); gap: 8px;
        }
        .wr-empty-text { font-size: 13px; font-weight: 600; }

        /* Metrics */
        .wr-metrics { display: grid; grid-template-columns: repeat(4, 1fr); gap: 8px; flex-shrink: 0; }
        .wr-metric {
          background: rgba(255,255,255,0.1);
          border: 1px solid rgba(255,255,255,0.2);
          border-radius: 16px; padding: 12px 10px; text-align: center;
          backdrop-filter: blur(6px); overflow: hidden;
        }
        .wr-metric-num-wrap { overflow: hidden; height: clamp(28px, 3.2vw, 42px); }
        .wr-metric-number {
          font-size: clamp(22px, 2.8vw, 36px);
          font-weight: 900; line-height: 1; display: block;
          animation: wr-odometer 0.35s cubic-bezier(0.22, 1, 0.36, 1) both;
        }
        @keyframes wr-odometer {
          from { transform: translateY(-100%); opacity: 0; }
          to   { transform: translateY(0); opacity: 1; }
        }
        .wr-metric-number.amber { color: #FFA726; }
        .wr-metric-number.blue  { color: #64B5F6; }
        .wr-metric-number.green { color: #66BB6A; }
        .wr-metric-number.white { color: #FFFFFF; }
        .wr-metric-label {
          font-size: 9px; font-weight: 800; letter-spacing: 0.12em;
          text-transform: uppercase; color: rgba(255,255,255,0.7); margin-top: 5px;
        }

        /* ── Ticker ── */
        .wr-ticker {
          flex-shrink: 0; display: flex; align-items: center; gap: 12px;
          padding: 9px 28px;
          background: rgba(0,0,0,0.3);
          border-top: 1px solid rgba(255,255,255,0.08);
          backdrop-filter: blur(10px);
        }
        .wr-ticker-tag {
          display: flex; align-items: center; gap: 5px;
          background: #43A047; color: #FFFFFF;
          font-size: 9px; font-weight: 800; letter-spacing: 0.14em;
          text-transform: uppercase; padding: 3px 10px;
          border-radius: 999px; white-space: nowrap; flex-shrink: 0;
        }
        .wr-ticker-text {
          font-size: 12px; font-weight: 600; color: rgba(255,255,255,0.9);
          letter-spacing: 0.01em; transition: opacity 0.4s ease;
        }
        .wr-ticker-text.hidden { opacity: 0; }

        /* Audio hint */
        .wr-audio-hint {
          position: fixed; bottom: 56px; right: 18px;
          background: rgba(0,0,0,0.65); color: rgba(255,255,255,0.7);
          font-size: 11px; font-weight: 500; padding: 6px 12px;
          border-radius: 8px; z-index: 201; pointer-events: none;
          animation: wr-fadeout 3s ease forwards 5s;
        }
        @keyframes wr-fadeout { to { opacity: 0; } }
      `}</style>

      <div className="wr">
        {/* Scan-line TV overlay */}
        <div className="wr-scanlines" />

        {/* Attention flash — rerenders on every new call */}
        {flashKey > 0 && <div key={flashKey} className="wr-flash" />}

        {/* Aurora blobs */}
        <div className="wr-blob wr-blob-1" />
        <div className="wr-blob wr-blob-2" />
        <div className="wr-blob wr-blob-3" />

        {/* Audio tap hint */}
        {!audioReady && (
          <div className="wr-audio-hint">Tap anywhere to enable audio announcements</div>
        )}

        {/* ── Header ── */}
        <header className="wr-header">
          <div className="wr-header-left">
            <img
              src={mcnLogo}
              alt="MAS Callnet"
              className="wr-logo"
              onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
            />
            <div>
              <div className="wr-company">MAS CALLNET</div>
              <div className="wr-tagline">Interview Waiting Hall</div>
            </div>
          </div>

          <div className="wr-header-right">
            <div className="wr-live-badge">
              <span className={`wr-live-dot${sseConnected ? "" : " offline"}`} />
              {sseConnected ? "Live" : "Reconnecting"}
            </div>

            {isBranchLocked ? (
              <div className="wr-branch-locked">
                <span style={{ fontSize: "9px", opacity: 0.55, fontWeight: 500, letterSpacing: "0.1em", textTransform: "uppercase" }}>Branch</span>
                <span>{selectedBranch}</span>
              </div>
            ) : (
              branches.length > 0 && (
                <select
                  className="wr-branch-select"
                  value={selectedBranch}
                  onChange={(e) => handleBranchChange(e.target.value)}
                >
                  <option value="">All Branches</option>
                  {branches.map((b) => (
                    <option key={b} value={b}>{b}</option>
                  ))}
                </select>
              )
            )}

            <div className="wr-clock">
              <div className="wr-time">{formatClock(clock)}</div>
              <div className="wr-date">{formatDate(clock)}</div>
            </div>
          </div>
        </header>

        {/* ── Body ── */}
        <div className="wr-body">

          {/* Left — Now Calling */}
          <div className="wr-left">
            {/* LED NOW CALLING header */}
            <div className="wr-now-calling-header">
              <div className="wr-now-calling-header-line" />
              <span className="wr-led-dot" />
              Now Calling
              <span className="wr-led-dot" />
              <div className="wr-now-calling-header-line" />
            </div>

            {/* Calling card with spotlight */}
            <div className={`wr-card-wrap${displayToken ? " active" : ""}`}>
              <div className="wr-spotlight" />
              <div className={`wr-calling-card${displayToken ? " active" : " idle"}`}>
                {displayToken ? (
                  <>
                    <div className="wr-card-accent" />
                    <div className="wr-badge-now-calling">
                      <span className="wr-badge-dot" />
                      Now Calling
                    </div>
                    {/* Slot-machine digits */}
                    <div className="wr-token-slots">
                      {digits3.map((d, i) => (
                        <SlotDigit key={i} target={d} animKey={tokenAnimKey} delay={i} />
                      ))}
                    </div>
                    <div className="wr-token-full">Token: {displayToken.token}</div>
                    {displayToken.name && (
                      <div className="wr-candidate-name">{displayToken.name}</div>
                    )}
                    {displayToken.role && <div className="wr-token-role">{displayToken.role}</div>}
                    <div className="wr-token-instruction">
                      Please proceed to the Interview Room
                    </div>
                  </>
                ) : (
                  <div className="wr-idle-wrap">
                    <div className="wr-idle-icon">
                      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.5)" strokeWidth="2">
                        <circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>
                      </svg>
                    </div>
                    <div className="wr-idle-text">Standby</div>
                    <div className="wr-idle-sub">Next token will be announced shortly</div>
                  </div>
                )}
              </div>
            </div>

            {/* Next-up teaser */}
            {nextUpEntry && (
              <div className="wr-next-up">
                <span className="wr-next-dot" />
                <span style={{ opacity: 0.65, fontSize: "10px", fontWeight: 700, letterSpacing: "0.1em", textTransform: "uppercase", flexShrink: 0 }}>Next</span>
                <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {nextUpEntry.token_number}
                  {nextUpEntry.candidate_name ? ` · ${nextUpEntry.candidate_name}` : ""}
                </span>
              </div>
            )}

            {/* In Interview */}
            {inInterviewQueue.length > 0 && (
              <div className="wr-in-interview-wrap">
                <div className="wr-section-label">Currently in Interview</div>
                {inInterviewQueue.map((entry) => (
                  <div key={entry.token_number} className="wr-interview-pill">
                    <span className="wr-green-dot" />
                    <span className="wr-interview-token">{entry.token_number}</span>
                    {entry.applied_role && (
                      <span style={{ fontSize: "11px", color: "rgba(255,255,255,0.75)" }}>{entry.applied_role}</span>
                    )}
                    <span className="wr-interview-badge">In Progress</span>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Right — Queue + Metrics */}
          <div className="wr-right">
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexShrink: 0 }}>
              <div className="wr-section-label" style={{ marginBottom: 0 }}>Waiting Queue</div>
              {waitingQueue.length > 0 && (
                <span style={{
                  background: "rgba(255,167,38,0.15)", color: "#FFA726",
                  fontSize: "11px", fontWeight: 800, padding: "2px 10px",
                  borderRadius: "999px", border: "1px solid rgba(255,167,38,0.35)",
                  letterSpacing: "0.04em",
                  animation: "wr-live-pulse 2s ease-in-out infinite",
                }}>
                  {waitingQueue.length} waiting
                </span>
              )}
            </div>

            <div className="wr-queue-scroll">
              {waitingQueue.length === 0 ? (
                <div className="wr-empty-queue">
                  <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                    <polyline points="20 6 9 17 4 12"/>
                  </svg>
                  <div className="wr-empty-text">No candidates waiting</div>
                </div>
              ) : (
                waitingQueue.map((entry, idx) => (
                  <div key={entry.token_number} className={`wr-queue-row${idx === 0 ? " is-next" : ""}`}>
                    <span className={`wr-row-pos${idx === 0 ? " is-next" : ""}`}>{idx + 1}</span>
                    {idx === 0 && <span className="wr-next-badge">Next</span>}
                    <span className={`wr-row-indicator ${entry.queue_status}`} />
                    <div className="wr-row-body">
                      <div className="wr-row-token-text">{entry.token_number}</div>
                      {entry.applied_role && (
                        <div className="wr-row-role-text">{entry.applied_role}</div>
                      )}
                    </div>
                    <div className="wr-row-right">
                      <div className="wr-row-wait">{formatWait(entry.estimated_wait_time)}</div>
                      <span className={`wr-row-status ${entry.queue_status}`}>
                        {statusLabel(entry.queue_status)}
                      </span>
                    </div>
                  </div>
                ))
              )}
            </div>

            {/* Metrics with odometer animation */}
            <div>
              <div className="wr-section-label">Today's Summary</div>
              <div className="wr-metrics">
                <div className="wr-metric">
                  <div className="wr-metric-num-wrap">
                    <span key={metricKeys.waiting} className="wr-metric-number amber">{metrics?.total_waiting ?? 0}</span>
                  </div>
                  <div className="wr-metric-label">Waiting</div>
                </div>
                <div className="wr-metric">
                  <div className="wr-metric-num-wrap">
                    <span key={metricKeys.inRoom} className="wr-metric-number blue">{metrics?.total_in_interview ?? 0}</span>
                  </div>
                  <div className="wr-metric-label">In Room</div>
                </div>
                <div className="wr-metric">
                  <div className="wr-metric-num-wrap">
                    <span key={metricKeys.done} className="wr-metric-number green">{metrics?.total_completed_today ?? 0}</span>
                  </div>
                  <div className="wr-metric-label">Done</div>
                </div>
                <div className="wr-metric">
                  <div className="wr-metric-num-wrap">
                    <span className="wr-metric-number white">
                      {metrics?.average_wait_time ? `${Math.round(metrics.average_wait_time)}m` : "--"}
                    </span>
                  </div>
                  <div className="wr-metric-label">Avg Wait</div>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* ── Ticker ── */}
        <div className="wr-ticker">
          <span className="wr-ticker-tag">
            <svg width="8" height="8" viewBox="0 0 10 10" fill="none">
              <circle cx="5" cy="5" r="4" fill="white" opacity="0.9"/>
            </svg>
            Info
          </span>
          <span className={`wr-ticker-text${tickerVisible ? "" : " hidden"}`}>
            {TICKER_TIPS[tickerIdx]}
          </span>
        </div>
      </div>
    </>
  );
}
