/**
 * The employee-facing half of the NOC Certificate.
 *
 * The invite mails a link to /employee/noc/<token>. Everything here is reached with a bearer-less
 * token from an email, WhatsApp or SMS, so it is deliberately narrow: it discloses only the
 * identity fields the form pre-fills and the asset rows printed on the certificate, it never
 * accepts an identifier from the caller other than the token, and it says nothing about which
 * managers have or have not signed — clearance decisions by named people are not the leaver's to
 * read on an unauthenticated page.
 *
 * MOUNT ORDER IS LOAD-BEARING. This router must be mounted in app.ts ABOVE
 * `app.use("/api", clientRouter)`, which applies requireAuth to every /api/* path. Mounted below
 * it, every NOC link an employee clicks answers "missing authorization token" — the same failure
 * that hit the joining-kit and EPF links. backend/src/__tests__/publicRouteMountOrder.contract.test.ts
 * guards the ordering.
 */

import { Router } from "express";
import type { Request, Response } from "express";
import { publicRegistrationLimiter } from "../../middleware/rateLimiter.js";
import * as nocCase from "./noc-case.service.js";

export const nocCasePublicRouter = Router();

/**
 * One error shape for every failure.
 *
 * A caller here is anonymous, so the response must not become an oracle: "employee not found"
 * versus "link expired" would let someone probing tokens learn which ones map to real people.
 * The service already normalises its refusals to a flat message with a code; this preserves that
 * and gives anything unexpected a 500 with no detail.
 */
function fail(res: Response, err: unknown): Response {
  const e = err as { statusCode?: number; code?: string; message?: string };
  if (e?.statusCode && e.statusCode < 500) {
    return res.status(e.statusCode).json({ success: false, code: e.code ?? "NOC_LINK_INVALID", message: e.message });
  }
  console.error("[noc-public] unexpected error:", err);
  return res.status(500).json({ success: false, code: "NOC_FORM_ERROR", message: "Something went wrong. Please contact HR." });
}

/** req.ip / user-agent, the two-line idiom this codebase already uses for public-token audit. */
function requestContext(req: Request): { ip: string | null; userAgent: string | null } {
  return { ip: req.ip ?? null, userAgent: req.get("user-agent") ?? null };
}

// GET /api/public/noc/:token — load the form
nocCasePublicRouter.get("/:token", publicRegistrationLimiter, async (req: Request, res: Response) => {
  try {
    return res.json({ success: true, data: await nocCase.getPublicFormView(String(req.params.token)) });
  } catch (err) {
    return fail(res, err);
  }
});

// POST /api/public/noc/:token/submit — employee submits
nocCasePublicRouter.post("/:token/submit", publicRegistrationLimiter, async (req: Request, res: Response) => {
  try {
    const { resignationDate, reasonForLeaving, assets } = req.body as {
      resignationDate?: string;
      reasonForLeaving?: string;
      assets?: Array<{ itemCode: string; quantity?: number | null; status: nocCase.AssetStatus; remarks?: string | null }>;
    };
    const ctx = requestContext(req);

    const { caseId } = await nocCase.submitEmployeeForm({
      token: String(req.params.token),
      input: {
        resignationDate: String(resignationDate ?? ""),
        reasonForLeaving: reasonForLeaving ?? null,
        // Only ever an array. A malformed body must not reach the service's asset loop as
        // something it will iterate the properties of.
        assets: Array.isArray(assets) ? assets : [],
      },
      ip: ctx.ip,
      userAgent: ctx.userAgent,
    });

    // Fire-and-forget: the submission is committed, and a mail failure must not tell the employee
    // their form did not save. Notification failures are recorded on the dispatch claim.
    void import("./noc.notifications.js")
      .then((m) => m.notifyEmployeeSubmitted(caseId))
      .catch((e) => console.error("[noc-public] submit notification failed:", (e as Error).message));

    return res.json({
      success: true,
      message: "Your NOC form has been submitted. HR and your reporting line have been notified.",
    });
  } catch (err) {
    return fail(res, err);
  }
});
