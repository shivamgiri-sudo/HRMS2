import type { NextFunction, Request, Response } from "express";
import type { RowDataPacket } from "mysql2";
import { authService } from '../modules/auth/auth.service.js';
import { getUserRoleContext } from '../shared/roleResolver.js';

/** 30-second in-process cache: userId → { primaryRole, isReadOnly, exp }
 *  Cuts the two per-request DB queries to zero for repeat requests within the TTL window.
 *  Cache is invalidated when a user's role or read-only status changes (max 30s stale).
 */
const AUTH_CONTEXT_CACHE = new Map<string, { primaryRole: string | undefined; isReadOnly: boolean; exp: number }>();
const AUTH_CACHE_TTL_MS = 30_000;

function getCachedAuthContext(userId: string) {
  const entry = AUTH_CONTEXT_CACHE.get(userId);
  if (entry && Date.now() < entry.exp) return entry;
  return null;
}

function setCachedAuthContext(userId: string, primaryRole: string | undefined, isReadOnly: boolean) {
  AUTH_CONTEXT_CACHE.set(userId, { primaryRole, isReadOnly, exp: Date.now() + AUTH_CACHE_TTL_MS });
}

export function invalidateAuthContextCache(userId: string) {
  AUTH_CONTEXT_CACHE.delete(userId);
}

export interface AuthenticatedRequest extends Request {
  authUser: {
    id: string;
    email?: string;
    role?: string;
    isDemo?: boolean;
    isReadOnly?: boolean;
  };
  userRoles?: string[];
}

type ReadOnlyRow = RowDataPacket & { is_read_only?: unknown };

// Demo user map: mock-token-{role} → user id, email, and role (matches demoCreds.ts in frontend)
const DEMO_TOKEN_MAP: Record<string, { id: string; email: string; role: string }> = {
  "mock-token-super-admin-role": { id: "demo-super-admin-id", email: "super-admin@mascallnet.com", role: "super_admin" },
  "mock-token-admin":            { id: "demo-admin-id",       email: "admin@mascallnet.com",        role: "admin" },
  "mock-token-hr":               { id: "demo-hr-id",          email: "hr@mascallnet.com",           role: "hr" },
  "mock-token-recruiter":        { id: "demo-recruiter-id",   email: "recruiter@mascallnet.com",    role: "recruiter" },
  "mock-token-process_manager":  { id: "demo-manager-id",     email: "manager@mascallnet.com",      role: "process_manager" },
  "mock-token-team_leader":      { id: "demo-tl-id",          email: "tl@mascallnet.com",           role: "team_leader" },
  "mock-token-qa":               { id: "demo-qa-id",          email: "qa@mascallnet.com",           role: "qa" },
  "mock-token-wfm":              { id: "demo-wfm-id",         email: "wfm@mascallnet.com",          role: "wfm" },
  "mock-token-finance":          { id: "demo-finance-id",     email: "finance@mascallnet.com",      role: "finance" },
  "mock-token-employee":         { id: "demo-employee-id",    email: "employee@mascallnet.com",     role: "employee" },
  "mock-token-ceo":              { id: "demo-ceo-id",         email: "ceo@mascallnet.com",          role: "ceo" },
  "mock-token-trainer":          { id: "demo-trainer-id",     email: "trainer@mascallnet.com",      role: "trainer" },
  // Legacy demo token — lowest privilege
  "mock-token":                  { id: "demo-user-id",        email: "demo@mascallnet.com",         role: "employee" },
};

export async function requireAuth(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
) {
  try {
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return res.status(401).json({
        success: false,
        message: "Missing authorization token"
      });
    }

    const token = authHeader.replace("Bearer ", "").trim();

    // Demo bypass — only when INTERNAL_DEMO_BYPASS=true AND not in production
    if (token.startsWith("mock-token")) {
      const demoBypassEnabled =
        process.env.INTERNAL_DEMO_BYPASS === "true" &&
        process.env.NODE_ENV !== "production";

      if (!demoBypassEnabled) {
        return res.status(401).json({ success: false, message: "Invalid or expired token" });
      }

      // Only accept exact known tokens — reject anything not in the map
      const demo = DEMO_TOKEN_MAP[token];
      if (!demo) {
        return res.status(401).json({ success: false, message: "Invalid or expired token" });
      }

      req.authUser = { id: demo.id, email: demo.email, role: demo.role, isDemo: true };
      return next();
    }

    // Verify MySQL JWT
    const mysqlUser = authService.verifyAccessToken(token);
    if (mysqlUser) {
      // Enforce 2FA gate: pre_auth tokens ONLY reach the 2FA challenge/verify endpoints.
      // Any other route must reject pre_auth tokens so 2FA cannot be bypassed.
      if (mysqlUser.scope === 'pre_auth') {
        const path = req.path ?? '';
        const is2faEndpoint = /^\/2fa\//i.test(path);
        if (!is2faEndpoint) {
          return res.status(401).json({
            success: false,
            message: '2FA verification required',
            twoFactorRequired: true,
          });
        }
      }

      // Resolve primary role and isReadOnly — use 30s in-process cache to avoid 2 DB queries per request
      let resolvedRole: string | undefined;
      let isReadOnly = false;
      const cached = getCachedAuthContext(mysqlUser.id);
      if (cached) {
        resolvedRole = cached.primaryRole;
        isReadOnly = cached.isReadOnly;
      } else {
        try {
          const ctx = await getUserRoleContext(mysqlUser.id);
          resolvedRole = ctx.primaryRole;
        } catch {
          // Non-fatal — role stays undefined; requireRole middleware does its own DB lookup
        }
        try {
          const { db } = await import('../db/mysql.js');
          const [rows] = await db.execute<import('mysql2').RowDataPacket[]>(
            'SELECT is_read_only FROM auth_user WHERE id = ? LIMIT 1',
            [mysqlUser.id]
          );
          isReadOnly = Array.isArray(rows) && rows.length > 0 ? !!(rows[0] as ReadOnlyRow).is_read_only : false;
        } catch { /* keep false */ }
        setCachedAuthContext(mysqlUser.id, resolvedRole, isReadOnly);
      }
      req.authUser = {
        id: mysqlUser.id,
        email: mysqlUser.email,
        role: resolvedRole,
        isReadOnly
      };
      return next();
    }

    // Token is invalid or expired
    return res.status(401).json({ success: false, message: "Invalid or expired token" });
  } catch (error) {
    return next(error);
  }
}

export function requireWriteAccess(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
) {
  const isReadOnly = req.authUser?.isReadOnly || false;

  if (isReadOnly) {
    return res.status(403).json({
      success: false,
      error: 'Write access denied. Your account is in read-only mode.',
      code: 'READ_ONLY_ACCESS'
    });
  }

  next();
}
