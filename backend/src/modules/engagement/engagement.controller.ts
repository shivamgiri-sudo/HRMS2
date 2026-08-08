import type { Response } from "express";
import type { AuthenticatedRequest } from "../../middleware/authMiddleware.js";
import { getEmployeeForUser } from "../../shared/accessGuard.js";
import {
  awardBadge,
  getBadges,
  getEmployeeBadges,
} from "./badge.service.js";
import { getEmployeeEngagementSummary } from "./engagement.service.js";
import {
  addPoints,
  getEmployeeTier,
  getLeaderboard,
  getPointsHistory,
  getTiers,
} from "./gamification.service.js";
import {
  getMonthlyKudosLimit,
  listKudos,
  listKudosTemplates,
  sendKudos,
} from "./kudos.service.js";
import {
  calculateENPS,
  createSurvey,
  getPulseSummary,
  getSurvey,
  getSurveyResults,
  listPulseChecks,
  listSurveys,
  submitPulseCheck,
  submitSurveyResponse,
} from "./survey.service.js";
import {
  AddPointsSchema,
  AwardBadgeSchema,
  CreateSurveySchema,
  SendKudosSchema,
  SubmitPulseCheckSchema,
  SubmitSurveyResponseSchema,
} from "./engagement.validation.js";

async function requireEmployee(req: AuthenticatedRequest) {
  const employee = await getEmployeeForUser(req.authUser!.id);
  if (!employee) {
    // 403, not 500. An account with no employees row is an ordinary, expected state - a real
    // one on this deployment, where not every auth_user is mapped - and every other module
    // answers it with 403 and this same sentence (helpdesk, mobility, management). A bare Error
    // reaches the handler with no statusCode, so it became a 500 carrying an error reference:
    // indistinguishable in the logs and in alerting from the server actually falling over, for
    // a condition the caller can neither retry nor fix.
    throw Object.assign(new Error("No employee profile mapped to this account"), { statusCode: 403 });
  }
  return employee;
}

function parseLimit(value: unknown, fallback = 50) {
  const limit = Number(value ?? fallback);
  return Number.isInteger(limit) && limit > 0 ? Math.min(limit, 100) : fallback;
}

export const engagementController = {
  async getMySummary(req: AuthenticatedRequest, res: Response) {
    const employee = await requireEmployee(req);
    // generatedAt feeds the dashboard Source Freshness panel, which read
    // "Timestamp unavailable" without it (CEO UAT). Computed live per request.
    return res.json({ success: true, data: await getEmployeeEngagementSummary(employee.id), generatedAt: new Date().toISOString() });
  },

  async listBadges(req: AuthenticatedRequest, res: Response) {
    const category = req.query.category as "performance" | "activity" | "tenure" | "social" | undefined;
    return res.json({ success: true, data: await getBadges({ badge_category: category, is_active: true }) });
  },

  async getEmployeeBadges(req: AuthenticatedRequest, res: Response) {
    return res.json({ success: true, data: await getEmployeeBadges(req.params.employeeId) });
  },

  async awardBadge(req: AuthenticatedRequest, res: Response) {
    const parsed = AwardBadgeSchema.safeParse({
      employee_id: req.body.employeeId,
      badge_id: req.body.badgeId,
      reason: req.body.reason,
      awarded_by: req.authUser!.id,
    });
    if (!parsed.success) return res.status(400).json({ success: false, error: Object.values(parsed.error.flatten().fieldErrors).flat().join("; ") || parsed.error.message });
    return res.status(201).json({ success: true, data: await awardBadge(parsed.data) });
  },

  async getPoints(req: AuthenticatedRequest, res: Response) {
    return res.json({
      success: true,
      data: await getPointsHistory(req.params.employeeId, undefined, 1, parseLimit(req.query.limit)),
    });
  },

  async adjustPoints(req: AuthenticatedRequest, res: Response) {
    const parsed = AddPointsSchema.safeParse({
      employee_id: req.body.employeeId,
      points_delta: req.body.points,
      transaction_type: "manual_adjustment",
      description: req.body.reason,
    });
    if (!parsed.success) return res.status(400).json({ success: false, error: Object.values(parsed.error.flatten().fieldErrors).flat().join("; ") || parsed.error.message });
    return res.status(201).json({
      success: true,
      data: await addPoints(
        parsed.data.employee_id,
        parsed.data.points_delta,
        parsed.data.transaction_type,
        parsed.data.description
      ),
    });
  },

  async getLeaderboard(req: AuthenticatedRequest, res: Response) {
    const allowed = ["day", "week", "month", "quarter", "year", "all-time"] as const;
    const period = allowed.includes(req.query.period as any) ? req.query.period as typeof allowed[number] : "all-time";
    return res.json({ success: true, data: await getLeaderboard(period, parseLimit(req.query.limit, 10)) });
  },

  async listTiers(_req: AuthenticatedRequest, res: Response) {
    return res.json({ success: true, data: await getTiers(true) });
  },

  async getEmployeeTier(req: AuthenticatedRequest, res: Response) {
    return res.json({ success: true, data: await getEmployeeTier(req.params.employeeId) });
  },

  async listKudosTemplates(_req: AuthenticatedRequest, res: Response) {
    return res.json({ success: true, data: await listKudosTemplates(true) });
  },

  async sendKudos(req: AuthenticatedRequest, res: Response) {
    const employee = await requireEmployee(req);
    const parsed = SendKudosSchema.safeParse({
      ...req.body,
      sender_id: employee.id,
      receiver_id: req.body.receiverId,
      kudos_template_id: req.body.templateId,
      custom_message: req.body.message,
      is_anonymous: req.body.isAnonymous,
    });
    if (!parsed.success) return res.status(400).json({ success: false, error: Object.values(parsed.error.flatten().fieldErrors).flat().join("; ") || parsed.error.message });
    return res.status(201).json({ success: true, data: { id: await sendKudos(parsed.data) } });
  },

  async listKudos(req: AuthenticatedRequest, res: Response) {
    const filters = req.query.scope === "received"
      ? { receiver_id: req.params.employeeId }
      : req.query.scope === "given"
        ? { sender_id: req.params.employeeId }
        : {};
    return res.json({ success: true, data: await listKudos(filters, parseLimit(req.query.limit)) });
  },

  async getMyKudosLimit(req: AuthenticatedRequest, res: Response) {
    const employee = await requireEmployee(req);
    return res.json({ success: true, data: await getMonthlyKudosLimit(employee.id) });
  },

  async listSurveys(_req: AuthenticatedRequest, res: Response) {
    return res.json({ success: true, data: await listSurveys({ is_active: true }) });
  },

  async getSurvey(req: AuthenticatedRequest, res: Response) {
    const survey = await getSurvey(req.params.id);
    if (!survey) return res.status(404).json({ success: false, message: "Survey not found" });
    return res.json({ success: true, data: survey });
  },

  async createSurvey(req: AuthenticatedRequest, res: Response) {
    const parsed = CreateSurveySchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ success: false, error: Object.values(parsed.error.flatten().fieldErrors).flat().join("; ") || parsed.error.message });
    return res.status(201).json({
      success: true,
      data: { id: await createSurvey(parsed.data, req.authUser!.id) },
    });
  },

  async submitSurvey(req: AuthenticatedRequest, res: Response) {
    const survey = await getSurvey(req.params.id);
    if (!survey) return res.status(404).json({ success: false, message: "Survey not found" });
    const employee = survey.is_anonymous ? null : await requireEmployee(req);
    const parsed = SubmitSurveyResponseSchema.safeParse({
      survey_id: req.params.id,
      employee_id: employee?.id,
      responses: req.body.responses,
    });
    if (!parsed.success) return res.status(400).json({ success: false, error: Object.values(parsed.error.flatten().fieldErrors).flat().join("; ") || parsed.error.message });
    await submitSurveyResponse(parsed.data);
    return res.status(201).json({ success: true });
  },

  async getSurveyResults(req: AuthenticatedRequest, res: Response) {
    return res.json({ success: true, data: await getSurveyResults(req.params.id) });
  },

  async getENPS(req: AuthenticatedRequest, res: Response) {
    return res.json({
      success: true,
      data: await calculateENPS(req.params.id, req.params.questionId),
    });
  },

  async submitPulse(req: AuthenticatedRequest, res: Response) {
    const employee = await requireEmployee(req);
    const parsed = SubmitPulseCheckSchema.safeParse({ ...req.body, employee_id: employee.id });
    if (!parsed.success) return res.status(400).json({ success: false, error: Object.values(parsed.error.flatten().fieldErrors).flat().join("; ") || parsed.error.message });
    await submitPulseCheck(parsed.data);
    return res.status(201).json({ success: true });
  },

  async getMyPulseChecks(req: AuthenticatedRequest, res: Response) {
    const employee = await requireEmployee(req);
    return res.json({ success: true, data: await listPulseChecks({ employee_id: employee.id }) });
  },

  async getPulseSummary(_req: AuthenticatedRequest, res: Response) {
    return res.json({ success: true, data: await getPulseSummary() });
  },

  // =========================================================================
  // Daily Login & Streak
  // =========================================================================

  async claimDailyLogin(req: AuthenticatedRequest, res: Response) {
    const employee = await requireEmployee(req);
    const { dailyLoginService } = await import('./daily-login.service.js');
    const result = await dailyLoginService.claimDailyLogin(employee.id);
    return res.json({ success: true, data: result });
  },

  async getStreakStatus(req: AuthenticatedRequest, res: Response) {
    const employee = await requireEmployee(req);
    const { dailyLoginService } = await import('./daily-login.service.js');
    const status = await dailyLoginService.getStreakStatus(employee.id);
    return res.json({ success: true, data: status });
  },

  async getLoginHistory(req: AuthenticatedRequest, res: Response) {
    const employee = await requireEmployee(req);
    const limit = Math.min(Number(req.query.limit) || 30, 100);
    const { dailyLoginService } = await import('./daily-login.service.js');
    const history = await dailyLoginService.getLoginHistory(employee.id, limit);
    return res.json({ success: true, data: history });
  },

  async getStreakLeaderboard(_req: AuthenticatedRequest, res: Response) {
    const limit = Math.min(Number(_req.query.limit) || 10, 50);
    const { dailyLoginService } = await import('./daily-login.service.js');
    const leaderboard = await dailyLoginService.getStreakLeaderboard(limit);
    return res.json({ success: true, data: leaderboard });
  },

  // =========================================================================
  // Daily Tips / Did You Know
  // =========================================================================

  async getTodayTip(req: AuthenticatedRequest, res: Response) {
    const employee = await requireEmployee(req);
    const { dailyTipsService } = await import('./daily-tips.service.js');
    const result = await dailyTipsService.getTodayTip(employee.id);
    return res.json({ success: true, data: result });
  },

  async markTipAsRead(req: AuthenticatedRequest, res: Response) {
    const employee = await requireEmployee(req);
    const tipId = req.params.tipId;
    if (!tipId) return res.status(400).json({ success: false, error: 'tipId is required' });
    const { dailyTipsService } = await import('./daily-tips.service.js');
    const result = await dailyTipsService.markTipAsRead(employee.id, tipId);
    return res.json({ success: true, data: result });
  },

  async getTipArchive(req: AuthenticatedRequest, res: Response) {
    const category = req.query.category as string | undefined;
    const limit = Math.min(Number(req.query.limit) || 20, 100);
    const offset = Number(req.query.offset) || 0;
    const { dailyTipsService } = await import('./daily-tips.service.js');
    const result = await dailyTipsService.getTipArchive({ category: category as any, limit, offset });
    return res.json({ success: true, data: result });
  },

  async getMyTipHistory(req: AuthenticatedRequest, res: Response) {
    const employee = await requireEmployee(req);
    const limit = Math.min(Number(req.query.limit) || 30, 100);
    const { dailyTipsService } = await import('./daily-tips.service.js');
    const history = await dailyTipsService.getReadHistory(employee.id, limit);
    return res.json({ success: true, data: history });
  },

  async createTip(req: AuthenticatedRequest, res: Response) {
    const userId = req.authUser?.id;
    if (!userId) return res.status(401).json({ success: false, error: 'Unauthorized' });
    const { dailyTipsService } = await import('./daily-tips.service.js');
    const tip = await dailyTipsService.createTip(req.body, userId);
    return res.status(201).json({ success: true, data: tip });
  },

  async updateTip(req: AuthenticatedRequest, res: Response) {
    const tipId = req.params.tipId;
    if (!tipId) return res.status(400).json({ success: false, error: 'tipId is required' });
    const { dailyTipsService } = await import('./daily-tips.service.js');
    const tip = await dailyTipsService.updateTip(tipId, req.body);
    return res.json({ success: true, data: tip });
  },

  async deleteTip(req: AuthenticatedRequest, res: Response) {
    const tipId = req.params.tipId;
    if (!tipId) return res.status(400).json({ success: false, error: 'tipId is required' });
    const { dailyTipsService } = await import('./daily-tips.service.js');
    await dailyTipsService.deleteTip(tipId);
    return res.json({ success: true });
  },

  async getTipStats(_req: AuthenticatedRequest, res: Response) {
    const { dailyTipsService } = await import('./daily-tips.service.js');
    const stats = await dailyTipsService.getTipStats();
    return res.json({ success: true, data: stats });
  },

  // =========================================================================
  // Daily Trivia Quiz
  // =========================================================================

  async getTodayTrivia(req: AuthenticatedRequest, res: Response) {
    const employee = await requireEmployee(req);
    const { dailyTriviaService } = await import('./daily-trivia.service.js');
    const result = await dailyTriviaService.getTodayQuestion(employee.id);
    return res.json({ success: true, data: result });
  },

  async submitTriviaAnswer(req: AuthenticatedRequest, res: Response) {
    const employee = await requireEmployee(req);
    const { questionId, selectedOption, timeTakenSeconds } = req.body;
    if (!questionId || !selectedOption) {
      return res.status(400).json({ success: false, error: 'questionId and selectedOption are required' });
    }
    const { dailyTriviaService } = await import('./daily-trivia.service.js');
    const result = await dailyTriviaService.submitAnswer(employee.id, questionId, selectedOption, timeTakenSeconds);
    return res.json({ success: true, data: result });
  },

  async getTriviaLeaderboard(req: AuthenticatedRequest, res: Response) {
    const date = req.query.date as string | undefined;
    const { dailyTriviaService } = await import('./daily-trivia.service.js');
    const result = await dailyTriviaService.getTriviaLeaderboard(date);
    return res.json({ success: true, data: result });
  },

  async createTriviaQuestion(req: AuthenticatedRequest, res: Response) {
    const userId = req.authUser?.id;
    if (!userId) return res.status(401).json({ success: false, error: 'Unauthorized' });
    const { dailyTriviaService } = await import('./daily-trivia.service.js');
    const question = await dailyTriviaService.createQuestion(req.body, userId);
    return res.status(201).json({ success: true, data: question });
  },

  async getTriviaQuestionBank(req: AuthenticatedRequest, res: Response) {
    const limit = Math.min(Number(req.query.limit) || 50, 100);
    const offset = Number(req.query.offset) || 0;
    const category = req.query.category as any;
    const { dailyTriviaService } = await import('./daily-trivia.service.js');
    const result = await dailyTriviaService.getQuestionBank({ limit, offset, category });
    return res.json({ success: true, data: result });
  },

  // =========================================================================
  // Brain Teaser
  // =========================================================================

  async getTodayTeaser(req: AuthenticatedRequest, res: Response) {
    const employee = await requireEmployee(req);
    const { brainTeaserService } = await import('./brain-teaser.service.js');
    const result = await brainTeaserService.getTodayTeaser(employee.id);
    return res.json({ success: true, data: result });
  },

  async revealTeaserHint(req: AuthenticatedRequest, res: Response) {
    const employee = await requireEmployee(req);
    const { teaserId, hintNumber } = req.body;
    if (!teaserId || ![1, 2].includes(Number(hintNumber))) {
      return res.status(400).json({ success: false, error: 'teaserId and hintNumber (1 or 2) are required' });
    }
    const { brainTeaserService } = await import('./brain-teaser.service.js');
    const result = await brainTeaserService.revealHint(employee.id, teaserId, Number(hintNumber) as 1 | 2);
    return res.json({ success: true, data: result });
  },

  async submitTeaserAnswer(req: AuthenticatedRequest, res: Response) {
    const employee = await requireEmployee(req);
    const { teaserId, submittedAnswer, timeTakenSecs } = req.body;
    if (!teaserId || !submittedAnswer) {
      return res.status(400).json({ success: false, error: 'teaserId and submittedAnswer are required' });
    }
    const { brainTeaserService } = await import('./brain-teaser.service.js');
    const result = await brainTeaserService.submitAnswer(employee.id, teaserId, submittedAnswer, timeTakenSecs);
    return res.json({ success: true, data: result });
  },

  async createTeaser(req: AuthenticatedRequest, res: Response) {
    const userId = req.authUser?.id;
    if (!userId) return res.status(401).json({ success: false, error: 'Unauthorized' });
    const { brainTeaserService } = await import('./brain-teaser.service.js');
    const teaser = await brainTeaserService.createTeaser(req.body, userId);
    return res.status(201).json({ success: true, data: teaser });
  },

  async getTeaserBank(req: AuthenticatedRequest, res: Response) {
    const limit = Math.min(Number(req.query.limit) || 50, 100);
    const offset = Number(req.query.offset) || 0;
    const category = req.query.category as any;
    const { brainTeaserService } = await import('./brain-teaser.service.js');
    const result = await brainTeaserService.getTeaserBank({ limit, offset, category });
    return res.json({ success: true, data: result });
  },

  // =========================================================================
  // Word Puzzle (Wordle-style)
  // =========================================================================

  async getTodayPuzzle(req: AuthenticatedRequest, res: Response) {
    const employee = await requireEmployee(req);
    const { wordPuzzleService } = await import('./word-puzzle.service.js');
    const result = await wordPuzzleService.getTodayPuzzle(employee.id);
    return res.json({ success: true, data: result });
  },

  async submitWordGuess(req: AuthenticatedRequest, res: Response) {
    const employee = await requireEmployee(req);
    const { puzzleId, guess } = req.body;
    if (!puzzleId || !guess) {
      return res.status(400).json({ success: false, error: 'puzzleId and guess are required' });
    }
    const { wordPuzzleService } = await import('./word-puzzle.service.js');
    const result = await wordPuzzleService.submitGuess(employee.id, puzzleId, guess);
    return res.json({ success: true, data: result });
  },

  async createWordPuzzle(req: AuthenticatedRequest, res: Response) {
    const userId = req.authUser?.id;
    if (!userId) return res.status(401).json({ success: false, error: 'Unauthorized' });
    const { wordPuzzleService } = await import('./word-puzzle.service.js');
    const puzzle = await wordPuzzleService.createPuzzle(req.body, userId);
    return res.status(201).json({ success: true, data: puzzle });
  },

  async getWordPuzzleBank(req: AuthenticatedRequest, res: Response) {
    const limit = Math.min(Number(req.query.limit) || 50, 100);
    const offset = Number(req.query.offset) || 0;
    const { wordPuzzleService } = await import('./word-puzzle.service.js');
    const result = await wordPuzzleService.getPuzzleBank({ limit, offset });
    return res.json({ success: true, data: result });
  },

  // =========================================================================
  // Quick Polls
  // =========================================================================

  async getActivePolls(req: AuthenticatedRequest, res: Response) {
    const employee = await requireEmployee(req);
    const { quickPollService } = await import('./quick-poll.service.js');
    const polls = await quickPollService.getActivePolls(employee.id);
    return res.json({ success: true, data: polls });
  },

  async getPoll(req: AuthenticatedRequest, res: Response) {
    const employee = await requireEmployee(req);
    const { quickPollService } = await import('./quick-poll.service.js');
    const poll = await quickPollService.getPollById(req.params.pollId, employee.id);
    if (!poll) return res.status(404).json({ success: false, error: 'Poll not found' });
    return res.json({ success: true, data: poll });
  },

  async voteOnPoll(req: AuthenticatedRequest, res: Response) {
    const employee = await requireEmployee(req);
    const { pollId } = req.params;
    const { selectedOption } = req.body;
    if (!selectedOption) return res.status(400).json({ success: false, error: 'selectedOption is required' });
    const { quickPollService } = await import('./quick-poll.service.js');
    const result = await quickPollService.vote(employee.id, pollId, Number(selectedOption));
    return res.json({ success: true, data: result });
  },

  async createPoll(req: AuthenticatedRequest, res: Response) {
    const userId = req.authUser?.id;
    if (!userId) return res.status(401).json({ success: false, error: 'Unauthorized' });
    const { quickPollService } = await import('./quick-poll.service.js');
    const poll = await quickPollService.createPoll(req.body, userId);
    return res.status(201).json({ success: true, data: poll });
  },

  async approvePoll(req: AuthenticatedRequest, res: Response) {
    const userId = req.authUser?.id;
    if (!userId) return res.status(401).json({ success: false, error: 'Unauthorized' });
    const { quickPollService } = await import('./quick-poll.service.js');
    const poll = await quickPollService.approvePoll(req.params.pollId, userId);
    return res.json({ success: true, data: poll });
  },

  async closePoll(req: AuthenticatedRequest, res: Response) {
    const { quickPollService } = await import('./quick-poll.service.js');
    const poll = await quickPollService.closePoll(req.params.pollId);
    return res.json({ success: true, data: poll });
  },

  async getAllPolls(req: AuthenticatedRequest, res: Response) {
    const status = req.query.status as any;
    const limit = Math.min(Number(req.query.limit) || 20, 100);
    const offset = Number(req.query.offset) || 0;
    const { quickPollService } = await import('./quick-poll.service.js');
    const result = await quickPollService.getAllPolls({ status, limit, offset });
    return res.json({ success: true, data: result });
  },

  // =========================================================================
  // Admin Export
  // =========================================================================

  async exportEngagementCsv(_req: AuthenticatedRequest, res: Response) {
    const { db } = await import('../../db/mysql.js');
    type Row = {
      employee_id: string;
      employee_name: string;
      branch: string;
      department: string;
      designation: string;
      total_points: number;
      current_tier: string;
      current_streak: number;
      longest_streak: number;
      last_login_date: string | null;
      badges_count: number;
      kudos_received: number;
      surveys_completed: number;
      trivia_correct: number;
      trivia_participate: number;
      puzzle_solved: number;
      brain_teaser_correct: number;
      tip_reads: number;
      poll_votes: number;
    };

    const [rows] = await db.execute<any[]>(`
      SELECT
        e.id                                                    AS employee_id,
        CONCAT(e.first_name, ' ', e.last_name)                 AS employee_name,
        COALESCE(b.branch_name, '')                             AS branch,
        COALESCE(d.dept_name, '')                               AS department,
        COALESCE(dg.designation_name, '')                       AS designation,
        COALESCE(ts.total_points, 0)                           AS total_points,
        COALESCE(tm.tier_name, 'Bronze')                       AS current_tier,
        COALESCE(ts.current_streak, 0)                         AS current_streak,
        COALESCE(ts.longest_streak, 0)                         AS longest_streak,
        ts.last_login_date,
        (SELECT COUNT(*) FROM employee_badge eb WHERE eb.employee_id = e.id) AS badges_count,
        (SELECT COUNT(*) FROM kudos k WHERE k.receiver_id = e.id)            AS kudos_received,
        (SELECT COUNT(DISTINCT survey_id) FROM survey_response sr WHERE sr.employee_id = e.id) AS surveys_completed,
        (SELECT COUNT(*) FROM gamification_points_ledger l WHERE l.employee_id = e.id AND l.transaction_type = 'trivia_correct') AS trivia_correct,
        (SELECT COUNT(*) FROM gamification_points_ledger l WHERE l.employee_id = e.id AND l.transaction_type = 'trivia_participate') AS trivia_participate,
        (SELECT COUNT(*) FROM gamification_points_ledger l WHERE l.employee_id = e.id AND l.transaction_type = 'puzzle_solved') AS puzzle_solved,
        (SELECT COUNT(*) FROM gamification_points_ledger l WHERE l.employee_id = e.id AND l.transaction_type = 'brain_teaser_correct') AS brain_teaser_correct,
        (SELECT COUNT(*) FROM gamification_points_ledger l WHERE l.employee_id = e.id AND l.transaction_type = 'tip_read') AS tip_reads,
        (SELECT COUNT(*) FROM gamification_points_ledger l WHERE l.employee_id = e.id AND l.transaction_type = 'poll_voted') AS poll_votes
      FROM employees e
      LEFT JOIN employee_tier_status ts ON ts.employee_id = e.id
      LEFT JOIN gamification_tier_master tm ON tm.tier_id = ts.current_tier_id
      LEFT JOIN branch_master b ON b.id = e.branch_id
      LEFT JOIN department_master d ON d.id = e.department_id
      LEFT JOIN designation_master dg ON dg.id = e.designation_id
      WHERE e.employment_status = 'active'
      ORDER BY total_points DESC
    `);

    const header = [
      'Employee ID', 'Name', 'Branch', 'Department', 'Designation',
      'Total Points', 'Tier', 'Current Streak', 'Longest Streak', 'Last Login Date',
      'Badges Earned', 'Kudos Received', 'Surveys Completed',
      'Trivia Correct', 'Trivia Participated', 'Puzzles Solved',
      'Brain Teasers Correct', 'Tips Read', 'Polls Voted',
    ].join(',');

    const escape = (v: string | number | null) => {
      if (v == null) return '';
      const s = String(v);
      return s.includes(',') || s.includes('"') || s.includes('\n')
        ? `"${s.replace(/"/g, '""')}"` : s;
    };

    const lines = (rows as Row[]).map(r => [
      r.employee_id, r.employee_name, r.branch, r.department, r.designation,
      r.total_points, r.current_tier, r.current_streak, r.longest_streak,
      r.last_login_date ?? '',
      r.badges_count, r.kudos_received, r.surveys_completed,
      r.trivia_correct, r.trivia_participate, r.puzzle_solved,
      r.brain_teaser_correct, r.tip_reads, r.poll_votes,
    ].map(escape).join(','));

    const csv = [header, ...lines].join('\r\n');
    const today = new Date().toISOString().slice(0, 10);
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="engagement-export-${today}.csv"`);
    return res.send(csv);
  },
};

