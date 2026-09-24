/**
 * Public, token-gated routes behind the appointment-letter email's
 * "Review & Accept" button. Mounted at /api/public/appointment-letter, ABOVE the
 * "/api" requireAuth catch-all in app.ts (the same requirement, and the same
 * reason, as the joining-kit public mount).
 *
 * No session: the token is the credential. Every failure for an unknown or
 * malformed token is one flat 404 — see appointmentLetterPublic.service.ts.
 */
import fs from "fs";
import { Router, type NextFunction, type Request, type Response } from "express";
import rateLimit from "express-rate-limit";
import {
  getPublicLetterFile,
  getPublicLetterSession,
  startPublicLetterEsign,
} from "./appointmentLetterPublic.service.js";

export const publicAppointmentLetterRouter = Router();

/**
 * 30 signing starts per 10 minutes per IP. Each new session is a billed provider
 * call; the server side is already idempotent, so this only bounds abuse. Loose
 * enough for a whole office behind one NAT signing on the same morning.
 */
const startLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, message: "Too many attempts from this network. Please wait a few minutes and try again." },
});

type Handler = (req: Request, res: Response) => Promise<unknown>;

/**
 * Known token/flow errors carry a statusCode and a message written for the
 * employee; anything else is a real fault and goes to the global handler, which
 * masks it. Answering the known ones here keeps an ordinary bad link from being
 * logged as an API error on every click.
 */
const h = (fn: Handler) => (req: Request, res: Response, next: NextFunction) => {
  void fn(req, res).catch((error: unknown) => {
    const known = error as { statusCode?: number; code?: string; message?: string };
    if (known?.statusCode && known.statusCode >= 400 && known.statusCode < 500 && known.code) {
      return res.status(known.statusCode).json({ success: false, code: known.code, message: known.message });
    }
    return next(error);
  });
};

/** The URL carries a bearer token: never cache the response, never leak it in a Referer. */
const privateResponse = (res: Response) => {
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("Referrer-Policy", "no-referrer");
  res.setHeader("X-Robots-Tag", "noindex, nofollow");
};

publicAppointmentLetterRouter.get("/:token/session", h(async (req, res) => {
  privateResponse(res);
  const session = await getPublicLetterSession(String(req.params.token));
  return res.json({ success: true, data: { session } });
}));

publicAppointmentLetterRouter.get("/:token/file", h(async (req, res) => {
  privateResponse(res);
  const file = await getPublicLetterFile(String(req.params.token));
  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", `inline; filename="${file.fileName.replace(/"/g, "")}"`);
  const stream = fs.createReadStream(file.storagePath);
  stream.on("error", () => {
    if (!res.headersSent) res.status(404).json({ success: false, code: "LETTER_FILE_MISSING", message: "The letter document is not available. Please contact HR." });
    else res.destroy();
  });
  stream.pipe(res);
}));

// Starting a session is a billed provider call: rate-limited on top of the global limiter.
publicAppointmentLetterRouter.post("/:token/start", startLimiter, h(async (req, res) => {
  privateResponse(res);
  const out = await startPublicLetterEsign({
    token: String(req.params.token),
    ipAddress: req.ip,
    userAgent: req.get("user-agent") ?? null,
  });
  return res.json({ success: true, data: out });
}));
