import mysql from "mysql2/promise";
import type { RowDataPacket } from "mysql2";

export async function getPerfSummary(
  pool: mysql.Pool,
  from: string,
  to: string,
  aprSql: string,
  auditSql: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  aprParams: any[],
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  auditParams: any[],
): Promise<Record<string, unknown>> {
  const [aprRows, auditRows, salesRows] = await Promise.all([
    pool.execute<RowDataPacket[]>(
      `SELECT COUNT(DISTINCT UserID) AS total_agents,
        ROUND(AVG(Calls), 1) AS avg_calls_per_agent,
        ROUND(AVG(CASE WHEN TIME_TO_SEC(COALESCE(Login_Time,'00:00:00')) > 0
          THEN (TIME_TO_SEC(COALESCE(BIO,'00:00:00'))+TIME_TO_SEC(COALESCE(LUNCH,'00:00:00'))
               +TIME_TO_SEC(COALESCE(QA,'00:00:00'))+TIME_TO_SEC(COALESCE(TRAINING,'00:00:00'))
               +TIME_TO_SEC(COALESCE(DISMX,'00:00:00')))
               /TIME_TO_SEC(COALESCE(Login_Time,'00:00:00'))*100 ELSE NULL END),1) AS avg_shrinkage,
        ROUND(AVG(CASE WHEN TIME_TO_SEC(COALESCE(Net_Login,'00:00:00'))>0
          THEN Calls/(TIME_TO_SEC(COALESCE(Net_Login,'00:00:00'))/3600) ELSE NULL END),2) AS calls_per_hour_avg
      FROM Shivamgiri.apr WHERE ReportDate BETWEEN ? AND ?${aprSql}`,
      [...aprParams],
    ),
    pool.execute<RowDataPacket[]>(
      `SELECT ROUND(AVG(quality_percentage), 2) AS avg_quality
      FROM db_audit.call_quality_assessment WHERE CallDate BETWEEN ? AND ?${auditSql}`,
      [...auditParams],
    ),
    pool.execute<RowDataPacket[]>(
      `SELECT COUNT(CASE WHEN SaleDone IN ('Yes','1') THEN 1 END) AS total_sales,
        ROUND(COUNT(CASE WHEN SaleDone IN ('Yes','1') THEN 1 END)/NULLIF(COUNT(*),0)*100,2) AS avg_conversion_rate
      FROM db_external.CallDetails WHERE CallDate BETWEEN ? AND ?`,
      [from, to],
    ),
  ]);

  const apr = aprRows[0] as RowDataPacket[];
  const audit = auditRows[0] as RowDataPacket[];
  const sales = salesRows[0] as RowDataPacket[];

  return { ...apr[0], ...audit[0], ...sales[0] };
}

export async function getAgentMatrix(
  pool: mysql.Pool,
  from: string,
  to: string,
  aprSql: string,
  auditSql: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  aprParams: any[],
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  auditParams: any[],
): Promise<RowDataPacket[]> {
  const sql = `SELECT COALESCE(a.agent_code, q.agent_name, s.agent_name) AS agent_code,
    COALESCE(a.total_calls, 0) AS total_calls,
    a.avg_aht_seconds, a.shrinkage_pct,
    COALESCE(q.avg_quality, 0) AS avg_quality,
    COALESCE(s.sales_done, 0) AS sales_done,
    COALESCE(s.conversion_pct, 0) AS conversion_pct,
    a.calls_per_hour,
    ROUND(0.4*COALESCE(q.avg_quality,0)+0.3*(100-COALESCE(a.shrinkage_pct,50))+0.3*LEAST(COALESCE(s.conversion_pct,0)*10,100),1) AS performance_score
  FROM (
    SELECT UserID AS agent_code, SUM(Calls) AS total_calls,
      ROUND(AVG(TIME_TO_SEC(COALESCE(AHT,'00:00:00'))),0) AS avg_aht_seconds,
      ROUND(AVG(CASE WHEN TIME_TO_SEC(COALESCE(Login_Time,'00:00:00'))>0
        THEN (TIME_TO_SEC(COALESCE(BIO,'00:00:00'))+TIME_TO_SEC(COALESCE(LUNCH,'00:00:00'))
             +TIME_TO_SEC(COALESCE(QA,'00:00:00'))+TIME_TO_SEC(COALESCE(TRAINING,'00:00:00'))
             +TIME_TO_SEC(COALESCE(DISMX,'00:00:00')))
             /TIME_TO_SEC(COALESCE(Login_Time,'00:00:00'))*100 ELSE NULL END),1) AS shrinkage_pct,
      ROUND(AVG(CASE WHEN TIME_TO_SEC(COALESCE(Net_Login,'00:00:00'))>0
        THEN Calls/(TIME_TO_SEC(COALESCE(Net_Login,'00:00:00'))/3600) ELSE NULL END),2) AS calls_per_hour
    FROM Shivamgiri.apr WHERE ReportDate BETWEEN ? AND ?${aprSql}
    GROUP BY UserID
  ) a
  LEFT JOIN (
    SELECT User AS agent_name, ROUND(AVG(quality_percentage),2) AS avg_quality
    FROM db_audit.call_quality_assessment WHERE CallDate BETWEEN ? AND ?${auditSql}
      AND User IS NOT NULL AND User != '' GROUP BY User
  ) q ON a.agent_code = q.agent_name
  LEFT JOIN (
    SELECT AgentName AS agent_name,
      COUNT(CASE WHEN SaleDone IN ('Yes','1') THEN 1 END) AS sales_done,
      ROUND(COUNT(CASE WHEN SaleDone IN ('Yes','1') THEN 1 END)/NULLIF(COUNT(*),0)*100,2) AS conversion_pct
    FROM db_external.CallDetails WHERE CallDate BETWEEN ? AND ?
      AND AgentName IS NOT NULL AND AgentName != '' GROUP BY AgentName
  ) s ON a.agent_code = s.agent_name
  ORDER BY performance_score DESC LIMIT 50`;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const params: any[] = [...aprParams, ...auditParams, from, to];
  const [rows] = await pool.execute<RowDataPacket[]>(sql, params);
  return rows;
}

export async function getPerfTrend(
  pool: mysql.Pool,
  from: string,
  to: string,
  aprSql: string,
  auditSql: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  aprParams: any[],
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  auditParams: any[],
): Promise<{ apr_trend: RowDataPacket[]; audit_trend: RowDataPacket[]; sales_trend: RowDataPacket[] }> {
  const [aprRows, auditRows, salesRows] = await Promise.all([
    pool.execute<RowDataPacket[]>(
      `SELECT DATE_FORMAT(ReportDate,'%Y-%m-%d') AS date,
        ROUND(AVG(Calls),1) AS avg_calls,
        ROUND(AVG(TIME_TO_SEC(COALESCE(AHT,'00:00:00'))),0) AS avg_aht_seconds,
        ROUND(AVG(CASE WHEN TIME_TO_SEC(COALESCE(Login_Time,'00:00:00'))>0
          THEN (TIME_TO_SEC(COALESCE(BIO,'00:00:00'))+TIME_TO_SEC(COALESCE(LUNCH,'00:00:00'))
               +TIME_TO_SEC(COALESCE(QA,'00:00:00'))+TIME_TO_SEC(COALESCE(TRAINING,'00:00:00'))
               +TIME_TO_SEC(COALESCE(DISMX,'00:00:00')))
               /TIME_TO_SEC(COALESCE(Login_Time,'00:00:00'))*100 ELSE NULL END),1) AS avg_shrinkage
      FROM Shivamgiri.apr WHERE ReportDate BETWEEN ? AND ?${aprSql}
      GROUP BY DATE(ReportDate) ORDER BY date ASC LIMIT 180`,
      [...aprParams],
    ),
    pool.execute<RowDataPacket[]>(
      `SELECT DATE_FORMAT(CallDate,'%Y-%m-%d') AS date,
        ROUND(AVG(quality_percentage),2) AS avg_quality
      FROM db_audit.call_quality_assessment WHERE CallDate BETWEEN ? AND ?${auditSql}
      GROUP BY DATE(CallDate) ORDER BY date ASC LIMIT 180`,
      [...auditParams],
    ),
    pool.execute<RowDataPacket[]>(
      `SELECT DATE_FORMAT(CallDate,'%Y-%m-%d') AS date,
        COUNT(CASE WHEN SaleDone IN ('Yes','1') THEN 1 END) AS sales_count,
        ROUND(COUNT(CASE WHEN SaleDone IN ('Yes','1') THEN 1 END)/NULLIF(COUNT(*),0)*100,2) AS conversion_pct
      FROM db_external.CallDetails WHERE CallDate BETWEEN ? AND ?
      GROUP BY DATE(CallDate) ORDER BY date ASC LIMIT 180`,
      [from, to],
    ),
  ]);

  return {
    apr_trend: aprRows[0] as RowDataPacket[],
    audit_trend: auditRows[0] as RowDataPacket[],
    sales_trend: salesRows[0] as RowDataPacket[],
  };
}

export async function getProcessComparison(
  pool: mysql.Pool,
  from: string,
  to: string,
  aprSql: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  aprParams: any[],
): Promise<RowDataPacket[]> {
  const sql = `SELECT a.campaign_id AS process,
    COUNT(DISTINCT a.UserID) AS agent_count,
    ROUND(AVG(a.Calls),1) AS avg_calls,
    ROUND(AVG(TIME_TO_SEC(COALESCE(a.AHT,'00:00:00'))),0) AS avg_aht_seconds,
    ROUND(AVG(CASE WHEN TIME_TO_SEC(COALESCE(a.Login_Time,'00:00:00'))>0
      THEN (TIME_TO_SEC(COALESCE(a.BIO,'00:00:00'))+TIME_TO_SEC(COALESCE(a.LUNCH,'00:00:00'))
           +TIME_TO_SEC(COALESCE(a.QA,'00:00:00'))+TIME_TO_SEC(COALESCE(a.TRAINING,'00:00:00'))
           +TIME_TO_SEC(COALESCE(a.DISMX,'00:00:00')))
           /TIME_TO_SEC(COALESCE(a.Login_Time,'00:00:00'))*100 ELSE NULL END),1) AS avg_shrinkage,
    ROUND(AVG(q.avg_quality),2) AS avg_quality,
    ROUND(AVG(s.conversion_pct),2) AS avg_conversion,
    ROUND(0.4*COALESCE(AVG(q.avg_quality),0)
      +0.3*(100-COALESCE(AVG(CASE WHEN TIME_TO_SEC(COALESCE(a.Login_Time,'00:00:00'))>0
        THEN (TIME_TO_SEC(COALESCE(a.BIO,'00:00:00'))+TIME_TO_SEC(COALESCE(a.LUNCH,'00:00:00'))
             +TIME_TO_SEC(COALESCE(a.QA,'00:00:00'))+TIME_TO_SEC(COALESCE(a.TRAINING,'00:00:00'))
             +TIME_TO_SEC(COALESCE(a.DISMX,'00:00:00')))
             /TIME_TO_SEC(COALESCE(a.Login_Time,'00:00:00'))*100 ELSE NULL END),0))
      +0.3*LEAST(COALESCE(AVG(s.conversion_pct),0)*10,100),1) AS overall_score
  FROM Shivamgiri.apr a
  LEFT JOIN (
    SELECT User AS agent_name, ROUND(AVG(quality_percentage),2) AS avg_quality
    FROM db_audit.call_quality_assessment WHERE CallDate BETWEEN ? AND ?
      AND User IS NOT NULL AND User != '' GROUP BY User
  ) q ON a.UserID = q.agent_name
  LEFT JOIN (
    SELECT AgentName AS agent_name,
      ROUND(COUNT(CASE WHEN SaleDone IN ('Yes','1') THEN 1 END)/NULLIF(COUNT(*),0)*100,2) AS conversion_pct
    FROM db_external.CallDetails WHERE CallDate BETWEEN ? AND ?
      AND AgentName IS NOT NULL GROUP BY AgentName
  ) s ON a.UserID = s.agent_name
  WHERE a.ReportDate BETWEEN ? AND ?${aprSql}
  GROUP BY a.campaign_id ORDER BY overall_score DESC LIMIT 20`;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const params: any[] = [from, to, from, to, ...aprParams];
  const [rows] = await pool.execute<RowDataPacket[]>(sql, params);
  return rows;
}

export async function getUtilization(
  pool: mysql.Pool,
  from: string,
  to: string,
  aprSql: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  params: any[],
): Promise<RowDataPacket[]> {
  const sql = `SELECT UserID AS agent_code,
    ROUND(SUM(TIME_TO_SEC(COALESCE(Login_Time,'00:00:00')))/3600,2) AS login_hours,
    ROUND(SUM(TIME_TO_SEC(COALESCE(Net_Login,'00:00:00')))/3600,2) AS net_login_hours,
    ROUND(SUM(TIME_TO_SEC(COALESCE(Net_Login,'00:00:00')))/NULLIF(SUM(TIME_TO_SEC(COALESCE(Login_Time,'00:00:00'))),0)*100,1) AS utilization_pct,
    ROUND(SUM(Calls)/NULLIF(SUM(TIME_TO_SEC(COALESCE(Net_Login,'00:00:00')))/3600,0),2) AS calls_per_hour,
    ROUND(SUM(TIME_TO_SEC(COALESCE(BIO,'00:00:00')))/60,1) AS bio_mins,
    ROUND(SUM(TIME_TO_SEC(COALESCE(LUNCH,'00:00:00')))/60,1) AS lunch_mins,
    ROUND(SUM(TIME_TO_SEC(COALESCE(QA,'00:00:00')))/60,1) AS qa_mins,
    ROUND(SUM(TIME_TO_SEC(COALESCE(TRAINING,'00:00:00')))/60,1) AS training_mins
  FROM Shivamgiri.apr WHERE ReportDate BETWEEN ? AND ?${aprSql}
  GROUP BY UserID HAVING login_hours > 0 ORDER BY utilization_pct DESC LIMIT 50`;

  const [rows] = await pool.execute<RowDataPacket[]>(sql, [...params]);
  return rows;
}
