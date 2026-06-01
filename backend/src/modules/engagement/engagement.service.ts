import type { RowDataPacket } from "mysql2";
import { db } from "../../db/mysql.js";
import { getEmployeeBadges } from "./badge.service.js";
import { getEmployeeTier, getPointsHistory } from "./gamification.service.js";
import { listKudos } from "./kudos.service.js";

export async function getEmployeeEngagementSummary(employeeId: string) {
  const [tier, badges, kudos, points, surveyRows, pulseRows] = await Promise.all([
    getEmployeeTier(employeeId),
    getEmployeeBadges(employeeId),
    listKudos({ receiver_id: employeeId }, 5),
    getPointsHistory(employeeId, undefined, 1, 5),
    db.execute<RowDataPacket[]>(
      "SELECT COUNT(DISTINCT survey_id) as total FROM survey_response WHERE employee_id = ?",
      [employeeId]
    ),
    db.execute<RowDataPacket[]>(
      "SELECT COUNT(*) as total FROM pulse_check WHERE employee_id = ?",
      [employeeId]
    ),
  ]);

  return {
    employee_id: employeeId,
    total_points: tier.total_points,
    current_tier: tier.current_tier,
    points_to_next_tier: tier.points_to_next_tier,
    progress_percentage: tier.progress_percentage,
    badges_earned: badges,
    kudos_received: kudos,
    surveys_completed: Number(surveyRows[0][0]?.total ?? 0),
    pulse_checks_submitted: Number(pulseRows[0][0]?.total ?? 0),
    recent_transactions: points.data,
  };
}

