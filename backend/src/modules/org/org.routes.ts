import { Router } from "express";
import type { Request, RequestHandler, Response } from "express";
import { requireAuth } from "../../middleware/authMiddleware.js";
import type { AuthenticatedRequest } from "../../middleware/authMiddleware.js";
import { requireRole } from "../../middleware/requireRole.js";
import { db } from "../../db/mysql.js";
import * as XLSX from "xlsx";
import {
  branchService, departmentService, lobService, designationService,
  campaignService, costCentreService, gradeBandService,
  locationService, policyService, processService,
} from "./org.service.js";

const router = Router();
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const h = (fn: (req: any, res: any) => Promise<unknown>) => (req: any, res: any, next: any) => fn(req, res).catch(next);

router.use(requireAuth);

// All list/get: any authenticated user (needed for dropdowns)
// Create/update/delete: admin or hr, EXCEPT /departments — super_admin only, see
// requireDepartmentWrite below.

/**
 * Who is making an Org Masters change, for cost_centre_approval_log.
 *
 * Reads the same authUser the rest of the app uses; returns undefined when it is absent so the
 * service simply skips the audit row rather than inventing an actor.
 */
function orgActor(req: Request): { id: string; role: string } | undefined {
  const auth = (req as any).authUser;
  if (!auth?.id) return undefined;
  return { id: String(auth.id), role: String(auth.role ?? (req as any).userRoles?.[0] ?? "unknown") };
}

/**
 * Per-path override for the write guards below.
 *
 * Every org master shared one gate — create/update on requireRole("admin","hr"), delete on
 * requireRole("admin") — which is right for the tables HR genuinely maintains (designations,
 * campaigns, grade bands) and wrong for department_master. See requireDepartmentWrite.
 */
type CrudGuards = {
  write?: RequestHandler;
  remove?: RequestHandler;
  status?: RequestHandler;
};

/**
 * department_master is org structure, not day-to-day HR data. Renaming or deleting a
 * department silently re-points every employee record, payroll cost mapping, requisition and
 * report filter that resolves through it, and there is no undo. Until 2026-08-27 this sat on
 * the shared requireRole("admin","hr") gate, which on live data meant 17 accounts could
 * create or rename a department and 3 could delete one — 16 of the 17 being branch HR, who
 * have no reason to reshape the company's org chart. Locked to super_admin.
 *
 * The one carve-out is a genuine false positive, not a concession. EmployeeEditDialog PUTs
 * `{ manager_id }` to this same endpoint as a side effect of HR ticking "department head" on
 * an employee record (see EmployeeEditDialog.tsx around the department_id save). That is an
 * employee edit expressed as a department write, so admin/hr keep it — but ONLY when
 * manager_id is the *entire* body. Any payload that also carries dept_name, dept_code,
 * description or active_status is a structure change and falls through to super_admin.
 *
 * Checking the body shape rather than trusting a dedicated route means an HR client cannot
 * reach a rename by pointing the head-assignment call at a fuller payload.
 */
const isDepartmentHeadAssignment = (body: unknown): boolean => {
  if (!body || typeof body !== "object" || Array.isArray(body)) return false;
  const keys = Object.keys(body as Record<string, unknown>);
  return keys.length > 0 && keys.every((key) => key === "manager_id");
};

const requireDepartmentStructure = requireRole("super_admin");
const requireDepartmentHead      = requireRole("admin", "hr");

const requireDepartmentWrite: RequestHandler = (req, res, next) =>
  isDepartmentHeadAssignment(req.body)
    ? requireDepartmentHead(req as AuthenticatedRequest, res, next)
    : requireDepartmentStructure(req as AuthenticatedRequest, res, next);

function buildCrud(
  path: string,
  svc: {
    list(options?: any): any;
    getById(id: string): any;
    create(d: any): any;
    update(id: string, d: any): any;
    delete(id: string): any;
    setStatus?(id: string, status: number): any;
  },
  guards: CrudGuards = {}
) {
  const writeGuard  = guards.write  ?? requireRole("admin", "hr");
  const removeGuard = guards.remove ?? requireRole("admin");
  const statusGuard = guards.status ?? requireRole("admin", "hr");
  router.get(path, h(async (req: Request, res: Response) => {
    const { q, active_status, page, limit, branch_id, include_duplicates } = req.query;
    const options = {
      q: q as string | undefined,
      active_status: active_status as string | undefined,
      page: page ? parseInt(page as string, 10) : undefined,
      limit: limit ? parseInt(limit as string, 10) : undefined,
      // Ignored by list() for tables with no branch_id column (see TABLES_WITH_BRANCH_ID
      // in org.service.ts) — safe to always pass through.
      branch_id: branch_id as string | undefined,
      // Opt-in only — see includeDuplicates doc on ListOptions in org.service.ts. Nothing
      // sends this today except the Org Masters Branches tab; every other caller of every
      // other tab is unaffected.
      includeDuplicates: include_duplicates === "1" || include_duplicates === "true",
    };
    res.json({ data: await svc.list(options) });
  }));
  router.get(`${path}/:id`, h(async (req: Request, res: Response) => {
    const item = await svc.getById(req.params.id);
    if (!item) return res.status(404).json({ error: "Not found" });
    res.json({ data: item });
  }));
  router.post(path, writeGuard, h(async (req: Request, res: Response) => {
    const item = await svc.create(req.body);
    res.status(201).json({ data: item });
  }));
  router.put(`${path}/:id`, writeGuard, h(async (req: Request, res: Response) => {
    const item = await svc.update(req.params.id, req.body);
    res.json({ data: item });
  }));
  router.delete(`${path}/:id`, removeGuard, h(async (req: Request, res: Response) => {
    await svc.delete(req.params.id);
    res.json({ ok: true });
  }));
  if (svc.setStatus) {
    router.patch(`${path}/:id/status`, statusGuard, h(async (req: Request, res: Response) => {
      const { active_status } = req.body;
      if (active_status !== 0 && active_status !== 1) {
        return res.status(400).json({ error: "active_status must be 0 or 1" });
      }
      await svc.setStatus!(req.params.id, active_status);
      res.json({ ok: true });
    }));
  }
}

// Canonical filter source for all pages. Use this instead of building filters from employee/report rows.
router.get("/filter-options", h(async (_req: Request, res: Response) => {
  const [managers] = await db.execute<any[]>(
    `SELECT e.id, e.employee_code,
            COALESCE(NULLIF(e.full_name, ''), CONCAT(e.first_name, ' ', COALESCE(e.last_name, ''))) AS full_name
       FROM employees e
      WHERE e.active_status = 1
        AND LOWER(COALESCE(e.employment_status, 'active')) = 'active'
        AND EXISTS (SELECT 1 FROM employees team WHERE team.reporting_manager_id = e.id OR team.manager_id = e.id)
      ORDER BY full_name ASC`
  );
  res.json({
    success: true,
    data: {
      branches: await branchService.list(),
      departments: await departmentService.list(),
      processes: await processService.list(),
      costCentres: await costCentreService.list(),
      designations: await designationService.list(),
      locations: await locationService.list(),
      managers,
    },
    meta: { activeOnly: true },
  });
}));

router.get("/", h(async (_req: Request, res: Response) => {
  const [
    branches,
    departments,
    designations,
    processes,
    lobs,
    locations,
    policies,
    costCentres,
    gradeBands,
    campaigns,
  ] = await Promise.all([
    branchService.list(),
    departmentService.list(),
    designationService.list(),
    processService.list(),
    lobService.list(),
    locationService.list(),
    policyService.list(),
    costCentreService.list(),
    gradeBandService.list(),
    campaignService.list(),
  ]);

  return res.json({
    success: true,
    data: {
      branches,
      departments,
      designations,
      processes,
      lobs,
      locations,
      policies,
      cost_centres: costCentres,
      grade_bands: gradeBands,
      campaigns,
    },
  });
}));

// Call Centre Code: register GET before buildCrud to avoid /:id swallowing the static segment
router.get("/branches/cc-code-map",
  requireAuth,
  requireRole("admin", "hr", "super_admin"),
  h(async (_req: any, res: any) => {
    const data = await branchService.getCallCentreCodeMap();
    res.json({ data });
  })
);

buildCrud("/branches",      branchService);
buildCrud("/departments",   departmentService, {
  write:  requireDepartmentWrite,
  remove: requireRole("super_admin"),
  status: requireRole("super_admin"),
});
buildCrud("/lobs",          lobService);
buildCrud("/designations",  designationService);
buildCrud("/campaigns",     campaignService);
buildCrud("/grade-bands",   gradeBandService);
buildCrud("/locations",     locationService);
buildCrud("/policies",      policyService);
buildCrud("/processes",     processService);

// Cost-centres: migration status (must be before :id route)
router.get("/cost-centres/migration-status", h(async (_req: Request, res: Response) => {
  const { total, orphaned } = await costCentreService.countOrphanedRecords();
  res.json({
    success: true,
    data: {
      total,
      orphaned,
      migrationComplete: orphaned === 0,
      message: orphaned > 0
        ? `${orphaned} of ${total} cost centre(s) need Client, LOB, Branch, and Process assigned.`
        : "All cost centres have required relationships.",
    },
  });
}));

// Cost-centres: list with full relationship joins
router.get("/cost-centres", h(async (req: Request, res: Response) => {
  const { q, active_status, page, limit, branch_id, client_id, lob_id, process_id } = req.query;
  const options = {
    q: q as string | undefined,
    active_status: active_status as string | undefined,
    page: page ? parseInt(page as string, 10) : undefined,
    limit: limit ? parseInt(limit as string, 10) : undefined,
    branch_id: branch_id as string | undefined,
    client_id: client_id as string | undefined,
    lob_id: lob_id as string | undefined,
    process_id: process_id as string | undefined,
  };
  const rows = await costCentreService.list(options);
  // truncated rides alongside data rather than wrapping it, so every existing caller that reads
  // response.data keeps working unchanged while a caller that cares can warn the user.
  return res.json({ data: rows, truncated: Boolean((rows as { truncated?: boolean }).truncated) });
}));

// Cost-centres: billing summary for last 3 months (must be before /:id route)
router.get("/cost-centres/billing-summary", h(async (_req: Request, res: Response) => {
  const months = ["May-25", "Jun-25", "Jul-25"];
  const [rows] = await db.execute<any[]>(
    `SELECT cc.cost_centre_code, cc.id AS cost_centre_id,
        bps.bill_client_name, bps.month_label,
        COALESCE(SUM(bps.provision_amt), 0) AS provision_amt,
        COALESCE(SUM(bps.billing_amt), 0)   AS billing_amt
       FROM cost_centre_master cc
       JOIN billing_provision_snapshot bps
         ON bps.cost_centre_code COLLATE utf8mb4_unicode_ci = cc.cost_centre_code COLLATE utf8mb4_unicode_ci
        AND bps.month_label IN (?, ?, ?)
        AND bps.bill_branch NOT LIKE '%DIALDESK%'
       WHERE cc.active_status = 1
       GROUP BY cc.cost_centre_code, cc.id, bps.bill_client_name, bps.month_label
       ORDER BY cc.cost_centre_code, bps.month_label`,
    months
  );
  const map: Record<string, { bill_client_name: string | null; months: Record<string, { provision: number; billing: number }> }> = {};
  for (const row of rows as any[]) {
    const key = String(row.cost_centre_id);
    if (!map[key]) map[key] = { bill_client_name: row.bill_client_name ?? null, months: {} };
    map[key].months[row.month_label] = {
      provision: Number(row.provision_amt),
      billing:   Number(row.billing_amt),
    };
    if (!map[key].bill_client_name && row.bill_client_name) {
      map[key].bill_client_name = row.bill_client_name;
    }
  }
  res.json({ success: true, data: map });
}));

router.get("/cost-centres/:id", h(async (req: Request, res: Response) => {
  const item = await costCentreService.getById(req.params.id);
  if (!item) return res.status(404).json({ error: "Not found" });
  res.json({ data: item });
}));

router.post("/cost-centres", requireRole("admin", "hr"), h(async (req: Request, res: Response) => {
  const item = await costCentreService.create(req.body);
  res.status(201).json({ data: item });
}));

router.put("/cost-centres/:id", requireRole("admin", "hr"), h(async (req: Request, res: Response) => {
  const item = await costCentreService.update(req.params.id, req.body, orgActor(req));
  res.json({ data: item });
}));

// Cost-centres: migrate existing record with required FKs
router.put("/cost-centres/:id/migrate", requireRole("admin", "hr"), h(async (req: Request, res: Response) => {
  const item = await costCentreService.migrate(req.params.id, req.body);
  res.json({ data: item, message: "Cost centre migrated successfully" });
}));

router.delete("/cost-centres/:id", requireRole("admin"), h(async (req: Request, res: Response) => {
  await costCentreService.delete(req.params.id);
  res.json({ ok: true });
}));

router.patch("/cost-centres/:id/status", requireRole("admin", "hr"), h(async (req: Request, res: Response) => {
  const { active_status } = req.body;
  if (active_status !== 0 && active_status !== 1) {
    return res.status(400).json({ error: "active_status must be 0 or 1" });
  }
  await costCentreService.setStatus(req.params.id, active_status, orgActor(req));
  res.json({ ok: true });
}));

// Employees scoped to a cost centre (for reporting manager dropdown)
router.get("/employees-by-cost-centre", h(async (req: Request, res: Response) => {
  const costCentreId = req.query.cost_centre_id as string | undefined;
  if (!costCentreId) return res.status(400).json({ error: "cost_centre_id is required" });
  const [rows] = await db.execute<any[]>(
    `SELECT e.id,
            e.employee_code,
            COALESCE(NULLIF(e.full_name,''), CONCAT(e.first_name,' ',COALESCE(e.last_name,''))) AS full_name,
            d.designation_name
     FROM employees e
     LEFT JOIN designation_master d ON d.id = e.designation_id
     WHERE e.cost_centre_id = ?
       AND e.active_status = 1
       AND LOWER(COALESCE(e.employment_status,'active')) = 'active'
     ORDER BY full_name ASC`,
    [costCentreId]
  );
  res.json({ ok: true, data: rows });
}));

// Employees scoped to a branch (for reporting manager dropdown)
router.get("/employees-by-branch", h(async (req: Request, res: Response) => {
  const branchId = req.query.branch_id as string | undefined;
  if (!branchId) return res.status(400).json({ error: "branch_id is required" });
  const [rows] = await db.execute<any[]>(
    `SELECT e.id,
            e.employee_code,
            COALESCE(NULLIF(e.full_name,''), CONCAT(e.first_name,' ',COALESCE(e.last_name,''))) AS full_name,
            d.designation_name
     FROM employees e
     LEFT JOIN designation_master d ON d.id = e.designation_id
     WHERE e.branch_id = ?
       AND e.active_status = 1
       AND LOWER(COALESCE(e.employment_status,'active')) = 'active'
     ORDER BY full_name ASC`,
    [branchId]
  );
  res.json({ ok: true, data: rows });
}));

// Call Centre Code: PATCH can safely follow buildCrud (different HTTP method, no collision)
router.patch("/branches/:id/call-centre-code",
  requireAuth,
  requireRole("admin", "hr", "super_admin"),
  h(async (req: any, res: any) => {
    const { ccCode } = req.body;
    if (!ccCode || typeof ccCode !== "string" || ccCode.trim().length === 0) {
      return res.status(400).json({ error: "ccCode is required" });
    }
    await branchService.updateCallCentreCode(req.params.id, ccCode.trim().toUpperCase());
    res.json({ success: true });
  })
);

// ── Excel export: branches + processes + cost centres ─────────────────────────
router.get("/export/masters",
  requireAuth,
  requireRole("admin", "hr"),
  h(async (_req: Request, res: Response) => {
    const [branches, processes, costCentres] = await Promise.all([
      branchService.list(),
      processService.list(),
      costCentreService.list(),
    ]);

    const wb = XLSX.utils.book_new();

    // Sheet 1: Branch Master
    const branchRows = (branches as any[]).map((b) => ({
      "Branch Code": b.branch_code ?? "",
      "Branch Name": b.branch_name ?? "",
      "City": b.city ?? "",
      "State": b.state ?? "",
      "Call Centre Code": b.call_centre_code ?? "",
      "Status": Number(b.active_status) === 1 ? "Active" : "Inactive",
    }));
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(branchRows), "Branch Master");

    // Sheet 2: Process Master
    const processRows = (processes as any[]).map((p) => ({
      "Process Code": p.process_code ?? "",
      "Process Name": p.process_name ?? "",
      "Client Name": p.client_name ?? "",
      "Branch": p.branch_name ?? "",
      "Business LOB": p.business_lob ?? "",
      "Workload Type": p.workload_type ?? "",
      "Status": Number(p.active_status) === 1 ? "Active" : "Inactive",
    }));
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(processRows), "Process Master");

    // Sheet 3: Cost Centre Master (with relationship names)
    const ccRows = (costCentres as any[]).map((c) => ({
      "Cost Centre Code": c.cost_centre_code ?? "",
      "Cost Centre Name": c.cost_centre_name ?? "",
      "Client": c.client_name ?? "",
      "LOB": c.lob_name ?? "",
      "Branch": c.branch_name ?? "",
      "Process": c.process_name ?? "",
      "Needs Migration": c.needs_migration ? "Yes" : "No",
      "Status": Number(c.active_status) === 1 ? "Active" : "Inactive",
    }));
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(ccRows), "Cost Centre Master");

    const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx" });
    const today = new Date().toISOString().slice(0, 10);
    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.setHeader("Content-Disposition", `attachment; filename="org-masters-${today}.xlsx"`);
    res.send(buf);
  })
);

export { router as orgRouter };
