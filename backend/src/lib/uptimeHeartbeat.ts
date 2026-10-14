/**
 * Heartbeat to an Uptime Kuma "push" monitor.
 *
 * The workers process (hrms2-workers) has no HTTP port, so nothing can poll it. Instead it calls
 * the push URL every minute; if the calls stop for two minutes, Uptime Kuma alerts.
 * OFF unless UPTIME_KUMA_WORKERS_PUSH_URL is set. Never throws, never blocks shutdown.
 */
let timer: NodeJS.Timeout | null = null;

export function heartbeatUrl(env: NodeJS.ProcessEnv = process.env): string | null {
  const raw = (env.UPTIME_KUMA_WORKERS_PUSH_URL ?? "").trim();
  if (!raw) return null;
  try {
    const u = new URL(raw);
    if (!/^https?:$/.test(u.protocol) || !u.pathname.includes("/api/push/")) return null;
    return raw;
  } catch {
    return null;
  }
}

/** Build the URL for one beat. `msg` is short status text shown in Uptime Kuma. */
export function beatUrl(base: string, msg: string): string {
  const u = new URL(base);
  u.searchParams.set("status", "up");
  u.searchParams.set("msg", msg.slice(0, 120));
  u.searchParams.set("ping", "");
  return u.toString();
}

export async function sendBeat(base: string, msg: string, fetchImpl: typeof fetch = fetch): Promise<boolean> {
  try {
    const r = await fetchImpl(beatUrl(base, msg), { method: "GET", signal: AbortSignal.timeout(5000) });
    return r.ok;
  } catch {
    return false;
  }
}

export function startUptimeHeartbeat(statusText: () => string, intervalMs = 60_000): boolean {
  const base = heartbeatUrl();
  if (!base || timer) return false;
  const beat = () => void sendBeat(base, statusText());
  beat();
  timer = setInterval(beat, intervalMs);
  timer.unref();
  console.log("[heartbeat] reporting to Uptime Kuma every", Math.round(intervalMs / 1000), "s");
  return true;
}

export function stopUptimeHeartbeat(): void {
  if (timer) clearInterval(timer);
  timer = null;
}
