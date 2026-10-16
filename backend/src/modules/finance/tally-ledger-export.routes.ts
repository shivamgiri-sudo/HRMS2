import { Router } from "express";
import { requireAuth, type AuthenticatedRequest } from "../../middleware/authMiddleware.js";
import { requireRole } from "../../middleware/requireRole.js";
import { logSensitiveAction } from "../../shared/auditLog.js";
import { GRN_TALLY_READ_ROLES } from "./grn-tally-export.routes.js";
import { buildLedgerTallyExport, buildLedgerTallyXlsx, type LedgerTallyKind } from "./tally-ledger-export.service.js";

/** Finance Ledger -> Tally XML, per month. Mounted at /api/finance/ledger-tally. Read-only. */
export const ledgerTallyRouter = Router();
ledgerTallyRouter.use(requireAuth);

const KINDS: LedgerTallyKind[] = ["all", "masters", "grn", "imprest", "payments", "journals"];

function parse(req: AuthenticatedRequest): { month: string; kind: LedgerTallyKind; format: "xml" | "xlsx" } {
  const month = String(req.query.month ?? "");
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) throw Object.assign(new Error("month must be YYYY-MM"), { status: 400 });
  const kind = String(req.query.kind ?? "all") as LedgerTallyKind;
  if (!KINDS.includes(kind)) throw Object.assign(new Error(`kind must be one of ${KINDS.join(", ")}`), { status: 400 });
  const format = String(req.query.format ?? "xml");
  if (format !== "xml" && format !== "xlsx") throw Object.assign(new Error("format must be xml or xlsx"), { status: 400 });
  return { month, kind, format };
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
    const { month, kind, format } = parse(req);
    const built = format === "xlsx"
      ? await buildLedgerTallyXlsx({ month, kind })
      : await buildLedgerTallyExport({ month, kind });
    const summary = built.summary;
    await logSensitiveAction({
      actor_user_id: req.authUser!.id,
      action_type: "ledger_tally_export",
      module_key: "finance",
      entity_type: "journal_entry",
      req,
      change_summary: { month, kind, format, ...summary.counts, masters: summary.masters },
    });
    res.setHeader("X-Tally-Exceptions", String(summary.exceptions.length));
    if (format === "xlsx") {
      res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
      res.setHeader("Content-Disposition", `attachment; filename="Tally_${kind}_${month}.xlsx"`);
      res.send((built as { buffer: Buffer }).buffer);
    } else {
      res.setHeader("Content-Type", "application/xml; charset=utf-8");
      res.setHeader("Content-Disposition", `attachment; filename="Tally_${kind}_${month}.xml"`);
      res.send(Buffer.from((built as { xml: string }).xml, "utf8"));
    }
  } catch (error) {
    const status = statusOf(error);
    if (status === 500) console.error("[ledger-tally] export failed", error);
    res.status(status).json({ success: false, error: status === 500 ? "Unable to build the Tally file" : (error as Error).message });
  }
});
