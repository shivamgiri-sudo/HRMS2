import { Router, type NextFunction, type Request, type Response } from 'express';
import { requireAuth } from '../../middleware/authMiddleware.js';
import { requireRole } from '../../middleware/requireRole.js';
import {
  getAvailableModules,
  getModuleAccessList,
  getEmployeesWithAccess,
  grantModuleAccess,
  revokeModuleAccess,
  bulkGrantAccess,
  bulkRevokeAccess,
  hasModuleAccess,
  getEmployeeModules,
  searchEmployees,
} from './super-admin.service.js';

export const superAdminRouter = Router();

interface SuperAdminRequest extends Request {
  authUser?: {
    id: string;
    employee_code?: string;
  };
}

type AsyncHandler = (req: SuperAdminRequest, res: Response) => Promise<unknown>;

const h = (fn: AsyncHandler) => (req: SuperAdminRequest, res: Response, next: NextFunction) => {
  void fn(req, res).catch(next);
};

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Unexpected error';
}

// All routes require authentication and admin role
superAdminRouter.use(requireAuth);
superAdminRouter.use(requireRole('admin'));

// ── 1. Get available modules ──────────────────────────────────────────────────
superAdminRouter.get('/modules', h(async (_req, res) => {
  try {
    const modules = await getAvailableModules();
    return res.json({ success: true, data: modules });
  } catch (error: unknown) {
    return res.status(500).json({ success: false, message: getErrorMessage(error) });
  }
}));

// ── 2. Get module access list ─────────────────────────────────────────────────
superAdminRouter.get('/module-access', h(async (req, res) => {
  try {
    const moduleName = req.query.module_name as string | undefined;
    const accessList = await getModuleAccessList(moduleName);
    return res.json({ success: true, data: accessList });
  } catch (error: unknown) {
    return res.status(500).json({ success: false, message: getErrorMessage(error) });
  }
}));

// ── 3. Get employees with access ──────────────────────────────────────────────
superAdminRouter.get('/employees-with-access', h(async (_req, res) => {
  try {
    const employees = await getEmployeesWithAccess();
    return res.json({ success: true, data: employees });
  } catch (error: unknown) {
    return res.status(500).json({ success: false, message: getErrorMessage(error) });
  }
}));

// ── 4. Grant module access ────────────────────────────────────────────────────
superAdminRouter.post('/grant-access', h(async (req, res) => {
  try {
    const { module_name, employee_code, remarks } = req.body;

    if (!module_name || !employee_code) {
      return res.status(400).json({
        success: false,
        message: 'module_name and employee_code are required',
      });
    }

    const grantedBy = req.authUser!.id;

    await grantModuleAccess(module_name, employee_code, grantedBy, remarks);

    return res.json({
      success: true,
      message: 'Access granted successfully',
    });
  } catch (error: unknown) {
    return res.status(500).json({ success: false, message: getErrorMessage(error) });
  }
}));

// ── 5. Revoke module access ───────────────────────────────────────────────────
superAdminRouter.post('/revoke-access', h(async (req, res) => {
  try {
    const { module_name, employee_code } = req.body;

    if (!module_name || !employee_code) {
      return res.status(400).json({
        success: false,
        message: 'module_name and employee_code are required',
      });
    }

    await revokeModuleAccess(module_name, employee_code);

    return res.json({
      success: true,
      message: 'Access revoked successfully',
    });
  } catch (error: unknown) {
    return res.status(500).json({ success: false, message: getErrorMessage(error) });
  }
}));

// ── 6. Bulk grant access ──────────────────────────────────────────────────────
superAdminRouter.post('/bulk-grant', h(async (req, res) => {
  try {
    const { module_name, employee_codes, remarks } = req.body;

    if (!module_name || !Array.isArray(employee_codes) || employee_codes.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'module_name and employee_codes array are required',
      });
    }

    const grantedBy = req.authUser!.id;

    const result = await bulkGrantAccess(module_name, employee_codes, grantedBy, remarks);

    return res.json({
      success: true,
      message: `Access granted to ${result.granted} employees`,
      data: result,
    });
  } catch (error: unknown) {
    return res.status(500).json({ success: false, message: getErrorMessage(error) });
  }
}));

// ── 7. Bulk revoke access ─────────────────────────────────────────────────────
superAdminRouter.post('/bulk-revoke', h(async (req, res) => {
  try {
    const { module_name, employee_codes } = req.body;

    if (!module_name || !Array.isArray(employee_codes) || employee_codes.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'module_name and employee_codes array are required',
      });
    }

    const result = await bulkRevokeAccess(module_name, employee_codes);

    return res.json({
      success: true,
      message: `Access revoked from ${result.revoked} employees`,
      data: result,
    });
  } catch (error: unknown) {
    return res.status(500).json({ success: false, message: getErrorMessage(error) });
  }
}));

// ── 8. Check module access ────────────────────────────────────────────────────
superAdminRouter.get('/check-access', h(async (req, res) => {
  try {
    const { employee_code, module_name } = req.query;

    if (!employee_code || !module_name) {
      return res.status(400).json({
        success: false,
        message: 'employee_code and module_name are required',
      });
    }

    const hasAccess = await hasModuleAccess(
      employee_code as string,
      module_name as string
    );

    return res.json({
      success: true,
      has_access: hasAccess,
    });
  } catch (error: unknown) {
    return res.status(500).json({ success: false, message: getErrorMessage(error) });
  }
}));

// ── 9. Get employee modules ───────────────────────────────────────────────────
superAdminRouter.get('/employee-modules/:employeeCode', h(async (req, res) => {
  try {
    const { employeeCode } = req.params;
    const modules = await getEmployeeModules(employeeCode);

    return res.json({
      success: true,
      data: modules,
    });
  } catch (error: unknown) {
    return res.status(500).json({ success: false, message: getErrorMessage(error) });
  }
}));

// ── 10. Search employees ──────────────────────────────────────────────────────
superAdminRouter.get('/search-employees', h(async (req, res) => {
  try {
    const query = req.query.q as string;

    if (!query || query.trim().length < 2) {
      return res.status(400).json({
        success: false,
        message: 'Search query must be at least 2 characters',
      });
    }

    const employees = await searchEmployees(query.trim());

    return res.json({
      success: true,
      data: employees,
    });
  } catch (error: unknown) {
    return res.status(500).json({ success: false, message: getErrorMessage(error) });
  }
}));
