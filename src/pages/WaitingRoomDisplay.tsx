import { useEffect, useRef, useState, useCallback } from "react";
import { Info } from "lucide-react";
import mcnLogo from "@/assets/brand/mcn-logo.png";

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
  "Keep your original ID proof and a photocopy ready",
  "Dress professionally — first impressions matter",
  "MAS Callnet — one of India's leading BPO organisations",
  "Our team is here to help — feel free to ask at the front desk",
  "Interview rounds typically take 30–45 minutes",
  "We offer PF, ESIC, incentives and career growth opportunities",
  "Thank you for your patience — we'll call your token shortly",
  "Please keep your mobile on silent during the interview",
  "Bring your educational certificates for verification today",
  "Welcome to MAS Callnet — we're excited to meet you!",
];

const POLL_INTERVAL = 15_000;
const TICKER_INTERVAL = 8_000;
const BASE_URL = "";

// ── Particle background ───────────────────────────────────────────────────────

const PARTICLES = Array.from({ length: 28 }, (_, i) => ({
  id: i,
  x: (i * 37 + 11) % 97,
  y: (i * 53 + 7) % 93,
  size: (i % 4) + 2,
  duration: 6 + (i % 5),
  delay: -(i * 0.7),
  opacity: 0.06 + (i % 4) * 0.03,
}));

// ── Helpers ───────────────────────────────────────────────────────────────────

function formatClock(date: Date): string {
  return date.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false });
}

function formatDate(date: Date): string {
  return date.toLocaleDateString("en-IN", { weekday: "long", day: "numeric", month: "long", year: "numeric" });
}

function formatWait(minutes: number | null): string {
  if (minutes == null || minutes <= 0) return "< 1 min";
  if (minutes < 60) return `~${minutes} min`;
  return `~${Math.round(minutes / 60)}h`;
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

// ── Main Component ────────────────────────────────────────────────────────────

export default function WaitingRoomDisplay() {
  const [clock, setClock] = useState(new Date());
  const [branches, setBranches] = useState<string[]>([]);
  const [selectedBranch, setSelectedBranch] = useState<string>(() => localStorage.getItem("wr_branch") ?? "");
  const [queue, setQueue] = useState<SafeQueueEntry[]>([]);
  const [metrics, setMetrics] = useState<QueueMetrics | null>(null);
  const [tickerIdx, setTickerIdx] = useState(0);
  const [tickerVisible, setTickerVisible] = useState(true);
  const [calledToken, setCalledToken] = useState<string | null>(null);
  const [calledRole, setCalledRole] = useState<string | null>(null);
  const [tokenAnimKey, setTokenAnimKey] = useState(0);
  const [sseConnected, setSseConnected] = useState(false);

  const prevCalledRef = useRef<string | null>(null);
  const esRef = useRef<EventSource | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Clock tick
  useEffect(() => {
    const t = setInterval(() => setClock(new Date()), 1000);
    return () => clearInterval(t);
  }, []);

  // Ticker rotation
  useEffect(() => {
    const t = setInterval(() => {
      setTickerVisible(false);
      setTimeout(() => {
        setTickerIdx((i) => (i + 1) % TICKER_TIPS.length);
        setTickerVisible(true);
      }, 400);
    }, TICKER_INTERVAL);
    return () => clearInterval(t);
  }, []);

  // Load branches
  useEffect(() => {
    fetch(`${BASE_URL}/api/ats/queue/branches`)
      .then((r) => r.json())
      .then((j) => {
        if (j.success && Array.isArray(j.data)) {
          setBranches(j.data);
          const savedBranch = localStorage.getItem("wr_branch") ?? "";
          if (savedBranch && !j.data.includes(savedBranch)) {
            localStorage.removeItem("wr_branch");
            setSelectedBranch("");
          }
        }
      })
      .catch(() => {/* silent */});
  }, []);

  // Process incoming payload
  const applyPayload = useCallback((payload: DisplayPayload) => {
    setQueue(payload.queue ?? []);
    setMetrics(payload.metrics ?? null);

    // Detect "now calling" — first entry with status 'called'
    const nowCalling = payload.queue.find((q) => q.queue_status === "called");
    const nowToken = nowCalling?.token_number ?? null;
    if (nowToken && nowToken !== prevCalledRef.current) {
      prevCalledRef.current = nowToken;
      setCalledToken(nowToken);
      setCalledRole(nowCalling?.applied_role ?? null);
      setTokenAnimKey((k) => k + 1);
    }
    if (!nowToken && prevCalledRef.current) {
      prevCalledRef.current = null;
    }
  }, []);

  // Fetch once (used for fallback polling)
  const fetchSnapshot = useCallback(() => {
    const params = new URLSearchParams();
    if (selectedBranch) params.set("branch", selectedBranch);
    fetch(`${BASE_URL}/api/ats/queue/public-display?${params}`)
      .then((r) => r.json())
      .then((j) => { if (j.success) applyPayload({ ...j.data, ts: Date.now() }); })
      .catch(() => {/* silent */});
  }, [selectedBranch, applyPayload]);

  // SSE connection
  useEffect(() => {
    // Cleanup previous
    if (esRef.current) { esRef.current.close(); esRef.current = null; }
    if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }

    const params = new URLSearchParams();
    if (selectedBranch) params.set("branch", selectedBranch);
    const url = `${BASE_URL}/api/ats/queue/display-stream?${params}`;

    const es = new EventSource(url);
    esRef.current = es;

    es.onopen = () => setSseConnected(true);

    es.onmessage = (e) => {
      try {
        const payload: DisplayStreamEvent = JSON.parse(e.data);
        if (payload.data) {
          applyPayload({ ...payload.data, ts: payload.ts ?? Date.now() });
        }
      } catch {/* malformed */}
    };

    es.onerror = () => {
      setSseConnected(false);
      es.close();
      esRef.current = null;
      // Fallback polling
      fetchSnapshot();
      pollRef.current = setInterval(fetchSnapshot, POLL_INTERVAL);
    };

    return () => {
      es.close();
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, [selectedBranch, applyPayload, fetchSnapshot]);

  // Persist branch selection
  const handleBranchChange = (b: string) => {
    setSelectedBranch(b);
    if (b) {
      localStorage.setItem("wr_branch", b);
    } else {
      localStorage.removeItem("wr_branch");
    }
  };

  const waitingQueue = queue.filter((q) => q.queue_status === "waiting").slice(0, 8);
  const inInterviewQueue = queue.filter((q) => q.queue_status === "in_interview").slice(0, 3);

  return (
    <>
      {/* Google Fonts */}
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Orbitron:wght@600;700;900&family=Inter:wght@400;500;600;700&display=swap');

        * { box-sizing: border-box; margin: 0; padding: 0; }

        .wr-root {
          width: 100vw; height: 100dvh; overflow: hidden;
          background: radial-gradient(ellipse at 50% 40%, #0F1A2E 0%, #020617 70%);
          color: #F8FAFC;
          font-family: 'Inter', sans-serif;
          display: flex; flex-direction: column;
          position: relative;
        }

        /* Particles */
        .particle {
          position: absolute; border-radius: 50%;
          background: #1B6AB5;
          pointer-events: none;
          animation: floatUp linear infinite;
        }
        @keyframes floatUp {
          0%   { transform: translateY(0)   scale(1);   }
          50%  { transform: translateY(-18px) scale(1.2); }
          100% { transform: translateY(0)   scale(1);   }
        }

        /* Header */
        .wr-header {
          display: flex; align-items: center; justify-content: space-between;
          padding: 14px 32px;
          border-bottom: 1px solid #1E3A5F;
          background: rgba(11,18,35,0.85);
          backdrop-filter: blur(8px);
          z-index: 10; flex-shrink: 0;
        }
        .wr-logo-area { display: flex; align-items: center; gap: 14px; }
        .wr-logo { height: 40px; width: auto; }
        .wr-company { font-family: 'Orbitron', sans-serif; font-size: 18px; font-weight: 700; color: #F8FAFC; letter-spacing: 0.08em; }
        .wr-tagline { font-size: 11px; color: #94A3B8; letter-spacing: 0.06em; margin-top: 1px; }
        .wr-clock-area { text-align: right; }
        .wr-time { font-family: 'Orbitron', sans-serif; font-size: 28px; font-weight: 700; color: #1B6AB5; letter-spacing: 0.12em; }
        .wr-date { font-size: 12px; color: #94A3B8; margin-top: 2px; }
        .wr-branch-select {
          background: #0E1223; border: 1px solid #1E3A5F; color: #F8FAFC;
          padding: 6px 12px; border-radius: 8px; font-size: 13px;
          font-family: 'Inter', sans-serif; cursor: pointer; outline: none;
          appearance: none; -webkit-appearance: none;
          background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='8' viewBox='0 0 12 8'%3E%3Cpath d='M1 1l5 5 5-5' stroke='%2394A3B8' stroke-width='1.5' fill='none' stroke-linecap='round'/%3E%3C/svg%3E");
          background-repeat: no-repeat; background-position: right 10px center;
          padding-right: 28px; min-width: 160px;
        }
        .wr-branch-select option { background: #0E1223; }
        .wr-status-dot {
          width: 8px; height: 8px; border-radius: 50%;
          display: inline-block; margin-right: 6px;
          background: #22C55E;
        }
        .wr-status-dot.offline { background: #EF4444; }

        /* Main body */
        .wr-body {
          flex: 1; display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 0;
          overflow: hidden;
          padding: 24px 32px;
          gap: 24px;
        }

        /* Left — Now Calling */
        .wr-left {
          display: flex; flex-direction: column; align-items: center; justify-content: center;
          gap: 24px;
        }
        .wr-calling-label {
          font-size: 13px; font-weight: 600; letter-spacing: 0.18em; text-transform: uppercase;
          color: #94A3B8;
        }
        .wr-calling-card {
          position: relative;
          border: 2px solid #F59E0B;
          border-radius: 24px;
          background: linear-gradient(135deg, #0E1223 0%, #101828 100%);
          padding: 40px 56px;
          text-align: center;
          width: 100%; max-width: 440px;
          animation: glowPulse 1.8s ease-in-out infinite;
        }
        @keyframes glowPulse {
          0%, 100% { box-shadow: 0 0 24px #F59E0B33, 0 0 48px #F59E0B1A; }
          50%       { box-shadow: 0 0 40px #F59E0B55, 0 0 80px #F59E0B2A; }
        }
        .wr-calling-card.empty {
          border-color: #1E3A5F;
          animation: none;
          box-shadow: none;
        }
        .wr-now-calling-badge {
          font-size: 11px; font-weight: 700; letter-spacing: 0.2em; text-transform: uppercase;
          color: #F59E0B; margin-bottom: 20px;
        }
        .wr-token-number {
          font-family: 'Orbitron', sans-serif;
          font-size: clamp(56px, 7vw, 96px);
          font-weight: 900;
          color: #F59E0B;
          letter-spacing: 0.15em;
          line-height: 1;
          animation: tokenIn 0.35s ease-out;
        }
        @keyframes tokenIn {
          0%   { transform: scale(0.7); opacity: 0; }
          70%  { transform: scale(1.04); }
          100% { transform: scale(1);   opacity: 1; }
        }
        .wr-calling-sub {
          margin-top: 16px; font-size: 14px; color: #94A3B8; letter-spacing: 0.04em;
        }
        .wr-calling-role {
          margin-top: 8px; font-size: 16px; font-weight: 600; color: #60A5FA;
        }
        .wr-no-calling {
          font-family: 'Orbitron', sans-serif; font-size: 18px; color: #334155;
          font-weight: 600; letter-spacing: 0.08em;
        }
        .wr-no-calling-sub { font-size: 12px; color: #475569; margin-top: 8px; }

        /* Right — Queue + Metrics */
        .wr-right { display: flex; flex-direction: column; gap: 20px; overflow: hidden; }
        .wr-section-title {
          font-size: 11px; font-weight: 700; letter-spacing: 0.18em; text-transform: uppercase;
          color: #64748B; margin-bottom: 10px;
        }

        /* Queue list */
        .wr-queue-list { display: flex; flex-direction: column; gap: 8px; flex: 1; overflow: hidden; }
        .wr-queue-row {
          display: flex; align-items: center; gap: 14px;
          background: #0E1223; border: 1px solid #1E3A5F;
          border-radius: 12px; padding: 12px 16px;
          animation: slideInRight 0.3s ease-out both;
        }
        .wr-queue-row.in-interview { border-color: #22C55E33; background: #0A1A12; }
        @keyframes slideInRight {
          from { transform: translateX(30px); opacity: 0; }
          to   { transform: translateX(0);    opacity: 1; }
        }
        .wr-status-indicator {
          width: 10px; height: 10px; border-radius: 50%; flex-shrink: 0;
        }
        .wr-status-indicator.waiting   { background: #F59E0B; animation: dotPulse 1.4s ease-in-out infinite; }
        .wr-status-indicator.called    { background: #1B6AB5; }
        .wr-status-indicator.in_interview { background: #22C55E; }
        @keyframes dotPulse {
          0%, 100% { opacity: 1; transform: scale(1); }
          50%      { opacity: 0.5; transform: scale(0.8); }
        }
        .wr-row-position {
          font-family: 'Orbitron', sans-serif; font-size: 11px; color: #475569;
          min-width: 24px;
        }
        .wr-row-token {
          font-family: 'Orbitron', sans-serif; font-size: 20px; font-weight: 700;
          color: #F8FAFC; flex: 1; letter-spacing: 0.06em;
        }
        .wr-row-role { font-size: 12px; color: #64748B; margin-top: 1px; }
        .wr-row-wait { font-size: 12px; color: #475569; text-align: right; flex-shrink: 0; }
        .wr-row-status-badge {
          font-size: 10px; font-weight: 600; letter-spacing: 0.08em; text-transform: uppercase;
          padding: 2px 8px; border-radius: 999px; flex-shrink: 0;
        }
        .wr-row-status-badge.waiting     { background: #F59E0B1A; color: #F59E0B; }
        .wr-row-status-badge.in_interview { background: #22C55E1A; color: #22C55E; }

        .wr-empty-queue {
          flex: 1; display: flex; flex-direction: column; align-items: center; justify-content: center;
          color: #334155; gap: 8px;
        }
        .wr-empty-queue-icon { font-size: 32px; opacity: 0.4; }
        .wr-empty-queue-text { font-size: 14px; font-weight: 500; }

        /* Metrics */
        .wr-metrics { display: grid; grid-template-columns: repeat(4, 1fr); gap: 12px; flex-shrink: 0; }
        .wr-metric-card {
          background: #0E1223; border: 1px solid #1E3A5F; border-radius: 14px;
          padding: 14px 16px; text-align: center;
        }
        .wr-metric-number {
          font-family: 'Orbitron', sans-serif; font-size: clamp(22px, 2.5vw, 32px);
          font-weight: 700; color: #1B6AB5; line-height: 1;
        }
        .wr-metric-number.amber  { color: #F59E0B; }
        .wr-metric-number.green  { color: #22C55E; }
        .wr-metric-number.slate  { color: #64748B; }
        .wr-metric-label { font-size: 10px; color: #475569; font-weight: 600; letter-spacing: 0.1em; text-transform: uppercase; margin-top: 6px; }

        /* Ticker */
        .wr-ticker {
          flex-shrink: 0;
          border-top: 1px solid #1E3A5F;
          background: rgba(11,18,35,0.9);
          backdrop-filter: blur(8px);
          padding: 12px 32px;
          display: flex; align-items: center; gap: 12px;
        }
        .wr-ticker-icon { color: #1B6AB5; flex-shrink: 0; }
        .wr-ticker-text {
          font-size: 13px; color: #94A3B8;
          transition: opacity 0.4s ease;
          letter-spacing: 0.02em;
        }
        .wr-ticker-text.hidden { opacity: 0; }
      `}</style>

      <div className="wr-root">
        {/* Floating particles */}
        {PARTICLES.map((p) => (
          <div
            key={p.id}
            className="particle"
            style={{
              left: `${p.x}%`,
              top: `${p.y}%`,
              width: `${p.size}px`,
              height: `${p.size}px`,
              opacity: p.opacity,
              animationDuration: `${p.duration}s`,
              animationDelay: `${p.delay}s`,
            }}
          />
        ))}

        {/* Header */}
        <header className="wr-header">
          <div className="wr-logo-area">
            <img src={mcnLogo} alt="MAS Callnet" className="wr-logo" onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }} />
            <div>
              <div className="wr-company">MAS CALLNET</div>
              <div className="wr-tagline">INTERVIEW WAITING HALL</div>
            </div>
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: "20px" }}>
            <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
              <span className={`wr-status-dot${sseConnected ? "" : " offline"}`} />
              <span style={{ fontSize: "11px", color: "#64748B" }}>
                {sseConnected ? "Live" : "Updating"}
              </span>
            </div>

            {branches.length > 0 && (
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
            )}

            <div className="wr-clock-area">
              <div className="wr-time">{formatClock(clock)}</div>
              <div className="wr-date">{formatDate(clock)}</div>
            </div>
          </div>
        </header>

        {/* Body */}
        <div className="wr-body">
          {/* Left — Now Calling */}
          <div className="wr-left">
            <div className="wr-calling-label">Current Status</div>

            <div className={`wr-calling-card${calledToken ? "" : " empty"}`}>
              {calledToken ? (
                <>
                  <div className="wr-now-calling-badge">▶ NOW CALLING</div>
                  <div key={tokenAnimKey} className="wr-token-number">{calledToken}</div>
                  {calledRole && <div className="wr-calling-role">{calledRole}</div>}
                  <div className="wr-calling-sub">Please proceed to the interview room</div>
                </>
              ) : (
                <>
                  <div style={{ fontSize: "32px", marginBottom: "16px", opacity: 0.3 }}>⏳</div>
                  <div className="wr-no-calling">Standby</div>
                  <div className="wr-no-calling-sub">Next token will be announced shortly</div>
                </>
              )}
            </div>

            {/* In Interview */}
            {inInterviewQueue.length > 0 && (
              <div style={{ width: "100%", maxWidth: "440px" }}>
                <div className="wr-section-title">Currently in Interview</div>
                <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
                  {inInterviewQueue.map((entry) => (
                    <div key={entry.token_number} style={{
                      display: "flex", alignItems: "center", gap: "10px",
                      background: "#0A1A12", border: "1px solid #22C55E33",
                      borderRadius: "10px", padding: "8px 14px",
                    }}>
                      <span className="wr-status-indicator in_interview" />
                      <span style={{ fontFamily: "'Orbitron', sans-serif", fontSize: "15px", fontWeight: 700, color: "#22C55E", flex: 1 }}>
                        {entry.token_number}
                      </span>
                      <span style={{ fontSize: "11px", color: "#22C55E88" }}>In Interview</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Right — Queue + Metrics */}
          <div className="wr-right">
            <div>
              <div className="wr-section-title">
                Waiting Queue
                {waitingQueue.length > 0 && (
                  <span style={{ marginLeft: "8px", color: "#F59E0B", fontFamily: "'Orbitron', sans-serif", fontSize: "13px" }}>
                    {waitingQueue.length}
                  </span>
                )}
              </div>

              <div className="wr-queue-list">
                {waitingQueue.length === 0 ? (
                  <div className="wr-empty-queue">
                    <div className="wr-empty-queue-icon">✓</div>
                    <div className="wr-empty-queue-text">No candidates waiting</div>
                  </div>
                ) : (
                  waitingQueue.map((entry, idx) => (
                    <div
                      key={entry.token_number}
                      className={`wr-queue-row${entry.queue_status === "in_interview" ? " in-interview" : ""}`}
                      style={{ animationDelay: `${idx * 50}ms` }}
                    >
                      <span className={`wr-status-indicator ${entry.queue_status}`} />
                      <div style={{ display: "flex", flexDirection: "column", flex: 1, minWidth: 0 }}>
                        <div className="wr-row-token">{entry.token_number}</div>
                        {entry.applied_role && <div className="wr-row-role">{entry.applied_role}</div>}
                      </div>
                      <div style={{ textAlign: "right", flexShrink: 0 }}>
                        <div className="wr-row-wait">{formatWait(entry.estimated_wait_time)}</div>
                        <span className={`wr-row-status-badge ${entry.queue_status}`}>
                          {statusLabel(entry.queue_status)}
                        </span>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>

            {/* Metrics */}
            <div>
              <div className="wr-section-title">Today's Summary</div>
              <div className="wr-metrics">
                <div className="wr-metric-card">
                  <div className="wr-metric-number amber">{metrics?.total_waiting ?? 0}</div>
                  <div className="wr-metric-label">Waiting</div>
                </div>
                <div className="wr-metric-card">
                  <div className="wr-metric-number">{metrics?.total_in_interview ?? 0}</div>
                  <div className="wr-metric-label">In Room</div>
                </div>
                <div className="wr-metric-card">
                  <div className="wr-metric-number green">{metrics?.total_completed_today ?? 0}</div>
                  <div className="wr-metric-label">Done</div>
                </div>
                <div className="wr-metric-card">
                  <div className="wr-metric-number slate">
                    {metrics?.average_wait_time ? `${Math.round(metrics.average_wait_time)}m` : "--"}
                  </div>
                  <div className="wr-metric-label">Avg Wait</div>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Ticker */}
        <div className="wr-ticker">
          <Info size={16} className="wr-ticker-icon" />
          <span className={`wr-ticker-text${tickerVisible ? "" : " hidden"}`}>
            {TICKER_TIPS[tickerIdx]}
          </span>
        </div>
      </div>
    </>
  );
}
