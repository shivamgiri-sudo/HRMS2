import { env } from "../../config/env.js";
import { LoopbackError, type LoopbackCtx } from "./types.js";

const TIMEOUT_MS = 12_000;

/**
 * Process-wide cap on in-flight internal calls. One person's approval list fans out to ~60 adapters, each
 * making several calls into modules that hit the DB; unthrottled, a few approvers opening HRMS at once
 * exhausts the connection pool queue and trips the DB circuit breaker for the whole app.
 */
const MAX_IN_FLIGHT = 4;
let inFlight = 0;
const waiters: Array<() => void> = [];
async function acquire() {
  if (inFlight < MAX_IN_FLIGHT) { inFlight++; return; }
  await new Promise<void>((resolve) => waiters.push(resolve));
}
function release() {
  const next = waiters.shift();
  if (next) next(); else inFlight--;
}

/** Calls this same server as the caller (their own bearer token), so every module's guard applies. */
export function createLoopback(userId: string, authorization: string): LoopbackCtx {
  const base = `http://127.0.0.1:${env.PORT}`;
  return {
    userId,
    async call(method, path, opts = {}) {
      const url = new URL(path, base);
      for (const [k, v] of Object.entries(opts.query ?? {})) {
        if (v !== undefined && v !== "") url.searchParams.set(k, String(v));
      }
      await acquire();
      const ctl = new AbortController();
      const timer = setTimeout(() => ctl.abort(), TIMEOUT_MS);
      try {
        const res = await fetch(url, {
          method,
          headers: {
            Authorization: authorization,
            "Content-Type": "application/json",
            "X-Approval-Center": "1",
          },
          body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
          signal: ctl.signal,
        });
        const text = await res.text();
        let payload: any = null;
        try { payload = text ? JSON.parse(text) : null; } catch { payload = { raw: text }; }
        if (!res.ok) {
          const msg = payload?.message ?? payload?.error ?? `Request failed (${res.status})`;
          throw new LoopbackError(res.status, typeof msg === "string" ? msg : JSON.stringify(msg), payload);
        }
        return payload;
      } finally {
        clearTimeout(timer);
        release();
      }
    },
  };
}
