import { randomUUID } from "crypto";
import type { RowDataPacket } from "mysql2";
import { db } from "../../db/mysql.js";

const schemaTableCache = new Map<string, Promise<boolean>>();
const schemaColumnCache = new Map<string, Promise<boolean>>();

async function tableExists(tableName: string): Promise<boolean> {
  const cached = schemaTableCache.get(tableName);
  if (cached) return cached;
  const lookup = db.execute<RowDataPacket[]>(
    `SELECT 1 FROM information_schema.tables WHERE table_schema = DATABASE() AND table_name = ? LIMIT 1`,
    [tableName]
  ).then(([rows]) => rows.length > 0);
  schemaTableCache.set(tableName, lookup);
  return lookup;
}

async function columnExists(tableName: string, columnName: string): Promise<boolean> {
  const cacheKey = `${tableName}.${columnName}`;
  const cached = schemaColumnCache.get(cacheKey);
  if (cached) return cached;
  const lookup = db.execute<RowDataPacket[]>(
    `SELECT 1 FROM information_schema.columns
      WHERE table_schema = DATABASE() AND table_name = ? AND column_name = ? LIMIT 1`,
    [tableName, columnName]
  ).then(([rows]) => rows.length > 0);
  schemaColumnCache.set(cacheKey, lookup);
  return lookup;
}

async function scalar(sql: string, params: unknown[] = [], fallback = 0): Promise<number> {
  try {
    const [rows] = await db.execute<RowDataPacket[]>(sql, params);
    const first = rows[0] ?? {};
    const value = Object.values(first)[0];
    const n = Number(value ?? fallback);
    return Number.isFinite(n) ? n : fallback;
  } catch {
    return fallback;
  }
}

function clamp(value: number, min = 0, max = 100): number {
  return Math.max(min, Math.min(max, Number.isFinite(value) ? value : 0));
}

function riskLabelFromScore(score: number): "highly_engaged" | "stable" | "watchlist" | "attrition_risk" | "critical_people_risk" {
  if (score >= 80) return "highly_engaged";
  if (score >= 60) return "stable";
  if (score >= 40) return "watchlist";
  if (score >= 25) return "attrition_risk";
  return "critical_people_risk";
}

// ── Performance score from real tables ───────────────────────────────────────
async function computePerformanceScore(
  employeeId: string,
  signals: Set<string>
): Promise<number> {
  let score = 0;
  let sources = 0;

  if (await tableExists("management_kpi_summary")) {
    const colWeighted = await columnExists("management_kpi_summary", "weighted_score");
    const colScore    = await columnExists("management_kpi_summary", "overall_score");
    const colExpr     = colWeighted ? "weighted_score" : colScore ? "overall_score" : "NULL";
    if (colExpr !== "NULL") {
      const v = await scalar(
        `SELECT COALESCE(AVG(${colExpr}), -1) AS s
           FROM management_kpi_summary
          WHERE employee_id = ?
            AND period >= DATE_FORMAT(DATE_SUB(CURDATE(), INTERVAL 3 MONTH), '%Y-%m')`,
        [employeeId], -1
      );
      if (v >= 0) { score += v; sources++; signals.add("kpi"); }
    }
  }

  if (await tableExists("employee_kpi_score")) {
    const v = await scalar(
      `SELECT COALESCE(AVG(score), -1) AS s
         FROM employee_kpi_score
        WHERE employee_id = ?
          AND period >= DATE_FORMAT(DATE_SUB(CURDATE(), INTERVAL 3 MONTH), '%Y-%m')`,
      [employeeId], -1
    );
    if (v >= 0) { score += v; sources++; signals.add("kpi_score"); }
  }

  // Active PIP reduces score
  let pipActive = false;
  if (await tableExists("pip_record")) {
    const cnt = await scalar(
      `SELECT COUNT(*) AS cnt FROM pip_record WHERE employee_id = ? AND status = 'active'`,
      [employeeId]
    );
    if (cnt > 0) { pipActive = true; signals.add("pip_active"); }
  }

  // Performance feedback recency
  if (await tableExists("performance_feedback_response")) {
    const v = await scalar(
      `SELECT COALESCE(AVG(overall_rating), -1) AS s
         FROM performance_feedback_response
        WHERE reviewee_id = ?
          AND submitted_at >= DATE_SUB(NOW(), INTERVAL 6 MONTH)`,
      [employeeId], -1
    );
    if (v >= 0) { score += (v / 5) * 100; sources++; signals.add("feedback_rating"); }
  }

  if (sources === 0) return 65; // pure fallback — no signal counted
  const avg = clamp(score / sources);
  return pipActive ? clamp(avg - 15) : avg;
}

// ── Career growth score ───────────────────────────────────────────────────────
async function computeCareerGrowthScore(
  employeeId: string,
  signals: Set<string>
): Promise<number> {
  let score = 50; // neutral baseline
  let boosts = 0;

  if (await tableExists("lms_learning_progress_snapshot")) {
    const completed = await scalar(
      `SELECT COUNT(*) AS cnt
         FROM lms_learning_progress_snapshot
        WHERE employee_id = ? AND status = 'completed'
          AND synced_at >= DATE_SUB(NOW(), INTERVAL 6 MONTH)`,
      [employeeId]
    );
    const inProgress = await scalar(
      `SELECT COUNT(*) AS cnt
         FROM lms_learning_progress_snapshot
        WHERE employee_id = ? AND status = 'in_progress'`,
      [employeeId]
    );
    if (completed > 0 || inProgress > 0) {
      score += Math.min(completed * 8, 24) + (inProgress > 0 ? 5 : 0);
      boosts++;
      signals.add("lms");
    }
  }

  if (await tableExists("development_plan")) {
    const activePlans = await scalar(
      `SELECT COUNT(*) AS cnt
         FROM development_plan
        WHERE employee_id = ? AND status IN ('active','in_progress')`,
      [employeeId]
    );
    if (activePlans > 0) { score += 10; boosts++; signals.add("dev_plan"); }
  }

  if (await tableExists("development_plan_goal")) {
    const completedGoals = await scalar(
      `SELECT COUNT(*) AS cnt
         FROM development_plan_goal dpg
         JOIN development_plan dp ON dp.id = dpg.development_plan_id
        WHERE dp.employee_id = ? AND dpg.status = 'completed'
          AND dpg.completed_at >= DATE_SUB(NOW(), INTERVAL 6 MONTH)`,
      [employeeId]
    );
    if (completedGoals > 0) { score += Math.min(completedGoals * 5, 15); boosts++; signals.add("dev_goals"); }
  }

  if (await tableExists("pip_record")) {
    // Long-term no-PIP is stable; active PIP was already penalised in perf
    const cnt = await scalar(
      `SELECT COUNT(*) AS cnt FROM pip_record WHERE employee_id = ? AND status = 'active'`,
      [employeeId]
    );
    if (cnt > 0) { score -= 10; signals.add("pip_active"); }
  }

  // Promotion / mobility signal
  if (await tableExists("employee_career_event")) {
    const promotions = await scalar(
      `SELECT COUNT(*) AS cnt
         FROM employee_career_event
        WHERE employee_id = ? AND event_type IN ('promotion','lateral_move')
          AND event_date >= DATE_SUB(CURDATE(), INTERVAL 18 MONTH)`,
      [employeeId]
    );
    if (promotions > 0) { score += 15; boosts++; signals.add("promotion"); }
  }

  // If no growth activity at all, slight downward drift
  if (boosts === 0) score = Math.max(score - 10, 30);

  return clamp(score);
}

// ── Support friction score ────────────────────────────────────────────────────
async function computeSupportFrictionScore(
  employeeId: string,
  signals: Set<string>
): Promise<number> {
  const openTickets = await scalar(
    `SELECT COUNT(*) AS cnt FROM helpdesk_ticket WHERE employee_id = ? AND status NOT IN ('resolved','closed','cancelled')`,
    [employeeId]
  );
  const breached = await scalar(
    `SELECT COUNT(*) AS cnt FROM helpdesk_ticket
      WHERE employee_id = ? AND sla_breached = 1 AND status NOT IN ('resolved','closed','cancelled')`,
    [employeeId]
  ).catch(() => 0);
  const openGrievances = await scalar(
    `SELECT COUNT(*) AS cnt FROM grievance WHERE employee_id = ? AND status NOT IN ('resolved','closed')`,
    [employeeId]
  ).catch(() => 0);

  if (openTickets > 0 || openGrievances > 0) signals.add("support_friction");

  // friction = penalty: 0 friction = 100 score; more open/breached = lower
  let penalty = openTickets * 10 + (breached as number) * 20 + openGrievances * 25;
  return clamp(100 - penalty);
}

// ── Risk drivers ──────────────────────────────────────────────────────────────
function buildRiskDrivers(params: {
  pulseScore: number;
  pulses90d: number;
  kudosReceived90d: number;
  attendanceScore: number;
  performanceScore: number;
  pipActive: boolean;
  supportFrictionScore: number;
  careerGrowthScore: number;
  openGrievances: number;
  signals: Set<string>;
}): string[] {
  const drivers: string[] = [];
  if (params.pulseScore < 40)                             drivers.push("low_pulse_mood");
  if (params.pulses90d === 0)                             drivers.push("no_pulse_response");
  if (params.kudosReceived90d === 0)                      drivers.push("zero_recognition_90d");
  if (params.attendanceScore < 70)                        drivers.push("attendance_instability");
  if (params.performanceScore < 50)                       drivers.push("low_kpi_performance");
  if (params.pipActive)                                   drivers.push("active_pip");
  if (params.supportFrictionScore < 60)                   drivers.push("unresolved_support_tickets");
  if (params.openGrievances > 0)                          drivers.push("open_grievance");
  if (!params.signals.has("lms") && !params.signals.has("dev_plan") && !params.signals.has("promotion"))
                                                          drivers.push("no_career_growth_signals");
  return drivers;
}

// ── Recommended actions ───────────────────────────────────────────────────────
function buildRecommendedActions(
  riskLabel: string,
  riskDrivers: string[]
): Array<{ action: string; priority: string; owner: string }> {
  switch (riskLabel) {
    case "critical_people_risk":
      return [
        { action: "HR check-in within 24 hours", priority: "critical", owner: "hr" },
        { action: "Manager 1:1 — today", priority: "critical", owner: "manager" },
        { action: "Resolve support/ticket blockers immediately", priority: "high", owner: "hr" },
        { action: "Review any open grievance with POSH sensitivity", priority: "high", owner: "hr" },
      ];
    case "attrition_risk":
      return [
        { action: "Manager 1:1 within 3 days", priority: "high", owner: "manager" },
        { action: "HR check-in this week", priority: "high", owner: "hr" },
        ...(riskDrivers.includes("unresolved_support_tickets")
          ? [{ action: "Resolve open support tickets", priority: "high", owner: "hr" }]
          : []),
        ...(riskDrivers.includes("low_kpi_performance")
          ? [{ action: "Performance coaching session", priority: "medium", owner: "manager" }]
          : []),
      ];
    case "watchlist":
      return [
        { action: "Manager 1:1 within 7 days", priority: "medium", owner: "manager" },
        { action: "Recognition or appreciation touchpoint", priority: "low", owner: "manager" },
        { action: "Pulse follow-up if not responded", priority: "low", owner: "hr" },
        ...(riskDrivers.includes("no_career_growth_signals")
          ? [{ action: "Discuss career growth roadmap", priority: "medium", owner: "manager" }]
          : []),
      ];
    case "highly_engaged":
      return [
        { action: "Consider nomination for recognition/award", priority: "low", owner: "hr" },
        { action: "Explore stretch assignment or mentorship role", priority: "low", owner: "manager" },
      ];
    default:
      return [
        { action: "Regular 1:1 check-in", priority: "low", owner: "manager" },
      ];
  }
}

// ── Data confidence ───────────────────────────────────────────────────────────
function computeDataConfidence(signals: Set<string>): number {
  const count = signals.size;
  if (count >= 5) return 90;
  if (count >= 3) return 65;
  if (count >= 1) return 40;
  return 20;
}

// ── Main calculation ──────────────────────────────────────────────────────────
export async function calculateEmployeeEngagementHealth(employeeId: string) {
  const today = new Date().toISOString().slice(0, 10);
  const signals = new Set<string>();

  const [
    kudosReceived90d,
    kudosGiven90d,
    badges180d,
    surveys90d,
    pulses90d,
    pulseAvg,
  ] = await Promise.all([
    scalar(
      `SELECT COUNT(*) AS cnt FROM kudos_transaction WHERE receiver_id = ? AND sent_at >= DATE_SUB(NOW(), INTERVAL 90 DAY)`,
      [employeeId]
    ),
    scalar(
      `SELECT COUNT(*) AS cnt FROM kudos_transaction WHERE sender_id = ? AND sent_at >= DATE_SUB(NOW(), INTERVAL 90 DAY)`,
      [employeeId]
    ),
    scalar(
      `SELECT COUNT(*) AS cnt FROM employee_badge_earned WHERE employee_id = ? AND earned_at >= DATE_SUB(NOW(), INTERVAL 180 DAY)`,
      [employeeId]
    ),
    scalar(
      `SELECT COUNT(DISTINCT survey_id) AS cnt FROM survey_response WHERE employee_id = ? AND submitted_at >= DATE_SUB(NOW(), INTERVAL 90 DAY)`,
      [employeeId]
    ),
    scalar(
      `SELECT COUNT(*) AS cnt FROM pulse_check WHERE employee_id = ? AND submitted_at >= DATE_SUB(NOW(), INTERVAL 90 DAY)`,
      [employeeId]
    ),
    scalar(
      `SELECT AVG(mood_score) AS avg_score FROM pulse_check WHERE employee_id = ? AND submitted_at >= DATE_SUB(NOW(), INTERVAL 90 DAY)`,
      [employeeId],
      3
    ),
  ]);

  if (kudosReceived90d > 0) signals.add("kudos_received");
  if (kudosGiven90d > 0) signals.add("kudos_given");
  if (badges180d > 0) signals.add("badges");
  if (surveys90d > 0) signals.add("surveys");
  if (pulses90d > 0) signals.add("pulse");

  const attendanceScorePromise = tableExists("attendance_daily_record").then(async (exists) => {
    if (!exists) return 65;
    const [workedDays, absentDays] = await Promise.all([
      scalar(
        `SELECT COUNT(*) AS cnt FROM attendance_daily_record WHERE employee_id = ? AND attendance_date >= DATE_SUB(CURDATE(), INTERVAL 90 DAY)`,
        [employeeId]
      ),
      scalar(
        `SELECT COUNT(*) AS cnt FROM attendance_daily_record WHERE employee_id = ? AND attendance_date >= DATE_SUB(CURDATE(), INTERVAL 90 DAY) AND status IN ('absent','Absent','A','LWP')`,
        [employeeId]
      ),
    ]);
    if (workedDays <= 0) return 65;
    signals.add("attendance");
    return clamp(100 - (absentDays / workedDays) * 100);
  });

  const [
    attendanceScore,
    performanceScore,
    careerGrowthScore,
    supportFrictionScore,
  ] = await Promise.all([
    attendanceScorePromise,
    computePerformanceScore(employeeId, signals),
    computeCareerGrowthScore(employeeId, signals),
    computeSupportFrictionScore(employeeId, signals),
  ]);

  const pulseScore = clamp((pulseAvg / 5) * 100);
  const kudosScore = clamp((kudosReceived90d * 8) + (kudosGiven90d * 4) + (badges180d * 10));
  const participationScore = clamp((surveys90d * 15) + (pulses90d * 10));

  const engagementScore = clamp(
    pulseScore            * 0.20 +
    attendanceScore       * 0.15 +
    kudosScore            * 0.12 +
    participationScore    * 0.08 +
    performanceScore      * 0.18 +
    careerGrowthScore     * 0.12 +
    supportFrictionScore  * 0.08 +
    (signals.size > 0 ? 60 : 40) * 0.07
  );

  const dataConfidenceScore = computeDataConfidence(signals);
  const riskLabel = riskLabelFromScore(engagementScore);

  const pipActive = signals.has("pip_active");
  const openGrievances = await scalar(
    `SELECT COUNT(*) AS cnt FROM grievance WHERE employee_id = ? AND status NOT IN ('resolved','closed')`,
    [employeeId]
  ).catch(() => 0);

  const riskDrivers = buildRiskDrivers({
    pulseScore,
    pulses90d,
    kudosReceived90d,
    attendanceScore,
    performanceScore,
    pipActive,
    supportFrictionScore,
    careerGrowthScore,
    openGrievances,
    signals,
  });

  const recommendedActions = buildRecommendedActions(riskLabel, riskDrivers);
  const insight = {
    kudosReceived90d,
    kudosGiven90d,
    badges180d,
    surveys90d,
    pulses90d,
    pulseAvg,
    riskDrivers,
    recommendedActions,
    dataConfidenceScore,
    signals: [...signals],
    message: riskLabel === "critical_people_risk"
      ? "Critical people risk detected. HR and manager intervention required immediately."
      : riskLabel === "attrition_risk"
        ? "Low engagement signals detected. HR/manager check-in recommended."
        : riskLabel === "watchlist"
          ? "Watchlist engagement trend. Manager should connect informally."
          : "Engagement signals are acceptable.",
  };

  // Save to people_experience_health_snapshot if table exists
  const peTableExists = await tableExists("people_experience_health_snapshot");
  if (peTableExists) {
    await db.execute(
      `INSERT INTO people_experience_health_snapshot
         (id, employee_id, snapshot_date, engagement_score, data_confidence_score,
          risk_label, pulse_score, recognition_score, participation_score,
          attendance_score, performance_score, support_friction_score,
          career_growth_score, top_risk_drivers_json, recommended_actions_json)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE
         engagement_score       = VALUES(engagement_score),
         data_confidence_score  = VALUES(data_confidence_score),
         risk_label             = VALUES(risk_label),
         pulse_score            = VALUES(pulse_score),
         recognition_score      = VALUES(recognition_score),
         participation_score    = VALUES(participation_score),
         attendance_score       = VALUES(attendance_score),
         performance_score      = VALUES(performance_score),
         support_friction_score = VALUES(support_friction_score),
         career_growth_score    = VALUES(career_growth_score),
         top_risk_drivers_json  = VALUES(top_risk_drivers_json),
         recommended_actions_json = VALUES(recommended_actions_json),
         updated_at             = NOW()`,
      [
        randomUUID(), employeeId, today,
        Math.round(engagementScore * 100) / 100,
        dataConfidenceScore,
        riskLabel,
        Math.round(pulseScore * 100) / 100,
        Math.round(kudosScore * 100) / 100,
        Math.round(participationScore * 100) / 100,
        Math.round(attendanceScore * 100) / 100,
        Math.round(performanceScore * 100) / 100,
        Math.round(supportFrictionScore * 100) / 100,
        Math.round(careerGrowthScore * 100) / 100,
        JSON.stringify(riskDrivers),
        JSON.stringify(recommendedActions),
      ]
    );
  }

  // Also maintain backward compat: write to engagement_health_snapshot
  await db.execute(
    `INSERT INTO engagement_health_snapshot
       (id, employee_id, snapshot_date, engagement_score, pulse_score, kudos_score,
        participation_score, attendance_score, performance_score, risk_label, insight_json)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE
       engagement_score   = VALUES(engagement_score),
       pulse_score        = VALUES(pulse_score),
       kudos_score        = VALUES(kudos_score),
       participation_score = VALUES(participation_score),
       attendance_score   = VALUES(attendance_score),
       performance_score  = VALUES(performance_score),
       risk_label         = VALUES(risk_label),
       insight_json       = VALUES(insight_json),
       created_at         = NOW()`,
    [
      randomUUID(), employeeId, today,
      Math.round(engagementScore * 100) / 100,
      Math.round(pulseScore * 100) / 100,
      Math.round(kudosScore * 100) / 100,
      Math.round(participationScore * 100) / 100,
      Math.round(attendanceScore * 100) / 100,
      Math.round(performanceScore * 100) / 100,
      riskLabel,
      JSON.stringify(insight),
    ]
  );

  return {
    employee_id:            employeeId,
    snapshot_date:          today,
    engagement_score:       Math.round(engagementScore * 100) / 100,
    data_confidence_score:  dataConfidenceScore,
    risk_label:             riskLabel,
    pulse_score:            Math.round(pulseScore * 100) / 100,
    recognition_score:      Math.round(kudosScore * 100) / 100,
    participation_score:    Math.round(participationScore * 100) / 100,
    attendance_score:       Math.round(attendanceScore * 100) / 100,
    performance_score:      Math.round(performanceScore * 100) / 100,
    support_friction_score: Math.round(supportFrictionScore * 100) / 100,
    career_growth_score:    Math.round(careerGrowthScore * 100) / 100,
    top_risk_drivers:       riskDrivers,
    recommended_actions:    recommendedActions,
    insight,
    signals:                [...signals],
  };
}

export async function getEngagementCommandCenter(filters?: {
  branch_id?: string;
  process_id?: string;
  department_id?: string;
  manager_id?: string;
  risk_label?: string;
}) {
  const conds: string[] = [
    `hs.snapshot_date = (SELECT MAX(snapshot_date) FROM people_experience_health_snapshot)`
  ];
  const params: unknown[] = [];

  if (filters?.branch_id)     { conds.push("e.branch_id = ?");      params.push(filters.branch_id); }
  if (filters?.process_id)    { conds.push("e.process_id = ?");      params.push(filters.process_id); }
  if (filters?.department_id) { conds.push("e.department_id = ?");   params.push(filters.department_id); }
  if (filters?.manager_id)    { conds.push("e.reporting_manager_id = ?"); params.push(filters.manager_id); }
  if (filters?.risk_label)    { conds.push("hs.risk_label = ?");     params.push(filters.risk_label); }

  const where = conds.join(" AND ");

  const peTableExists = await tableExists("people_experience_health_snapshot");
  const snapshotTable = peTableExists ? "people_experience_health_snapshot" : "engagement_health_snapshot";
  const extraCols = peTableExists
    ? `, hs.data_confidence_score, hs.support_friction_score, hs.career_growth_score,
         hs.top_risk_drivers_json, hs.recommended_actions_json`
    : "";

  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT e.id AS employee_id,
            CONCAT_WS(' ', e.first_name, e.last_name) AS employee_name,
            e.employee_code,
            b.branch_name,
            p.process_name,
            d.department_name,
            hs.engagement_score,
            hs.risk_label,
            hs.pulse_score,
            hs.attendance_score,
            hs.performance_score,
            hs.snapshot_date
            ${extraCols}
       FROM ${snapshotTable} hs
       JOIN employees e ON e.id = hs.employee_id
       LEFT JOIN branch_master b ON b.id = e.branch_id
       LEFT JOIN process_master p ON p.id = e.process_id
       LEFT JOIN department_master d ON d.id = e.department_id
      WHERE ${where}
      ORDER BY hs.engagement_score ASC
      LIMIT 200`,
    params
  );

  const [summaryRows] = await db.execute<RowDataPacket[]>(
    `SELECT risk_label, COUNT(*) AS count, ROUND(AVG(engagement_score), 2) AS avg_score
       FROM ${snapshotTable}
      WHERE snapshot_date = (SELECT MAX(snapshot_date) FROM ${snapshotTable})
      GROUP BY risk_label`
  );

  const [kudosRows] = await db.execute<RowDataPacket[]>(
    `SELECT kt.kudos_id, kt.sent_at, kt.points_awarded, kt.custom_message,
            CASE WHEN kt.is_anonymous = 1 THEN 'Anonymous' ELSE sender.full_name END AS sender_name,
            receiver.full_name AS receiver_name,
            km.kudos_title, km.kudos_icon, km.kudos_category,
            COALESCE(reactions.reaction_count, 0) AS reaction_count
       FROM kudos_transaction kt
       LEFT JOIN employees sender ON sender.id = kt.sender_id
       LEFT JOIN employees receiver ON receiver.id = kt.receiver_id
       LEFT JOIN kudos_master km ON km.kudos_template_id = kt.kudos_template_id
       LEFT JOIN (SELECT kudos_id, COUNT(*) AS reaction_count FROM kudos_reaction GROUP BY kudos_id) reactions
         ON reactions.kudos_id = kt.kudos_id
      ORDER BY kt.sent_at DESC
      LIMIT 30`
  );

  return { summary: summaryRows, watchlist: rows, kudos_feed: kudosRows };
}

export async function scanEngagementHealth(limit = 500) {
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT id FROM employees WHERE LOWER(COALESCE(employment_status, 'active')) = 'active' LIMIT ?`,
    [limit]
  );

  const employees = rows as Array<{ id: string }>;
  const results: Awaited<ReturnType<typeof calculateEmployeeEngagementHealth>>[] = [];
  const concurrency = 10;

  for (let i = 0; i < employees.length; i += concurrency) {
    const batch = employees.slice(i, i + concurrency);
    results.push(...await Promise.all(batch.map((row) => calculateEmployeeEngagementHealth(row.id))));
  }

  return { scanned: results.length, results };
}

export async function getFilterOptions(userId: string, userRoles: string[]) {
  const isGlobal = userRoles.some(r => ["admin", "hr", "super_admin", "ceo"].includes(r));

  const [branches] = await db.execute<RowDataPacket[]>(
    isGlobal
      ? `SELECT id, branch_name AS name FROM branch_master WHERE active_status = 1 ORDER BY branch_name`
      : `SELECT DISTINCT bm.id, bm.branch_name AS name
           FROM branch_master bm
           JOIN employees e ON e.branch_id = bm.id
          WHERE e.reporting_manager_id IN (
            SELECT id FROM employees WHERE user_id = ? LIMIT 1
          ) AND bm.active_status = 1`,
    isGlobal ? [] : [userId]
  );

  const [processes] = await db.execute<RowDataPacket[]>(
    `SELECT id, process_name AS name FROM process_master WHERE active_status = 1 ORDER BY process_name`
  );

  const [departments] = await db.execute<RowDataPacket[]>(
    `SELECT id, department_name AS name FROM department_master WHERE active_status = 1 ORDER BY department_name`
  );

  const [managers] = await db.execute<RowDataPacket[]>(
    isGlobal
      ? `SELECT DISTINCT e.id, e.full_name AS name, e.employee_code
           FROM employees e
           JOIN employees sub ON sub.reporting_manager_id = e.id
          WHERE e.active_status = 1 ORDER BY e.full_name LIMIT 200`
      : `SELECT e.id, e.full_name AS name, e.employee_code
           FROM employees e
          WHERE e.user_id = ? AND e.active_status = 1 LIMIT 5`,
    isGlobal ? [] : [userId]
  );

  return {
    branches,
    processes,
    departments,
    managers,
    risk_labels: ["critical_people_risk", "attrition_risk", "watchlist", "stable", "highly_engaged"],
    support_categories: ["hr", "payroll", "it", "general", "asset", "attendance"],
  };
}
