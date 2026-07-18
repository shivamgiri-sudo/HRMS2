import { Router } from "express";
import { requireAuth } from "../../middleware/authMiddleware.js";
import { requireRole } from "../../middleware/requireRole.js";
import { selfOrAdminHr } from "../../shared/accessGuard.js";
import { companyPostsController as companyPosts } from "./company-posts.controller.js";
import { engagementController as c } from "./engagement.controller.js";

const router = Router();
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const h = (fn: (req: any, res: any) => Promise<unknown>) => (req: any, res: any, next: any) => fn(req, res).catch(next);

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

router.get("/company-posts/feed", h(companyPosts.listFeed));
router.post("/company-posts", h(companyPosts.create));
router.get("/company-posts/mine", h(companyPosts.listMine));
router.get("/company-posts/approvals", h(companyPosts.listApprovals));
router.post("/company-posts/:id/approve", h(companyPosts.approve));
router.post("/company-posts/:id/reject", h(companyPosts.reject));
router.delete("/company-posts/:id", h(companyPosts.remove));

router.get("/company-post-creators", requireRole("super_admin"), h(companyPosts.listCreators));
router.post("/company-post-creators/:employeeId/grant", requireRole("super_admin"), h(companyPosts.grantCreator));
router.post("/company-post-creators/:employeeId/revoke", requireRole("super_admin"), h(companyPosts.revokeCreator));

export { router as engagementRouter };

