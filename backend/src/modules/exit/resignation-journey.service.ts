/**
 * "Before you go" journey summary for the My Resignation page.
 *
 * Read-only and always about ONE employee - the caller. The route resolves the employee from the
 * authenticated user and never accepts an id from the client, so nothing here takes a scope
 * decision: it is handed an employee id that is already known to be the caller's own.
 *
 * Every source is read through safeRows: a table that is missing on an environment, or a column
 * that drifted, yields an empty section rather than a 500. Each query is bounded (LIMIT) so a
 * long-serving employee with years of kudos cannot turn a page load into a table scan payload.
 * Every table/column below was checked against backend/sql/schema-snapshot.json.
 *
 * Compensation is deliberately NOT included (no CTC, no increment percentage) - this page is
 * opened on phones on the floor, and listComprehensiveJourney already hides compensation unless a
 * caller explicitly opts in. Increments appear as dated events only.
 */
import type { RowDataPacket } from "mysql2";
import { db } from "../../db/mysql.js";
import { getPolicyValue } from "../policy-engine/policy-engine.cache.js";

export type TimelineEventType =
  | "joining"
  | "confirmation"
  | "promotion"
  | "transfer"
  | "increment"
  | "anniversary"
  | "milestone";

export interface TimelineEvent {
  id: string;
  type: TimelineEventType;
  date: string; // YYYY-MM-DD
  title: string;
  detail: string | null;
}

export interface AchievementItem {
  id: string;
  title: string;
  detail: string | null;
  date: string | null;
}

export interface AchievementSection {
  count: number;
  recent: AchievementItem[];
}

export interface JourneySummary {
  profile: {
    employee_id: string;
    employee_code: string | null;
    name: string;
    first_name: string | null;
    designation: string | null;
    branch: string | null;
    department: string | null;
    process: string | null;
    photo_url: string | null;
    date_of_joining: string | null;
  };
  tenure: { years: number; months: number; total_months: number; label: string };
  notice_period_days: number;
  timeline: TimelineEvent[];
  achievements: {
    kudos: AchievementSection & { points: number };
    badges: AchievementSection;
    milestones: AchievementSection;
    recognitions: AchievementSection;
  };
}

const TIMELINE_SOURCE_LIMIT = 20;
const RECENT_LIMIT = 5;
/** Anniversaries worth celebrating on the timeline and in the milestones card. */
const ANNIVERSARY_YEARS = [1, 2, 3, 5, 7, 10, 15, 20, 25, 30];

async function safeRows(sql: string, params: unknown[]): Promise<RowDataPacket[]> {
  try {
    const [rows] = await db.execute<RowDataPacket[]>(sql, params);
    return Array.isArray(rows) ? rows : [];
  } catch {
    return [];
  }
}

async function safeCount(sql: string, params: unknown[]): Promise<number> {
  const rows = await safeRows(sql, params);
  const n = Number(rows[0]?.n ?? 0);
  return Number.isFinite(n) ? n : 0;
}

function dateOnly(value: unknown): string | null {
  if (value === null || value === undefined || value === "") return null;
  const s = String(value).slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null;
}

function clean(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  const s = String(value).trim();
  return s ? s : null;
}

function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? "" : "s"}`;
}

export function tenureLabel(totalMonths: number): string {
  const years = Math.floor(totalMonths / 12);
  const months = totalMonths % 12;
  if (years === 0 && months === 0) return "Less than a month";
  const parts: string[] = [];
  if (years > 0) parts.push(plural(years, "year"));
  if (months > 0) parts.push(plural(months, "month"));
  return parts.join(" ");
}

async function noticePeriodDays(): Promise<number> {
  try {
    const n = Number(await getPolicyValue("exit", "notice", "default_notice_days", "30"));
    return Number.isFinite(n) && n >= 0 ? Math.trunc(n) : 30;
  } catch {
    return 30;
  }
}

export async function getJourneySummary(employeeId: string): Promise<JourneySummary | null> {
  // Tenure is computed in SQL (TIMESTAMPDIFF against CURDATE()) - this codebase has a recorded
  // history of a host-timezone JS Date shifting a DATE by a day, and the month boundary is
  // exactly where that would show.
  const baseRows = await safeRows(
    `SELECT e.id, e.employee_code, e.first_name, e.last_name, e.full_name,
            COALESCE(NULLIF(TRIM(e.photo_url), ''), NULLIF(TRIM(e.avatar_url), '')) AS photo_url,
            DATE_FORMAT(e.date_of_joining, '%Y-%m-%d') AS date_of_joining,
            CASE WHEN e.date_of_joining IS NULL THEN 0
                 ELSE GREATEST(0, TIMESTAMPDIFF(MONTH, e.date_of_joining, CURDATE())) END AS total_months,
            d.designation_name, b.branch_name, dept.dept_name, p.process_name
       FROM employees e
       LEFT JOIN designation_master d ON d.id = e.designation_id
       LEFT JOIN branch_master b ON b.id = e.branch_id
       LEFT JOIN department_master dept ON dept.id = e.department_id
       LEFT JOIN process_master p ON p.id = e.process_id
      WHERE e.id = ?
      LIMIT 1`,
    [employeeId],
  );
  const emp = baseRows[0];
  if (!emp) return null;

  const totalMonths = Number(emp.total_months ?? 0) || 0;
  const doj = dateOnly(emp.date_of_joining);
  const name =
    clean(emp.full_name) ??
    clean([emp.first_name, emp.last_name].filter(Boolean).join(" ")) ??
    clean(emp.employee_code) ??
    "Colleague";

  const [
    probationRows,
    promotionRows,
    transferRows,
    incrementRows,
    anniversaryRows,
    kudosTxnCount,
    kudosLegacyCount,
    kudosPointsRows,
    kudosTxnRows,
    kudosLegacyRows,
    badgeCount,
    tenureBadgeCount,
    badgeRows,
    spotlightCount,
    spotlightRows,
    notice,
  ] = await Promise.all([
    safeRows(
      `SELECT id, DATE_FORMAT(COALESCE(actual_end_date, probation_end_date), '%Y-%m-%d') AS confirmed_on
         FROM employee_probation
        WHERE employee_id = ? AND status = 'confirmed'
        LIMIT 1`,
      [employeeId],
    ),
    safeRows(
      `SELECT id, from_designation, to_designation, DATE_FORMAT(effective_date, '%Y-%m-%d') AS effective_date
         FROM promotion_record
        WHERE employee_id = ? AND status IN ('approved', 'completed')
        ORDER BY effective_date DESC
        LIMIT ${TIMELINE_SOURCE_LIMIT}`,
      [employeeId],
    ),
    safeRows(
      `SELECT id, transfer_type, from_value, to_value, DATE_FORMAT(effective_date, '%Y-%m-%d') AS effective_date
         FROM transfer_record
        WHERE employee_id = ? AND status IN ('approved', 'completed')
        ORDER BY effective_date DESC
        LIMIT ${TIMELINE_SOURCE_LIMIT}`,
      [employeeId],
    ),
    safeRows(
      `SELECT id, DATE_FORMAT(effective_from, '%Y-%m-%d') AS effective_from
         FROM salary_increment_request
        WHERE employee_id = ? AND status IN ('approved', 'implemented')
        ORDER BY effective_from DESC
        LIMIT ${TIMELINE_SOURCE_LIMIT}`,
      [employeeId],
    ),
    // Anniversaries already reached, computed by MySQL so leap days and month ends follow the
    // same calendar rules as every other date column.
    doj
      ? safeRows(
          `SELECT y.n AS years, DATE_FORMAT(DATE_ADD(?, INTERVAL y.n YEAR), '%Y-%m-%d') AS on_date
             FROM (${ANNIVERSARY_YEARS.map(() => "SELECT ? AS n").join(" UNION ALL ")}) y
            WHERE DATE_ADD(?, INTERVAL y.n YEAR) <= CURDATE()
            ORDER BY y.n`,
          [doj, ...ANNIVERSARY_YEARS, doj],
        )
      : Promise.resolve([] as RowDataPacket[]),
    safeCount(`SELECT COUNT(*) AS n FROM kudos_transaction WHERE receiver_id = ?`, [employeeId]),
    safeCount(`SELECT COUNT(*) AS n FROM kudos_recognition WHERE to_employee_id = ?`, [employeeId]),
    safeRows(
      `SELECT COALESCE(SUM(points_awarded), 0) AS points FROM kudos_transaction WHERE receiver_id = ?`,
      [employeeId],
    ),
    safeRows(
      `SELECT kt.kudos_id AS id, kt.custom_message, kt.sent_at, km.kudos_title,
              CASE WHEN kt.is_anonymous = 1 THEN 'A colleague'
                   ELSE COALESCE(NULLIF(TRIM(s.full_name), ''), NULLIF(TRIM(CONCAT_WS(' ', s.first_name, s.last_name)), ''), 'A colleague')
              END AS from_name
         FROM kudos_transaction kt
         LEFT JOIN kudos_master km ON km.kudos_template_id = kt.kudos_template_id
         LEFT JOIN employees s ON s.id = kt.sender_id
        WHERE kt.receiver_id = ?
        ORDER BY kt.sent_at DESC
        LIMIT ${RECENT_LIMIT}`,
      [employeeId],
    ),
    safeRows(
      `SELECT kr.id, kr.kudos_text, kr.kudos_type, kr.created_at,
              COALESCE(NULLIF(TRIM(s.full_name), ''), NULLIF(TRIM(CONCAT_WS(' ', s.first_name, s.last_name)), ''), 'A colleague') AS from_name
         FROM kudos_recognition kr
         LEFT JOIN employees s ON s.id = kr.from_employee_id
        WHERE kr.to_employee_id = ?
        ORDER BY kr.created_at DESC
        LIMIT ${RECENT_LIMIT}`,
      [employeeId],
    ),
    safeCount(`SELECT COUNT(*) AS n FROM employee_badge_earned WHERE employee_id = ?`, [employeeId]),
    safeCount(
      `SELECT COUNT(*) AS n
         FROM employee_badge_earned ebe
         JOIN gamification_badge_master gbm ON gbm.badge_id = ebe.badge_id
        WHERE ebe.employee_id = ? AND LOWER(gbm.badge_category) = 'tenure'`,
      [employeeId],
    ),
    safeRows(
      `SELECT ebe.earned_id AS id, ebe.earned_at, ebe.reason,
              gbm.badge_name, gbm.badge_description, gbm.badge_category
         FROM employee_badge_earned ebe
         LEFT JOIN gamification_badge_master gbm ON gbm.badge_id = ebe.badge_id
        WHERE ebe.employee_id = ?
        ORDER BY ebe.earned_at DESC
        LIMIT ${RECENT_LIMIT * 2}`,
      [employeeId],
    ),
    safeCount(`SELECT COUNT(*) AS n FROM employee_spotlight_nomination WHERE nominee_id = ?`, [employeeId]),
    safeRows(
      `SELECT id, reason, DATE_FORMAT(COALESCE(nomination_week, created_at), '%Y-%m-%d') AS on_date
         FROM employee_spotlight_nomination
        WHERE nominee_id = ?
        ORDER BY created_at DESC
        LIMIT ${RECENT_LIMIT}`,
      [employeeId],
    ),
    noticePeriodDays(),
  ]);

  // ── Timeline ────────────────────────────────────────────────────────────────
  const timeline: TimelineEvent[] = [];
  if (doj) {
    const where = [clean(emp.designation_name), clean(emp.branch_name)].filter(Boolean).join(" · ");
    timeline.push({
      id: `joining-${employeeId}`,
      type: "joining",
      date: doj,
      title: "Joined MAS Callnet",
      detail: where || null,
    });
  }
  const confirmedOn = dateOnly(probationRows[0]?.confirmed_on);
  if (confirmedOn) {
    timeline.push({
      id: `confirmation-${probationRows[0].id}`,
      type: "confirmation",
      date: confirmedOn,
      title: "Confirmed after probation",
      detail: null,
    });
  }
  for (const r of promotionRows) {
    const date = dateOnly(r.effective_date);
    if (!date) continue;
    const to = clean(r.to_designation);
    const from = clean(r.from_designation);
    timeline.push({
      id: `promotion-${r.id}`,
      type: "promotion",
      date,
      title: to ? `Promoted to ${to}` : "Promotion",
      detail: from && to ? `${from} → ${to}` : null,
    });
  }
  for (const r of transferRows) {
    const date = dateOnly(r.effective_date);
    if (!date) continue;
    const kind = clean(r.transfer_type)?.replace(/_/g, " ") ?? "role";
    const to = clean(r.to_value);
    timeline.push({
      id: `transfer-${r.id}`,
      type: "transfer",
      date,
      title: `New ${kind}${to ? `: ${to}` : ""}`,
      detail: clean(r.from_value) && to ? `${clean(r.from_value)} → ${to}` : null,
    });
  }
  for (const r of incrementRows) {
    const date = dateOnly(r.effective_from);
    if (!date) continue;
    timeline.push({ id: `increment-${r.id}`, type: "increment", date, title: "Salary increment", detail: null });
  }
  const milestoneItems: AchievementItem[] = [];
  for (const r of anniversaryRows) {
    const date = dateOnly(r.on_date);
    const years = Number(r.years);
    if (!date || !Number.isFinite(years)) continue;
    const title = `${plural(years, "year")} with MAS Callnet`;
    timeline.push({ id: `anniversary-${years}`, type: "anniversary", date, title, detail: null });
    milestoneItems.push({ id: `anniversary-${years}`, title, detail: null, date });
  }
  timeline.sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id));

  // ── Achievements ────────────────────────────────────────────────────────────
  const kudosRecent: AchievementItem[] = [
    ...kudosTxnRows.map((r) => ({
      id: `kudos-${r.id}`,
      title: clean(r.kudos_title) ?? "Kudos",
      detail: clean(r.custom_message) ? `${clean(r.custom_message)} — ${r.from_name}` : `From ${r.from_name}`,
      date: dateOnly(r.sent_at),
    })),
    ...kudosLegacyRows.map((r) => ({
      id: `kudos-legacy-${r.id}`,
      title: clean(r.kudos_type)?.replace(/_/g, " ") ?? "Kudos",
      detail: clean(r.kudos_text) ? `${clean(r.kudos_text)} — ${r.from_name}` : `From ${r.from_name}`,
      date: dateOnly(r.created_at),
    })),
  ]
    .sort((a, b) => String(b.date ?? "").localeCompare(String(a.date ?? "")))
    .slice(0, RECENT_LIMIT);

  // Tenure badges are milestones, not "badges" - showing a 1-year badge in both cards would
  // count the same achievement twice.
  const isTenureBadge = (r: RowDataPacket) => String(r.badge_category ?? "").toLowerCase() === "tenure";
  const tenureBadgeRows = badgeRows.filter(isTenureBadge);
  const otherBadgeRows = badgeRows.filter((r) => !isTenureBadge(r));
  for (const r of tenureBadgeRows) {
    milestoneItems.push({
      id: `badge-${r.id}`,
      title: clean(r.badge_name) ?? "Tenure badge",
      detail: clean(r.badge_description),
      date: dateOnly(r.earned_at),
    });
  }
  milestoneItems.sort((a, b) => String(b.date ?? "").localeCompare(String(a.date ?? "")));

  return {
    profile: {
      employee_id: String(emp.id),
      employee_code: clean(emp.employee_code),
      name,
      first_name: clean(emp.first_name),
      designation: clean(emp.designation_name),
      branch: clean(emp.branch_name),
      department: clean(emp.dept_name),
      process: clean(emp.process_name),
      photo_url: clean(emp.photo_url),
      date_of_joining: doj,
    },
    tenure: {
      years: Math.floor(totalMonths / 12),
      months: totalMonths % 12,
      total_months: totalMonths,
      label: tenureLabel(totalMonths),
    },
    notice_period_days: notice,
    timeline,
    achievements: {
      kudos: {
        count: kudosTxnCount + kudosLegacyCount,
        points: Number(kudosPointsRows[0]?.points ?? 0) || 0,
        recent: kudosRecent,
      },
      badges: {
        count: Math.max(0, badgeCount - tenureBadgeCount),
        recent: otherBadgeRows.slice(0, RECENT_LIMIT).map((r) => ({
          id: `badge-${r.id}`,
          title: clean(r.badge_name) ?? "Badge",
          detail: clean(r.reason) ?? clean(r.badge_description),
          date: dateOnly(r.earned_at),
        })),
      },
      milestones: {
        count: anniversaryRows.length + tenureBadgeCount,
        recent: milestoneItems.slice(0, RECENT_LIMIT),
      },
      recognitions: {
        count: spotlightCount,
        recent: spotlightRows.map((r) => ({
          id: `spotlight-${r.id}`,
          title: "Spotlight nomination",
          detail: clean(r.reason),
          date: dateOnly(r.on_date),
        })),
      },
    },
  };
}
