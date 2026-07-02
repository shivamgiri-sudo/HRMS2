import mysql from "mysql2/promise";
import type { RowDataPacket } from "mysql2";
import { env } from "../../config/env.js";

let ciPool: mysql.Pool | null = null;

function getCiPool(): mysql.Pool {
  if (!ciPool) {
    ciPool = mysql.createPool({
      host: env.DB_HOST,
      port: env.DB_PORT,
      user: env.DB_USER,
      password: env.DB_PASSWORD,
      database: "Shivamgiri",
      waitForConnections: true,
      connectionLimit: 5,
      connectTimeout: 10000,
    });
  }
  return ciPool;
}

/**
 * Top Objection Types with Resolution and Sales Metrics
 */
export interface ObjectionPattern {
  OBJECTION: string;
  CALL_COUNT: number;
  HANDLED_COUNT: number;
  RESOLUTION_RATE_PCT: number;
  SALES_AFTER_OBJECTION: number;
  SALES_CLOSE_RATE_AFTER_OBJECTION_PCT: number | null;
}

export async function getTopObjectionPatterns(limit = 50): Promise<ObjectionPattern[]> {
  const pool = getCiPool();
  const [rows] = await pool.execute<RowDataPacket[]>(
    `SELECT
      OBJECTION,
      COUNT(*) as CALL_COUNT,
      SUM(CASE WHEN ObjectionHandling IS NOT NULL AND ObjectionHandling NOT IN ('', 'null') THEN 1 ELSE 0 END) as HANDLED_COUNT,
      ROUND(
        (SUM(CASE WHEN ObjectionHandling IS NOT NULL AND ObjectionHandling NOT IN ('', 'null') THEN 1 ELSE 0 END) * 100.0) /
        COUNT(*), 2
      ) as RESOLUTION_RATE_PCT,
      SUM(CASE
        WHEN ObjectionHandling IS NOT NULL AND ObjectionHandling NOT IN ('', 'null')
        AND (SaleDone = 'Yes' OR SaleDone = '1')
        THEN 1 ELSE 0
      END) as SALES_AFTER_OBJECTION,
      ROUND(
        (SUM(CASE
          WHEN ObjectionHandling IS NOT NULL AND ObjectionHandling NOT IN ('', 'null')
          AND (SaleDone = 'Yes' OR SaleDone = '1')
          THEN 1 ELSE 0
        END) * 100.0) /
        NULLIF(SUM(CASE WHEN ObjectionHandling IS NOT NULL AND ObjectionHandling NOT IN ('', 'null') THEN 1 ELSE 0 END), 0), 2
      ) as SALES_CLOSE_RATE_AFTER_OBJECTION_PCT
    FROM db_external.CallDetails
    WHERE OBJECTION IS NOT NULL
      AND OBJECTION != ''
      AND OBJECTION != 'null'
      AND CustomerObjectionCategory IS NOT NULL
    GROUP BY OBJECTION
    ORDER BY CALL_COUNT DESC
    LIMIT ?`,
    [limit]
  );

  return rows as ObjectionPattern[];
}

/**
 * Top Objection Handlers - Agents with Best Resolution Rates
 */
export interface TopHandler {
  HANDLER_CODE: string;
  HANDLER_NAME: string;
  OBJECTIONS_HANDLED: number;
  UNIQUE_OBJECTION_TYPES: number;
  SALES_CLOSE_RATE_AFTER_OBJ_PCT: number;
  SALES_CLOSED_COUNT: number;
}

export async function getTopObjectionHandlers(limit = 50): Promise<TopHandler[]> {
  const pool = getCiPool();
  const [rows] = await pool.execute<RowDataPacket[]>(
    `SELECT
      cd.User as HANDLER_CODE,
      COALESCE(NULLIF(e.full_name,''), CONCAT_WS(' ', e.first_name, COALESCE(e.last_name,'')), cd.User) AS HANDLER_NAME,
      COUNT(*) as OBJECTIONS_HANDLED,
      COUNT(DISTINCT cd.OBJECTION) as UNIQUE_OBJECTION_TYPES,
      ROUND(
        (SUM(CASE
          WHEN cd.ObjectionHandling IS NOT NULL AND cd.ObjectionHandling NOT IN ('', 'null')
          AND (cd.SaleDone = 'Yes' OR cd.SaleDone = '1')
          THEN 1 ELSE 0
        END) * 100.0) / COUNT(*), 2
      ) as SALES_CLOSE_RATE_AFTER_OBJ_PCT,
      SUM(CASE
        WHEN cd.ObjectionHandling IS NOT NULL AND cd.ObjectionHandling NOT IN ('', 'null')
        AND (cd.SaleDone = 'Yes' OR cd.SaleDone = '1')
        THEN 1 ELSE 0
      END) as SALES_CLOSED_COUNT
    FROM db_external.CallDetails cd
    LEFT JOIN mas_hrms.employees e ON e.employee_code = cd.User
    WHERE cd.OBJECTION IS NOT NULL
      AND cd.OBJECTION != ''
      AND cd.OBJECTION != 'null'
      AND cd.ObjectionHandling IS NOT NULL
      AND cd.ObjectionHandling NOT IN ('', 'null')
      AND cd.User IS NOT NULL
    GROUP BY cd.User, e.full_name, e.first_name, e.last_name
    HAVING COUNT(*) >= 5
    ORDER BY SALES_CLOSE_RATE_AFTER_OBJ_PCT DESC
    LIMIT ?`,
    [limit]
  );

  return rows as TopHandler[];
}

/**
 * Sales Closed After Objection Handling
 */
export interface ObjectionSalesMetric {
  OBJECTION: string;
  OBJECTION_RAISED_COUNT: number;
  HANDLED_COUNT: number;
  SALES_CLOSED_AFTER_HANDLING: number;
  CONVERSION_RATE_AFTER_HANDLING_PCT: number | null;
}

export async function getSalesClosedAfterObjection(limit = 50): Promise<ObjectionSalesMetric[]> {
  const pool = getCiPool();
  const [rows] = await pool.execute<RowDataPacket[]>(
    `SELECT
      cd.OBJECTION,
      COUNT(*) as OBJECTION_RAISED_COUNT,
      SUM(CASE WHEN cd.ObjectionHandling IS NOT NULL AND cd.ObjectionHandling NOT IN ('', 'null') THEN 1 ELSE 0 END) as HANDLED_COUNT,
      SUM(CASE
        WHEN cd.ObjectionHandling IS NOT NULL AND cd.ObjectionHandling NOT IN ('', 'null')
        AND (cd.SaleDone = 'Yes' OR cd.SaleDone = '1')
        THEN 1 ELSE 0
      END) as SALES_CLOSED_AFTER_HANDLING,
      ROUND(
        (SUM(CASE
          WHEN cd.ObjectionHandling IS NOT NULL AND cd.ObjectionHandling NOT IN ('', 'null')
          AND (cd.SaleDone = 'Yes' OR cd.SaleDone = '1')
          THEN 1 ELSE 0
        END) * 100.0) /
        NULLIF(SUM(CASE WHEN cd.ObjectionHandling IS NOT NULL AND cd.ObjectionHandling NOT IN ('', 'null') THEN 1 ELSE 0 END), 0), 2
      ) as CONVERSION_RATE_AFTER_HANDLING_PCT
    FROM db_external.CallDetails cd
    WHERE cd.OBJECTION IS NOT NULL
      AND cd.OBJECTION != ''
      AND cd.OBJECTION != 'null'
    GROUP BY cd.OBJECTION
    ORDER BY SALES_CLOSED_AFTER_HANDLING DESC
    LIMIT ?`,
    [limit]
  );

  return rows as ObjectionSalesMetric[];
}

/**
 * Objection Types by Process
 */
export interface ProcessObjectionMetric {
  PROCESS_CODE: string;
  PROCESS_NAME: string;
  OBJECTION: string;
  OBJECTION_COUNT: number;
  HANDLED_COUNT: number;
  RESOLUTION_RATE_PCT: number;
  SALES_AFTER_OBJECTION: number;
}

export async function getObjectionsByProcess(limit = 100): Promise<ProcessObjectionMetric[]> {
  const pool = getCiPool();
  const [rows] = await pool.execute<RowDataPacket[]>(
    `SELECT
      COALESCE(cd.campaign_id, 'UNASSIGNED') as PROCESS_CODE,
      COALESCE(pm.process_name, cd.campaign_id, 'UNASSIGNED') as PROCESS_NAME,
      cd.OBJECTION,
      COUNT(*) as OBJECTION_COUNT,
      SUM(CASE WHEN cd.ObjectionHandling IS NOT NULL AND cd.ObjectionHandling NOT IN ('', 'null') THEN 1 ELSE 0 END) as HANDLED_COUNT,
      ROUND(
        (SUM(CASE WHEN cd.ObjectionHandling IS NOT NULL AND cd.ObjectionHandling NOT IN ('', 'null') THEN 1 ELSE 0 END) * 100.0) /
        COUNT(*), 2
      ) as RESOLUTION_RATE_PCT,
      SUM(CASE
        WHEN cd.ObjectionHandling IS NOT NULL AND cd.ObjectionHandling NOT IN ('', 'null')
        AND (cd.SaleDone = 'Yes' OR cd.SaleDone = '1')
        THEN 1 ELSE 0
      END) as SALES_AFTER_OBJECTION
    FROM db_external.CallDetails cd
    LEFT JOIN mas_hrms.process_master pm ON pm.process_code = cd.campaign_id
    WHERE cd.OBJECTION IS NOT NULL
      AND cd.OBJECTION != ''
      AND cd.OBJECTION != 'null'
    GROUP BY cd.campaign_id, pm.process_name, cd.OBJECTION
    ORDER BY PROCESS_CODE, OBJECTION_COUNT DESC
    LIMIT ?`,
    [limit]
  );

  return rows as ProcessObjectionMetric[];
}

/**
 * Objection & Rebuttal Reference Matrix
 */
export interface ObjectionRebuttal {
  OBJECTION: string;
  RECOMMENDED_REBUTTAL: string;
  FREQUENCY: number;
}

export async function getObjectionRebuttalMatrix(limit = 100): Promise<ObjectionRebuttal[]> {
  const pool = getCiPool();
  const [rows] = await pool.execute<RowDataPacket[]>(
    `SELECT
      obj.Objection as OBJECTION,
      obj.Rebutal as RECOMMENDED_REBUTTAL,
      COUNT(*) as FREQUENCY
    FROM db_external.tbl_obj obj
    WHERE obj.Objection IS NOT NULL
      AND obj.Objection != ''
      AND obj.Objection != 'null'
    GROUP BY obj.Objection, obj.Rebutal
    ORDER BY FREQUENCY DESC
    LIMIT ?`,
    [limit]
  );

  return rows as ObjectionRebuttal[];
}

/**
 * Overall Objection Health Dashboard
 */
export interface ObjectionHealthDashboard {
  TOTAL_OBJECTIONS_RAISED: number;
  UNIQUE_OBJECTION_TYPES: number;
  TOTAL_OBJECTIONS_HANDLED: number;
  OVERALL_RESOLUTION_RATE_PCT: number;
  SALES_CLOSED_AFTER_OBJECTION_HANDLING: number;
  SALES_CONVERSION_AFTER_OBJECTION_PCT: number | null;
  UNIQUE_HANDLERS: number;
  UNIQUE_CLIENTS: number;
  UNIQUE_PROCESSES: number;
}

export async function getObjectionHealthDashboard(): Promise<ObjectionHealthDashboard> {
  const pool = getCiPool();
  const [rows] = await pool.execute<RowDataPacket[]>(
    `SELECT
      COUNT(*) as TOTAL_OBJECTIONS_RAISED,
      COUNT(DISTINCT OBJECTION) as UNIQUE_OBJECTION_TYPES,
      SUM(CASE WHEN ObjectionHandling IS NOT NULL AND ObjectionHandling NOT IN ('', 'null') THEN 1 ELSE 0 END) as TOTAL_OBJECTIONS_HANDLED,
      ROUND(
        (SUM(CASE WHEN ObjectionHandling IS NOT NULL AND ObjectionHandling NOT IN ('', 'null') THEN 1 ELSE 0 END) * 100.0) /
        COUNT(*), 2
      ) as OVERALL_RESOLUTION_RATE_PCT,
      SUM(CASE
        WHEN ObjectionHandling IS NOT NULL AND ObjectionHandling NOT IN ('', 'null')
        AND (SaleDone = 'Yes' OR SaleDone = '1')
        THEN 1 ELSE 0
      END) as SALES_CLOSED_AFTER_OBJECTION_HANDLING,
      ROUND(
        (SUM(CASE
          WHEN ObjectionHandling IS NOT NULL AND ObjectionHandling NOT IN ('', 'null')
          AND (SaleDone = 'Yes' OR SaleDone = '1')
          THEN 1 ELSE 0
        END) * 100.0) /
        NULLIF(SUM(CASE WHEN ObjectionHandling IS NOT NULL AND ObjectionHandling NOT IN ('', 'null') THEN 1 ELSE 0 END), 0), 2
      ) as SALES_CONVERSION_AFTER_OBJECTION_PCT,
      COUNT(DISTINCT User) as UNIQUE_HANDLERS,
      COUNT(DISTINCT client_id) as UNIQUE_CLIENTS,
      COUNT(DISTINCT campaign_id) as UNIQUE_PROCESSES
    FROM db_external.CallDetails
    WHERE OBJECTION IS NOT NULL
      AND OBJECTION != ''
      AND OBJECTION != 'null'`
  );

  if (rows.length === 0) {
    return {
      TOTAL_OBJECTIONS_RAISED: 0,
      UNIQUE_OBJECTION_TYPES: 0,
      TOTAL_OBJECTIONS_HANDLED: 0,
      OVERALL_RESOLUTION_RATE_PCT: 0,
      SALES_CLOSED_AFTER_OBJECTION_HANDLING: 0,
      SALES_CONVERSION_AFTER_OBJECTION_PCT: 0,
      UNIQUE_HANDLERS: 0,
      UNIQUE_CLIENTS: 0,
      UNIQUE_PROCESSES: 0,
    };
  }

  return rows[0] as ObjectionHealthDashboard;
}

/**
 * Consolidated Report - All Metrics
 */
export interface ObjectionAnalysisReport {
  dashboard: ObjectionHealthDashboard;
  topPatterns: ObjectionPattern[];
  topHandlers: TopHandler[];
  salesMetrics: ObjectionSalesMetric[];
  processList: ProcessObjectionMetric[];
  rebuttalMatrix: ObjectionRebuttal[];
}

export async function generateComprehensiveObjectionReport(
  patternLimit = 50,
  handlerLimit = 50,
  processLimit = 100,
  rebuttalLimit = 100
): Promise<ObjectionAnalysisReport> {
  const [dashboard, topPatterns, topHandlers, salesMetrics, processList, rebuttalMatrix] =
    await Promise.all([
      getObjectionHealthDashboard(),
      getTopObjectionPatterns(patternLimit),
      getTopObjectionHandlers(handlerLimit),
      getSalesClosedAfterObjection(patternLimit),
      getObjectionsByProcess(processLimit),
      getObjectionRebuttalMatrix(rebuttalLimit),
    ]);

  return {
    dashboard,
    topPatterns,
    topHandlers,
    salesMetrics,
    processList,
    rebuttalMatrix,
  };
}
