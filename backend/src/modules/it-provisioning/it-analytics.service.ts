/**
 * IT Analytics Service — IT Manager Dashboard Metrics
 */

import { db } from "../../db/mysql.js";
import type { RowDataPacket } from "mysql2";

interface ItAnalyticsSummary {
  asset_lifecycle: { total_assets: number; in_use: number; idle: number; faulty: number; depreciation_value: number };
  provisioning_tat: { avg_request_to_approval_days: number; avg_approval_to_delivery_days: number };
  license_compliance: { active_licenses: number; expiring_soon: number; over_allocated: number };
  incident_resolution: { open_tickets: number; p1_count: number; p2_count: number; avg_resolution_hours: number };
  vendor_sla: Array<{ vendor_name: string; avg_response_hours: number; sla_breaches: number }>;
  security_posture: { devices_pending_updates: number; antivirus_inactive: number; vulnerabilities: number };
}

export async function getItAnalyticsSummary(): Promise<ItAnalyticsSummary> {
  const [assets] = await db.query<RowDataPacket[]>(
    `SELECT
       COUNT(*) as total,
       SUM(CASE WHEN status = 'in_use' THEN 1 ELSE 0 END) as in_use,
       SUM(CASE WHEN status = 'idle' THEN 1 ELSE 0 END) as idle,
       SUM(CASE WHEN status = 'faulty' THEN 1 ELSE 0 END) as faulty,
       SUM(current_value) as depreciation_value
     FROM assets`
  );

  const [tat] = await db.query<RowDataPacket[]>(
    `SELECT
       AVG(DATEDIFF(approved_at, requested_at)) as req_to_approval,
       AVG(DATEDIFF(delivered_at, approved_at)) as approval_to_delivery
     FROM provisioning_requests
     WHERE status = 'delivered'
       AND delivered_at >= DATE_SUB(CURDATE(), INTERVAL 90 DAY)`
  );

  const [licenses] = await db.query<RowDataPacket[]>(
    `SELECT
       COUNT(*) as active,
       SUM(CASE WHEN expiry_date BETWEEN CURDATE() AND DATE_ADD(CURDATE(), INTERVAL 30 DAY) THEN 1 ELSE 0 END) as expiring_soon,
       SUM(CASE WHEN allocated > total_count THEN 1 ELSE 0 END) as over_allocated
     FROM software_licenses
     WHERE status = 'active'`
  );

  const [incidents] = await db.query<RowDataPacket[]>(
    `SELECT
       SUM(CASE WHEN status IN ('open', 'in_progress') THEN 1 ELSE 0 END) as open_tickets,
       SUM(CASE WHEN priority = 'P1' AND status IN ('open', 'in_progress') THEN 1 ELSE 0 END) as p1_count,
       SUM(CASE WHEN priority = 'P2' AND status IN ('open', 'in_progress') THEN 1 ELSE 0 END) as p2_count,
       AVG(CASE WHEN status = 'resolved' THEN TIMESTAMPDIFF(HOUR, created_at, resolved_at) END) as avg_resolution_hours
     FROM it_tickets`
  );

  const [vendors] = await db.query<RowDataPacket[]>(
    `SELECT
       v.name as vendor_name,
       AVG(TIMESTAMPDIFF(HOUR, t.created_at, t.first_response_at)) as avg_response_hours,
       COUNT(CASE WHEN t.sla_breached = 1 THEN 1 END) as sla_breaches
     FROM vendors v
     LEFT JOIN it_tickets t ON v.id = t.vendor_id AND t.created_at >= DATE_SUB(NOW(), INTERVAL 30 DAY)
     GROUP BY v.id, v.name
     ORDER BY sla_breaches DESC
     LIMIT 5`
  );

  const [security] = await db.query<RowDataPacket[]>(
    `SELECT
       SUM(CASE WHEN updates_pending = 1 THEN 1 ELSE 0 END) as pending_updates,
       SUM(CASE WHEN antivirus_active = 0 THEN 1 ELSE 0 END) as av_inactive,
       SUM(vulnerability_count) as total_vulnerabilities
     FROM device_security_status`
  );

  return {
    asset_lifecycle: {
      total_assets: assets[0]?.total ?? 0,
      in_use: assets[0]?.in_use ?? 0,
      idle: assets[0]?.idle ?? 0,
      faulty: assets[0]?.faulty ?? 0,
      depreciation_value: Number(assets[0]?.depreciation_value ?? 0),
    },
    provisioning_tat: {
      avg_request_to_approval_days: Math.round(Number(tat[0]?.req_to_approval ?? 0)),
      avg_approval_to_delivery_days: Math.round(Number(tat[0]?.approval_to_delivery ?? 0)),
    },
    license_compliance: {
      active_licenses: licenses[0]?.active ?? 0,
      expiring_soon: licenses[0]?.expiring_soon ?? 0,
      over_allocated: licenses[0]?.over_allocated ?? 0,
    },
    incident_resolution: {
      open_tickets: incidents[0]?.open_tickets ?? 0,
      p1_count: incidents[0]?.p1_count ?? 0,
      p2_count: incidents[0]?.p2_count ?? 0,
      avg_resolution_hours: Math.round(Number(incidents[0]?.avg_resolution_hours ?? 0)),
    },
    vendor_sla: vendors.map((r) => ({
      vendor_name: r.vendor_name,
      avg_response_hours: Math.round(Number(r.avg_response_hours ?? 0)),
      sla_breaches: r.sla_breaches ?? 0,
    })),
    security_posture: {
      devices_pending_updates: security[0]?.pending_updates ?? 0,
      antivirus_inactive: security[0]?.av_inactive ?? 0,
      vulnerabilities: security[0]?.total_vulnerabilities ?? 0,
    },
  };
}
