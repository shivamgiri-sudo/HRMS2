// @ts-nocheck
// AUTO-SYNCED from tausifansari-mcn/Mydashboards backend/src/modules/call-master/call-master.service.ts @ 4fbd5df - do not edit; run scripts/sync-mydashboards.mjs
import { querySource } from '../upstream-shim/sourceDb.js';
import prisma from '../upstream-shim/prismaClient.js';

export interface CallMasterFilters {
  startDate: string;   // YYYY-MM-DD
  endDate: string;     // YYYY-MM-DD
  clientIds?: number[]; // dialdesk_client_ids
  lob?: 'Inbound' | 'Outbound' | 'All';
}

export interface UserScope {
  clientIds: number[] | null;              // null = super admin (unrestricted)
  allowedLobs: ('Inbound' | 'Outbound')[] | null; // null = unrestricted
}

/**
 * Resolves what data a user is allowed to see.
 * Priority: super_admin → unrestricted; process mappings → scoped by those
 * processes' dialdesk_client_ids and LOBs; else falls back to the single
 * client assigned on the user record.
 */
export async function resolveUserScope(userId: number, tenantClientId: number | null): Promise<UserScope> {
  if (tenantClientId === null) return { clientIds: null, allowedLobs: null };

  // Check process assignments first — they define the most granular scope
  const mappings = await prisma.md_user_process_mapping.findMany({
    where: { user_id: userId },
    include: { process: true },
  });

  if (mappings.length > 0) {
    const clientIds = [...new Set(mappings.map(m => m.process.dialdesk_client_id))];
    const lobSet = new Set(mappings.map(m => m.process.lob.toLowerCase()));
    const allowedLobs: ('Inbound' | 'Outbound')[] = [];
    if (lobSet.has('inbound'))  allowedLobs.push('Inbound');
    if (lobSet.has('outbound')) allowedLobs.push('Outbound');
    return {
      clientIds,
      allowedLobs: allowedLobs.length > 0 ? allowedLobs : null,
    };
  }

  // No process mappings yet — fall back to the assigned client
  const client = await prisma.md_clients.findUnique({ where: { id: tenantClientId } });
  return { clientIds: client ? [client.dialdesk_client_id] : [], allowedLobs: null };
}

// Helper: get list of clients visible to this user (for filter dropdowns)
export async function getClientList(tenantClientId: number | null, userId?: number) {
  // Super admin: all active clients
  if (tenantClientId === null) {
    return prisma.md_clients.findMany({
      where: { is_active: true },
      select: { id: true, name: true, dialdesk_client_id: true },
      orderBy: { name: 'asc' },
    });
  }

  // Check process mappings — only show clients the user has processes for
  if (userId !== undefined) {
    const mappings = await prisma.md_user_process_mapping.findMany({
      where: { user_id: userId },
      include: { process: true },
    });
    if (mappings.length > 0) {
      const prismaClientIds = [...new Set(mappings.map(m => m.process.client_id))];
      return prisma.md_clients.findMany({
        where: { is_active: true, id: { in: prismaClientIds } },
        select: { id: true, name: true, dialdesk_client_id: true },
        orderBy: { name: 'asc' },
      });
    }
  }

  // Fallback: the single client assigned on the user record
  return prisma.md_clients.findMany({
    where: { is_active: true, id: tenantClientId },
    select: { id: true, name: true, dialdesk_client_id: true },
    orderBy: { name: 'asc' },
  });
}

// ─── KPI Cards ───────────────────────────────────────────────────────────────

export async function getKPIs(filters: CallMasterFilters) {
  const { startDate, endDate, clientIds } = filters;
  const lob = filters.lob || 'All';

  // Quality data (Inbound) from db_audit
  let qualityKPIs = {
    totalAudited: 0,
    qualityScore: 0,
    fatalScore: 0,
    customerExperience: 0,
    compliance: 0,
  };

  if (lob === 'All' || lob === 'Inbound') {
    const clientFilter = clientIds?.length
      ? `AND ClientId IN (${clientIds.map(() => '?').join(',')})` : '';
    const params: (string | number | null)[] =[startDate, endDate, ...(clientIds || [])];

    const [qRow] = await querySource<{
      total: number; avg_quality: number; fatal_score: number; avg_cx: number; avg_compliance: number;
    }>(`
      SELECT
        COUNT(*) AS total,
        ROUND(AVG(quality_percentage), 2) AS avg_quality,
        ROUND(
          SUM(CASE WHEN quality_percentage = 0 THEN 1 ELSE 0 END) * 100.0 / NULLIF(COUNT(*), 0),
          2
        ) AS fatal_score,
        ROUND(AVG(
          (COALESCE(customer_concern_acknowledged,0) + COALESCE(express_empathy,0) +
           COALESCE(active_listening,0) + COALESCE(assurance_or_appreciation_provided,0) +
           COALESCE(politeness_and_no_sarcasm,0)) / 5.0 * 100
        ), 2) AS avg_cx,
        ROUND(AVG(
          (COALESCE(professionalism_maintained,0) + COALESCE(proper_hold_procedure,0) +
           COALESCE(correct_and_complete_information,0) + COALESCE(proper_call_closure,0) +
           COALESCE(address_recorded_completely,0)) / 5.0 * 100
        ), 2) AS avg_compliance
      FROM db_audit.call_quality_assessment
      WHERE CallDate BETWEEN ? AND ? ${clientFilter}
    `, params);

    if (qRow) {
      qualityKPIs = {
        totalAudited: Number(qRow.total) || 0,
        qualityScore: Number(qRow.avg_quality) || 0,
        fatalScore: Number(qRow.fatal_score) || 0,
        customerExperience: Number(qRow.avg_cx) || 0,
        compliance: Number(qRow.avg_compliance) || 0,
      };
    }
  }

  // Outbound data from db_external
  let outboundKPIs = { totalCalls: 0, salesConversion: 0, outboundQuality: 0 };

  if (lob === 'All' || lob === 'Outbound') {
    const clientFilter = clientIds?.length
      ? `AND client_id IN (${clientIds.map(() => '?').join(',')})` : '';
    const params: (string | number | null)[] =[startDate, endDate, ...(clientIds || [])];

    const [oRow] = await querySource<{ total: number; conversion: number; ob_quality: number }>(`
      SELECT
        COUNT(*) AS total,
        ROUND(SUM(CASE WHEN SaleDone = '1' THEN 1 ELSE 0 END) / COUNT(*) * 100, 2) AS conversion,
        ROUND(AVG(${OB_QUALITY_EXPR}), 2) AS ob_quality
      FROM db_external.CallDetails
      WHERE CallDate BETWEEN ? AND ? ${clientFilter}
    `, params);

    if (oRow) {
      outboundKPIs = {
        totalCalls: Number(oRow.total) || 0,
        salesConversion: Number(oRow.conversion) || 0,
        outboundQuality: Number(oRow.ob_quality) || 0,
      };
    }
  }

  // Platform stats — scoped to the user's allowed clients so a restricted user's "Active Clients"
  // KPI doesn't leak the total count of clients on the platform (super admins pass no clientIds
  // and still see the unrestricted total).
  const activeClients = await prisma.md_clients.count({
    where: clientIds?.length
      ? { is_active: true, dialdesk_client_id: { in: clientIds } }
      : { is_active: true },
  });

  // Active agents — LOB-aware: inbound=db_audit User, outbound=CallDetails AgentName, all=union
  let activeAgents = 0;
  {
    const ibCF = clientIds?.length ? `AND ClientId IN (${clientIds.map(() => '?').join(',')})` : '';
    const obCF = clientIds?.length ? `AND client_id IN (${clientIds.map(() => '?').join(',')})` : '';
    if (lob === 'Inbound') {
      const [r] = await querySource<{ cnt: number }>(`
        SELECT COUNT(DISTINCT User) AS cnt
        FROM db_audit.call_quality_assessment
        WHERE CallDate BETWEEN ? AND ? ${ibCF}
      `, [startDate, endDate, ...(clientIds || [])]);
      activeAgents = Number(r?.cnt) || 0;
    } else if (lob === 'Outbound') {
      const [r] = await querySource<{ cnt: number }>(`
        SELECT COUNT(DISTINCT AgentName) AS cnt
        FROM db_external.CallDetails
        WHERE CallDate BETWEEN ? AND ? ${obCF}
          AND AgentName IS NOT NULL AND AgentName != ''
      `, [startDate, endDate, ...(clientIds || [])]);
      activeAgents = Number(r?.cnt) || 0;
    } else {
      const [r] = await querySource<{ cnt: number }>(`
        SELECT COUNT(DISTINCT agent) AS cnt FROM (
          SELECT CONVERT(User USING utf8mb4) COLLATE utf8mb4_general_ci AS agent
          FROM db_audit.call_quality_assessment
          WHERE CallDate BETWEEN ? AND ? ${ibCF}
          UNION
          SELECT CONVERT(AgentName USING utf8mb4) COLLATE utf8mb4_general_ci AS agent
          FROM db_external.CallDetails
          WHERE CallDate BETWEEN ? AND ? ${obCF}
            AND AgentName IS NOT NULL AND AgentName != ''
        ) t
      `, [startDate, endDate, ...(clientIds || []), startDate, endDate, ...(clientIds || [])]);
      activeAgents = Number(r?.cnt) || 0;
    }
  }

  return {
    totalCalls: outboundKPIs.totalCalls,
    totalAudited: qualityKPIs.totalAudited,
    qualityScore: qualityKPIs.qualityScore,
    fatalScore: qualityKPIs.fatalScore,
    customerExperience: qualityKPIs.customerExperience,
    compliance: qualityKPIs.compliance,
    salesConversion: outboundKPIs.salesConversion,
    outboundQuality: outboundKPIs.outboundQuality,
    activeClients,
    activeAgents,
  };
}

// ─── Quality Trend ───────────────────────────────────────────────────────────

export async function getQualityTrend(filters: CallMasterFilters, period: 'daily' | 'weekly' | 'monthly' = 'daily') {
  const { startDate, endDate, clientIds } = filters;
  const clientFilter = clientIds?.length ? `AND ClientId IN (${clientIds.map(() => '?').join(',')})` : '';
  const params: (string | number | null)[] =[startDate, endDate, ...(clientIds || [])];

  const groupExpr = period === 'monthly'
    ? "DATE_FORMAT(CallDate, '%Y-%m')"
    : period === 'weekly'
    ? "DATE_FORMAT(CallDate, '%Y-%u')"
    : "DATE_FORMAT(CallDate, '%Y-%m-%d')";

  return querySource<{ period: string; quality: number; calls: number; fatal: number }>(`
    SELECT
      ${groupExpr} AS period,
      ROUND(AVG(quality_percentage), 2) AS quality,
      COUNT(*) AS calls,
      ROUND(
        SUM(CASE WHEN quality_percentage = 0 THEN 1 ELSE 0 END) * 100.0 / NULLIF(COUNT(*), 0),
        2
      ) AS fatal
    FROM db_audit.call_quality_assessment
    WHERE CallDate BETWEEN ? AND ? ${clientFilter}
    GROUP BY ${groupExpr}
    ORDER BY period ASC
    LIMIT 90
  `, params);
}

// ─── Calls by Client ─────────────────────────────────────────────────────────

export async function getCallsByClient(filters: CallMasterFilters) {
  const { startDate, endDate, clientIds } = filters;

  // Quality (inbound)
  const qFilter = clientIds?.length ? `AND q.ClientId IN (${clientIds.map(() => '?').join(',')})` : '';
  const qRows = await querySource<{ client_name: string; audited: number; quality: number }>(`
    SELECT
      COALESCE(c.name, CONCAT('Client ', q.ClientId)) AS client_name,
      COUNT(*) AS audited,
      ROUND(AVG(q.quality_percentage), 2) AS quality
    FROM db_audit.call_quality_assessment q
    LEFT JOIN shivamgiri.md_clients c ON c.dialdesk_client_id = CAST(q.ClientId AS UNSIGNED)
    WHERE q.CallDate BETWEEN ? AND ? ${qFilter}
    GROUP BY q.ClientId, c.name
    ORDER BY audited DESC
    LIMIT 20
  `, [startDate, endDate, ...(clientIds || [])]);

  // Outbound calls
  const oFilter = clientIds?.length ? `AND cd.client_id IN (${clientIds.map(() => '?').join(',')})` : '';
  const oRows = await querySource<{ client_name: string; calls: number; sales: number }>(`
    SELECT
      COALESCE(c.name, CONCAT('Client ', cd.client_id)) AS client_name,
      COUNT(*) AS calls,
      SUM(CASE WHEN cd.SaleDone = '1' THEN 1 ELSE 0 END) AS sales
    FROM db_external.CallDetails cd
    LEFT JOIN shivamgiri.md_clients c ON c.dialdesk_client_id = cd.client_id
    WHERE cd.CallDate BETWEEN ? AND ? ${oFilter}
    GROUP BY cd.client_id, c.name
    ORDER BY calls DESC
    LIMIT 20
  `, [startDate, endDate, ...(clientIds || [])]);

  return { inbound: qRows, outbound: oRows };
}

// ─── Calls by Hour ───────────────────────────────────────────────────────────

export async function getCallsByHour(filters: CallMasterFilters) {
  const { startDate, endDate, clientIds } = filters;
  const results: Record<number, { hour: number; inbound: number; outbound: number }> = {};
  for (let i = 0; i < 24; i++) results[i] = { hour: i, inbound: 0, outbound: 0 };

  const qFilter = clientIds?.length ? `AND ClientId IN (${clientIds.map(() => '?').join(',')})` : '';
  const qRows = await querySource<{ hour: number; cnt: number }>(`
    SELECT HOUR(CallDate) AS hour, COUNT(*) AS cnt
    FROM db_audit.call_quality_assessment
    WHERE CallDate BETWEEN ? AND ? ${qFilter}
    GROUP BY HOUR(CallDate)
  `, [startDate, endDate, ...(clientIds || [])]);

  const oFilter = clientIds?.length ? `AND client_id IN (${clientIds.map(() => '?').join(',')})` : '';
  const oRows = await querySource<{ hour: number; cnt: number }>(`
    SELECT HOUR(CallDate) AS hour, COUNT(*) AS cnt
    FROM db_external.CallDetails
    WHERE CallDate BETWEEN ? AND ? ${oFilter}
    GROUP BY HOUR(CallDate)
  `, [startDate, endDate, ...(clientIds || [])]);

  qRows.forEach((r) => { results[r.hour].inbound = Number(r.cnt); });
  oRows.forEach((r) => { results[r.hour].outbound = Number(r.cnt); });

  return Object.values(results).map((r) => ({
    hour: `${String(r.hour).padStart(2, '0')}:00`,
    inbound: r.inbound,
    outbound: r.outbound,
    total: r.inbound + r.outbound,
  }));
}

// ─── Calls by Day of Week ─────────────────────────────────────────────────────

export async function getCallsByDay(filters: CallMasterFilters) {
  const { startDate, endDate, clientIds } = filters;
  const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  const results: Record<number, { day: string; inbound: number; outbound: number }> = {};
  days.forEach((d, i) => { results[i] = { day: d, inbound: 0, outbound: 0 }; });

  const qFilter = clientIds?.length ? `AND ClientId IN (${clientIds.map(() => '?').join(',')})` : '';
  const qRows = await querySource<{ dow: number; cnt: number }>(`
    SELECT (DAYOFWEEK(CallDate) - 1) AS dow, COUNT(*) AS cnt
    FROM db_audit.call_quality_assessment
    WHERE CallDate BETWEEN ? AND ? ${qFilter}
    GROUP BY (DAYOFWEEK(CallDate) - 1)
  `, [startDate, endDate, ...(clientIds || [])]);

  const oFilter = clientIds?.length ? `AND client_id IN (${clientIds.map(() => '?').join(',')})` : '';
  const oRows = await querySource<{ dow: number; cnt: number }>(`
    SELECT (DAYOFWEEK(CallDate) - 1) AS dow, COUNT(*) AS cnt
    FROM db_external.CallDetails
    WHERE CallDate BETWEEN ? AND ? ${oFilter}
    GROUP BY (DAYOFWEEK(CallDate) - 1)
  `, [startDate, endDate, ...(clientIds || [])]);

  qRows.forEach((r) => { results[r.dow].inbound = Number(r.cnt); });
  oRows.forEach((r) => { results[r.dow].outbound = Number(r.cnt); });

  return Object.values(results);
}

// ─── Top/Bottom Agents ────────────────────────────────────────────────────────

export async function getTopAgents(filters: CallMasterFilters, limit = 10) {
  const { startDate, endDate, clientIds } = filters;
  const clientFilter = clientIds?.length ? `AND ClientId IN (${clientIds.map(() => '?').join(',')})` : '';
  const params: (string | number | null)[] =[startDate, endDate, ...(clientIds || [])];

  const agentSelect = `
      COALESCE(am.AgentName, q.User) AS agent,
      COUNT(*) AS calls,
      ROUND(AVG(q.quality_percentage), 2) AS quality,
      ROUND(AVG(
        (COALESCE(q.professionalism_maintained,0) + COALESCE(q.correct_and_complete_information,0) +
         COALESCE(q.proper_call_closure,0)) / 3.0 * 100
      ), 2) AS compliance,
      ROUND(
        SUM(CASE WHEN q.quality_percentage = 0 THEN 1 ELSE 0 END) * 100.0 / NULLIF(COUNT(*), 0),
        2
      ) AS fatal_rate`;

  const top = await querySource<{ agent: string; calls: number; quality: number; compliance: number; fatal_rate: number }>(`
    SELECT ${agentSelect}
    FROM db_audit.call_quality_assessment q
    LEFT JOIN db_masmis.AgentMaster am ON am.MasId = q.User COLLATE utf8mb4_unicode_ci
    WHERE q.CallDate BETWEEN ? AND ? ${clientFilter.replace(/ClientId/g, 'q.ClientId')}
    GROUP BY q.User
    HAVING calls >= 3
    ORDER BY quality DESC
    LIMIT ${limit}
  `, params);

  const bottom = await querySource<{ agent: string; calls: number; quality: number; compliance: number; fatal_rate: number }>(`
    SELECT ${agentSelect}
    FROM db_audit.call_quality_assessment q
    LEFT JOIN db_masmis.AgentMaster am ON am.MasId = q.User COLLATE utf8mb4_unicode_ci
    WHERE q.CallDate BETWEEN ? AND ? ${clientFilter.replace(/ClientId/g, 'q.ClientId')}
    GROUP BY q.User
    HAVING calls >= 3
    ORDER BY quality ASC
    LIMIT ${limit}
  `, params);

  return { top, bottom };
}

// ─── Sales Funnel ─────────────────────────────────────────────────────────────

export async function getSalesFunnel(filters: CallMasterFilters) {
  const { startDate, endDate, clientIds } = filters;
  const clientFilter = clientIds?.length ? `AND client_id IN (${clientIds.map(() => '?').join(',')})` : '';

  const [row] = await querySource<{
    total: number; offered: number; objection: number; upsell: number; sold: number;
  }>(`
    SELECT
      COUNT(*) AS total,
      SUM(CASE WHEN Opening = '1' OR Opening = 1 THEN 1 ELSE 0 END) AS offered,
      SUM(CASE WHEN ObjectionHandling = '1' OR ObjectionHandling = 1 THEN 1 ELSE 0 END) AS objection,
      SUM(CASE WHEN UpsellingEfforts = '1' OR UpsellingEfforts = 1 THEN 1 ELSE 0 END) AS upsell,
      SUM(CASE WHEN SaleDone = '1' OR SaleDone = 1 THEN 1 ELSE 0 END) AS sold
    FROM db_external.CallDetails
    WHERE CallDate BETWEEN ? AND ? ${clientFilter}
  `, [startDate, endDate, ...(clientIds || [])]);

  if (!row) return [];

  const total = Number(row.total) || 1;
  return [
    { stage: 'Total Calls', value: Number(row.total), pct: 100 },
    { stage: 'Offer Presented', value: Number(row.offered), pct: Math.round(Number(row.offered) / total * 100) },
    { stage: 'Objection Handled', value: Number(row.objection), pct: Math.round(Number(row.objection) / total * 100) },
    { stage: 'Upsell Attempted', value: Number(row.upsell), pct: Math.round(Number(row.upsell) / total * 100) },
    { stage: 'Sale Completed', value: Number(row.sold), pct: Math.round(Number(row.sold) / total * 100) },
  ];
}

// ─── CX Parameters ────────────────────────────────────────────────────────────

export const INBOUND_PARAMS = [
  { key: 'call_answered_within_5_seconds',   label: 'Answered ≤5s' },
  { key: 'customer_concern_acknowledged',    label: 'Concern Acknowledged' },
  { key: 'professionalism_maintained',       label: 'Professionalism' },
  { key: 'assurance_or_appreciation_provided', label: 'Assurance' },
  { key: 'pronunciation_and_clarity',        label: 'Pronunciation & Clarity' },
  { key: 'enthusiasm_and_no_fumbling',       label: 'Enthusiasm' },
  { key: 'active_listening',                 label: 'Active Listening' },
  { key: 'politeness_and_no_sarcasm',        label: 'Politeness' },
  { key: 'proper_grammar',                   label: 'Proper Grammar' },
  { key: 'accurate_issue_probing',           label: 'Issue Probing' },
  { key: 'proper_hold_procedure',            label: 'Hold Procedure' },
  { key: 'proper_transfer_and_language',     label: 'Transfer & Language' },
  { key: 'dead_air_under_10_seconds',        label: 'Dead Air <10s' },
  { key: 'case_escalated_correctly',         label: 'Escalation' },
  { key: 'address_recorded_completely',      label: 'Address Recorded' },
  { key: 'correct_and_complete_information', label: 'Correct Info' },
  { key: 'upselling_or_offers_suggested',    label: 'Upselling' },
  { key: 'further_assistance_offered',       label: 'Further Assistance' },
  { key: 'proper_call_closure',              label: 'Call Closure' },
] as const;

export const OUTBOUND_PARAMS = [
  { key: 'Opening',           label: 'Opening' },
  { key: 'Offered',           label: 'Offer Presented' },
  { key: 'ObjectionHandling', label: 'Objection Handling' },
  { key: 'PrepaidPitch',      label: 'Prepaid Pitch' },
  { key: 'UpsellingEfforts',  label: 'Upselling Efforts' },
  { key: 'OfferUrgency',      label: 'Offer Urgency' },
  { key: 'SensitiveWordUsed', label: 'No Sensitive Words' },
] as const;

// A pitch parameter counts as compliant whenever the AI grader wrote ANYTHING meaningful for
// it — a bare '1' flag or a free-text justification/transcript excerpt alike — and
// non-compliant only when it's genuinely blank/absent (NULL / '' / 'None' / '0'). Some
// clients' data has these columns as clean 0/1 flags; others (e.g. Housing Premium) have them
// as full free-text pitch excerpts with no bare flag at all — this rule scores both correctly,
// whereas a strict `=1` comparison silently zeroed out every free-text row.
function obFlagCase(col: string): string {
  return `(CASE WHEN ${col} IS NULL OR TRIM(${col}) = '' OR LOWER(TRIM(${col})) IN ('none','0') THEN 0 ELSE 1 END)`;
}

// Per-row outbound quality: 6 binary params + SensitiveWordUsed (passes when = 'none')
const OB_QUALITY_EXPR = `(
  ${obFlagCase('Opening')} +
  ${obFlagCase('Offered')} +
  ${obFlagCase('ObjectionHandling')} +
  ${obFlagCase('PrepaidPitch')} +
  ${obFlagCase('UpsellingEfforts')} +
  ${obFlagCase('OfferUrgency')} +
  (CASE WHEN LOWER(COALESCE(SensitiveWordUsed,'none')) = 'none' THEN 1 ELSE 0 END)
) / 7.0 * 100`;

export async function getCXParameters(filters: CallMasterFilters) {
  const { startDate, endDate, clientIds } = filters;
  const ibFilter = clientIds?.length ? `AND ClientId IN (${clientIds.map(() => '?').join(',')})` : '';
  const obFilter = clientIds?.length ? `AND client_id IN (${clientIds.map(() => '?').join(',')})` : '';
  const ibParams: (string | number | null)[] = [startDate, endDate, ...(clientIds || [])];
  const obParams: (string | number | null)[] = [startDate, endDate, ...(clientIds || [])];

  // Inbound: all 19 parameters
  const ibSelect = INBOUND_PARAMS
    .map(p => `ROUND(AVG(COALESCE(\`${p.key}\`,0))*100,1) AS \`${p.key}\``)
    .join(', ');

  const [ibRow] = await querySource<Record<string, number>>(`
    SELECT ${ibSelect}
    FROM db_audit.call_quality_assessment
    WHERE CallDate BETWEEN ? AND ? ${ibFilter}
  `, ibParams);

  const inbound = INBOUND_PARAMS.map(p => ({
    parameter: p.label,
    key: p.key,
    score: ibRow ? (Number(ibRow[p.key]) || 0) : 0,
  }));

  // Outbound: 7 parameters (6 binary + SensitiveWordUsed)
  const [obRow] = await querySource<Record<string, number>>(`
    SELECT
      ROUND(AVG(${obFlagCase('Opening')})*100,1) AS Opening,
      ROUND(AVG(${obFlagCase('Offered')})*100,1) AS Offered,
      ROUND(AVG(${obFlagCase('ObjectionHandling')})*100,1) AS ObjectionHandling,
      ROUND(AVG(${obFlagCase('PrepaidPitch')})*100,1) AS PrepaidPitch,
      ROUND(AVG(${obFlagCase('UpsellingEfforts')})*100,1) AS UpsellingEfforts,
      ROUND(AVG(${obFlagCase('OfferUrgency')})*100,1) AS OfferUrgency,
      ROUND(AVG(CASE WHEN LOWER(COALESCE(SensitiveWordUsed,'none')) = 'none' THEN 1 ELSE 0 END)*100,1) AS SensitiveWordUsed
    FROM db_external.CallDetails
    WHERE CallDate BETWEEN ? AND ? ${obFilter}
  `, obParams);

  const outbound = OUTBOUND_PARAMS.map(p => ({
    parameter: p.label,
    key: p.key,
    score: obRow ? (Number(obRow[p.key]) || 0) : 0,
  }));

  // Scenario distribution (QRC + Sale) from inbound
  const scenarioRows = await querySource<{ scenario: string; cnt: number }>(`
    SELECT scenario, COUNT(*) AS cnt
    FROM db_audit.call_quality_assessment
    WHERE CallDate BETWEEN ? AND ? ${ibFilter}
      AND scenario IS NOT NULL AND scenario != ''
    GROUP BY scenario
    ORDER BY cnt DESC
  `, ibParams);

  const scenario = scenarioRows.map(r => ({
    name: String(r.scenario),
    value: Number(r.cnt),
  }));

  return { inbound, outbound, scenario };
}

// ─── Agent Parameter Drill-down ───────────────────────────────────────────────

export async function getAgentParams(agentName: string, filters: CallMasterFilters) {
  const { startDate, endDate, clientIds } = filters;
  const clientFilter = clientIds?.length ? `AND ClientId IN (${clientIds.map(() => '?').join(',')})` : '';
  const params: (string | number | null)[] = [startDate, endDate, agentName, ...(clientIds || [])];

  const ibSelect = INBOUND_PARAMS
    .map(p => `ROUND(AVG(COALESCE(\`${p.key}\`,0))*100,1) AS \`${p.key}\``)
    .join(', ');

  const [row] = await querySource<Record<string, number>>(`
    SELECT ${ibSelect}
    FROM db_audit.call_quality_assessment
    WHERE CallDate BETWEEN ? AND ? AND User = ? ${clientFilter}
  `, params);

  if (!row) return [];

  return INBOUND_PARAMS.map(p => ({
    parameter: p.label,
    key: p.key,
    score: Number(row[p.key]) || 0,
  }));
}

// ─── Active Agents Detail List (LOB-aware) ───────────────────────────────────

export async function getActiveAgentsList(filters: CallMasterFilters) {
  const { startDate, endDate, clientIds } = filters;
  const lob = filters.lob || 'All';
  const ibCF = clientIds?.length ? `AND q.ClientId IN (${clientIds.map(() => '?').join(',')})` : '';
  const obCF = clientIds?.length ? `AND d.client_id IN (${clientIds.map(() => '?').join(',')})` : '';

  const ibQuery = `
    SELECT
      COALESCE(am.AgentName, q.User) AS agent,
      COUNT(*) AS calls,
      ROUND(AVG(q.quality_percentage), 1) AS quality,
      GROUP_CONCAT(DISTINCT COALESCE(c.name, CONCAT('Client ', q.ClientId)) ORDER BY c.name SEPARATOR ', ') AS clients,
      'Inbound' AS lob
    FROM db_audit.call_quality_assessment q
    LEFT JOIN shivamgiri.md_clients c ON c.dialdesk_client_id = CAST(q.ClientId AS UNSIGNED)
    LEFT JOIN db_masmis.AgentMaster am ON am.MasId = q.User COLLATE utf8mb4_unicode_ci
    WHERE q.CallDate BETWEEN ? AND ? ${ibCF}
    GROUP BY q.User
    ORDER BY calls DESC`;

  const obQuery = `
    SELECT
      COALESCE(am.AgentName, d.AgentName) AS agent,
      COUNT(*) AS calls,
      ROUND(AVG(${OB_QUALITY_EXPR}), 1) AS quality,
      GROUP_CONCAT(DISTINCT COALESCE(c.name, CONCAT('Client ', d.client_id)) ORDER BY c.name SEPARATOR ', ') AS clients,
      'Outbound' AS lob
    FROM db_external.CallDetails d
    LEFT JOIN shivamgiri.md_clients c ON c.dialdesk_client_id = d.client_id
    LEFT JOIN db_masmis.AgentMaster am ON am.MasId = d.AgentName COLLATE utf8mb4_unicode_ci
    WHERE d.CallDate BETWEEN ? AND ? ${obCF}
      AND d.AgentName IS NOT NULL AND d.AgentName != ''
    GROUP BY d.AgentName
    ORDER BY calls DESC`;

  type AgentRow = { agent: string; calls: number; quality: number; clients: string; lob: string };

  if (lob === 'Inbound') {
    return querySource<AgentRow>(ibQuery, [startDate, endDate, ...(clientIds || [])]);
  }
  if (lob === 'Outbound') {
    return querySource<AgentRow>(obQuery, [startDate, endDate, ...(clientIds || [])]);
  }

  // All: both sets, sorted by calls desc
  const [ibRows, obRows] = await Promise.all([
    querySource<AgentRow>(ibQuery, [startDate, endDate, ...(clientIds || [])]),
    querySource<AgentRow>(obQuery, [startDate, endDate, ...(clientIds || [])]),
  ]);
  return [...ibRows, ...obRows].sort((a, b) => Number(b.calls) - Number(a.calls));
}

// ─── Scenario Detail (sub-scenario from scenario1 column) ────────────────────

export async function getScenarioDetail(scenario: string, filters: CallMasterFilters) {
  const { startDate, endDate, clientIds } = filters;
  const clientFilter = clientIds?.length
    ? `AND ClientId IN (${clientIds.map(() => '?').join(',')})` : '';

  const rows = await querySource<{ sub: string; cnt: number }>(`
    SELECT scenario1 AS sub, COUNT(*) AS cnt
    FROM db_audit.call_quality_assessment
    WHERE CallDate BETWEEN ? AND ?
      AND scenario = ? ${clientFilter}
      AND scenario1 IS NOT NULL AND scenario1 != ''
    GROUP BY scenario1
    ORDER BY cnt DESC
  `, [startDate, endDate, scenario, ...(clientIds || [])]);

  return rows.map(r => ({ name: String(r.sub), value: Number(r.cnt) }));
}

// ─── Calls by Month ───────────────────────────────────────────────────────────

export async function getCallsByMonth(filters: CallMasterFilters) {
  const { startDate, endDate, clientIds } = filters;

  const qFilter = clientIds?.length ? `AND ClientId IN (${clientIds.map(() => '?').join(',')})` : '';
  const oFilter = clientIds?.length ? `AND client_id IN (${clientIds.map(() => '?').join(',')})` : '';

  const [inbound, outbound] = await Promise.all([
    querySource<{ month: string; calls: number }>(`
      SELECT DATE_FORMAT(CallDate, '%Y-%m') AS month, COUNT(*) AS calls
      FROM db_audit.call_quality_assessment
      WHERE CallDate BETWEEN ? AND ? ${qFilter}
      GROUP BY month ORDER BY month ASC LIMIT 24
    `, [startDate, endDate, ...(clientIds || [])]),
    querySource<{ month: string; calls: number; sales: number }>(`
      SELECT
        DATE_FORMAT(CallDate, '%Y-%m') AS month,
        COUNT(*) AS calls,
        SUM(CASE WHEN SaleDone='1' THEN 1 ELSE 0 END) AS sales
      FROM db_external.CallDetails
      WHERE CallDate BETWEEN ? AND ? ${oFilter}
      GROUP BY month ORDER BY month ASC LIMIT 24
    `, [startDate, endDate, ...(clientIds || [])]),
  ]);

  // Merge by month
  const months: Record<string, { month: string; inbound: number; outbound: number; sales: number }> = {};
  inbound.forEach((r) => { months[r.month] = { month: r.month, inbound: Number(r.calls), outbound: 0, sales: 0 }; });
  outbound.forEach((r) => {
    if (!months[r.month]) months[r.month] = { month: r.month, inbound: 0, outbound: 0, sales: 0 };
    months[r.month].outbound = Number(r.calls);
    months[r.month].sales = Number(r.sales);
  });

  return Object.values(months).sort((a, b) => a.month.localeCompare(b.month));
}

// ─── Process List (quality + fatal per process) ───────────────────────────────

export async function getProcessList(filters: CallMasterFilters) {
  const { startDate, endDate, clientIds } = filters;
  const processFilter = clientIds?.length
    ? `AND p.dialdesk_client_id IN (${clientIds.map(() => '?').join(',')})`
    : '';

  const rows = await querySource<{
    process_name: string;
    lob: string;
    client_name: string;
    total_calls: number;
    quality_score: number | null;
    fatal_calls: number;
    fatal_rate: number | null;
  }>(`
    SELECT
      p.process_name,
      p.lob,
      COALESCE(c.name, 'Unknown') AS client_name,
      COUNT(q.CallDate)                                                    AS total_calls,
      ROUND(AVG(q.quality_percentage), 1)                                  AS quality_score,
      COALESCE(SUM(CASE WHEN q.quality_percentage = 0 THEN 1 ELSE 0 END), 0) AS fatal_calls,
      ROUND(
        SUM(CASE WHEN q.quality_percentage = 0 THEN 1 ELSE 0 END) * 100.0
          / NULLIF(COUNT(q.CallDate), 0),
        1
      ) AS fatal_rate
    FROM shivamgiri.md_processes p
    LEFT JOIN shivamgiri.md_clients c ON c.id = p.client_id
    LEFT JOIN db_audit.call_quality_assessment q
      ON CAST(q.ClientId AS UNSIGNED) = p.dialdesk_client_id
     AND q.CallDate BETWEEN ? AND ?
    WHERE p.is_active = TRUE ${processFilter}
    GROUP BY p.id, p.process_name, p.lob, c.name
    ORDER BY c.name, p.lob, p.process_name
  `, [startDate, endDate, ...(clientIds || [])]);

  return rows.map(r => ({
    process_name: String(r.process_name),
    lob:          String(r.lob),
    client_name:  String(r.client_name),
    total_calls:  Number(r.total_calls) || 0,
    quality_score: r.quality_score !== null ? Number(r.quality_score) : null,
    fatal_calls:  Number(r.fatal_calls) || 0,
    fatal_rate:   r.fatal_rate !== null ? Number(r.fatal_rate) : null,
  }));
}

// ─── Fatal Calls by Day of Week (inbound, quality_percentage = 0) ─────────────

export async function getFatalByDay(filters: CallMasterFilters) {
  const { startDate, endDate, clientIds } = filters;
  const clientFilter = clientIds?.length
    ? `AND ClientId IN (${clientIds.map(() => '?').join(',')})`
    : '';

  const rows = await querySource<{ day: string; dow: number; fatal_calls: number }>(`
    SELECT
      DAYNAME(CallDate)    AS day,
      DAYOFWEEK(CallDate)  AS dow,
      COUNT(*)             AS fatal_calls
    FROM db_audit.call_quality_assessment
    WHERE CallDate BETWEEN ? AND ?
      AND quality_percentage = 0
      ${clientFilter}
    GROUP BY DAYOFWEEK(CallDate), DAYNAME(CallDate)
    ORDER BY DAYOFWEEK(CallDate)
  `, [startDate, endDate, ...(clientIds || [])]);

  // Ensure all 7 days are present (fill missing days with 0)
  const DAY_ORDER = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
  const map = Object.fromEntries(rows.map(r => [String(r.day), Number(r.fatal_calls) || 0]));
  return DAY_ORDER.map(d => ({ day: d, fatal_calls: map[d] ?? 0 }));
}

// ─── Outbound Sales Intelligence ──────────────────────────────────────────────

const _obCf = (ids?: number[]) =>
  ids?.length ? `AND client_id IN (${ids.map(() => '?').join(',')})` : '';
const _obP = (s: string, e: string, ids?: number[]) => [s, e, ...(ids || [])];

export async function getOBSummary(filters: CallMasterFilters) {
  const { startDate, endDate, clientIds } = filters;
  const [row] = await querySource<{
    total: number; sales: number; conv_pct: number; avg_talk_sec: number; active_agents: number;
  }>(`
    SELECT
      COUNT(*)                                                                                    AS total,
      SUM(CASE WHEN SaleDone='1' OR SaleDone=1 THEN 1 ELSE 0 END)                             AS sales,
      ROUND(SUM(CASE WHEN SaleDone='1' OR SaleDone=1 THEN 1 ELSE 0 END)*100.0
            /NULLIF(COUNT(*),0), 2)                                                              AS conv_pct,
      ROUND(AVG(NULLIF(LengthSec,0)), 1)                                                        AS avg_talk_sec,
      COUNT(DISTINCT CASE WHEN AgentName IS NOT NULL AND AgentName!='' THEN AgentName END)      AS active_agents
    FROM db_external.CallDetails
    WHERE CallDate BETWEEN ? AND ? ${_obCf(clientIds)}
  `, _obP(startDate, endDate, clientIds));
  return {
    totalCalls:   Number(row?.total)         || 0,
    totalSales:   Number(row?.sales)         || 0,
    convPct:      Number(row?.conv_pct)      || 0,
    avgTalkSec:   Number(row?.avg_talk_sec)  || 0,
    activeAgents: Number(row?.active_agents) || 0,
  };
}

export async function getOBDailyTrend(filters: CallMasterFilters) {
  const { startDate, endDate, clientIds } = filters;
  return querySource<{ date: string; calls: number; sales: number; conv_pct: number; ob_quality: number }>(`
    SELECT
      DATE_FORMAT(CallDate,'%Y-%m-%d')                                                          AS date,
      COUNT(*)                                                                                   AS calls,
      SUM(CASE WHEN SaleDone='1' OR SaleDone=1 THEN 1 ELSE 0 END)                             AS sales,
      ROUND(SUM(CASE WHEN SaleDone='1' OR SaleDone=1 THEN 1 ELSE 0 END)*100.0
            /NULLIF(COUNT(*),0), 2)                                                              AS conv_pct,
      ROUND(AVG(${OB_QUALITY_EXPR}), 2)                                                         AS ob_quality
    FROM db_external.CallDetails
    WHERE CallDate BETWEEN ? AND ? ${_obCf(clientIds)}
    GROUP BY DATE_FORMAT(CallDate,'%Y-%m-%d')
    ORDER BY date ASC
    LIMIT 90
  `, _obP(startDate, endDate, clientIds));
}

export async function getOBHourly(filters: CallMasterFilters) {
  const { startDate, endDate, clientIds } = filters;
  const bucket: Record<number, { hour: string; calls: number; sales: number }> = {};
  for (let i = 0; i < 24; i++)
    bucket[i] = { hour: `${String(i).padStart(2, '0')}:00`, calls: 0, sales: 0 };

  const rows = await querySource<{ hour: number; calls: number; sales: number }>(`
    SELECT
      HOUR(CallDate) AS hour,
      COUNT(*) AS calls,
      SUM(CASE WHEN SaleDone='1' OR SaleDone=1 THEN 1 ELSE 0 END) AS sales
    FROM db_external.CallDetails
    WHERE CallDate BETWEEN ? AND ? ${_obCf(clientIds)}
    GROUP BY HOUR(CallDate)
  `, _obP(startDate, endDate, clientIds));

  rows.forEach(r => {
    bucket[r.hour].calls = Number(r.calls);
    bucket[r.hour].sales = Number(r.sales);
  });
  return Object.values(bucket);
}

export async function getOBAgentPerf(filters: CallMasterFilters, limit = 100) {
  const { startDate, endDate, clientIds } = filters;
  return querySource<{
    agent: string; calls: number; sales: number; conv_pct: number; ob_quality: number; avg_talk_sec: number;
  }>(`
    SELECT
      COALESCE(am.AgentName, AgentName) AS agent,
      COUNT(*) AS calls,
      SUM(CASE WHEN SaleDone='1' OR SaleDone=1 THEN 1 ELSE 0 END) AS sales,
      ROUND(SUM(CASE WHEN SaleDone='1' OR SaleDone=1 THEN 1 ELSE 0 END)*100.0
            /NULLIF(COUNT(*),0), 2) AS conv_pct,
      ROUND(AVG(${OB_QUALITY_EXPR}), 2) AS ob_quality,
      ROUND(AVG(NULLIF(LengthSec,0)), 1) AS avg_talk_sec
    FROM db_external.CallDetails
    LEFT JOIN db_masmis.AgentMaster am ON am.MasId = AgentName COLLATE utf8mb4_unicode_ci
    WHERE CallDate BETWEEN ? AND ? ${_obCf(clientIds)}
      AND AgentName IS NOT NULL AND AgentName != ''
    GROUP BY AgentName
    ORDER BY conv_pct DESC, calls DESC
    LIMIT ${limit}
  `, _obP(startDate, endDate, clientIds));
}

export async function getOBAgentDaily(agentName: string, filters: CallMasterFilters) {
  const { startDate, endDate, clientIds } = filters;
  return querySource<{ date: string; calls: number; sales: number; conv_pct: number; avg_talk_sec: number }>(`
    SELECT
      DATE_FORMAT(CallDate,'%Y-%m-%d') AS date,
      COUNT(*) AS calls,
      SUM(CASE WHEN SaleDone='1' OR SaleDone=1 THEN 1 ELSE 0 END) AS sales,
      ROUND(SUM(CASE WHEN SaleDone='1' OR SaleDone=1 THEN 1 ELSE 0 END)*100.0
            /NULLIF(COUNT(*),0), 2) AS conv_pct,
      ROUND(AVG(NULLIF(LengthSec,0)), 1) AS avg_talk_sec
    FROM db_external.CallDetails
    WHERE CallDate BETWEEN ? AND ? ${_obCf(clientIds)}
      AND AgentName = ?
    GROUP BY DATE_FORMAT(CallDate,'%Y-%m-%d')
    ORDER BY date ASC
  `, [..._obP(startDate, endDate, clientIds), agentName]);
}

export async function getOBDisposition(filters: CallMasterFilters) {
  const { startDate, endDate, clientIds } = filters;
  return querySource<{ disposition: string; cnt: number; sales: number }>(`
    SELECT
      COALESCE(NULLIF(TRIM(CallDisposition),''), 'Unknown') AS disposition,
      COUNT(*) AS cnt,
      SUM(CASE WHEN SaleDone='1' OR SaleDone=1 THEN 1 ELSE 0 END) AS sales
    FROM db_external.CallDetails
    WHERE CallDate BETWEEN ? AND ? ${_obCf(clientIds)}
    GROUP BY disposition
    ORDER BY cnt DESC
    LIMIT 20
  `, _obP(startDate, endDate, clientIds));
}

export async function getOBProductMix(filters: CallMasterFilters) {
  const { startDate, endDate, clientIds } = filters;
  return querySource<{ product: string; calls: number; sales: number }>(`
    SELECT
      COALESCE(NULLIF(TRIM(ProductOffering),''), 'Not Specified') AS product,
      COUNT(*) AS calls,
      SUM(CASE WHEN SaleDone='1' OR SaleDone=1 THEN 1 ELSE 0 END) AS sales
    FROM db_external.CallDetails
    WHERE CallDate BETWEEN ? AND ? ${_obCf(clientIds)}
    GROUP BY product
    ORDER BY calls DESC
    LIMIT 20
  `, _obP(startDate, endDate, clientIds));
}

export async function getOBNotInterested(filters: CallMasterFilters) {
  const { startDate, endDate, clientIds } = filters;
  return querySource<{ reason: string; cnt: number }>(`
    SELECT
      COALESCE(NULLIF(TRIM(NotInterestedBucketReason),''), 'Not Specified') AS reason,
      COUNT(*) AS cnt
    FROM db_external.CallDetails
    WHERE CallDate BETWEEN ? AND ? ${_obCf(clientIds)}
      AND NotInterestedBucketReason IS NOT NULL AND NotInterestedBucketReason != ''
    GROUP BY reason
    ORDER BY cnt DESC
    LIMIT 15
  `, _obP(startDate, endDate, clientIds));
}

export async function getOBQualityParams(filters: CallMasterFilters) {
  const { startDate, endDate, clientIds } = filters;
  const [row] = await querySource<Record<string, number>>(`
    SELECT
      ROUND(AVG(${obFlagCase('Opening')})*100,1) AS Opening,
      ROUND(AVG(${obFlagCase('Offered')})*100,1) AS Offered,
      ROUND(AVG(${obFlagCase('ObjectionHandling')})*100,1) AS ObjectionHandling,
      ROUND(AVG(${obFlagCase('PrepaidPitch')})*100,1) AS PrepaidPitch,
      ROUND(AVG(${obFlagCase('UpsellingEfforts')})*100,1) AS UpsellingEfforts,
      ROUND(AVG(${obFlagCase('OfferUrgency')})*100,1) AS OfferUrgency,
      ROUND(AVG(CASE WHEN LOWER(COALESCE(SensitiveWordUsed,'none'))='none' THEN 1 ELSE 0 END)*100,1) AS SensitiveWordUsed
    FROM db_external.CallDetails
    WHERE CallDate BETWEEN ? AND ? ${_obCf(clientIds)}
  `, _obP(startDate, endDate, clientIds));

  return OUTBOUND_PARAMS.map(p => ({
    parameter: p.label,
    key: p.key,
    score: row ? (Number(row[p.key]) || 0) : 0,
  }));
}

// ─── Export ───────────────────────────────────────────────────────────────────

const INBOUND_EXPORT_SQL: Record<string, string> = {
  CallDate:     'q.CallDate',
  User:         'q.User',
  Client:       "COALESCE(c.name, CONCAT('Client ', q.ClientId))",
  QualityScore: 'q.quality_percentage',
  scenario:     'q.scenario',
  scenario1:    'q.scenario1',
  call_answered_within_5_seconds:     'q.`call_answered_within_5_seconds`',
  customer_concern_acknowledged:      'q.`customer_concern_acknowledged`',
  professionalism_maintained:         'q.`professionalism_maintained`',
  assurance_or_appreciation_provided: 'q.`assurance_or_appreciation_provided`',
  pronunciation_and_clarity:          'q.`pronunciation_and_clarity`',
  enthusiasm_and_no_fumbling:         'q.`enthusiasm_and_no_fumbling`',
  active_listening:                   'q.`active_listening`',
  politeness_and_no_sarcasm:          'q.`politeness_and_no_sarcasm`',
  proper_grammar:                     'q.`proper_grammar`',
  accurate_issue_probing:             'q.`accurate_issue_probing`',
  proper_hold_procedure:              'q.`proper_hold_procedure`',
  proper_transfer_and_language:       'q.`proper_transfer_and_language`',
  dead_air_under_10_seconds:          'q.`dead_air_under_10_seconds`',
  case_escalated_correctly:           'q.`case_escalated_correctly`',
  address_recorded_completely:        'q.`address_recorded_completely`',
  correct_and_complete_information:   'q.`correct_and_complete_information`',
  upselling_or_offers_suggested:      'q.`upselling_or_offers_suggested`',
  further_assistance_offered:         'q.`further_assistance_offered`',
  proper_call_closure:                'q.`proper_call_closure`',
};

const OBQ_EXPORT_SQL = `ROUND((
  ${obFlagCase('d.Opening')} +
  ${obFlagCase('d.Offered')} +
  ${obFlagCase('d.ObjectionHandling')} +
  ${obFlagCase('d.PrepaidPitch')} +
  ${obFlagCase('d.UpsellingEfforts')} +
  ${obFlagCase('d.OfferUrgency')} +
  (CASE WHEN LOWER(COALESCE(d.SensitiveWordUsed,'none')) = 'none' THEN 1 ELSE 0 END)
) / 7.0 * 100, 1)`;

const OUTBOUND_EXPORT_SQL: Record<string, string> = {
  CallDate:         'd.CallDate',
  AgentName:        'd.AgentName',
  Client:           "COALESCE(c.name, CONCAT('Client ', d.client_id))",
  LengthSec:        'd.LengthSec',
  CallDisposition:  'd.CallDisposition',
  StartTime:        'd.StartTime',
  EndTime:          'd.EndTime',
  Opening:          'd.Opening',
  Offered:          'd.Offered',
  ObjectionHandling:'d.ObjectionHandling',
  PrepaidPitch:     'd.PrepaidPitch',
  UpsellingEfforts: 'd.UpsellingEfforts',
  OfferUrgency:     'd.OfferUrgency',
  SensitiveWordUsed:'d.SensitiveWordUsed',
  OBQuality:        OBQ_EXPORT_SQL,
  SaleDone:         'd.SaleDone',
  ProductOffering:  'd.ProductOffering',
  DiscountType:     'd.DiscountType',
  Category:         'd.Category',
  SubCategory:      'd.SubCategory',
  Feedback:         'd.Feedback',
  Feedback_Category:'d.Feedback_Category',
  AreaForImprovement:'d.AreaForImprovement',
  SensitiveWordContext:'d.SensitiveWordContext',
  NotInterestedBucketReason:'d.NotInterestedBucketReason',
};

export async function getExportData(
  filters: CallMasterFilters,
  source: 'inbound' | 'outbound',
  selectedColKeys: string[],
  limit = 5000,
) {
  const sqlMap = source === 'inbound' ? INBOUND_EXPORT_SQL : OUTBOUND_EXPORT_SQL;
  const validKeys = selectedColKeys.filter(k => k in sqlMap);
  if (validKeys.length === 0) return [];

  const { startDate, endDate, clientIds } = filters;
  const selectClause = validKeys.map(k => `${sqlMap[k]} AS \`${k}\``).join(', ');

  if (source === 'inbound') {
    const clientFilter = clientIds?.length
      ? `AND q.ClientId IN (${clientIds.map(() => '?').join(',')})`
      : '';
    return querySource(
      `SELECT ${selectClause}
       FROM db_audit.call_quality_assessment q
       LEFT JOIN shivamgiri.md_clients c ON c.dialdesk_client_id = CAST(q.ClientId AS UNSIGNED)
       WHERE q.CallDate BETWEEN ? AND ? ${clientFilter}
       ORDER BY q.CallDate DESC
       LIMIT ${limit}`,
      [startDate, endDate, ...(clientIds || [])],
    );
  } else {
    const clientFilter = clientIds?.length
      ? `AND d.client_id IN (${clientIds.map(() => '?').join(',')})`
      : '';
    return querySource(
      `SELECT ${selectClause}
       FROM db_external.CallDetails d
       LEFT JOIN shivamgiri.md_clients c ON c.dialdesk_client_id = d.client_id
       WHERE d.CallDate BETWEEN ? AND ? ${clientFilter}
         AND d.AgentName IS NOT NULL AND d.AgentName != ''
       ORDER BY d.CallDate DESC
       LIMIT ${limit}`,
      [startDate, endDate, ...(clientIds || [])],
    );
  }
}

// ─── Fatal Agent Summary (agent × date aggregation for export) ────────────────

// ─── Agent Audit Summary (per-agent quality band breakdown) ──────────────────

export async function getAgentAuditSummary(filters: CallMasterFilters) {
  const { startDate, endDate, clientIds } = filters;
  const clientFilter = clientIds?.length
    ? `AND ClientId IN (${clientIds.map(() => '?').join(',')})`
    : '';

  const rows = await querySource<{
    agent: string;
    audit_count: number;
    cq_score: number;
    fatal_count: number;
    fatal_pct: number;
    tq_count: number;
    mq_count: number;
    bq_count: number;
  }>(`
    SELECT
      COALESCE(am.AgentName, q.User)                                             AS agent,
      COUNT(*)                                                                   AS audit_count,
      ROUND(AVG(q.quality_percentage), 1)                                        AS cq_score,
      SUM(CASE WHEN q.quality_percentage = 0 THEN 1 ELSE 0 END)                AS fatal_count,
      ROUND(
        SUM(CASE WHEN q.quality_percentage = 0 THEN 1 ELSE 0 END) * 100.0 / NULLIF(COUNT(*), 0),
        1
      )                                                                          AS fatal_pct,
      SUM(CASE WHEN q.quality_percentage >= 80 THEN 1 ELSE 0 END)              AS tq_count,
      SUM(CASE WHEN q.quality_percentage >= 60 AND q.quality_percentage < 80 THEN 1 ELSE 0 END) AS mq_count,
      SUM(CASE WHEN q.quality_percentage > 0  AND q.quality_percentage < 60 THEN 1 ELSE 0 END)  AS bq_count
    FROM db_audit.call_quality_assessment q
    LEFT JOIN db_masmis.AgentMaster am ON am.MasId = q.User COLLATE utf8mb4_unicode_ci
    WHERE q.CallDate BETWEEN ? AND ? ${clientFilter.replace(/ClientId/g, 'q.ClientId')}
    GROUP BY q.User
    ORDER BY cq_score DESC
  `, [startDate, endDate, ...(clientIds || [])]);

  return rows.map(r => ({
    agent:       r.agent,
    audit_count: Number(r.audit_count) || 0,
    cq_score:    parseFloat(String(r.cq_score)) || 0,
    fatal_count: Number(r.fatal_count) || 0,
    fatal_pct:   parseFloat(String(r.fatal_pct)) || 0,
    tq_count:    Number(r.tq_count) || 0,
    mq_count:    Number(r.mq_count) || 0,
    bq_count:    Number(r.bq_count) || 0,
  }));
}

export async function getFatalAgentSummary(filters: CallMasterFilters, limit = 50000) {
  const { startDate, endDate, clientIds } = filters;
  const clientFilter = clientIds?.length
    ? `AND q.ClientId IN (${clientIds.map(() => '?').join(',')})`
    : '';

  return querySource<{
    date: string;
    agent: string;
    client: string;
    total_calls: number;
    fatal_calls: number;
    fatal_rate: number;
    avg_quality: number;
  }>(`
    SELECT
      q.CallDate                                                             AS date,
      COALESCE(am.AgentName, q.User)                 AS agent,
      COALESCE(c.name, CONCAT('Client ', q.ClientId))                       AS client,
      COUNT(*)                                                               AS total_calls,
      SUM(CASE WHEN q.quality_percentage = 0 THEN 1 ELSE 0 END)            AS fatal_calls,
      ROUND(
        SUM(CASE WHEN q.quality_percentage = 0 THEN 1 ELSE 0 END) * 100.0
          / NULLIF(COUNT(*), 0),
        2
      )                                                                      AS fatal_rate,
      ROUND(AVG(q.quality_percentage), 2)                                    AS avg_quality
    FROM db_audit.call_quality_assessment q
    LEFT JOIN shivamgiri.md_clients c ON c.dialdesk_client_id = CAST(q.ClientId AS UNSIGNED)
    LEFT JOIN db_masmis.AgentMaster am ON am.MasId = q.User COLLATE utf8mb4_unicode_ci
    WHERE q.CallDate BETWEEN ? AND ? ${clientFilter}
    GROUP BY q.CallDate, q.User, q.ClientId, c.name
    ORDER BY q.CallDate DESC, q.User ASC
    LIMIT ${limit}
  `, [startDate, endDate, ...(clientIds || [])]);
}
