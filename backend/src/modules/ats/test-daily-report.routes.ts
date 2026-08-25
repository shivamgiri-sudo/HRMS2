import { Router } from "express";

const testDailyReportRouter = Router();

// PUBLIC TEST ENDPOINT - REMOVE AFTER TESTING
testDailyReportRouter.post("/trigger", async (req, res) => {
  const { date, email, preview } = req.body;

  try {
    const { runDailyHiringReport } = await import("./ats-reminders.cron.js");

    if (preview) {
      const result = await runDailyHiringReport(date || '2026-08-24', 'preview');
      return res.json({ success: true, preview: true, data: result });
    }

    const result = await runDailyHiringReport(date || '2026-08-24', email || 'shivam.giri@teammas.in');
    return res.json(result);
  } catch (error: any) {
    return res.status(500).json({ success: false, error: error.message });
  }
});

export default testDailyReportRouter;