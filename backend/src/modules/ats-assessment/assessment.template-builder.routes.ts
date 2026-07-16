import { Router, type NextFunction, type Request, type Response } from "express";
import type { AuthenticatedRequest } from "../../middleware/authMiddleware.js";
import { requireRole } from "../../middleware/requireRole.js";
import { assessmentAdminPage } from "./assessment.admin.page.js";
import { assessmentTemplateBuilderPage } from "./assessment.builder.page.js";
import { saveCustomAssessmentTemplate } from "./assessment.template-builder.service.js";

export const assessmentBuilderPublicRouter = Router();
export const assessmentBuilderProtectedRouter = Router();

type AsyncHandler = (req: Request, res: Response) => Promise<unknown>;
const h = (handler: AsyncHandler) => (req: Request, res: Response, next: NextFunction) => {
  void handler(req, res).catch(next);
};

function noStore(res: Response) {
  res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, private");
  res.setHeader("Pragma", "no-cache");
  res.setHeader(
    "Content-Security-Policy",
    "default-src 'self'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; connect-src 'self'; img-src 'self' data:; frame-ancestors 'self'; base-uri 'self'",
  );
}

function enhancedAdminPage() {
  const html = assessmentAdminPage();
  if (html.includes("/api/ats-ext/assessment-template-builder")) return html;
  return html.replace(
    '<button id="syncTemplates" class="btn">Sync Built-in Templates</button>',
    '<a class="btn secondary" href="/api/ats-ext/assessment-template-builder">Create Custom Template</a><button id="syncTemplates" class="btn">Sync Built-in Templates</button>',
  );
}

assessmentBuilderPublicRouter.get("/assessment-admin", (_req, res) => {
  noStore(res);
  return res.type("html").send(enhancedAdminPage());
});

assessmentBuilderPublicRouter.get("/assessment-template-builder", (_req, res) => {
  noStore(res);
  return res.type("html").send(assessmentTemplateBuilderPage());
});

assessmentBuilderProtectedRouter.post(
  "/assessment-admin/templates",
  requireRole("admin", "super_admin", "hr", "recruitment_hr"),
  h(async (req, res) => {
    try {
      const userId = (req as AuthenticatedRequest).authUser?.id;
      if (!userId) {
        return res.status(401).json({
          success: false,
          message: "Authenticated user is required",
          code: "AUTH_REQUIRED",
        });
      }
      const data = await saveCustomAssessmentTemplate(req.body, userId);
      return res.status(201).json({ success: true, data });
    } catch (error) {
      const value = error as { statusCode?: number; code?: string; message?: string };
      const status = Number(value.statusCode ?? 500);
      if (status >= 500) console.error("Assessment template builder error", error);
      return res.status(Number.isFinite(status) ? status : 500).json({
        success: false,
        message: value.message ?? "Unable to save assessment template",
        code: value.code ?? "TEMPLATE_SAVE_FAILED",
      });
    }
  }),
);
