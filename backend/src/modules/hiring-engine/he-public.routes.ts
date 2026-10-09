/**
 * Candidate-facing, unauthenticated by design: the unguessable per-match or per-invite token (128 bits) is the credential,
 * the link only works in the window around the candidate's own slot, and the response never contains anything
 * but the candidate's first name and the branch they were invited to. Mounted at /api/he-public.
 */
import rateLimit from "express-rate-limit";
import { Router } from "express";
import { logger } from "../../logger.js";
import { enterAnswerGate, leaveAnswerGate } from "./answer-token-gate.js";
import { logText } from "./log-text.js";
import { answerInvite, getContextByToken, getInviteContext, optInWhatsApp, recordPing, startSharing, stopSharing } from "./he-location.service.js";

export const hePublicRouter = Router();

hePublicRouter.use(rateLimit({ windowMs: 10 * 60 * 1000, max: 240, standardHeaders: true, legacyHeaders: false, message: { success: false, message: "Too many requests. Please wait a few minutes." } }));

hePublicRouter.get("/loc/:token", async (req, res) => {
  try {
    const c = await getContextByToken(String(req.params.token));
    if (!c) {
      // A person invited without a match: same page, answers only (no location or WhatsApp opt-in until a slot is booked).
      const ic = await getInviteContext(String(req.params.token));
      if (!ic) return res.status(404).json({ success: false, message: "This link is not valid." });
      return res.json({ success: true, data: { ...ic, demo: false } });
    }
    res.json({ success: true, data: { firstName: c.firstName, branchName: c.branchName, address: c.address, slotAt: c.slotAt, open: c.open, sharing: c.sharing, state: c.state, waConsent: c.waConsent, optInOpen: c.optInOpen, role: c.role, rsvpOpen: c.rsvpOpen, reference: c.reference, mapsUrl: c.mapsUrl, docs: c.docs, demo: c.matchId === "demo" } });
  } catch (err) {
    logger.error({ err: (err as Error).message }, "[he-public] context failed");
    res.status(500).json({ success: false, message: "Something went wrong. Please try again." });
  }
});

hePublicRouter.post("/loc/:token/start", async (req, res) => {
  try {
    const ok = await startSharing(String(req.params.token));
    res.status(ok ? 200 : 404).json({ success: ok, message: ok ? undefined : "This link is not active right now." });
  } catch (err) {
    logger.error({ err: (err as Error).message }, "[he-public] start failed");
    res.status(500).json({ success: false });
  }
});

hePublicRouter.post("/loc/:token/ping", async (req, res) => {
  try {
    const b = (req.body ?? {}) as { lat?: unknown; lng?: unknown; accuracy?: unknown };
    const r = await recordPing(String(req.params.token), b.lat, b.lng, b.accuracy);
    if (r.ok) return res.json({ success: true, data: { distanceKm: r.distanceKm, etaMin: r.etaMin, arrived: r.arrived } });
    const status = r.reason === "invalid_token" ? 404 : r.reason === "too_frequent" ? 429 : r.reason === "bad_coordinates" ? 400 : 403;
    res.status(status).json({ success: false, reason: r.reason });
  } catch (err) {
    logger.error({ err: (err as Error).message }, "[he-public] ping failed");
    res.status(500).json({ success: false });
  }
});

hePublicRouter.post("/loc/:token/stop", async (req, res) => {
  try {
    const ok = await stopSharing(String(req.params.token));
    res.status(ok ? 200 : 404).json({ success: ok });
  } catch (err) {
    logger.error({ err: (err as Error).message }, "[he-public] stop failed");
    res.status(500).json({ success: false });
  }
});

hePublicRouter.post("/loc/:token/optin", async (req, res) => {
  try {
    const r = await optInWhatsApp(String(req.params.token));
    const status = r === "invalid" ? 404 : r === "closed" ? 403 : 200;
    res.status(status).json({ success: status === 200, result: r });
  } catch (err) {
    logger.error({ err: (err as Error).message }, "[he-public] opt-in failed");
    res.status(500).json({ success: false });
  }
});

hePublicRouter.post("/loc/:token/answer", async (req, res) => {
  const token = String(req.params.token);
  const gate = enterAnswerGate(token);
  if (gate !== "ok") {
    return res.status(429).json({ success: false, reason: gate, message: gate === "busy" ? "Your answer is being saved. Please try again in a moment." : "Too many answers. Please wait a few minutes." });
  }
  try {
    const r = await answerInvite(token, (req.body as { answer?: unknown } | undefined)?.answer);
    if (r.ok) return res.json({ success: true, data: r.matchToken ? { state: r.state, matchToken: r.matchToken } : { state: r.state } });
    res.status(r.reason === "invalid" ? 404 : r.reason === "bad_answer" ? 400 : 403).json({ success: false, reason: r.reason });
  } catch (err) {
    logger.error({ err: logText(err) }, "[he-public] answer failed");
    res.status(500).json({ success: false });
  } finally {
    leaveAnswerGate(token);
  }
});
