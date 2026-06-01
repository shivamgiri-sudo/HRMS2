import { Router } from "express";
import { requireAuth } from "../../middleware/authMiddleware.js";
import { employeeController as c } from "./employee.controller.js";
import { appendJourneyEvent, listJourneyEvents } from "./journeyLog.service.js";

const router = Router();
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const h = (fn: (req: any, res: any) => Promise<unknown>) => (req: any, res: any, next: any) => fn(req, res).catch(next);

router.use(requireAuth);

// GET /api/employees/me — returns the employee record for the logged-in user
router.get("/me", h(async (req: any, res: any) => {
  const userId = req.authUser?.id;
  if (!userId) return res.status(401).json({ success: false, error: "Unauthorized" });
  const { db } = await import("../../db/mysql.js");
  const [rows] = await db.execute(
    "SELECT * FROM employees WHERE user_id = ? AND active_status = 1 LIMIT 1",
    [userId]
  ) as any[];
  if (!rows.length) return res.status(404).json({ success: false, error: "No employee record for this user" });
  return res.json({ success: true, data: rows[0] });
}));

router.get("/", h(c.listEmployees));
router.post("/", h(c.createEmployee));
router.get("/:id", h(c.getEmployee));
router.patch("/:id", h(c.updateEmployee));
router.delete("/:id", h(c.deactivateEmployee));

// Journey log
router.get("/:id/journey", async (req: any, res: any, next: any) => {
  try {
    const data = await listJourneyEvents(req.params.id, {
      module:    req.query.module    as string | undefined,
      eventType: req.query.eventType as string | undefined,
      fromDate:  req.query.fromDate  as string | undefined,
      toDate:    req.query.toDate    as string | undefined,
    });
    return res.json({ success: true, data });
  } catch (err) { next(err); }
});

router.post("/:id/journey", async (req: any, res: any, next: any) => {
  try {
    const b = req.body;
    if (!b.eventType || !b.eventDate) {
      return res.status(400).json({ success: false, message: "eventType and eventDate required" });
    }
    const data = await appendJourneyEvent({
      employeeId:  req.params.id,
      eventType:   b.eventType,
      eventDate:   b.eventDate,
      description: b.description,
      oldValue:    b.oldValue,
      newValue:    b.newValue,
      module:      b.module,
      triggeredBy: req.authUser?.id,
      metadata:    b.metadata,
    });
    return res.status(201).json({ success: true, data });
  } catch (err) { next(err); }
});

export { router as employeeRouter };
