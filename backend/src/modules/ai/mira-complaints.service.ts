import type { RowDataPacket } from 'mysql2';
import { db } from '../../db/mysql.js';
import { triageWorkItem, TRIAGE_AUDIT_ACTION, findUntriagedMiraFeedback } from './mira-issue-triage.service.js';
import { FIX_DRAFT_AUDIT_ACTION, parseDiagnosisRemark } from './mira-fix-draft-generate.service.js';

export interface ComplaintSummary {
  id: string;
  title: string;
  description: string;
  priority: string;
  status: string;
  created_at: string;
  reporter_name: string;
  reporter_code: string | null;
  triage_status: 'pending' | 'diagnosed' | 'rejected' | 'error' | 'unavailable';
  triage_category: string | null;
  triage_confidence: string | null;
  triage_actionable: boolean | null;
  triage_root_cause: string | null;
  triage_next_step: string | null;
  triaged_at: string | null;
  draft_count: number;
  latest_draft_status: string | null;
}

export interface AuditRow {
  id: string;
  action: string;
  from_status: string;
  to_status: string;
  remarks: string | null;
  performed_by: string;
  performed_at: string;
}

export interface FixDraftRow {
  id: string;
  status: string;
  target_files: string[];
  diff_text: string;
  model: string | null;
  safety_flags: Array<{ file: string; reason: string }> | null;
  rejected_reason: string | null;
  test_output: string | null;
  created_at: string;
}

export interface UsageRow {
  id: string;
  provider_key: string;
  model_name: string | null;
  request_source: string;
  input_tokens: number;
  output_tokens: number;
  latency_ms: number;
  success: boolean;
  safety_blocked: boolean;
  created_at: string;
}

export interface ComplaintDetail {
  id: string;
  title: string;
  description: string;
  priority: string;
  status: string;
  created_at: string;
  updated_at: string;
  reporter_name: string;
  reporter_code: string | null;
  audit_log: AuditRow[];
  fix_drafts: FixDraftRow[];
  usage_log: UsageRow[];
}

function triageStatus(remarks: string | null): ComplaintSummary['triage_status'] {
  if (!remarks) return 'pending';
  if (remarks.startsWith('AI-drafted diagnosis')) return 'diagnosed';
  if (remarks.startsWith('Not analysed')) return 'rejected';
  if (remarks.startsWith('AI diagnosis unavailable')) return 'unavailable';
  if (remarks.startsWith('AI diagnosis failed')) return 'error';
  return 'pending';
}

export async function listComplaints(limit = 200): Promise<ComplaintSummary[]> {
  // Note: TRIAGE_AUDIT_ACTION is inlined as a string literal because MySQL doesn't support
  // ? placeholders inside correlated subqueries (ER_WRONG_ARGUMENTS errno 1210)
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT
       wi.id, wi.title, wi.description, wi.priority, wi.status, wi.created_at,
       CONCAT(COALESCE(e.first_name,''), ' ', COALESCE(e.last_name,'')) AS reporter_name,
       e.employee_code AS reporter_code,
       (SELECT al.remarks FROM work_item_audit_log al
         WHERE al.work_item_id = wi.id AND al.action = '${TRIAGE_AUDIT_ACTION}'
         ORDER BY al.performed_at DESC LIMIT 1) AS triage_remarks,
       (SELECT al.performed_at FROM work_item_audit_log al
         WHERE al.work_item_id = wi.id AND al.action = '${TRIAGE_AUDIT_ACTION}'
         ORDER BY al.performed_at DESC LIMIT 1) AS triaged_at,
       (SELECT COUNT(*) FROM mira_fix_draft fd WHERE fd.work_item_id = wi.id) AS draft_count,
       (SELECT fd.status FROM mira_fix_draft fd
         WHERE fd.work_item_id = wi.id ORDER BY fd.created_at DESC LIMIT 1) AS latest_draft_status
     FROM work_item wi
     LEFT JOIN employees e ON e.id = wi.created_by
     WHERE wi.item_type = 'MIRA_FEEDBACK'
     ORDER BY wi.created_at DESC
     LIMIT ?`,
    [limit],
  );

  return (rows as RowDataPacket[]).map((r) => {
    const remarks = r.triage_remarks ? String(r.triage_remarks) : null;
    const parsed = remarks ? parseDiagnosisRemark(remarks) : null;
    const status = triageStatus(remarks);
    return {
      id: String(r.id),
      title: String(r.title ?? ''),
      description: String(r.description ?? ''),
      priority: String(r.priority ?? 'high'),
      status: String(r.status ?? 'pending'),
      created_at: r.created_at instanceof Date ? r.created_at.toISOString() : String(r.created_at ?? ''),
      reporter_name: String(r.reporter_name ?? '').trim() || 'Unknown',
      reporter_code: r.reporter_code ? String(r.reporter_code) : null,
      triage_status: status,
      triage_category: parsed?.category ?? null,
      triage_confidence: parsed?.confidence ?? null,
      triage_actionable: parsed ? parsed.actionable : null,
      triage_root_cause: parsed?.rootCauseHypothesis ?? null,
      triage_next_step: parsed?.suggestedNextStep ?? null,
      triaged_at: r.triaged_at instanceof Date ? r.triaged_at.toISOString() : (r.triaged_at ? String(r.triaged_at) : null),
      draft_count: Number(r.draft_count ?? 0),
      latest_draft_status: r.latest_draft_status ? String(r.latest_draft_status) : null,
    };
  });
}

export async function getComplaintDetail(id: string): Promise<ComplaintDetail | null> {
  const [[wiRow]] = await db.execute<RowDataPacket[]>(
    `SELECT wi.*, CONCAT(COALESCE(e.first_name,''), ' ', COALESCE(e.last_name,'')) AS reporter_name,
            e.employee_code AS reporter_code
       FROM work_item wi
       LEFT JOIN employees e ON e.id = wi.created_by
      WHERE wi.id = ? AND wi.item_type = 'MIRA_FEEDBACK'`,
    [id],
  ) as [RowDataPacket[], unknown];

  if (!wiRow) return null;

  const [auditRows] = await db.execute<RowDataPacket[]>(
    `SELECT id, action, from_status, to_status, remarks, performed_by,
            performed_at
       FROM work_item_audit_log
      WHERE work_item_id = ?
      ORDER BY performed_at ASC`,
    [id],
  );

  const [draftRows] = await db.execute<RowDataPacket[]>(
    `SELECT id, status, target_files, diff_text, model, safety_flags,
            rejected_reason, test_output, created_at
       FROM mira_fix_draft
      WHERE work_item_id = ?
      ORDER BY created_at DESC`,
    [id],
  );

  const [usageRows] = await db.execute<RowDataPacket[]>(
    `SELECT id, provider_key, model_name, request_source, input_tokens, output_tokens,
            latency_ms, success, safety_blocked, created_at
       FROM ai_provider_usage_log
      WHERE entity_id = ? AND entity_type = 'mira_feedback'
      ORDER BY created_at ASC`,
    [id],
  );

  return {
    id: String(wiRow.id),
    title: String(wiRow.title ?? ''),
    description: String(wiRow.description ?? ''),
    priority: String(wiRow.priority ?? ''),
    status: String(wiRow.status ?? ''),
    created_at: wiRow.created_at instanceof Date ? wiRow.created_at.toISOString() : String(wiRow.created_at ?? ''),
    updated_at: wiRow.updated_at instanceof Date ? wiRow.updated_at.toISOString() : String(wiRow.updated_at ?? ''),
    reporter_name: String(wiRow.reporter_name ?? '').trim() || 'Unknown',
    reporter_code: wiRow.reporter_code ? String(wiRow.reporter_code) : null,
    audit_log: (auditRows as RowDataPacket[]).map((al) => ({
      id: String(al.id),
      action: String(al.action ?? ''),
      from_status: String(al.from_status ?? ''),
      to_status: String(al.to_status ?? ''),
      remarks: al.remarks ? String(al.remarks) : null,
      performed_by: String(al.performed_by ?? ''),
      performed_at: al.performed_at instanceof Date ? al.performed_at.toISOString() : String(al.performed_at ?? ''),
    })),
    fix_drafts: (draftRows as RowDataPacket[]).map((fd) => {
      let targetFiles: string[] = [];
      let safetyFlags = null;
      try { targetFiles = JSON.parse(String(fd.target_files ?? '[]')); } catch {}
      try { safetyFlags = fd.safety_flags ? JSON.parse(String(fd.safety_flags)) : null; } catch {}
      return {
        id: String(fd.id),
        status: String(fd.status ?? ''),
        target_files: targetFiles,
        diff_text: String(fd.diff_text ?? ''),
        model: fd.model ? String(fd.model) : null,
        safety_flags: safetyFlags,
        rejected_reason: fd.rejected_reason ? String(fd.rejected_reason) : null,
        test_output: fd.test_output ? String(fd.test_output) : null,
        created_at: fd.created_at instanceof Date ? fd.created_at.toISOString() : String(fd.created_at ?? ''),
      };
    }),
    usage_log: (usageRows as RowDataPacket[]).map((ul) => ({
      id: String(ul.id),
      provider_key: String(ul.provider_key ?? ''),
      model_name: ul.model_name ? String(ul.model_name) : null,
      request_source: String(ul.request_source ?? ''),
      input_tokens: Number(ul.input_tokens ?? 0),
      output_tokens: Number(ul.output_tokens ?? 0),
      latency_ms: Number(ul.latency_ms ?? 0),
      success: Boolean(ul.success),
      safety_blocked: Boolean(ul.safety_blocked),
      created_at: ul.created_at instanceof Date ? ul.created_at.toISOString() : String(ul.created_at ?? ''),
    })),
  };
}

export async function retriageComplaint(id: string): Promise<{ ok: boolean; outcome: string }> {
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT id, description FROM work_item WHERE id = ? AND item_type = 'MIRA_FEEDBACK'`,
    [id],
  );
  if (!(rows as RowDataPacket[]).length) return { ok: false, outcome: 'not_found' };

  const item = (rows as RowDataPacket[])[0];
  const outcome = await triageWorkItem(String(item.id), String(item.description ?? ''));
  return { ok: true, outcome: outcome.status };
}

export async function getComplaintStats(): Promise<{
  total: number;
  pending_triage: number;
  diagnosed: number;
  with_drafts: number;
  resolved: number;
}> {
  const [[counts]] = await db.execute<RowDataPacket[]>(
    `SELECT
       COUNT(*) AS total,
       SUM(CASE WHEN wi.status = 'completed' THEN 1 ELSE 0 END) AS resolved
     FROM work_item wi
     WHERE wi.item_type = 'MIRA_FEEDBACK'`,
    [],
  ) as [RowDataPacket[], unknown];

  const untriaged = await findUntriagedMiraFeedback();

  const [[draftCounts]] = await db.execute<RowDataPacket[]>(
    `SELECT COUNT(DISTINCT fd.work_item_id) AS with_drafts
       FROM mira_fix_draft fd
       JOIN work_item wi ON wi.id = fd.work_item_id AND wi.item_type = 'MIRA_FEEDBACK'`,
    [],
  ) as [RowDataPacket[], unknown];

  const total = Number(counts?.total ?? 0);
  const resolved = Number(counts?.resolved ?? 0);
  const pendingTriage = untriaged.length;

  return {
    total,
    pending_triage: pendingTriage,
    diagnosed: total - pendingTriage - resolved,
    with_drafts: Number(draftCounts?.with_drafts ?? 0),
    resolved,
  };
}
