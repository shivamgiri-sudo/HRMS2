import { Router } from 'express';
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

// All routes require authentication and admin role
superAdminRouter.use(requireAuth);
superAdminRouter.use(requireRole('admin'));

// ── 1. Get available modules ──────────────────────────────────────────────────
superAdminRouter.get('/modules', async (_req, res) => {
  try {
    const modules = await getAvailableModules();
    return res.json({ success: true, data: modules });
  } catch (error: any) {
    return res.status(500).json({ success: false, message: error.message });
  }
});

// ── 2. Get module access list ─────────────────────────────────────────────────
superAdminRouter.get('/module-access', async (req, res) => {
  try {
    const moduleName = req.query.module_name as string | undefined;
    const accessList = await getModuleAccessList(moduleName);
    return res.json({ success: true, data: accessList });
  } catch (error: any) {
    return res.status(500).json({ success: false, message: error.message });
  }
});

// ── 3. Get employees with access ──────────────────────────────────────────────
superAdminRouter.get('/employees-with-access', async (_req, res) => {
  try {
    const employees = await getEmployeesWithAccess();
    return res.json({ success: true, data: employees });
  } catch (error: any) {
    return res.status(500).json({ success: false, message: error.message });
  }
});

// ── 4. Grant module access ────────────────────────────────────────────────────
superAdminRouter.post('/grant-access', async (req: any, res) => {
  try {
    const { module_name, employee_code, remarks } = req.body;

    if (!module_name || !employee_code) {
      return res.status(400).json({
        success: false,
        message: 'module_name and employee_code are required',
      });
    }

    const grantedBy = req.authUser.employee_code || req.authUser.id;

    await grantModuleAccess(module_name, employee_code, grantedBy, remarks);

    return res.json({
      success: true,
      message: 'Access granted successfully',
    });
  } catch (error: any) {
    return res.status(500).json({ success: false, message: error.message });
  }
});

// ── 5. Revoke module access ───────────────────────────────────────────────────
superAdminRouter.post('/revoke-access', async (req, res) => {
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
  } catch (error: any) {
    return res.status(500).json({ success: false, message: error.message });
  }
});

// ── 6. Bulk grant access ──────────────────────────────────────────────────────
superAdminRouter.post('/bulk-grant', async (req: any, res) => {
  try {
    const { module_name, employee_codes, remarks } = req.body;

    if (!module_name || !Array.isArray(employee_codes) || employee_codes.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'module_name and employee_codes array are required',
      });
    }

    const grantedBy = req.authUser.employee_code || req.authUser.id;

    const result = await bulkGrantAccess(module_name, employee_codes, grantedBy, remarks);

    return res.json({
      success: true,
      message: `Access granted to ${result.granted} employees`,
      data: result,
    });
  } catch (error: any) {
    return res.status(500).json({ success: false, message: error.message });
  }
});

// ── 7. Bulk revoke access ─────────────────────────────────────────────────────
superAdminRouter.post('/bulk-revoke', async (req, res) => {
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
  } catch (error: any) {
    return res.status(500).json({ success: false, message: error.message });
  }
});

// ── 8. Check module access ────────────────────────────────────────────────────
superAdminRouter.get('/check-access', async (req, res) => {
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
  } catch (error: any) {
    return res.status(500).json({ success: false, message: error.message });
  }
});

// ── 9. Get employee modules ───────────────────────────────────────────────────
superAdminRouter.get('/employee-modules/:employeeCode', async (req, res) => {
  try {
    const { employeeCode } = req.params;
    const modules = await getEmployeeModules(employeeCode);

    return res.json({
      success: true,
      data: modules,
    });
  } catch (error: any) {
    return res.status(500).json({ success: false, message: error.message });
  }
});

// ── 10. Search employees ──────────────────────────────────────────────────────
superAdminRouter.get('/search-employees', async (req, res) => {
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
  } catch (error: any) {
    return res.status(500).json({ success: false, message: error.message });
  }
});
