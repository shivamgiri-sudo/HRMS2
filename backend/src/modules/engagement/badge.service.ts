// =====================================================
// Badge Service
// File: badge.service.ts
// Description: Badge management and auto-award logic
// =====================================================

import { db } from '../../db/mysql.js';
import type { RowDataPacket, ResultSetHeader } from 'mysql2';
import type {
  BadgeMaster,
  EmployeeBadgeEarned,
  CreateBadgeDTO,
  UpdateBadgeDTO,
  AwardBadgeDTO,
  BadgeFilters,
  BadgeCriteria,
} from './engagement.types.js';
import crypto from 'crypto';
import { addPoints } from './gamification.service.js';

export type AutoAwardActivity =
  | 'performance_review'
  | 'attendance'
  | 'survey_completed'
  | 'payslip_acknowledged'
  | 'kpi_score_recorded'
  | 'tenure';

// =====================================================
// BADGE MANAGEMENT
// =====================================================

/**
 * Get badges with optional filters
 */
export async function getBadges(filters?: BadgeFilters): Promise<BadgeMaster[]> {
  let sql = `
    SELECT DISTINCT badge_id, badge_name, badge_description, badge_icon,
           badge_category, points_value, criteria_json, is_active,
           created_at, updated_at
    FROM gamification_badge_master
    WHERE 1=1
  `;
  const params: unknown[] = [];

  if (filters?.badge_category) {
    sql += ' AND badge_category = ?';
    params.push(filters.badge_category);
  }

  if (filters?.is_active !== undefined) {
    sql += ' AND is_active = ?';
    params.push(filters.is_active);
  }

  if (filters?.search) {
    sql += ' AND (badge_name LIKE ? OR badge_description LIKE ?)';
    const searchTerm = `%${filters.search}%`;
    params.push(searchTerm, searchTerm);
  }

  sql += ' GROUP BY badge_id ORDER BY badge_category, badge_name';

  const [rows] = await db.execute<RowDataPacket[]>(sql, params);

  return rows.map((row) => ({
    badge_id: row.badge_id as string,
    badge_name: row.badge_name as string,
    badge_description: row.badge_description as string | null,
    badge_icon: row.badge_icon as string | null,
    badge_category: row.badge_category as BadgeMaster['badge_category'],
    points_value: row.points_value as number,
    criteria_json: row.criteria_json as BadgeCriteria | null,
    is_active: Boolean(row.is_active),
    created_at: row.created_at as string,
    updated_at: row.updated_at as string,
  }));
}

/**
 * Get single badge by ID
 */
export async function getBadgeById(badgeId: string): Promise<BadgeMaster | null> {
  const sql = `
    SELECT badge_id, badge_name, badge_description, badge_icon,
           badge_category, points_value, criteria_json, is_active,
           created_at, updated_at
    FROM gamification_badge_master
    WHERE badge_id = ?
  `;

  const [rows] = await db.execute<RowDataPacket[]>(sql, [badgeId]);

  if (rows.length === 0) return null;

  const row = rows[0];
  return {
    badge_id: row.badge_id as string,
    badge_name: row.badge_name as string,
    badge_description: row.badge_description as string | null,
    badge_icon: row.badge_icon as string | null,
    badge_category: row.badge_category as BadgeMaster['badge_category'],
    points_value: row.points_value as number,
    criteria_json: row.criteria_json as BadgeCriteria | null,
    is_active: Boolean(row.is_active),
    created_at: row.created_at as string,
    updated_at: row.updated_at as string,
  };
}

/**
 * Create new badge
 */
export async function createBadge(data: CreateBadgeDTO): Promise<BadgeMaster> {
  const badgeId = crypto.randomUUID();
  const now = new Date().toISOString();

  const sql = `
    INSERT INTO gamification_badge_master (
      badge_id, badge_name, badge_description, badge_icon,
      badge_category, points_value, criteria_json, is_active,
      created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `;

  const params = [
    badgeId,
    data.badge_name,
    data.badge_description || null,
    data.badge_icon || null,
    data.badge_category,
    data.points_value,
    data.criteria_json ? JSON.stringify(data.criteria_json) : null,
    data.is_active ?? true,
    now,
    now,
  ];

  await db.executeRun(sql, params);

  const badge = await getBadgeById(badgeId);
  if (!badge) throw new Error('Failed to create badge');

  return badge;
}

/**
 * Update badge
 */
export async function updateBadge(
  badgeId: string,
  updates: UpdateBadgeDTO
): Promise<BadgeMaster | null> {
  const fields: string[] = [];
  const params: unknown[] = [];

  if (updates.badge_name !== undefined) {
    fields.push('badge_name = ?');
    params.push(updates.badge_name);
  }
  if (updates.badge_description !== undefined) {
    fields.push('badge_description = ?');
    params.push(updates.badge_description);
  }
  if (updates.badge_icon !== undefined) {
    fields.push('badge_icon = ?');
    params.push(updates.badge_icon);
  }
  if (updates.badge_category !== undefined) {
    fields.push('badge_category = ?');
    params.push(updates.badge_category);
  }
  if (updates.points_value !== undefined) {
    fields.push('points_value = ?');
    params.push(updates.points_value);
  }
  if (updates.criteria_json !== undefined) {
    fields.push('criteria_json = ?');
    params.push(updates.criteria_json ? JSON.stringify(updates.criteria_json) : null);
  }
  if (updates.is_active !== undefined) {
    fields.push('is_active = ?');
    params.push(updates.is_active);
  }

  if (fields.length === 0) {
    return getBadgeById(badgeId);
  }

  fields.push('updated_at = ?');
  params.push(new Date().toISOString());
  params.push(badgeId);

  const sql = `UPDATE gamification_badge_master SET ${fields.join(', ')} WHERE badge_id = ?`;

  await db.executeRun(sql, params);

  return getBadgeById(badgeId);
}

/**
 * Deactivate badge (soft delete)
 */
export async function deactivateBadge(badgeId: string): Promise<boolean> {
  const sql = `UPDATE gamification_badge_master SET is_active = 0, updated_at = ? WHERE badge_id = ?`;
  const [result] = await db.executeRun(sql, [new Date().toISOString(), badgeId]);
  return (result as ResultSetHeader).affectedRows > 0;
}

// =====================================================
// BADGE AWARDING
// =====================================================

/**
 * Award badge manually
 */
export async function awardBadge(data: AwardBadgeDTO): Promise<EmployeeBadgeEarned> {
  // Check if employee exists
  const [empRows] = await db.execute<RowDataPacket[]>(
    'SELECT id FROM employees WHERE id = ?',
    [data.employee_id]
  );
  if (empRows.length === 0) {
    throw new Error(`Employee ${data.employee_id} not found`);
  }

  // Check if badge exists and is active
  const badge = await getBadgeById(data.badge_id);
  if (!badge) {
    throw new Error(`Badge ${data.badge_id} not found`);
  }
  if (!badge.is_active) {
    throw new Error(`Badge ${data.badge_id} is not active`);
  }

  // Check if already earned
  const [existingRows] = await db.execute<RowDataPacket[]>(
    'SELECT earned_id FROM employee_badge_earned WHERE employee_id = ? AND badge_id = ?',
    [data.employee_id, data.badge_id]
  );
  if (existingRows.length > 0) {
    throw new Error(`Employee ${data.employee_id} already has badge ${data.badge_id}`);
  }

  const earnedId = crypto.randomUUID();
  const now = new Date().toISOString();

  const sql = `
    INSERT IGNORE INTO employee_badge_earned (
      earned_id, employee_id, badge_id, earned_at,
      reason, awarded_by, metadata_json
    ) VALUES (?, ?, ?, ?, ?, ?, ?)
  `;

  const params = [
    earnedId,
    data.employee_id,
    data.badge_id,
    now,
    data.reason || null,
    data.awarded_by || null,
    data.metadata_json ? JSON.stringify(data.metadata_json) : null,
  ];

  await db.executeRun(sql, params);

  if (badge.points_value > 0) {
    await addPoints(
      data.employee_id,
      badge.points_value,
      'badge_earned',
      `Badge earned: ${badge.badge_name}`,
      earnedId
    );
  }

  return {
    earned_id: earnedId,
    employee_id: data.employee_id,
    badge_id: data.badge_id,
    earned_at: now,
    reason: data.reason || null,
    awarded_by: data.awarded_by || null,
    metadata_json: data.metadata_json || null,
  };
}

/**
 * Get employee's badges
 */
export async function getEmployeeBadges(employeeId: string): Promise<
  Array<
    EmployeeBadgeEarned & {
      badge_name: string;
      badge_icon: string | null;
      badge_category: string;
      points_value: number;
    }
  >
> {
  const sql = `
    SELECT
      ebe.earned_id, ebe.employee_id, ebe.badge_id, ebe.earned_at,
      ebe.reason, ebe.awarded_by, ebe.metadata_json,
      bm.badge_name, bm.badge_icon, bm.badge_category, bm.points_value
    FROM employee_badge_earned ebe
    JOIN gamification_badge_master bm ON ebe.badge_id = bm.badge_id
    WHERE ebe.employee_id = ?
    ORDER BY ebe.earned_at DESC
  `;

  const [rows] = await db.execute<RowDataPacket[]>(sql, [employeeId]);

  return rows.map((row) => ({
    earned_id: row.earned_id as string,
    employee_id: row.employee_id as string,
    badge_id: row.badge_id as string,
    earned_at: row.earned_at as string,
    reason: row.reason as string | null,
    awarded_by: row.awarded_by as string | null,
    metadata_json: row.metadata_json as Record<string, unknown> | null,
    badge_name: row.badge_name as string,
    badge_icon: row.badge_icon as string | null,
    badge_category: row.badge_category as string,
    points_value: row.points_value as number,
  }));
}

// =====================================================
// AUTO-AWARD LOGIC
// =====================================================

/**
 * Check and award auto-badges based on activity type
 */
export async function checkAutoAwards(
  employeeId: string,
  activityType: AutoAwardActivity
): Promise<EmployeeBadgeEarned[]> {
  const awarded: EmployeeBadgeEarned[] = [];

  switch (activityType) {
    case 'performance_review':
      awarded.push(...(await checkPerformanceBadges(employeeId)));
      break;
    case 'attendance':
      awarded.push(...(await checkAttendanceBadges(employeeId)));
      break;
    case 'survey_completed':
      awarded.push(...(await checkSurveyBadges(employeeId)));
      break;
    case 'payslip_acknowledged':
      awarded.push(...(await checkPayslipBadges(employeeId)));
      break;
    case 'kpi_score_recorded':
      awarded.push(...(await checkKpiBadges(employeeId)));
      break;
    case 'tenure':
      awarded.push(...(await checkTenureBadges(employeeId)));
      break;
    default:
      break;
  }

  return awarded;
}

/**
 * Queue a best-effort badge evaluation after a protected workflow succeeds.
 */
export function queueAutoAwards(employeeId: string, activityType: AutoAwardActivity): void {
  const timeout = setTimeout(() => {
    void checkAutoAwards(employeeId, activityType).catch((error: unknown) => {
      console.error(`Failed to evaluate ${activityType} badges for ${employeeId}`, error);
    });
  }, 0);
  timeout.unref();
}

function areConsecutiveMonthlyPeriods(rows: RowDataPacket[]): boolean {
  const periods = rows.map((row) => {
    const [year, month] = String(row.period).split("-").map(Number);
    return Number.isInteger(year) && Number.isInteger(month) ? year * 12 + month : Number.NaN;
  });
  return periods.every((period, index) => index === 0 || periods[index - 1] - period === 1);
}

/**
 * Check performance badges (top_performer, revenue_champion)
 */
async function checkPerformanceBadges(employeeId: string): Promise<EmployeeBadgeEarned[]> {
  const awarded: EmployeeBadgeEarned[] = [];

  // Top Performer: Rating >= 4.5 in the latest generated feedback report
  const [perfRows] = await db.execute<RowDataPacket[]>(
    `SELECT overall_score
     FROM performance_feedback_report
     WHERE employee_id = ?
     ORDER BY report_generated_at DESC
     LIMIT 1`,
    [employeeId]
  );

  if (perfRows.length > 0 && perfRows[0].overall_score >= 4.5) {
    const badge = await findBadgeByName('Top Performer');
    if (badge) {
      try {
        const earned = await awardBadge({
          employee_id: employeeId,
          badge_id: badge.badge_id,
          reason: 'Achieved rating >= 4.5 in performance review',
          awarded_by: 'system',
        });
        awarded.push(earned);
      } catch (err) {
        // Badge already awarded or other error - skip
      }
    }
  }

  return awarded;
}

/**
 * Check attendance badges (early_bird, perfect_attendance)
 */
async function checkAttendanceBadges(employeeId: string): Promise<EmployeeBadgeEarned[]> {
  const awarded: EmployeeBadgeEarned[] = [];

  // Early Bird: 90%+ check-ins before 9:00 AM in last 30 days
  const [earlyRows] = await db.execute<RowDataPacket[]>(
    `SELECT
       COUNT(*) as total_days,
       SUM(CASE WHEN TIME(login_time) < '09:00:00' THEN 1 ELSE 0 END) as early_count
     FROM wfm_attendance_session
     WHERE employee_id = ?
       AND login_time >= DATE_SUB(NOW(), INTERVAL 30 DAY)
       AND login_time IS NOT NULL`,
    [employeeId]
  );

  if (earlyRows.length > 0 && earlyRows[0].total_days >= 20) {
    const earlyPercentage = (earlyRows[0].early_count / earlyRows[0].total_days) * 100;
    if (earlyPercentage >= 90) {
      const badge = await findBadgeByName('Early Bird');
      if (badge) {
        try {
          const earned = await awardBadge({
            employee_id: employeeId,
            badge_id: badge.badge_id,
            reason: '90%+ check-ins before 9 AM in last 30 days',
            awarded_by: 'system',
          });
          awarded.push(earned);
        } catch (err) {
          // Badge already awarded or other error - skip
        }
      }
    }
  }

  // Perfect Attendance: No absences in last 90 days
  const [absenceRows] = await db.execute<RowDataPacket[]>(
    `SELECT
       COUNT(*) as rostered_days,
       SUM(CASE WHEN s.id IS NULL OR s.login_time IS NULL THEN 1 ELSE 0 END) as absence_count
     FROM wfm_roster_assignment ra
     LEFT JOIN wfm_attendance_session s
       ON s.employee_id = ra.employee_id AND s.session_date = ra.roster_date
     WHERE ra.employee_id = ?
       AND ra.roster_date >= DATE_SUB(CURDATE(), INTERVAL 90 DAY)
       AND ra.roster_status NOT IN ('Week Off', 'Holiday')`,
    [employeeId]
  );

  if (
    absenceRows.length > 0 &&
    absenceRows[0].rostered_days >= 60 &&
    absenceRows[0].absence_count === 0
  ) {
    const badge = await findBadgeByName('Perfect Attendance');
    if (badge) {
      try {
        const earned = await awardBadge({
          employee_id: employeeId,
          badge_id: badge.badge_id,
          reason: 'No absences in last 90 days',
          awarded_by: 'system',
        });
        awarded.push(earned);
      } catch (err) {
        // Badge already awarded or other error - skip
      }
    }
  }

  return awarded;
}

/**
 * Check survey badges (survey_champion)
 */
async function checkSurveyBadges(employeeId: string): Promise<EmployeeBadgeEarned[]> {
  const awarded: EmployeeBadgeEarned[] = [];

  // Survey Champion: Completed 10+ surveys or pulse checks
  const [surveyRows] = await db.execute<RowDataPacket[]>(
    `SELECT
       (SELECT COUNT(DISTINCT survey_id) FROM survey_response WHERE employee_id = ?)
       +
       (SELECT COUNT(*) FROM pulse_check WHERE employee_id = ?) as participation_count`,
    [employeeId, employeeId]
  );

  if (surveyRows.length > 0 && surveyRows[0].participation_count >= 10) {
    const badge = await findBadgeByName('Survey Champion');
    if (badge) {
      try {
        const earned = await awardBadge({
          employee_id: employeeId,
          badge_id: badge.badge_id,
          reason: 'Completed 10+ surveys or pulse checks',
          awarded_by: 'system',
        });
        awarded.push(earned);
      } catch (err) {
        // Badge already awarded or other error - skip
      }
    }
  }

  return awarded;
}

/**
 * Check payslip acknowledgement badges.
 */
async function checkPayslipBadges(employeeId: string): Promise<EmployeeBadgeEarned[]> {
  const awarded: EmployeeBadgeEarned[] = [];
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT COUNT(*) as acknowledgement_count
     FROM salary_payslip
     WHERE employee_id = ? AND acknowledged_at IS NOT NULL`,
    [employeeId]
  );

  if (rows.length > 0 && rows[0].acknowledgement_count >= 10) {
    const badge = await findBadgeByName('Payslip Champion');
    if (badge) {
      try {
        const earned = await awardBadge({
          employee_id: employeeId,
          badge_id: badge.badge_id,
          reason: 'Acknowledged 10+ payslips',
          awarded_by: 'system',
        });
        awarded.push(earned);
      } catch (err) {
        // Badge already awarded or other error - skip
      }
    }
  }

  return awarded;
}

/**
 * Check KPI badges from the last three recorded periods.
 */
async function checkKpiBadges(employeeId: string): Promise<EmployeeBadgeEarned[]> {
  const awarded: EmployeeBadgeEarned[] = [];
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT ks.period,
            ROUND(
              SUM(
                LEAST(
                  CASE
                    WHEN km.direction = 'lower_is_better'
                      THEN CASE WHEN ks.actual_value > 0 THEN ktm.target_value / ks.actual_value ELSE 1.2 END
                    ELSE CASE WHEN ktm.target_value > 0 THEN ks.actual_value / ktm.target_value ELSE 0 END
                  END,
                  1.2
                ) * ktm.weight_pct
              ) / NULLIF(SUM(ktm.weight_pct), 0) * 100,
              2
            ) as weighted_score_pct
     FROM kpi_score ks
     JOIN kpi_template_metric ktm ON ktm.metric_id = ks.metric_id
     JOIN kpi_metric_master km ON km.id = ks.metric_id
     WHERE ks.employee_id = ?
       AND ktm.template_id = (
         SELECT ka.template_id
         FROM kpi_assignment ka
         LEFT JOIN employees e ON e.id = ?
         WHERE ka.active_status = 1
           AND (
             ka.employee_id = ?
             OR (ka.employee_id IS NULL AND ka.designation_id = e.designation_id)
             OR (ka.employee_id IS NULL AND ka.designation_id IS NULL AND ka.department_id = e.department_id)
           )
         ORDER BY
           (ka.employee_id IS NOT NULL) DESC,
           (ka.designation_id IS NOT NULL) DESC,
           (ka.department_id IS NOT NULL) DESC
         LIMIT 1
       )
     GROUP BY ks.period
     ORDER BY ks.period DESC
     LIMIT 3`,
    [employeeId, employeeId, employeeId]
  );

  if (
    rows.length === 3 &&
    areConsecutiveMonthlyPeriods(rows) &&
    rows.every((row) => Number(row.weighted_score_pct) >= 100)
  ) {
    // Use "KPI Overachiever" for the KPI path to avoid collision with "Top Performer"
    // awarded via the performance-review path in checkPerformanceBadges.
    const badge = await findBadgeByName('KPI Overachiever') || await findBadgeByName('Top Performer');
    if (badge) {
      try {
        const earned = await awardBadge({
          employee_id: employeeId,
          badge_id: badge.badge_id,
          reason: 'Exceeded KPI targets for 3 consecutive months',
          awarded_by: 'system',
        });
        awarded.push(earned);
      } catch (err) {
        // Badge already awarded or other error - skip
      }
    }
  }

  return awarded;
}

/**
 * Check tenure badges (6_month, 1_year, 2_year, 5_year)
 */
async function checkTenureBadges(employeeId: string): Promise<EmployeeBadgeEarned[]> {
  const awarded: EmployeeBadgeEarned[] = [];

  // Get employee join date
  const [empRows] = await db.execute<RowDataPacket[]>(
    'SELECT date_of_joining FROM employees WHERE id = ?',
    [employeeId]
  );

  if (empRows.length === 0) return awarded;

  const joinDate = new Date(empRows[0].date_of_joining as string);
  const now = new Date();
  let tenureMonths =
    (now.getFullYear() - joinDate.getFullYear()) * 12 + (now.getMonth() - joinDate.getMonth());
  if (now.getDate() < joinDate.getDate()) tenureMonths -= 1;

  const tenureMilestones = [
    { months: 6, name: '6 Month Milestone' },
    { months: 12, name: '1 Year Anniversary' },
    { months: 24, name: '2 Year Veteran' },
    { months: 60, name: '5 Year Legend' },
  ];

  for (const milestone of tenureMilestones) {
    if (tenureMonths >= milestone.months) {
      const badge = await findBadgeByName(milestone.name);
      if (badge) {
        try {
          const earned = await awardBadge({
            employee_id: employeeId,
            badge_id: badge.badge_id,
            reason: `${milestone.months} months of service`,
            awarded_by: 'system',
          });
          awarded.push(earned);
        } catch (err) {
          // Badge already awarded or other error - skip
        }
      }
    }
  }

  return awarded;
}

/**
 * Helper: Find badge by name
 */
async function findBadgeByName(badgeName: string): Promise<BadgeMaster | null> {
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT badge_id, badge_name, badge_description, badge_icon,
            badge_category, points_value, criteria_json, is_active,
            created_at, updated_at
     FROM gamification_badge_master
     WHERE badge_name = ? AND is_active = 1`,
    [badgeName]
  );

  if (rows.length === 0) return null;

  const row = rows[0];
  return {
    badge_id: row.badge_id as string,
    badge_name: row.badge_name as string,
    badge_description: row.badge_description as string | null,
    badge_icon: row.badge_icon as string | null,
    badge_category: row.badge_category as BadgeMaster['badge_category'],
    points_value: row.points_value as number,
    criteria_json: row.criteria_json as BadgeCriteria | null,
    is_active: Boolean(row.is_active),
    created_at: row.created_at as string,
    updated_at: row.updated_at as string,
  };
}
