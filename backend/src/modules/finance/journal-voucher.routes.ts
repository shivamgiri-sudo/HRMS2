import { Router } from "express";
import { requireAuth, requireWriteAccess, type AuthenticatedRequest } from "../../middleware/authMiddleware.js";
import { requireRole } from "../../middleware/requireRole.js";
import { refuse } from "../process-pnl/finance-error.js";
import {
  getJournalVoucher,
  journalVoucherOptions,
  journalVoucherSummary,
  journalVouchersCsv,
  listJournalVouchers,
  type JvListFilters,
} from "./journal-voucher.queries.js";
import { JV_APPROVER_ROLES, JV_MAKER_ROLES, JV_READ_ROLES, JV_REVERSE_ROLES, type JvActor } from "./journal-voucher.roles.js";
import { journalVoucherService } from "./journal-voucher.service.js";
import { JV_STATUSES, JV_TYPES, isValidIsoDate, type JvStatus, type JvType } from "./journal-voucher.validation.js";

/**
 * Manual Journal Voucher API — own prefix (/api/finance/journal-vouchers), for the same reason
 * payment-voucher.routes.ts has one: never shadowed by grnRouter's ":id"-shaped routes.
 *
 * Maker-checker (journal-voucher.roles.ts): makers draft/edit/submit; a different approver posts.
 * Every mutating route is also guarded inside the service, because a route guard proves a role
 * and cannot prove two different people.
 */
export const journalVoucherRouter = Router();

const h =
  (fn: (req: AuthenticatedRequest, res: any) => Promise<unknown>) =>
  (req: AuthenticatedRequest, res: any, next: any) =>
    fn(req, res).catch(next);

function actorOf(req: AuthenticatedRequest): JvActor {
  const id = req.authUser?.id;
  if (!id) throw refuse(401, "UNAUTHENTICATED", "Authenticated user is required");
  const roles = req.userRoles?.length ? req.userRoles : [String(req.authUser?.role ?? "unknown")];
  return { id, roles: roles.map(String) };
}

const text = (value: unknown) => (typeof value === "string" && value.trim() ? value.trim() : undefined);

function numberOrUndefined(value: unknown, label: string): number | undefined {
  if (value === undefined || value === "") return undefined;
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) throw refuse(400, "JV_INVALID_FILTER", `${label} must be a positive number.`);
  return n;
}

function dateOrUndefined(value: unknown, label: string): string | undefined {
  const v = text(value);
  if (v === undefined) return undefined;
  if (!isValidIsoDate(v)) throw refuse(400, "JV_INVALID_FILTER", `${label} must be a date (YYYY-MM-DD).`);
  return v;
}

export function parseJournalVoucherFilters(query: Record<string, unknown>): JvListFilters {
  const status = text(query.status);
  if (status && !(JV_STATUSES as readonly string[]).includes(status)) throw refuse(400, "JV_INVALID_FILTER", "Unknown status filter.");
  const jvType = text(query.jvType);
  if (jvType && !(JV_TYPES as readonly string[]).includes(jvType)) throw refuse(400, "JV_INVALID_FILTER", "Unknown voucher type filter.");
  const accountKey = text(query.accountKey);
  if (accountKey && !/^(expense_sub_head|payable_account):[0-9a-fA-F-]{36}$/.test(accountKey)) {
    throw refuse(400, "JV_INVALID_FILTER", "Unknown account filter.");
  }
  const dir = text(query.dir);
  return {
    status: status as JvStatus | undefined,
    jvType: jvType as JvType | undefined,
    branchId: text(query.branchId),
    costCentreId: text(query.costCentreId),
    processId: text(query.processId),
    from: dateOrUndefined(query.from, "From date"),
    to: dateOrUndefined(query.to, "To date"),
    q: text(query.q)?.slice(0, 100),
    accountKey,
    createdBy: text(query.createdBy),
    minAmount: numberOrUndefined(query.minAmount, "Minimum amount"),
    maxAmount: numberOrUndefined(query.maxAmount, "Maximum amount"),
    sort: text(query.sort),
    dir: dir === "asc" ? "asc" : "desc",
    page: numberOrUndefined(query.page, "Page"),
    pageSize: numberOrUndefined(query.pageSize, "Page size"),
  };
}

journalVoucherRouter.use(requireAuth);

// Static paths first — "/:id" would otherwise swallow them.
journalVoucherRouter.get("/options", requireRole(...JV_READ_ROLES), h(async (_req, res) => {
  res.json({ success: true, data: await journalVoucherOptions() });
}));

journalVoucherRouter.get("/summary", requireRole(...JV_READ_ROLES), h(async (req, res) => {
  res.json({ success: true, data: await journalVoucherSummary(parseJournalVoucherFilters(req.query), actorOf(req)) });
}));

journalVoucherRouter.get("/export", requireRole(...JV_READ_ROLES), h(async (req, res) => {
  const detail = req.query.detail === "lines" ? "lines" : "vouchers";
  const csv = await journalVouchersCsv(parseJournalVoucherFilters(req.query), actorOf(req), detail);
  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename="journal-vouchers-${detail}-${new Date().toISOString().slice(0, 10)}.csv"`);
  res.send(csv);
}));

journalVoucherRouter.get("/", requireRole(...JV_READ_ROLES), h(async (req, res) => {
  res.json({ success: true, data: await listJournalVouchers(parseJournalVoucherFilters(req.query), actorOf(req)) });
}));

journalVoucherRouter.get("/:id", requireRole(...JV_READ_ROLES), h(async (req, res) => {
  res.json({ success: true, data: await getJournalVoucher(req.params.id, actorOf(req)) });
}));

journalVoucherRouter.post("/", requireWriteAccess, requireRole(...JV_MAKER_ROLES), h(async (req, res) => {
  res.status(201).json({ success: true, data: await journalVoucherService.create(req.body, actorOf(req)) });
}));

journalVoucherRouter.put("/:id", requireWriteAccess, requireRole(...JV_MAKER_ROLES), h(async (req, res) => {
  res.json({ success: true, data: await journalVoucherService.update(req.params.id, req.body, actorOf(req)) });
}));

journalVoucherRouter.delete("/:id", requireWriteAccess, requireRole(...JV_MAKER_ROLES), h(async (req, res) => {
  res.json({ success: true, data: await journalVoucherService.remove(req.params.id, actorOf(req)) });
}));

journalVoucherRouter.post("/:id/submit", requireWriteAccess, requireRole(...JV_MAKER_ROLES), h(async (req, res) => {
  res.json({ success: true, data: await journalVoucherService.submit(req.params.id, actorOf(req)) });
}));

journalVoucherRouter.post("/:id/approve", requireWriteAccess, requireRole(...JV_APPROVER_ROLES), h(async (req, res) => {
  res.json({ success: true, data: await journalVoucherService.approve(req.params.id, req.body?.note, actorOf(req)) });
}));

journalVoucherRouter.post("/:id/reject", requireWriteAccess, requireRole(...JV_APPROVER_ROLES), h(async (req, res) => {
  res.json({ success: true, data: await journalVoucherService.reject(req.params.id, req.body?.reason, actorOf(req)) });
}));

journalVoucherRouter.post("/:id/withdraw", requireWriteAccess, requireRole(...JV_READ_ROLES), h(async (req, res) => {
  res.json({ success: true, data: await journalVoucherService.withdraw(req.params.id, req.body?.reason, actorOf(req)) });
}));

journalVoucherRouter.post("/:id/reverse", requireWriteAccess, requireRole(...JV_REVERSE_ROLES), h(async (req, res) => {
  res.json({ success: true, data: await journalVoucherService.reverse(req.params.id, req.body?.reason, actorOf(req)) });
}));
