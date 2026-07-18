import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type { Response } from "express";
import { Router } from "express";
import multer from "multer";
import { requireAuth } from "../../middleware/authMiddleware.js";
import type { AuthenticatedRequest } from "../../middleware/authMiddleware.js";
import { requireRole } from "../../middleware/requireRole.js";
import { selfOrAdminHr } from "../../shared/accessGuard.js";
import { registerUpload } from "../document-vault/documentVault.service.js";
import { UPLOADS_ROOT } from "../files/files.routes.js";
import { assertCanCreateCompanyPost } from "./company-posts.service.js";
import { companyPostsController as companyPosts } from "./company-posts.controller.js";
import { engagementController as c } from "./engagement.controller.js";

const router = Router();
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const h = (fn: (req: any, res: any) => Promise<unknown>) => (req: any, res: any, next: any) => fn(req, res).catch(next);

const COMPANY_FEED_CATEGORY = "company-feed";
const companyFeedUploadStorage = multer.diskStorage({
  destination: (_req, _file, cb) => {
    const dir = path.join(UPLOADS_ROOT, COMPANY_FEED_CATEGORY);
    fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    cb(null, `${randomUUID()}${ext}`);
  },
});

const companyFeedUpload = multer({
  storage: companyFeedUploadStorage,
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    if ([".jpg", ".jpeg", ".png", ".webp"].includes(ext)) {
      cb(null, true);
      return;
    }
    cb(new Error(`File type ${ext} not allowed. Allowed: .jpg, .jpeg, .png, .webp`));
  },
});

async function requireCompanyPostCreator(
  req: AuthenticatedRequest,
  res: Response,
  next: () => void,
) {
  try {
    const userId = req.authUser?.id ?? "";
    await assertCanCreateCompanyPost(userId);
    next();
  } catch (error) {
    const message = error instanceof Error ? error.message : "Company post creator access is required";
    return res.status(403).json({ success: false, message });
  }
}

router.use(requireAuth);

router.get("/me", h(c.getMySummary));
router.get("/badges", h(c.listBadges));
router.post("/badges/award", requireRole("admin", "hr", "super_admin", "payroll_hr", "process_manager", "team_leader", "manager"), h(c.awardBadge));
router.get("/badges/:employeeId", selfOrAdminHr("employeeId"), h(c.getEmployeeBadges));

router.get("/leaderboard", h(c.getLeaderboard));
router.post("/points/adjust", requireRole("admin", "hr"), h(c.adjustPoints));
router.get("/points/:employeeId", selfOrAdminHr("employeeId"), h(c.getPoints));
router.get("/tiers", h(c.listTiers));
router.get("/tiers/:employeeId", selfOrAdminHr("employeeId"), h(c.getEmployeeTier));

router.get("/kudos/templates", h(c.listKudosTemplates));
router.get("/kudos/limit/me", h(c.getMyKudosLimit));
router.get("/kudos/wall", h(c.listKudos));
router.post("/kudos", h(c.sendKudos));
router.get("/kudos/:employeeId", selfOrAdminHr("employeeId"), h(c.listKudos));

router.get("/surveys", h(c.listSurveys));
router.post("/surveys", requireRole("admin", "hr"), h(c.createSurvey));
router.get("/surveys/:id/results", requireRole("admin", "hr"), h(c.getSurveyResults));
router.get("/surveys/:id/enps/:questionId", requireRole("admin", "hr"), h(c.getENPS));
router.get("/surveys/:id", h(c.getSurvey));
router.post("/surveys/:id/respond", h(c.submitSurvey));

router.get("/pulse/me", h(c.getMyPulseChecks));
router.get("/pulse/summary", requireRole("admin", "hr"), h(c.getPulseSummary));
router.post("/pulse", h(c.submitPulse));

router.post(
  "/company-posts/upload",
  requireCompanyPostCreator,
  (req: any, res: any, next: any) => {
    companyFeedUpload.single("file")(req, res, (err) => {
      if (err instanceof multer.MulterError) {
        return res.status(400).json({ success: false, message: `Upload error: ${err.message}` });
      }
      if (err) {
        return res.status(400).json({ success: false, message: err.message });
      }
      next();
    });
  },
  h(async (req: AuthenticatedRequest, res: Response) => {
    if (!req.file) {
      return res.status(400).json({ success: false, message: "No image uploaded or file type not allowed" });
    }

    try {
      await registerUpload({
        uploadedByUser: req.authUser!.id,
        category: COMPANY_FEED_CATEGORY,
        storedFilename: req.file.filename,
        originalFilename: req.file.originalname,
        mimeType: req.file.mimetype,
        fileSizeBytes: req.file.size,
        accessLevel: "internal",
        ownerEmployeeId: req.body?.ownerEmployeeId ?? undefined,
      });
    } catch (vaultErr) {
      console.error("[documentVault] Failed to register company feed upload:", vaultErr);
    }

    return res.status(201).json({
      success: true,
      data: {
        file_id: req.file.filename,
        url: `/api/files/${COMPANY_FEED_CATEGORY}/${req.file.filename}`,
        original_name: req.file.originalname,
        mime_type: req.file.mimetype,
        size: req.file.size,
      },
    });
  }),
);

router.get("/company-posts/feed", h(companyPosts.listFeed));
router.post("/company-posts", h(companyPosts.create));
router.get("/company-posts/mine", h(companyPosts.listMine));
router.get("/company-posts/approvals", h(companyPosts.listApprovals));
router.get("/company-posts/manage", h(companyPosts.listManage));
router.post("/company-posts/:id/approve", h(companyPosts.approve));
router.post("/company-posts/:id/reject", h(companyPosts.reject));
router.delete("/company-posts/:id", h(companyPosts.remove));

router.get("/company-post-creators", requireRole("super_admin"), h(companyPosts.listCreators));
router.post("/company-post-creators/:employeeId/grant", requireRole("super_admin"), h(companyPosts.grantCreator));
router.post("/company-post-creators/:employeeId/revoke", requireRole("super_admin"), h(companyPosts.revokeCreator));

export { router as engagementRouter };

