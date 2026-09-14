import { Router } from "express";
import type { Response } from "express";
import { requireAuth, type AuthenticatedRequest } from "../../middleware/authMiddleware.js";
import { requireRole } from "../../middleware/requireRole.js";
import {
  listClients,
  getClient,
  createClient,
  updateClient,
  toggleClientStatus,
  updateClientSubscriptionStatus,
  getClientStats,
  getClientUsageSummary,
  createBulkJob,
  updateBulkJobProgress,
  getBulkJobs,
  type CreateClientInput
} from "./client.service.js";
import {
  getEnhancedPortalUser,
  listEnhancedPortalUsers,
  updatePortalUser,
  deactivatePortalUser,
  reactivatePortalUser,
  logPortalUserActivity,
  getPortalUserActivity,
  getRecentLogins,
  updateLastLogin,
  grantPermission,
  revokePermission,
  getUserPermissions,
  getUserActivitySummary,
  type UpdatePortalUserInput
} from "./enhanced-portal-user.service.js";

const router = Router();

// Error handler wrapper
const h = (fn: (req: AuthenticatedRequest, res: Response) => Promise<any>) =>
  (req: AuthenticatedRequest, res: Response, next: any) =>
    fn(req, res).catch(next);

// All routes require authentication
router.use(requireAuth);

// ============================================================
// CLIENT MANAGEMENT ROUTES (Admin/HR only)
// ============================================================

/**
 * GET /api/clients
 * List all clients with optional filters
 * Query params: active_only, subscription_status, search
 */
router.get("/clients", requireRole("admin", "hr"), h(async (req: AuthenticatedRequest, res: Response) => {
  const { active_only, subscription_status, search } = req.query;

  const clients = await listClients({
    active_only: active_only === "true",
    subscription_status: subscription_status as string,
    search: search as string
  });

  return res.json({ success: true, data: clients });
}));

/**
 * POST /api/clients
 * Create a new client
 */
router.post("/clients", requireRole("admin", "hr"), h(async (req: AuthenticatedRequest, res: Response) => {
  const clientData: CreateClientInput = req.body;

  if (!clientData.client_code || !clientData.client_name) {
    return res.status(400).json({
      success: false,
      message: "client_code and client_name are required"
    });
  }

  const client = await createClient(clientData, req.authUser!.id);

  return res.status(201).json({
    success: true,
    data: client,
    message: "Client created successfully"
  });
}));

/**
 * GET /api/clients/:id
 * Get client details by ID
 */
router.get("/clients/:id", requireRole("admin", "hr"), h(async (req: AuthenticatedRequest, res: Response) => {
  const client = await getClient(req.params.id);

  if (!client) {
    return res.status(404).json({
      success: false,
      message: "Client not found"
    });
  }

  return res.json({ success: true, data: client });
}));

/**
 * PUT /api/clients/:id
 * Update client details
 */
router.put("/clients/:id", requireRole("admin", "hr"), h(async (req: AuthenticatedRequest, res: Response) => {
  const client = await getClient(req.params.id);

  if (!client) {
    return res.status(404).json({
      success: false,
      message: "Client not found"
    });
  }

  await updateClient(req.params.id, req.body);

  return res.json({
    success: true,
    message: "Client updated successfully"
  });
}));

/**
 * PATCH /api/clients/:id/status
 * Toggle client active status
 */
router.patch("/clients/:id/status", requireRole("admin"), h(async (req: AuthenticatedRequest, res: Response) => {
  const { active_status } = req.body;

  if (typeof active_status !== "boolean") {
    return res.status(400).json({
      success: false,
      message: "active_status must be a boolean"
    });
  }

  await toggleClientStatus(req.params.id, active_status);

  return res.json({
    success: true,
    message: `Client ${active_status ? "activated" : "deactivated"} successfully`
  });
}));

/**
 * PATCH /api/clients/:id/subscription
 * Update client subscription status
 */
router.patch("/clients/:id/subscription", requireRole("admin"), h(async (req: AuthenticatedRequest, res: Response) => {
  const { subscription_status } = req.body;

  const validStatuses = ["ACTIVE", "SUSPENDED", "TRIAL", "EXPIRED"];
  if (!validStatuses.includes(subscription_status)) {
    return res.status(400).json({
      success: false,
      message: `subscription_status must be one of: ${validStatuses.join(", ")}`
    });
  }

  await updateClientSubscriptionStatus(req.params.id, subscription_status);

  return res.json({
    success: true,
    message: "Subscription status updated successfully"
  });
}));

/**
 * GET /api/clients/stats/overview
 * Get overall client statistics
 */
router.get("/clients-stats", requireRole("admin", "hr"), h(async (req: AuthenticatedRequest, res: Response) => {
  const stats = await getClientStats();

  return res.json({ success: true, data: stats });
}));

/**
 * GET /api/clients/usage/summary
 * Get client usage summary
 * Query params: days (default: 30)
 */
router.get("/clients-usage", requireRole("admin", "hr"), h(async (req: AuthenticatedRequest, res: Response) => {
  const days = parseInt(req.query.days as string) || 30;
  const summary = await getClientUsageSummary(days);

  return res.json({ success: true, data: summary });
}));

// ============================================================
// ENHANCED PORTAL USER MANAGEMENT ROUTES
// ============================================================

/**
 * GET /api/portal-users
 * List portal users with filters
 * Query params: client_id, active_only, access_level, search
 */
router.get("/portal-users", requireRole("admin", "hr"), h(async (req: AuthenticatedRequest, res: Response) => {
  const { client_id, active_only, access_level, search } = req.query;

  const users = await listEnhancedPortalUsers({
    client_id: client_id as string,
    active_only: active_only === "true",
    access_level: access_level as string,
    search: search as string
  });

  return res.json({ success: true, data: users });
}));

/**
 * GET /api/portal-users/:id
 * Get portal user details
 */
router.get("/portal-users/:id", requireRole("admin", "hr"), h(async (req: AuthenticatedRequest, res: Response) => {
  const user = await getEnhancedPortalUser(req.params.id);

  if (!user) {
    return res.status(404).json({
      success: false,
      message: "Portal user not found"
    });
  }

  return res.json({ success: true, data: user });
}));

/**
 * PUT /api/portal-users/:id
 * Update portal user details
 */
router.put("/portal-users/:id", requireRole("admin", "hr"), h(async (req: AuthenticatedRequest, res: Response) => {
  const user = await getEnhancedPortalUser(req.params.id);

  if (!user) {
    return res.status(404).json({
      success: false,
      message: "Portal user not found"
    });
  }

  const updateData: UpdatePortalUserInput = req.body;
  await updatePortalUser(req.params.id, updateData);

  return res.json({
    success: true,
    message: "Portal user updated successfully"
  });
}));

/**
 * POST /api/portal-users/:id/deactivate
 * Deactivate portal user
 */
router.post("/portal-users/:id/deactivate", requireRole("admin", "hr"), h(async (req: AuthenticatedRequest, res: Response) => {
  const { reason } = req.body;

  await deactivatePortalUser(req.params.id, req.authUser!.id, reason);

  return res.json({
    success: true,
    message: "Portal user deactivated successfully"
  });
}));

/**
 * POST /api/portal-users/:id/reactivate
 * Reactivate portal user
 */
router.post("/portal-users/:id/reactivate", requireRole("admin", "hr"), h(async (req: AuthenticatedRequest, res: Response) => {
  await reactivatePortalUser(req.params.id);

  return res.json({
    success: true,
    message: "Portal user reactivated successfully"
  });
}));

/**
 * GET /api/portal-users/:id/activity
 * Get user activity log
 * Query params: limit (default: 100), action_type
 */
router.get("/portal-users/:id/activity", requireRole("admin", "hr"), h(async (req: AuthenticatedRequest, res: Response) => {
  const limit = parseInt(req.query.limit as string) || 100;
  const actionType = req.query.action_type as string;

  const activities = await getPortalUserActivity(req.params.id, limit, actionType);

  return res.json({ success: true, data: activities });
}));

/**
 * GET /api/portal-users/:id/logins
 * Get recent login history
 * Query params: limit (default: 20)
 */
router.get("/portal-users/:id/logins", requireRole("admin", "hr"), h(async (req: AuthenticatedRequest, res: Response) => {
  const limit = parseInt(req.query.limit as string) || 20;
  const logins = await getRecentLogins(req.params.id, limit);

  return res.json({ success: true, data: logins });
}));

/**
 * POST /api/portal-users/:id/log-activity
 * Manually log user activity (for testing/admin purposes)
 */
router.post("/portal-users/:id/log-activity", requireRole("admin"), h(async (req: AuthenticatedRequest, res: Response) => {
  const { action_type, resource_type, resource_id, metadata } = req.body;

  if (!action_type) {
    return res.status(400).json({
      success: false,
      message: "action_type is required"
    });
  }

  await logPortalUserActivity({
    user_id: req.params.id,
    action_type,
    resource_type,
    resource_id,
    ip_address: req.ip,
    user_agent: req.headers["user-agent"],
    metadata
  });

  return res.json({
    success: true,
    message: "Activity logged successfully"
  });
}));

// ============================================================
// PERMISSION MANAGEMENT ROUTES
// ============================================================

/**
 * GET /api/portal-users/:id/permissions
 * Get user permissions
 */
router.get("/portal-users/:id/permissions", requireRole("admin", "hr"), h(async (req: AuthenticatedRequest, res: Response) => {
  const permissions = await getUserPermissions(req.params.id);

  return res.json({ success: true, data: permissions });
}));

/**
 * POST /api/portal-users/:id/permissions
 * Grant permission to user
 */
router.post("/portal-users/:id/permissions", requireRole("admin"), h(async (req: AuthenticatedRequest, res: Response) => {
  const { permission_type, resource_scope, resource_ids, expires_at } = req.body;

  if (!permission_type || !resource_scope) {
    return res.status(400).json({
      success: false,
      message: "permission_type and resource_scope are required"
    });
  }

  await grantPermission({
    user_id: req.params.id,
    permission_type,
    resource_scope,
    resource_ids,
    granted_by: req.authUser!.id,
    expires_at: expires_at ? new Date(expires_at) : undefined
  });

  return res.json({
    success: true,
    message: "Permission granted successfully"
  });
}));

/**
 * DELETE /api/portal-users/:id/permissions/:permissionType
 * Revoke permission from user
 */
router.delete("/portal-users/:id/permissions/:permissionType", requireRole("admin"), h(async (req: AuthenticatedRequest, res: Response) => {
  await revokePermission(req.params.id, req.params.permissionType);

  return res.json({
    success: true,
    message: "Permission revoked successfully"
  });
}));

// ============================================================
// ANALYTICS ROUTES
// ============================================================

/**
 * GET /api/analytics/user-activity
 * Get user activity summary
 * Query params: client_id, days (default: 30)
 */
router.get("/analytics/user-activity", requireRole("admin", "hr"), h(async (req: AuthenticatedRequest, res: Response) => {
  const clientId = req.query.client_id as string;
  const days = parseInt(req.query.days as string) || 30;

  const summary = await getUserActivitySummary(clientId, days);

  return res.json({ success: true, data: summary });
}));

// ============================================================
// BULK OPERATIONS ROUTES
// ============================================================

/**
 * GET /api/bulk/jobs
 * List bulk operation jobs
 * Query params: limit (default: 50)
 */
router.get("/bulk/jobs", requireRole("admin", "hr"), h(async (req: AuthenticatedRequest, res: Response) => {
  const limit = parseInt(req.query.limit as string) || 50;
  const jobs = await getBulkJobs(limit);

  return res.json({ success: true, data: jobs });
}));

/**
 * POST /api/bulk/jobs
 * Create a new bulk operation job
 */
router.post("/bulk/jobs", requireRole("admin", "hr"), h(async (req: AuthenticatedRequest, res: Response) => {
  const { job_type, entity_type, total_records, file_url } = req.body;

  if (!job_type || !entity_type || !total_records) {
    return res.status(400).json({
      success: false,
      message: "job_type, entity_type, and total_records are required"
    });
  }

  const jobId = await createBulkJob(
    job_type,
    entity_type,
    total_records,
    req.authUser!.id,
    file_url
  );

  return res.status(201).json({
    success: true,
    data: { job_id: jobId },
    message: "Bulk job created successfully"
  });
}));

/**
 * PATCH /api/bulk/jobs/:id/progress
 * Update bulk job progress
 */
router.patch("/bulk/jobs/:id/progress", requireRole("admin", "hr"), h(async (req: AuthenticatedRequest, res: Response) => {
  const { processed, success, errors, error_log } = req.body;

  if (typeof processed !== "number" || typeof success !== "number" || typeof errors !== "number") {
    return res.status(400).json({
      success: false,
      message: "processed, success, and errors must be numbers"
    });
  }

  await updateBulkJobProgress(req.params.id, processed, success, errors, error_log);

  return res.json({
    success: true,
    message: "Job progress updated successfully"
  });
}));

export { router as clientRouter };
