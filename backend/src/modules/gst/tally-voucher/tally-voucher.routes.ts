/**
 * Tally Prime voucher XML export, mounted at /api/gst/tally-vouchers.
 *
 * Role gating is deliberately the same as gst-export.routes.ts: reading is the finance reading
 * set; generating, configuring ledgers and marking a batch downloaded belong to the roles that
 * own filing, because downloading stamps documents as "already in Tally" and the next export of
 * them becomes an ALTER.
 */

import { Router, type NextFunction, type Response } from "express";
import {
  requireAuth,
  requireWriteAccess,
  type AuthenticatedRequest,
} from "../../../middleware/authMiddleware.js";
import { requireRole } from "../../../middleware/requireRole.js";
import { listVoucherKinds } from "./tally-voucher-kinds.js";
import {
  TallyVoucherError,
  tallyVoucherService,
} from "./tally-voucher.service.js";

const TALLY_WRITE_ROLES = [
  "accounts_head",
  "finance_head",
  "super_admin",
] as const;
const TALLY_READ_ROLES = [
  ...TALLY_WRITE_ROLES,
  "admin",
  "finance",
  "branch_admin",
] as const;

const router = Router();

type Handler = (req: AuthenticatedRequest, res: Response) => Promise<unknown>;
const h =
  (fn: Handler) =>
  (req: AuthenticatedRequest, res: Response, next: NextFunction) =>
    fn(req, res).catch((error: unknown) => {
      if (error instanceof TallyVoucherError)
        return res
          .status(error.status)
          .json({ success: false, error: error.message });
      return next(error);
    });

function actor(req: AuthenticatedRequest) {
  const id = req.authUser?.id;
  if (!id) throw new TallyVoucherError("Authenticated user is required", 401);
  return {
    id,
    role: String(req.authUser?.role ?? req.userRoles?.[0] ?? "unknown"),
  };
}

const planBody = (req: AuthenticatedRequest) => ({
  companyGstin: String(req.body?.companyGstin ?? ""),
  periodMonth: String(req.body?.periodMonth ?? ""),
  voucherKinds: Array.isArray(req.body?.voucherKinds)
    ? (req.body.voucherKinds as unknown[]).map(String)
    : [],
});

router.use(requireAuth);

/** GET /kinds - the voucher types this install can export (Receipt appears once registered). */
router.get(
  "/kinds",
  requireRole(...TALLY_READ_ROLES),
  h(async (_req, res) =>
    res.json({
      success: true,
      data: listVoucherKinds().map((k) => ({ kind: k.kind, label: k.label })),
    }),
  ),
);

router.get(
  "/config",
  requireRole(...TALLY_READ_ROLES),
  h(async (req, res) =>
    res.json({
      success: true,
      data: await tallyVoucherService.getConfig(
        String(req.query.companyGstin ?? ""),
      ),
    }),
  ),
);

router.put(
  "/config",
  requireWriteAccess,
  requireRole(...TALLY_WRITE_ROLES),
  h(async (req, res) => {
    const user = actor(req);
    const values =
      req.body?.values && typeof req.body.values === "object"
        ? (req.body.values as Record<string, string>)
        : {};
    const data = await tallyVoucherService.saveConfig(
      req.body?.companyGstin ? String(req.body.companyGstin) : null,
      values,
      user.id,
      user.role,
    );
    return res.json({ success: true, data });
  }),
);

/** POST /preview - nothing persisted; the exceptions list and the XML for the clean vouchers. */
router.post(
  "/preview",
  requireRole(...TALLY_READ_ROLES),
  h(async (req, res) =>
    res.json({
      success: true,
      ...(await tallyVoucherService.preview(planBody(req))),
    }),
  ),
);

router.post(
  "/batches",
  requireWriteAccess,
  requireRole(...TALLY_WRITE_ROLES),
  h(async (req, res) => {
    const user = actor(req);
    const data = await tallyVoucherService.generateBatch(
      {
        ...planBody(req),
        notes: req.body?.notes ? String(req.body.notes) : undefined,
      },
      user.id,
      user.role,
    );
    return res.json({ success: true, ...data });
  }),
);

router.get(
  "/batches",
  requireRole(...TALLY_READ_ROLES),
  h(async (req, res) =>
    res.json({
      success: true,
      data: await tallyVoucherService.listBatches({
        companyGstin: req.query.companyGstin
          ? String(req.query.companyGstin)
          : undefined,
        periodMonth: req.query.periodMonth
          ? String(req.query.periodMonth)
          : undefined,
        limit: req.query.limit ? Number(req.query.limit) : undefined,
      }),
    }),
  ),
);

router.get(
  "/batches/:id",
  requireRole(...TALLY_READ_ROLES),
  h(async (req, res) =>
    res.json({
      success: true,
      ...(await tallyVoucherService.getBatch(String(req.params.id))),
    }),
  ),
);

/** GET /batches/:id/xml - 409 while blocking exceptions remain unless ?skipExceptions=true. */
router.get(
  "/batches/:id/xml",
  requireRole(...TALLY_READ_ROLES),
  h(async (req, res) => {
    const { xml, batch } = await tallyVoucherService.renderBatchXml(
      String(req.params.id),
      {
        skipExceptions: String(req.query.skipExceptions ?? "") === "true",
      },
    );
    res.setHeader("Content-Type", "application/xml; charset=utf-8");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="TALLY-VOUCHERS-${batch.company_gstin}-${batch.period_month}.xml"`,
    );
    return res.send(xml);
  }),
);

router.post(
  "/batches/:id/downloaded",
  requireWriteAccess,
  requireRole(...TALLY_WRITE_ROLES),
  h(async (req, res) => {
    const user = actor(req);
    const data = await tallyVoucherService.markDownloaded(
      String(req.params.id),
      user.id,
      user.role,
    );
    return res.json({ success: true, ...data });
  }),
);

/** GET /vouchers/:sourceType/:sourceId - drill-down for one invoice / credit note. */
router.get(
  "/vouchers/:sourceType/:sourceId",
  requireRole(...TALLY_READ_ROLES),
  h(async (req, res) =>
    res.json({
      success: true,
      data: await tallyVoucherService.getVoucherDetail(
        String(req.params.sourceType),
        String(req.params.sourceId),
      ),
    }),
  ),
);

export { router as tallyVoucherRouter };
