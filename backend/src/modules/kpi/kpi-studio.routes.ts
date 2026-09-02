/**
 * KPI Studio — HTTP surface, mounted at /api/kpi-studio.
 *
 * Backs the builder tabs added to the existing /kpi-master page and the drill-down added to
 * /my-kpi. Deliberately a new router rather than more routes on kpi-master.routes.ts: that file
 * owns the target/resolution surface every KPI page already depends on, and its literal routes
 * (/matrix, /team-summary, /live) sit above a `/:id` route where an added path can be swallowed by
 * the wildcard. Keeping the Studio separate means a mistake here cannot break /my-kpi.
 *
 * ── Roles ─────────────────────────────────────────────────────────────────────────────────────
 * CONFIG_ROLES may author KPIs and calculations. That is a genuinely powerful capability — a
 * formula decides what appears on somebody's appraisal — so it matches the roles that already hold
 * kpi_master_config write access in kpi-master.routes.ts (admin, hr, process_manager) plus the
 * quality/ops leads who own metric definitions in kpi.process-role.routes.ts. requireRole
 * short-circuits for super_admin, so it is never listed.
 *
 * VIEW_ROLES may read definitions without changing them, which team leaders need in order to
 * answer "why is my agent measured this way".
 *
 * The drill-down is scoped per employee rather than by role alone, reusing the same reporting-tree
 * check /api/kpi-master/live/:empId already applies — an employee may always see their own
 * explanation, a manager only their own reports'.
 */

import { Router } from 'express';
import type { Response } from 'express';
import multer from 'multer';
import { requireAuth } from '../../middleware/authMiddleware.js';
import type { AuthenticatedRequest } from '../../middleware/authMiddleware.js';
import { requireRole } from '../../middleware/requireRole.js';
import { getEmployeeForUser, hasProcessScope } from '../../shared/accessGuard.js';
import { db } from '../../db/mysql.js';
import type { RowDataPacket } from 'mysql2';
import {
  listDataSources,
  getDataSourceWithFields,
  saveDataSource,
  saveSourceField,
  deleteSourceField,
  listDefinitions,
  saveDefinition,
  retireDefinition,
  getDefinitionCoverage,
  resolveStudioForEmployee,
  createMetric,
  getScopeOptions,
  findEmployeesForScope,
  getFormulaHelp,
  getStudioCapability,
  validateDefinition,
  StudioNotInstalledError,
} from './kpi-studio.service.js';
import {
  introspectSourceColumns,
  parseUploadBuffer,
  suggestColumnMapping,
  commitUploadRows,
  saveManualValue,
} from './kpi-studio.sources.js';
import { computeStudioKpis, previewFormula, explainMetricForEmployee } from './kpi-studio.compute.js';
import { validateFormula } from './kpi-formula.engine.js';

const router = Router();

const CONFIG_ROLES = ['admin', 'hr', 'process_manager', 'qa', 'tq_head'] as const;
const VIEW_ROLES = [...CONFIG_ROLES, 'manager', 'branch_head', 'ceo', 'team_leader'] as const;

/**
 * Uploads are held in memory and never written to disk. A spreadsheet of KPI figures is at most a
 * few thousand rows, and a temp file is one more place the data can be left behind. 5 MB is
 * generous for that shape and small enough that a mistaken large upload is rejected rather than
 * consuming the process's heap.
 */
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024, files: 1 },
});

/**
 * Wraps a handler so a thrown error becomes a JSON response rather than an unhandled rejection.
 * StudioNotInstalledError becomes a 503 with instructions, because "the migration has not been
 * applied" is an operational state with a specific fix, not a bug and not a 500.
 */
const h =
  (fn: (req: AuthenticatedRequest, res: Response) => Promise<unknown>) =>
  (req: any, res: any, next: any) =>
    fn(req, res).catch((error: unknown) => {
      if (error instanceof StudioNotInstalledError) {
        return res.status(503).json({ success: false, message: error.message, studio_installed: false });
      }
      // A validation failure from the service layer is the user's mistake, not the server's, and
      // its message is written to be read by the person who made it. Anything without a message
      // falls through to the error handler.
      if (error instanceof Error && error.message) {
        return res.status(400).json({ success: false, message: error.message });
      }
      return next(error);
    });

router.use(requireAuth);

// ─── Capability + help ───────────────────────────────────────────────────────────────────────

/**
 * Whether the Studio schema is installed. The UI calls this first so it can show an actionable
 * message instead of a page of failed requests when migrations are pending.
 */
router.get(
  '/capability',
  h(async (_req, res) => {
    const capability = await getStudioCapability();
    res.json({ success: true, data: capability });
  }),
);

/** Function catalogue and guidance for the formula editor, straight from the engine. */
router.get(
  '/formula-help',
  h(async (_req, res) => {
    res.json({ success: true, data: getFormulaHelp() });
  }),
);

/**
 * Validates a formula as it is typed. No database write, no side effect, so it is available to any
 * authenticated user rather than gated — a team leader reading a definition benefits from the same
 * explanation of why it is or is not valid.
 */
router.post(
  '/validate-formula',
  h(async (req, res) => {
    const expression = typeof req.body?.formula === 'string' ? req.body.formula : '';
    let allowed: string[] | undefined;

    const sourceIds = [
      req.body?.data_source_id,
      ...(Array.isArray(req.body?.extra_source_ids) ? req.body.extra_source_ids : []),
    ].filter((value): value is string => typeof value === 'string' && Boolean(value));
    if (sourceIds.length) {
      const fieldSets = await Promise.all(
        [...new Set(sourceIds)].map(async (sourceId) => {
          const source = await getDataSourceWithFields(sourceId);
          return ((source?.fields ?? []) as any[]).map((field) => String(field.field_name));
        }),
      );
      allowed = [...new Set(fieldSets.flat())];
    }

    res.json({ success: true, data: validateFormula(expression, allowed) });
  }),
);

// ─── Pickers ─────────────────────────────────────────────────────────────────────────────────

router.get(
  '/scope-options',
  requireRole(...VIEW_ROLES),
  h(async (_req, res) => {
    res.json({ success: true, data: await getScopeOptions() });
  }),
);

router.get(
  '/employees',
  requireRole(...VIEW_ROLES),
  h(async (req, res) => {
    const rows = await findEmployeesForScope({
      search: req.query.search ? String(req.query.search) : undefined,
      branch_id: req.query.branch_id ? String(req.query.branch_id) : undefined,
      process_id: req.query.process_id ? String(req.query.process_id) : undefined,
      designation_id: req.query.designation_id ? String(req.query.designation_id) : undefined,
    });
    res.json({ success: true, data: rows });
  }),
);

/** Every KPI available to configure, with whether it currently receives any data. */
router.get(
  '/metrics',
  requireRole(...VIEW_ROLES),
  h(async (_req, res) => {
    const [rows] = await db.execute<RowDataPacket[]>(
      `SELECT m.id, m.metric_code, m.metric_name, m.category, m.family, m.unit, m.direction,
              m.scoring_type, m.aggregation_method,
              COALESCE(a.n, 0) AS actual_rows
         FROM kpi_metric_master m
         LEFT JOIN (SELECT metric_id, COUNT(*) AS n FROM kpi_daily_actual GROUP BY metric_id) a
                ON a.metric_id = m.id
        WHERE m.active_status = 1
        ORDER BY m.category, m.metric_name`,
    );
    res.json({ success: true, data: rows });
  }),
);

/** Builds a brand-new KPI. */
router.post(
  '/metrics',
  requireRole(...CONFIG_ROLES),
  h(async (req, res) => {
    const result = await createMetric(req.body ?? {});
    res.json({ success: true, data: result });
  }),
);

// ─── Data sources ────────────────────────────────────────────────────────────────────────────

router.get(
  '/data-sources',
  requireRole(...VIEW_ROLES),
  h(async (_req, res) => {
    res.json({ success: true, data: await listDataSources() });
  }),
);

router.get(
  '/data-sources/:id',
  requireRole(...VIEW_ROLES),
  h(async (req, res) => {
    const source = await getDataSourceWithFields(req.params.id);
    if (!source) return res.status(404).json({ success: false, message: 'Data source not found' });
    res.json({ success: true, data: source });
  }),
);

router.post(
  '/data-sources',
  requireRole(...CONFIG_ROLES),
  h(async (req, res) => {
    const result = await saveDataSource(req.body ?? {}, req.authUser?.id);
    res.json({ success: true, data: result });
  }),
);

/**
 * Columns the source table actually has, so the field builder offers real choices instead of a
 * free-text box that is only validated once data fails to arrive.
 */
router.get(
  '/data-sources/:id/columns',
  requireRole(...CONFIG_ROLES),
  h(async (req, res) => {
    const source = await getDataSourceWithFields(req.params.id);
    if (!source) return res.status(404).json({ success: false, message: 'Data source not found' });
    res.json({ success: true, data: await introspectSourceColumns(source as any) });
  }),
);

router.post(
  '/data-sources/:id/fields',
  requireRole(...CONFIG_ROLES),
  h(async (req, res) => {
    const result = await saveSourceField({ ...(req.body ?? {}), data_source_id: req.params.id });
    res.json({ success: true, data: result });
  }),
);

router.delete(
  '/fields/:fieldId',
  requireRole(...CONFIG_ROLES),
  h(async (req, res) => {
    res.json({ success: true, data: await deleteSourceField(req.params.fieldId) });
  }),
);

// ─── Definitions ─────────────────────────────────────────────────────────────────────────────

router.get(
  '/definitions',
  requireRole(...VIEW_ROLES),
  h(async (req, res) => {
    const rows = await listDefinitions({
      metric_id: req.query.metric_id ? String(req.query.metric_id) : undefined,
      branch_id: req.query.branch_id ? String(req.query.branch_id) : undefined,
      process_id: req.query.process_id ? String(req.query.process_id) : undefined,
      designation_id: req.query.designation_id ? String(req.query.designation_id) : undefined,
      employee_id: req.query.employee_id ? String(req.query.employee_id) : undefined,
      as_of: req.query.as_of ? String(req.query.as_of) : undefined,
    });
    res.json({ success: true, data: rows });
  }),
);

/**
 * Dry-run validation, so the builder can show whether Save will succeed before it is pressed. Runs
 * the identical validateDefinition the write path runs, so the two cannot disagree.
 */
router.post(
  '/definitions/validate',
  requireRole(...CONFIG_ROLES),
  h(async (req, res) => {
    const body = req.body ?? {};
    // The union across every source the definition reads, so a multi-source formula is validated
    // against the fields it can actually see rather than only the primary source's.
    const sourceIds = [
      body.data_source_id,
      ...(Array.isArray(body.extra_source_ids) ? body.extra_source_ids : []),
    ].filter(Boolean);
    const fieldSets = await Promise.all(
      [...new Set(sourceIds.map(String))].map(async (sourceId) => {
        const source = await getDataSourceWithFields(sourceId);
        return ((source?.fields ?? []) as any[]).map((field) => String(field.field_name));
      }),
    );
    const availableFields = [...new Set(fieldSets.flat())];
    let metric: { unit?: string | null; direction?: string | null } | null = null;
    if (body.metric_id) {
      const [rows] = await db.execute<RowDataPacket[]>(
        `SELECT unit, direction FROM kpi_metric_master WHERE id = ? LIMIT 1`,
        [String(body.metric_id)],
      );
      metric = (rows as any[])[0] ?? null;
    }
    res.json({ success: true, data: validateDefinition(body, { availableFields, metric }) });
  }),
);

router.post(
  '/definitions',
  requireRole(...CONFIG_ROLES),
  h(async (req, res) => {
    const result = await saveDefinition(req.body ?? {}, req.authUser?.id);
    res.json({ success: true, data: result });
  }),
);

/** How many employees a definition applies to. Shown before an edit is confirmed. */
router.get(
  '/definitions/:id/coverage',
  requireRole(...VIEW_ROLES),
  h(async (req, res) => {
    res.json({ success: true, data: await getDefinitionCoverage(req.params.id) });
  }),
);

router.delete(
  '/definitions/:id',
  requireRole(...CONFIG_ROLES),
  h(async (req, res) => {
    const effectiveTo = req.query.effective_to ? String(req.query.effective_to) : undefined;
    res.json({ success: true, data: await retireDefinition(req.params.id, effectiveTo) });
  }),
);

/** What a given employee actually resolves to. The answer to "why is this person measured this way". */
router.get(
  '/resolved/:employeeId',
  requireRole(...VIEW_ROLES),
  h(async (req, res) => {
    const asOf = req.query.as_of ? String(req.query.as_of) : undefined;
    res.json({ success: true, data: await resolveStudioForEmployee(req.params.employeeId, asOf) });
  }),
);

// ─── Preview and compute ─────────────────────────────────────────────────────────────────────

/**
 * Evaluates a formula against one real employee on one real date without saving.
 *
 * The single most important endpoint for making this usable by a non-developer: it returns the
 * actual field values that were read alongside the result, so a wrong formula is obvious
 * immediately rather than after it has produced nulls for 200 people.
 */
router.post(
  '/preview',
  requireRole(...CONFIG_ROLES),
  h(async (req, res) => {
    const body = req.body ?? {};
    if (!body.formula || !body.data_source_id || !body.employee_id) {
      return res.status(400).json({
        success: false,
        message: 'Need a formula, a data source and an employee to test against',
      });
    }
    const result = await previewFormula({
      formula: String(body.formula),
      dataSourceId: String(body.data_source_id),
      extraSourceIds: Array.isArray(body.extra_source_ids) ? body.extra_source_ids.map(String) : undefined,
      employeeId: String(body.employee_id),
      date: String(body.date ?? new Date().toISOString().slice(0, 10)),
    });
    res.json({ success: true, data: result });
  }),
);

/**
 * Runs the computation for a day.
 *
 * dryRun defaults to FALSE only when explicitly asked, because this writes to kpi_daily_actual —
 * the table every KPI surface reads — and an accidental full-company run is a change to everyone's
 * scores. The UI always previews first.
 */
router.post(
  '/compute',
  requireRole('admin', 'hr', 'process_manager'),
  h(async (req, res) => {
    const body = req.body ?? {};
    const date = String(body.date ?? new Date().toISOString().slice(0, 10));
    const result = await computeStudioKpis({
      date,
      processId: body.process_id ? String(body.process_id) : undefined,
      branchId: body.branch_id ? String(body.branch_id) : undefined,
      employeeIds: Array.isArray(body.employee_ids) ? body.employee_ids.map(String) : undefined,
      dryRun: body.dry_run === true,
      limit: body.limit ? Number(body.limit) : undefined,
    });
    res.json({ success: true, data: result });
  }),
);

// ─── Manual entry and upload ─────────────────────────────────────────────────────────────────

router.post(
  '/manual-value',
  requireRole(...CONFIG_ROLES),
  h(async (req, res) => {
    const body = req.body ?? {};
    if (!body.employee_id || !body.field_name || !body.value_date) {
      return res.status(400).json({ success: false, message: 'Need an employee, a field and a date' });
    }
    const raw = body.value;
    const value = raw === null || raw === undefined || raw === '' ? null : Number(raw);
    if (value !== null && !Number.isFinite(value)) {
      return res.status(400).json({ success: false, message: 'Value must be a number or blank' });
    }
    await saveManualValue({
      dataSourceId: body.data_source_id ? String(body.data_source_id) : null,
      employeeId: String(body.employee_id),
      fieldName: String(body.field_name),
      valueDate: String(body.value_date),
      value,
      note: body.note ? String(body.note) : null,
      userId: req.authUser?.id,
    });
    res.json({ success: true });
  }),
);

/**
 * Parses an upload and returns a preview: headers, a suggested column mapping, and sample rows.
 *
 * Nothing is stored. The mapping is a SUGGESTION the user confirms — auto-mapping and committing in
 * one step is how a column lands in the wrong field and nobody notices until a rating is wrong.
 */
router.post(
  '/upload/preview',
  requireRole(...CONFIG_ROLES),
  upload.single('file'),
  h(async (req, res) => {
    const file = (req as any).file as { buffer: Buffer; originalname: string } | undefined;
    if (!file) return res.status(400).json({ success: false, message: 'No file was uploaded' });

    const dataSourceId = String((req.body as any)?.data_source_id ?? '');
    if (!dataSourceId) return res.status(400).json({ success: false, message: 'Choose a data source for this upload' });

    const source = await getDataSourceWithFields(dataSourceId);
    if (!source) return res.status(404).json({ success: false, message: 'Data source not found' });

    const parsed = await parseUploadBuffer(file.buffer, file.originalname);
    const fields = (source.fields ?? []) as Array<{ field_name: string; display_name?: string | null }>;

    res.json({
      success: true,
      data: {
        file_name: file.originalname,
        headers: parsed.headers,
        row_count: parsed.rows.length,
        suggested_mapping: suggestColumnMapping(parsed.headers, fields),
        fields: fields.map((field) => field.field_name),
        sample_rows: parsed.rows.slice(0, 5),
      },
    });
  }),
);

/**
 * Validates and stores an upload.
 *
 * `dry_run` runs the identical validation the commit runs and reports what would happen, so the
 * confirmation screen cannot disagree with the outcome.
 */
router.post(
  '/upload/commit',
  requireRole(...CONFIG_ROLES),
  upload.single('file'),
  h(async (req, res) => {
    const file = (req as any).file as { buffer: Buffer; originalname: string } | undefined;
    if (!file) return res.status(400).json({ success: false, message: 'No file was uploaded' });

    const body = (req.body ?? {}) as Record<string, string>;
    const dataSourceId = String(body.data_source_id ?? '');
    const employeeColumn = String(body.employee_column ?? '');
    const dateColumn = String(body.date_column ?? '');
    if (!dataSourceId || !employeeColumn || !dateColumn) {
      return res.status(400).json({
        success: false,
        message: 'Need a data source, and which columns hold the employee code and the date',
      });
    }

    let columnMapping: Record<string, string>;
    try {
      columnMapping = JSON.parse(String(body.column_mapping ?? '{}'));
    } catch {
      return res.status(400).json({ success: false, message: 'Column mapping is not valid JSON' });
    }

    const parsed = await parseUploadBuffer(file.buffer, file.originalname);
    const result = await commitUploadRows({
      dataSourceId,
      fileName: file.originalname,
      employeeColumn,
      dateColumn,
      columnMapping,
      rows: parsed.rows,
      uploadedBy: req.authUser?.id,
      dryRun: body.dry_run === 'true',
    });
    res.json({ success: true, data: result });
  }),
);

// ─── Root cause ──────────────────────────────────────────────────────────────────────────────

/**
 * Same scope rule /api/kpi-master/live/:empId enforces, kept deliberately identical: an employee
 * always sees their own explanation; a manager sees anyone in their reporting tree; qa sees within
 * their assigned process. Diverging the two would let someone read the explanation of a KPI whose
 * value they are not allowed to see.
 */
async function canViewEmployeeExplanation(req: AuthenticatedRequest, employeeId: string): Promise<boolean> {
  // Roles come from BOTH places on purpose. `userRoles` is populated by requireRole, and this route
  // deliberately has none — an employee must be able to read their own explanation without holding
  // a privileged role. Reading only `userRoles` here made every role check below silently see an
  // empty list, so HR and managers were refused their own reports and only the self-check passed.
  // requireAuth populates authUser.roles, which is the source that is always present.
  const authRoles = (req.authUser as { roles?: string[] } | undefined)?.roles ?? [];
  const middlewareRoles = (req as AuthenticatedRequest & { userRoles?: string[] }).userRoles ?? [];
  const roles = [...new Set([...authRoles, ...middlewareRoles])];

  if (roles.some((role) => ['super_admin', 'admin', 'hr'].includes(role))) return true;

  const viewer = await getEmployeeForUser(req.authUser!.id);
  if (!viewer) return false;
  if (viewer.id === employeeId) return true;

  if (roles.some((role) => ['manager', 'process_manager', 'team_leader'].includes(role))) {
    const [rows] = await db.execute<RowDataPacket[]>(
      `WITH RECURSIVE reporting_tree AS (
         SELECT id FROM employees WHERE reporting_manager_id = ? AND active_status = 1
         UNION ALL
         SELECT e.id FROM employees e
           JOIN reporting_tree rt ON e.reporting_manager_id = rt.id
          WHERE e.active_status = 1
       )
       SELECT id FROM reporting_tree WHERE id = ? LIMIT 1`,
      [viewer.id, employeeId],
    );
    if ((rows as any[]).length > 0) return true;
  }

  if (roles.includes('qa') || roles.includes('tq_head')) {
    const [rows] = await db.execute<RowDataPacket[]>(
      `SELECT process_id, branch_id FROM employees WHERE id = ? AND active_status = 1 LIMIT 1`,
      [employeeId],
    );
    const target = (rows as any[])[0];
    return Boolean(target?.process_id) &&
      (await hasProcessScope(req.authUser!.id, target.process_id, target.branch_id, 'qa'));
  }

  return false;
}

router.get(
  '/explain/:employeeId/:metricId',
  h(async (req, res) => {
    if (!(await canViewEmployeeExplanation(req, req.params.employeeId))) {
      return res.status(403).json({
        success: false,
        message: 'That employee is outside your reporting or assigned scope',
      });
    }

    const to = req.query.date_to ? String(req.query.date_to) : new Date().toISOString().slice(0, 10);
    const fromDefault = new Date(Date.now() - 29 * 86_400_000).toISOString().slice(0, 10);
    const from = req.query.date_from ? String(req.query.date_from) : fromDefault;

    const explanation = await explainMetricForEmployee(req.params.employeeId, req.params.metricId, from, to);
    if (!explanation) {
      return res.json({
        success: true,
        data: null,
        message: 'No calculation history is recorded for this KPI. It may be fed by an existing sync rather than a Studio formula.',
      });
    }
    res.json({ success: true, data: explanation });
  }),
);

export { router as kpiStudioRouter };
