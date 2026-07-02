import type { NextFunction, Request, Response } from "express";
import { authService } from '../modules/auth/auth.service.js';
import { getUserRoleContext } from '../shared/roleResolver.js';

export interface AuthenticatedRequest extends Request {
  authUser?: {
    id: string;
    email?: string;
    role?: string;
    isDemo?: boolean;
    isReadOnly?: boolean;
  };
}

// Demo user map: mock-token-{role} → user id (matches demoCreds.ts in frontend)
const DEMO_TOKEN_MAP: Record<string, { id: string; email: string }> = {
  "mock-token-admin":          { id: "demo-admin-id",     email: "admin@mascallnet.com"     },
  "mock-token-hr":             { id: "demo-hr-id",        email: "hr@mascallnet.com"        },
  "mock-token-recruiter":      { id: "demo-recruiter-id", email: "recruiter@mascallnet.com" },
  "mock-token-process_manager":{ id: "demo-manager-id",   email: "manager@mascallnet.com"   },
  "mock-token-team_leader":    { id: "demo-tl-id",        email: "tl@mascallnet.com"        },
  "mock-token-qa":             { id: "demo-qa-id",        email: "qa@mascallnet.com"        },
  "mock-token-wfm":            { id: "demo-wfm-id",       email: "wfm@mascallnet.com"       },
  "mock-token-finance":        { id: "demo-finance-id",   email: "finance@mascallnet.com"   },
  "mock-token-employee":       { id: "demo-employee-id",  email: "employee@mascallnet.com"  },
  "mock-token-ceo":            { id: "demo-ceo-id",       email: "ceo@mascallnet.com"       },
  "mock-token-trainer":        { id: "demo-trainer-id",   email: "trainer@mascallnet.com"   },
  // Super admin demo token (all roles)
  "mock-token-super-admin-role": { id: "demo-super-admin-id", email: "super-admin@mascallnet.com" },
  // Legacy demo token
  "mock-token":                { id: "demo-user-id",      email: "demo@mascallnet.com"      },
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

      req.authUser = { id: demo.id, email: demo.email, isDemo: true };
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

      // Resolve primary role from DB so req.authUser.role is always populated
      let resolvedRole: string | undefined;
      try {
        const ctx = await getUserRoleContext(mysqlUser.id);
        resolvedRole = ctx.primaryRole;
      } catch {
        // Non-fatal — role stays undefined; requireRole middleware does its own DB lookup
      }
      // Load isReadOnly from DB to ensure it's always current (not stale JWT)
      let isReadOnly = false;
      try {
        const { db } = await import('../db/mysql.js');
        const [rows] = await db.execute<import('mysql2').RowDataPacket[]>(
          'SELECT is_read_only FROM auth_user WHERE id = ? LIMIT 1',
          [mysqlUser.id]
        );
        isReadOnly = Array.isArray(rows) && rows.length > 0 ? !!(rows[0] as any).is_read_only : false;
      } catch { /* keep false */ }
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
