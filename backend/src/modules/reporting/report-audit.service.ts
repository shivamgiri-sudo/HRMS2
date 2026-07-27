import { db } from '../../db/mysql.js';

export const REPORT_AUDIT_EVENTS = {
  REQUEST_SUBMITTED:          'REQUEST_SUBMITTED',
  REQUEST_REJECTED:           'REQUEST_REJECTED',
  EMAIL_RESOLUTION_FAILED:    'EMAIL_RESOLUTION_FAILED',
  SCOPE_RESOLVED:             'SCOPE_RESOLVED',
  REQUEST_QUEUED:             'REQUEST_QUEUED',
  DUPLICATE_DETECTED:         'DUPLICATE_DETECTED',
  REQUEST_CANCELLED:          'REQUEST_CANCELLED',
  GENERATION_STARTED:         'GENERATION_STARTED',
  SOURCE_QUERY_COMPLETED:     'SOURCE_QUERY_COMPLETED',
  GENERATION_COMPLETED:       'GENERATION_COMPLETED',
  GENERATION_FAILED:          'GENERATION_FAILED',
  FILE_STORED:                'FILE_STORED',
  EMAIL_QUEUED:               'EMAIL_QUEUED',
  EMAIL_SEND_STARTED:         'EMAIL_SEND_STARTED',
  EMAIL_SENT:                 'EMAIL_SENT',
  EMAIL_FAILED:               'EMAIL_FAILED',
  RETRY_SCHEDULED:            'RETRY_SCHEDULED',
  REQUEST_COMPLETED:          'REQUEST_COMPLETED',
  FILE_EXPIRED:               'FILE_EXPIRED',
  FILE_DELETED:               'FILE_DELETED',
  STALE_JOB_RECOVERED:        'STALE_JOB_RECOVERED',
  SUPER_ADMIN_VIEWED_REQUEST: 'SUPER_ADMIN_VIEWED_REQUEST',
  SUPER_ADMIN_RETRIED:        'SUPER_ADMIN_RETRIED',
  SUPER_ADMIN_CANCELLED:      'SUPER_ADMIN_CANCELLED',
} as const;

export type ReportAuditEventType = typeof REPORT_AUDIT_EVENTS[keyof typeof REPORT_AUDIT_EVENTS];

export interface ReportAuditEventInput {
  reportRequestId?: string;
  eventType: ReportAuditEventType;
  eventStatus?: string;
  activityAt?: Date;
  actorType?: 'user' | 'worker' | 'system' | 'admin';
  actorUserId?: string;
  actorEmployeeId?: string;
  actorEmployeeCode?: string;
  actorName?: string;
  actorRole?: string;
  reportCode?: string;
  reportName?: string;
  recipientEmail?: string;
  filtersSnapshotJson?: unknown;
  scopeSnapshotJson?: unknown;
  fileId?: string;
  deliveryId?: string;
  correlationId?: string;
  ipAddress?: string;
  userAgent?: string;
  message?: string;
  errorCode?: string;
  errorDetail?: string;
  metadataJson?: unknown;
}

export async function recordReportAuditEvent(input: ReportAuditEventInput): Promise<void> {
  try {
    await db.execute(
      `INSERT INTO report_audit_event
        (report_request_id, event_type, event_status, activity_at, actor_type,
         actor_user_id, actor_employee_id, actor_employee_code, actor_name, actor_role,
         report_code, report_name, recipient_email,
         filters_snapshot_json, scope_snapshot_json,
         file_id, delivery_id, correlation_id,
         ip_address, user_agent, message, error_code, error_detail, metadata_json)
       VALUES (?,?,?,?,?, ?,?,?,?,?, ?,?,?, ?,?, ?,?,?, ?,?,?,?,?,?)`,
      [
        input.reportRequestId ?? null,
        input.eventType,
        input.eventStatus ?? null,
        input.activityAt ?? new Date(),
        input.actorType ?? 'user',
        input.actorUserId ?? null,
        input.actorEmployeeId ?? null,
        input.actorEmployeeCode ?? null,
        input.actorName ?? null,
        input.actorRole ?? null,
        input.reportCode ?? null,
        input.reportName ?? null,
        input.recipientEmail ?? null,
        input.filtersSnapshotJson != null ? JSON.stringify(input.filtersSnapshotJson) : null,
        input.scopeSnapshotJson != null ? JSON.stringify(input.scopeSnapshotJson) : null,
        input.fileId ?? null,
        input.deliveryId ?? null,
        input.correlationId ?? null,
        input.ipAddress ?? null,
        input.userAgent ? String(input.userAgent).slice(0, 512) : null,
        input.message ?? null,
        input.errorCode ?? null,
        input.errorDetail ?? null,
        input.metadataJson != null ? JSON.stringify(input.metadataJson) : null,
      ]
    );
  } catch (err) {
    // Non-throwing — audit failures must not break the application
    process.stderr.write(
      JSON.stringify({
        level: 'error',
        source: 'report-audit.service',
        message: 'Failed to write report audit event',
        eventType: input.eventType,
        reportRequestId: input.reportRequestId,
        error: err instanceof Error ? err.message : String(err),
      }) + '\n'
    );
  }
}
