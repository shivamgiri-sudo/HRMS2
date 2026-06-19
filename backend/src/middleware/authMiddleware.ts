import type { NextFunction, Request, Response } from "express";
import { authService } from '../modules/auth/auth.service.js';

export interface AuthenticatedRequest extends Request {
  authUser?: {
    id: string;
    email?: string;
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
      req.authUser = {
        id: mysqlUser.id,
        email: mysqlUser.email,
        isReadOnly: mysqlUser.isReadOnly || false
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
