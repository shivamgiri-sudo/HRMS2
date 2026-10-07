/**
 * Recruiter Analytics Service — Recruiter Dashboard Metrics
 */

import { db } from "../../db/mysql.js";
import type { RowDataPacket } from "mysql2";

interface RecruiterAnalyticsSummary {
  source_effectiveness: Array<{
    source: string;
    applications: number;
    conversion_pct: number;
  }>;
  offer_to_join_ratio: {
    offers_extended: number;
    offers_accepted: number;
    joined: number;
    acceptance_rate: number;
    join_rate: number;
  };
  pipeline_summary: Array<{ stage: string; count: number }>;
  recruiter_performance: { hires_this_month: number; avg_tat_days: number };
  interview_summary: {
    scheduled: number;
    conducted: number;
    no_show: number;
    no_show_pct: number;
  };
  onboarding_handover: {
    ready_for_ops: number;
    ops_accepted: number;
    pending_handover: number;
  };
}

export async function getRecruiterAnalyticsSummary(
  recruiterId?: number,
): Promise<RecruiterAnalyticsSummary> {
  const recruiterFilter = recruiterId
    ? `AND c.recruiter_id = ${recruiterId}`
    : "";

  const [sources] = await db.query<RowDataPacket[]>(
    `SELECT source, COUNT(*) as applications, SUM(CASE WHEN status IN ('selected', 'offered', 'joined') THEN 1 ELSE 0 END) as converted
     FROM candidates
     WHERE created_at >= DATE_SUB(CURDATE(), INTERVAL 90 DAY) ${recruiterFilter}
     GROUP BY source
     ORDER BY applications DESC`,
  );

  const [offers] = await db.query<RowDataPacket[]>(
    `SELECT
       SUM(CASE WHEN status IN ('offered', 'accepted', 'joined') THEN 1 ELSE 0 END) as offers_extended,
       SUM(CASE WHEN status IN ('accepted', 'joined') THEN 1 ELSE 0 END) as offers_accepted,
       SUM(CASE WHEN status = 'joined' THEN 1 ELSE 0 END) as joined
     FROM candidates
     WHERE created_at >= DATE_SUB(CURDATE(), INTERVAL 90 DAY) ${recruiterFilter}`,
  );

  const offersExtended = offers[0]?.offers_extended ?? 0;
  const offersAccepted = offers[0]?.offers_accepted ?? 0;
  const joined = offers[0]?.joined ?? 0;

  const [pipeline] = await db.query<RowDataPacket[]>(
    `SELECT stage, COUNT(*) as count
     FROM candidates
     WHERE status NOT IN ('rejected', 'joined', 'withdrawn') ${recruiterFilter}
     GROUP BY stage
     ORDER BY FIELD(stage, 'screening', 'interview', 'offer', 'onboarding')`,
  );

  const [performance] = await db.query<RowDataPacket[]>(
    `SELECT
       COUNT(*) as hires,
       AVG(DATEDIFF(joining_date, created_at)) as avg_tat
     FROM candidates
     WHERE status = 'joined'
       AND DATE_FORMAT(joining_date, '%Y-%m') = DATE_FORMAT(CURDATE(), '%Y-%m') ${recruiterFilter}`,
  );

  const [interviews] = await db.query<RowDataPacket[]>(
    `SELECT
       COUNT(*) as scheduled,
       SUM(CASE WHEN status = 'conducted' THEN 1 ELSE 0 END) as conducted,
       SUM(CASE WHEN status = 'no_show' THEN 1 ELSE 0 END) as no_show
     FROM interviews
     WHERE scheduled_date >= DATE_SUB(CURDATE(), INTERVAL 30 DAY) ${recruiterFilter.replace("c.recruiter_id", "recruiter_id")}`,
  );

  const scheduled = interviews[0]?.scheduled ?? 0;
  const noShow = interviews[0]?.no_show ?? 0;

  const [handover] = await db.query<RowDataPacket[]>(
    `SELECT
       SUM(CASE WHEN onboarding_status = 'ready_for_ops' THEN 1 ELSE 0 END) as ready,
       SUM(CASE WHEN onboarding_status = 'ops_accepted' THEN 1 ELSE 0 END) as accepted,
       SUM(CASE WHEN onboarding_status IN ('docs_pending', 'bgv_pending') THEN 1 ELSE 0 END) as pending
     FROM candidates
     WHERE status = 'onboarding' ${recruiterFilter}`,
  );

  return {
    source_effectiveness: sources.map((r) => {
      const apps = Number(r.applications);
      const conv = Number(r.converted ?? 0);
      return {
        source: r.source ?? "Unknown",
        applications: apps,
        conversion_pct: apps > 0 ? Math.round((conv / apps) * 100) : 0,
      };
    }),
    offer_to_join_ratio: {
      offers_extended: offersExtended,
      offers_accepted: offersAccepted,
      joined,
      acceptance_rate:
        offersExtended > 0
          ? Math.round((offersAccepted / offersExtended) * 100)
          : 0,
      join_rate:
        offersAccepted > 0 ? Math.round((joined / offersAccepted) * 100) : 0,
    },
    pipeline_summary: pipeline.map((r) => ({ stage: r.stage, count: r.count })),
    recruiter_performance: {
      hires_this_month: performance[0]?.hires ?? 0,
      avg_tat_days: Math.round(Number(performance[0]?.avg_tat ?? 0)),
    },
    interview_summary: {
      scheduled,
      conducted: interviews[0]?.conducted ?? 0,
      no_show: noShow,
      no_show_pct: scheduled > 0 ? Math.round((noShow / scheduled) * 100) : 0,
    },
    onboarding_handover: {
      ready_for_ops: handover[0]?.ready ?? 0,
      ops_accepted: handover[0]?.accepted ?? 0,
      pending_handover: handover[0]?.pending ?? 0,
    },
  };
}
