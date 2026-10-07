import { env } from "../../config/env.js";
import { LoopbackError, type LoopbackCtx } from "./types.js";

const TIMEOUT_MS = 12_000;

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
      }
    },
  };
}
