/**
 * GS1 India dashboard — read-side service.
 * Reads from mas_hrms tables:
 *   gs1_email_daily_actual
 *   gs1_datakart_daily_actual
 *   gs1_approval_audit_raw
 *
 * Data is uploaded via the Bulk Upload Hub.
 */

import type { RowDataPacket } from 'mysql2';
import { db } from '../../db/mysql.js';
import { n, pct, round, parseRange } from './dialler-utils.js';

type Filters = { from?: string; to?: string };

// ── helpers ──────────────────────────────────────────────────────────────────

function iso(d: unknown): string {
  if (!d) return '';
  if (d instanceof Date) return d.toISOString().slice(0, 10);
  return String(d).slice(0, 10);
}

// ── 1. Overview ───────────────────────────────────────────────────────────────

export interface Gs1Overview {
  emailTasks: number;
  emailGtin: number;
  dataKartTasks: number;
  dataKartGtin: number;
  approvalSku: number;
  auditCount: number;
  auditErrors: number;
  auditErrorRate: number;
  daily: { date: string; emailTasks: number; dataKartTasks: number; approvalSku: number }[];
  generatedAt: string;
}

export async function getGs1Overview(filters: Filters): Promise<Gs1Overview> {
  const { from, to } = parseRange(filters);

  // Email totals
  const [emailRows] = await db.query<RowDataPacket[]>(
    `SELECT COALESCE(SUM(mail_received),0) AS emailTasks,
            COALESCE(SUM(gtin_processed),0) AS emailGtin
     FROM gs1_email_daily_actual
     WHERE mail_date BETWEEN ? AND ?`,
    [from, to],
  );
  const emailTasks = n(emailRows[0]?.emailTasks);
  const emailGtin = n(emailRows[0]?.emailGtin);

  // DataKart totals
  const [dkRows] = await db.query<RowDataPacket[]>(
    `SELECT COALESCE(SUM(task_count),0) AS dataKartTasks,
            COALESCE(SUM(gtin_count),0) AS dataKartGtin
     FROM gs1_datakart_daily_actual
     WHERE task_date BETWEEN ? AND ?`,
    [from, to],
  );
  const dataKartTasks = n(dkRows[0]?.dataKartTasks);
  const dataKartGtin = n(dkRows[0]?.dataKartGtin);

  // Approval / audit totals. SKU is the uploaded sku_count, not the row count —
  // one audited row can carry many SKUs, so COUNT(*) made "Approval SKU" a
  // duplicate of the audit count.
  const [auditRows] = await db.query<RowDataPacket[]>(
    `SELECT COALESCE(SUM(sku_count),0) AS approvalSku,
            COUNT(*) AS auditCount,
            COALESCE(SUM(error_flag),0) AS auditErrors
     FROM gs1_approval_audit_raw
     WHERE audit_date BETWEEN ? AND ?`,
    [from, to],
  );
  const approvalSku = n(auditRows[0]?.approvalSku);
  const auditCount = n(auditRows[0]?.auditCount);
  const auditErrors = n(auditRows[0]?.auditErrors);
  const auditErrorRate = round(pct(auditErrors, auditCount));

  // Daily series — merge email + datakart + approval by date.
  // Group by the same DATE_FORMAT expression the SELECT projects (via its alias):
  // grouping by DATE(x) while selecting DATE_FORMAT(x,...) is rejected under
  // ONLY_FULL_GROUP_BY, which MySQL 8 enables by default.
  const [emailDaily] = await db.query<RowDataPacket[]>(
    `SELECT DATE_FORMAT(mail_date,'%Y-%m-%d') AS date,
            COALESCE(SUM(mail_received),0) AS emailTasks
     FROM gs1_email_daily_actual
     WHERE mail_date BETWEEN ? AND ?
     GROUP BY date
     ORDER BY date`,
    [from, to],
  );
  const [dkDaily] = await db.query<RowDataPacket[]>(
    `SELECT DATE_FORMAT(task_date,'%Y-%m-%d') AS date,
            COALESCE(SUM(task_count),0) AS dataKartTasks
     FROM gs1_datakart_daily_actual
     WHERE task_date BETWEEN ? AND ?
     GROUP BY date
     ORDER BY date`,
    [from, to],
  );
  const [apprDaily] = await db.query<RowDataPacket[]>(
    `SELECT DATE_FORMAT(audit_date,'%Y-%m-%d') AS date,
            COALESCE(SUM(sku_count),0) AS approvalSku
     FROM gs1_approval_audit_raw
     WHERE audit_date BETWEEN ? AND ?
     GROUP BY date
     ORDER BY date`,
    [from, to],
  );

  // Merge into a single date-keyed map
  const dayMap: Record<string, { date: string; emailTasks: number; dataKartTasks: number; approvalSku: number }> = {};
  const touch = (d: string) => {
    if (!dayMap[d]) dayMap[d] = { date: d, emailTasks: 0, dataKartTasks: 0, approvalSku: 0 };
  };
  for (const r of emailDaily) { touch(r.date); dayMap[r.date].emailTasks = n(r.emailTasks); }
  for (const r of dkDaily)    { touch(r.date); dayMap[r.date].dataKartTasks = n(r.dataKartTasks); }
  for (const r of apprDaily)  { touch(r.date); dayMap[r.date].approvalSku = n(r.approvalSku); }
  const daily = Object.values(dayMap).sort((a, b) => a.date.localeCompare(b.date));

  return { emailTasks, emailGtin, dataKartTasks, dataKartGtin, approvalSku, auditCount, auditErrors, auditErrorRate, daily, generatedAt: new Date().toISOString() };
}

// ── 2. Email ──────────────────────────────────────────────────────────────────

export interface Gs1EmailAnalyst {
  analyst: string;
  tasks: number;
  gtin: number;
  images: number;
  sla15Pct: number;
}

export interface Gs1EmailDaily {
  date: string;
  tasks: number;
  gtin: number;
  images: number;
}

export interface Gs1Email {
  tasks: number;
  gtin: number;
  images: number;
  sla15Pct: number;
  byAnalyst: Gs1EmailAnalyst[];
  daily: Gs1EmailDaily[];
  generatedAt: string;
}

export async function getGs1Email(filters: Filters): Promise<Gs1Email> {
  const { from, to } = parseRange(filters);

  const [totals] = await db.query<RowDataPacket[]>(
    `SELECT COALESCE(SUM(mail_received),0)           AS tasks,
            COALESCE(SUM(gtin_processed),0)          AS gtin,
            COALESCE(SUM(image_count),0)             AS images,
            COALESCE(AVG(sla_within_15min)*100, 0)   AS sla15Pct
     FROM gs1_email_daily_actual
     WHERE mail_date BETWEEN ? AND ?`,
    [from, to],
  );

  const [byAnalystRows] = await db.query<RowDataPacket[]>(
    `SELECT analyst_name                                AS analyst,
            COALESCE(SUM(mail_received),0)            AS tasks,
            COALESCE(SUM(gtin_processed),0)           AS gtin,
            COALESCE(SUM(image_count),0)              AS images,
            COALESCE(AVG(sla_within_15min)*100, 0)    AS sla15Pct
     FROM gs1_email_daily_actual
     WHERE mail_date BETWEEN ? AND ?
     GROUP BY analyst_name
     ORDER BY tasks DESC`,
    [from, to],
  );

  const [dailyRows] = await db.query<RowDataPacket[]>(
    `SELECT DATE_FORMAT(mail_date,'%Y-%m-%d')         AS date,
            COALESCE(SUM(mail_received),0)            AS tasks,
            COALESCE(SUM(gtin_processed),0)           AS gtin,
            COALESCE(SUM(image_count),0)              AS images
     FROM gs1_email_daily_actual
     WHERE mail_date BETWEEN ? AND ?
     GROUP BY date
     ORDER BY date`,
    [from, to],
  );

  return {
    tasks:     n(totals[0]?.tasks),
    gtin:      n(totals[0]?.gtin),
    images:    n(totals[0]?.images),
    sla15Pct:  round(n(totals[0]?.sla15Pct)),
    byAnalyst: byAnalystRows.map(r => ({
      analyst:  String(r.analyst ?? ''),
      tasks:    n(r.tasks),
      gtin:     n(r.gtin),
      images:   n(r.images),
      sla15Pct: round(n(r.sla15Pct)),
    })),
    daily: dailyRows.map(r => ({
      date:   iso(r.date),
      tasks:  n(r.tasks),
      gtin:   n(r.gtin),
      images: n(r.images),
    })),
    generatedAt: new Date().toISOString(),
  };
}

// ── 3. DataKart ───────────────────────────────────────────────────────────────

export interface Gs1DataKartAnalyst {
  analyst: string;
  tasks: number;
  gtin: number;
  withinTatPct: number;
  avgGtin: number;
}

export interface Gs1DataKartDaily {
  date: string;
  tasks: number;
  gtin: number;
  withinTatPct: number;
}

export interface Gs1DataKart {
  tasks: number;
  gtin: number;
  withinTatPct: number;
  avgGtinPerTask: number;
  byAnalyst: Gs1DataKartAnalyst[];
  daily: Gs1DataKartDaily[];
  generatedAt: string;
}

export async function getGs1DataKart(filters: Filters): Promise<Gs1DataKart> {
  const { from, to } = parseRange(filters);

  const [totals] = await db.query<RowDataPacket[]>(
    `SELECT COALESCE(SUM(task_count),0)                     AS tasks,
            COALESCE(SUM(gtin_count),0)                     AS gtin,
            COALESCE(AVG(within_tat)*100, 0)                AS withinTatPct,
            CASE WHEN COALESCE(SUM(task_count),0) > 0
                 THEN COALESCE(SUM(gtin_count),0) / SUM(task_count)
                 ELSE 0 END                                 AS avgGtinPerTask
     FROM gs1_datakart_daily_actual
     WHERE task_date BETWEEN ? AND ?`,
    [from, to],
  );

  const [byAnalystRows] = await db.query<RowDataPacket[]>(
    `SELECT analyst_name                                        AS analyst,
            COALESCE(SUM(task_count),0)                       AS tasks,
            COALESCE(SUM(gtin_count),0)                       AS gtin,
            COALESCE(AVG(within_tat)*100, 0)                  AS withinTatPct,
            CASE WHEN COALESCE(SUM(task_count),0) > 0
                 THEN COALESCE(SUM(gtin_count),0) / SUM(task_count)
                 ELSE 0 END                                   AS avgGtin
     FROM gs1_datakart_daily_actual
     WHERE task_date BETWEEN ? AND ?
     GROUP BY analyst_name
     ORDER BY tasks DESC`,
    [from, to],
  );

  const [dailyRows] = await db.query<RowDataPacket[]>(
    `SELECT DATE_FORMAT(task_date,'%Y-%m-%d')                 AS date,
            COALESCE(SUM(task_count),0)                       AS tasks,
            COALESCE(SUM(gtin_count),0)                       AS gtin,
            COALESCE(AVG(within_tat)*100, 0)                  AS withinTatPct
     FROM gs1_datakart_daily_actual
     WHERE task_date BETWEEN ? AND ?
     GROUP BY date
     ORDER BY date`,
    [from, to],
  );

  return {
    tasks:          n(totals[0]?.tasks),
    gtin:           n(totals[0]?.gtin),
    withinTatPct:   round(n(totals[0]?.withinTatPct)),
    avgGtinPerTask: round(n(totals[0]?.avgGtinPerTask)),
    byAnalyst: byAnalystRows.map(r => ({
      analyst:      String(r.analyst ?? ''),
      tasks:        n(r.tasks),
      gtin:         n(r.gtin),
      withinTatPct: round(n(r.withinTatPct)),
      avgGtin:      round(n(r.avgGtin)),
    })),
    daily: dailyRows.map(r => ({
      date:         iso(r.date),
      tasks:        n(r.tasks),
      gtin:         n(r.gtin),
      withinTatPct: round(n(r.withinTatPct)),
    })),
    generatedAt: new Date().toISOString(),
  };
}

// ── 4. Approval / Audit ───────────────────────────────────────────────────────

export interface Gs1ApprovalCompany {
  company: string;
  sku: number;
  audits: number;
  errors: number;
  errorPct: number;
}

export interface Gs1ApprovalAnalyst {
  analyst: string;
  audits: number;
  errors: number;
  errorPct: number;
}

export interface Gs1ApprovalDaily {
  date: string;
  sku: number;
  audits: number;
  errors: number;
}

export interface Gs1Approval {
  totalSku: number;
  auditCount: number;
  auditErrors: number;
  errorRate: number;
  uniqueGcp: number;
  byCompany: Gs1ApprovalCompany[];
  byAnalyst: Gs1ApprovalAnalyst[];
  daily: Gs1ApprovalDaily[];
  generatedAt: string;
}

export async function getGs1Approval(filters: Filters): Promise<Gs1Approval> {
  const { from, to } = parseRange(filters);

  const [totals] = await db.query<RowDataPacket[]>(
    `SELECT COALESCE(SUM(sku_count),0)             AS totalSku,
            COUNT(*)                               AS auditCount,
            COALESCE(SUM(error_flag),0)            AS auditErrors,
            COUNT(DISTINCT gcp_code)               AS uniqueGcp
     FROM gs1_approval_audit_raw
     WHERE audit_date BETWEEN ? AND ?`,
    [from, to],
  );
  const totalSku   = n(totals[0]?.totalSku);
  const auditCount = n(totals[0]?.auditCount);
  const auditErrors = n(totals[0]?.auditErrors);
  const errorRate  = round(pct(auditErrors, auditCount));
  const uniqueGcp  = n(totals[0]?.uniqueGcp);

  const [byCompanyRows] = await db.query<RowDataPacket[]>(
    `SELECT company_name                               AS company,
            COALESCE(SUM(sku_count),0)                 AS sku,
            COUNT(*)                                   AS audits,
            COALESCE(SUM(error_flag),0)                AS errors
     FROM gs1_approval_audit_raw
     WHERE audit_date BETWEEN ? AND ?
     GROUP BY company_name
     ORDER BY sku DESC`,
    [from, to],
  );

  const [byAnalystRows] = await db.query<RowDataPacket[]>(
    `SELECT auditor_name                               AS analyst,
            COUNT(*)                                   AS audits,
            COALESCE(SUM(error_flag),0)                AS errors
     FROM gs1_approval_audit_raw
     WHERE audit_date BETWEEN ? AND ?
     GROUP BY auditor_name
     ORDER BY audits DESC`,
    [from, to],
  );

  const [dailyRows] = await db.query<RowDataPacket[]>(
    `SELECT DATE_FORMAT(audit_date,'%Y-%m-%d')         AS date,
            COALESCE(SUM(sku_count),0)                 AS sku,
            COUNT(*)                                   AS audits,
            COALESCE(SUM(error_flag),0)                AS errors
     FROM gs1_approval_audit_raw
     WHERE audit_date BETWEEN ? AND ?
     GROUP BY date
     ORDER BY date`,
    [from, to],
  );

  return {
    totalSku,
    auditCount,
    auditErrors,
    errorRate,
    uniqueGcp,
    byCompany: byCompanyRows.map(r => {
      const a = n(r.audits), e = n(r.errors);
      return { company: String(r.company ?? ''), sku: n(r.sku), audits: a, errors: e, errorPct: round(pct(e, a)) };
    }),
    byAnalyst: byAnalystRows.map(r => {
      const a = n(r.audits), e = n(r.errors);
      return { analyst: String(r.analyst ?? ''), audits: a, errors: e, errorPct: round(pct(e, a)) };
    }),
    daily: dailyRows.map(r => ({
      date:   iso(r.date),
      sku:    n(r.sku),
      audits: n(r.audits),
      errors: n(r.errors),
    })),
    generatedAt: new Date().toISOString(),
  };
}
