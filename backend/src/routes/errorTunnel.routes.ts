/**
 * POST /api/error-tunnel: relay for browser error reports.
 *
 * The frontend SDK sends its envelopes here (same origin) instead of straight to GlitchTip.
 * That keeps GlitchTip on the private network, needs no CSP or firewall change, and is not
 * blocked by ad-blockers. Off (404) unless ERROR_TRACKING_FRONTEND_DSN is set.
 *
 * It is not an open proxy:
 *  - the envelope must name the configured frontend DSN (same public key and project id); the
 *    upstream address always comes from server config, never from the request;
 *  - only event / session / client_report items are forwarded; attachments and replays are dropped;
 *  - every event is scrubbed again here (lib/piiScrub.ts), so even a stale or tampered client
 *    cannot push PII through;
 *  - bodies are capped at 256 KB and each IP at 300 envelopes a minute.
 * It is mounted before the global rate limiter on purpose: a burst of browser errors must never
 * use up the user's own API quota.
 */
import express, { Router, type Request, type Response } from "express";
import rateLimit from "express-rate-limit";
import { scrubEvent, type ScrubbableEvent } from "../lib/piiScrub.js";
import { rateLimitKey } from "../middleware/rateLimiter.js";

export const errorTunnelRouter = Router();

type DsnParts = { publicKey: string; projectId: string; envelopeUrl: string };

export function parseDsn(dsn: string | undefined | null): DsnParts | null {
  if (!dsn) return null;
  try {
    const u = new URL(dsn.trim());
    const m = u.pathname.match(/^(.*)\/(\d+)\/?$/);
    if (!u.username || !m || !/^https?:$/.test(u.protocol)) return null;
    const prefix = m[1] ?? "";
    return {
      publicKey: decodeURIComponent(u.username),
      projectId: m[2],
      // GlitchTip (like Sentry without a relay) authenticates an envelope by the key on the
      // request, not the DSN inside the envelope, so the tunnel must attach it. Verified e2e:
      // without it every forwarded envelope came back 403 Forbidden.
      envelopeUrl: `${u.protocol}//${u.host}${prefix}/api/${m[2]}/envelope/?sentry_key=${encodeURIComponent(decodeURIComponent(u.username))}&sentry_version=7`,
    };
  } catch {
    return null;
  }
}

const ALLOWED_ITEM_TYPES = new Set(["event", "session", "sessions", "client_report"]);
const MAX_BYTES = 256 * 1024;

export type TunnelResult =
  | { ok: true; upstream: string; body: string; forwardedItems: number }
  | { ok: false; status: number; reason: string };

/**
 * Validate an envelope against the configured DSN, drop disallowed items, scrub events.
 * Pure function (no network) so it can be unit-tested.
 */
export function prepareEnvelope(raw: string, configuredDsn: string | undefined): TunnelResult {
  const cfg = parseDsn(configuredDsn);
  if (!cfg) return { ok: false, status: 404, reason: "error tunnel disabled" };
  if (Buffer.byteLength(raw, "utf8") > MAX_BYTES) return { ok: false, status: 413, reason: "envelope too large" };

  const lines = raw.split("\n");
  let header: Record<string, unknown>;
  try {
    header = JSON.parse(lines[0] ?? "");
  } catch {
    return { ok: false, status: 400, reason: "bad envelope header" };
  }
  const claimed = parseDsn(typeof header.dsn === "string" ? header.dsn : null);
  if (!claimed || claimed.publicKey !== cfg.publicKey || claimed.projectId !== cfg.projectId) {
    return { ok: false, status: 403, reason: "envelope is not for this project" };
  }

  // Item framing: an item header line, then a payload. HRMS's SDK sends JSON payloads on one line;
  // an explicit `length` is honoured for anything else and the item is skipped if it is binary.
  const out: string[] = [JSON.stringify({ ...header, dsn: header.dsn })];
  let forwarded = 0;
  let i = 1;
  while (i < lines.length) {
    const headerLine = lines[i];
    if (!headerLine) { i++; continue; }
    let itemHeader: Record<string, unknown>;
    try {
      itemHeader = JSON.parse(headerLine);
    } catch {
      return { ok: false, status: 400, reason: "bad item header" };
    }
    const payload = lines[i + 1] ?? "";
    i += 2;
    const type = String(itemHeader.type ?? "");
    if (!ALLOWED_ITEM_TYPES.has(type)) continue;
    let body = payload;
    if (type === "event") {
      try {
        body = JSON.stringify(scrubEvent(JSON.parse(payload) as ScrubbableEvent));
      } catch {
        continue; // unparseable event: drop it rather than forward something unscrubbed
      }
    }
    const { length: _ignored, ...rest } = itemHeader;
    out.push(JSON.stringify(rest), body);
    forwarded++;
  }
  if (forwarded === 0) return { ok: false, status: 204, reason: "nothing to forward" };
  return { ok: true, upstream: cfg.envelopeUrl, body: out.join("\n") + "\n", forwardedItems: forwarded };
}

const tunnelLimiter = rateLimit({
  windowMs: 60_000,
  // Browsers send without a login token, so this is keyed by IP, and a whole office floor
  // shares one NAT address. 300/min still stops a runaway loop without dropping a real outage.
  limit: 300,
  keyGenerator: rateLimitKey,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, message: "Too many error reports" },
});

errorTunnelRouter.post(
  "/",
  tunnelLimiter,
  express.text({ type: () => true, limit: MAX_BYTES }),
  async (req: Request, res: Response) => {
    const raw = typeof req.body === "string" ? req.body : "";
    const prepared = prepareEnvelope(raw, process.env.ERROR_TRACKING_FRONTEND_DSN);
    if (!prepared.ok) {
      return res.status(prepared.status).json({ success: false, message: prepared.reason });
    }
    try {
      const upstream = await fetch(prepared.upstream, {
        method: "POST",
        headers: { "Content-Type": "application/x-sentry-envelope" },
        body: prepared.body,
        signal: AbortSignal.timeout(5000),
      });
      return res.status(upstream.status >= 500 ? 502 : upstream.status).end();
    } catch {
      // GlitchTip down must never surface as an error in the browser console loop.
      return res.status(202).end();
    }
  },
);
