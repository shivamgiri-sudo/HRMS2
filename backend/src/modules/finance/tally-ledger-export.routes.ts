import { Router } from "express";
import { requireAuth, type AuthenticatedRequest } from "../../middleware/authMiddleware.js";
import { requireRole } from "../../middleware/requireRole.js";
import { logSensitiveAction } from "../../shared/auditLog.js";
import { GRN_TALLY_READ_ROLES } from "./grn-tally-export.routes.js";
import { buildLedgerTallyExport, type LedgerTallyKind } from "./tally-ledger-export.service.js";

/** Finance Ledger -> Tally XML, per month. Mounted at /api/finance/ledger-tally. Read-only. */
export const ledgerTallyRouter = Router();
ledgerTallyRouter.use(requireAuth);

const KINDS: LedgerTallyKind[] = ["all", "masters", "grn", "payments", "journals"];

function parse(req: AuthenticatedRequest): { month: string; kind: LedgerTallyKind } {
  const month = String(req.query.month ?? "");
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) throw Object.assign(new Error("month must be YYYY-MM"), { status: 400 });
  const kind = String(req.query.kind ?? "all") as LedgerTallyKind;
  if (!KINDS.includes(kind)) throw Object.assign(new Error(`kind must be one of ${KINDS.join(", ")}`), { status: 400 });
  return { month, kind };
}
const statusOf = (e: unknown) => Number((e as { status?: number })?.status) || 500;

ledgerTallyRouter.get("/summary", requireRole(...GRN_TALLY_READ_ROLES), async (req: AuthenticatedRequest, res) => {
  try {
    const { month } = parse(req);
    const { summary } = await buildLedgerTallyExport({ month, kind: "all" });
    res.json({ success: true, data: summary });
  } catch (error) {
    const status = statusOf(error);
    if (status === 500) console.error("[ledger-tally] summary failed", error);
    res.status(status).json({ success: false, error: status === 500 ? "Unable to build the Tally summary" : (error as Error).message });
  }
});

ledgerTallyRouter.get("/export", requireRole(...GRN_TALLY_READ_ROLES), async (req: AuthenticatedRequest, res) => {
  try {
    const { month, kind } = parse(req);
    const { xml, summary } = await buildLedgerTallyExport({ month, kind });
    await logSensitiveAction({
      actor_user_id: req.authUser!.id,
      action_type: "ledger_tally_export",
      module_key: "finance",
      entity_type: "journal_entry",
      req,
      change_summary: { month, kind, ...summary.counts, masters: summary.masters },
    });
    res.setHeader("Content-Type", "application/xml; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="Tally_${kind}_${month}.xml"`);
    res.setHeader("X-Tally-Exceptions", String(summary.exceptions.length));
    res.send(Buffer.from(xml, "utf8"));
  } catch (error) {
    const status = statusOf(error);
    if (status === 500) console.error("[ledger-tally] export failed", error);
    res.status(status).json({ success: false, error: status === 500 ? "Unable to build the Tally file" : (error as Error).message });
  }
});
