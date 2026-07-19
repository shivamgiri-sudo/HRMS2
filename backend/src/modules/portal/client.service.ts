import { db } from "../../db/mysql.js";
import type { ResultSetHeader, RowDataPacket } from "mysql2";

// ============================================================
// CLIENT MASTER MANAGEMENT
// ============================================================

export interface Client {
  id: string;
  client_code: string;
  client_name: string;
  legal_entity_name?: string;
  industry?: string;
  primary_contact_name?: string;
  primary_contact_email?: string;
  primary_contact_phone?: string;
  escalation_contact_name?: string;
  escalation_contact_email?: string;
  escalation_contact_phone?: string;
  address_line1?: string;
  address_line2?: string;
  city?: string;
  state?: string;
  country?: string;
  postal_code?: string;
  logo_url?: string;
  website?: string;
  contract_start_date?: Date;
  contract_end_date?: Date;
  billing_cycle: 'MONTHLY' | 'QUARTERLY' | 'ANNUAL';
  api_key?: string;
  webhook_url?: string;
  subscription_status: 'ACTIVE' | 'SUSPENDED' | 'TRIAL' | 'EXPIRED';
  active_status: boolean;
  created_at: Date;
  updated_at?: Date;
}

export interface CreateClientInput {
  client_code: string;
  client_name: string;
  legal_entity_name?: string;
  industry?: string;
  primary_contact_name?: string;
  primary_contact_email?: string;
  primary_contact_phone?: string;
  escalation_contact_name?: string;
  escalation_contact_email?: string;
  escalation_contact_phone?: string;
  address_line1?: string;
  address_line2?: string;
  city?: string;
  state?: string;
  country?: string;
  postal_code?: string;
  logo_url?: string;
  website?: string;
  contract_start_date?: string;
  contract_end_date?: string;
  billing_cycle?: 'MONTHLY' | 'QUARTERLY' | 'ANNUAL';
  webhook_url?: string;
}

export async function listClients(filters?: {
  active_only?: boolean;
  subscription_status?: string;
  search?: string;
}): Promise<Client[]> {
  let query = "SELECT * FROM client_master WHERE 1=1";
  const params: any[] = [];

  if (filters?.active_only) {
    query += " AND active_status = 1";
  }

  if (filters?.search) {
    query += " AND (client_name LIKE ? OR client_code LIKE ?)";
    const searchPattern = `%${filters.search}%`;
    params.push(searchPattern, searchPattern);
  }

  query += " ORDER BY client_name";

  const [rows] = await db.execute<RowDataPacket[]>(query, params);
  return rows as Client[];
}

export async function getClient(id: string): Promise<Client | null> {
  const [rows] = await db.execute<RowDataPacket[]>(
    "SELECT * FROM client_master WHERE id = ?",
    [id]
  );
  return rows.length > 0 ? (rows[0] as Client) : null;
}

const CLIENT_WRITABLE_COLS = new Set([
  'client_code', 'client_name', 'legal_entity_name', 'industry',
  'primary_contact_name', 'primary_contact_email', 'primary_contact_phone',
  'escalation_contact_name', 'escalation_contact_email', 'escalation_contact_phone',
  'address_line1', 'address_line2', 'city', 'state', 'country', 'postal_code',
  'logo_url', 'website', 'contract_start_date', 'contract_end_date',
  'billing_cycle', 'subscription_status', 'webhook_url', 'active_status',
]);

export async function createClient(
  data: CreateClientInput,
  createdBy: string
): Promise<Client> {
  const id = (await import('crypto')).randomUUID();

  const cols = ['id', 'client_code', 'client_name', 'active_status'];
  const vals: any[] = [id, data.client_code, data.client_name, 1];

  // Write all provided optional fields
  (Object.entries(data) as [string, any][]).forEach(([key, value]) => {
    if (value !== undefined && key !== 'client_code' && key !== 'client_name' && CLIENT_WRITABLE_COLS.has(key)) {
      cols.push(key);
      vals.push(value);
    }
  });

  await db.execute(
    `INSERT INTO client_master (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`,
    vals
  );

  const client = await getClient(id);
  if (!client) throw new Error("Failed to retrieve created client");
  return client;
}

export async function updateClient(
  id: string,
  data: Partial<CreateClientInput>
): Promise<void> {
  const updates: string[] = [];
  const params: any[] = [];

  (Object.entries(data) as [string, any][]).forEach(([key, value]) => {
    if (value !== undefined && CLIENT_WRITABLE_COLS.has(key)) {
      updates.push(`${key} = ?`);
      params.push(value);
    }
  });

  if (updates.length === 0) return;

  params.push(id);
  await db.execute(
    `UPDATE client_master SET ${updates.join(", ")} WHERE id = ?`,
    params
  );
}

export async function toggleClientStatus(
  id: string,
  active_status: boolean
): Promise<void> {
  await db.execute(
    "UPDATE client_master SET active_status = ? WHERE id = ?",
    [active_status ? 1 : 0, id]
  );
}

export async function updateClientSubscriptionStatus(
  id: string,
  status: 'ACTIVE' | 'SUSPENDED' | 'TRIAL' | 'EXPIRED'
): Promise<void> {
  await db.execute(
    "UPDATE client_master SET subscription_status = ? WHERE id = ?",
    [status, id]
  );
}

// ============================================================
// CLIENT ANALYTICS
// ============================================================

export interface ClientStats {
  total_clients: number;
  active_clients: number;
  trial_clients: number;
  total_processes: number;
  total_portal_users: number;
  active_portal_users: number;
}

export async function getClientStats(): Promise<ClientStats> {
  const [clientRows] = await db.execute<RowDataPacket[]>(
    `SELECT
      COUNT(*) as total_clients,
      SUM(CASE WHEN active_status = 1 THEN 1 ELSE 0 END) as active_clients,
      SUM(CASE WHEN subscription_status = 'TRIAL' THEN 1 ELSE 0 END) as trial_clients
     FROM client_master`
  );

  const [userRows] = await db.execute<RowDataPacket[]>(
    `SELECT
      COUNT(*) as total_portal_users,
      SUM(CASE WHEN is_active = 1 THEN 1 ELSE 0 END) as active_portal_users
     FROM client_user`
  );

  const [procRows] = await db.execute<RowDataPacket[]>(
    `SELECT COUNT(*) as total_processes FROM process_master WHERE active_status = 1`
  );

  if (!clientRows[0]) return { total_clients: 0, active_clients: 0, trial_clients: 0, total_processes: 0, total_portal_users: 0, active_portal_users: 0 };

  return {
    total_clients: Number(clientRows[0].total_clients) || 0,
    active_clients: Number(clientRows[0].active_clients) || 0,
    trial_clients: Number(clientRows[0].trial_clients) || 0,
    total_processes: procRows[0] ? Number(procRows[0].total_processes) || 0 : 0,
    total_portal_users: userRows[0] ? Number(userRows[0].total_portal_users) || 0 : 0,
    active_portal_users: userRows[0] ? Number(userRows[0].active_portal_users) || 0 : 0,
  };
}

export interface ClientUsageSummary {
  client_id: string;
  client_name: string;
  active_users: number;
  total_logins: number;
  last_30_days_logins: number;
  api_calls: number;
  report_views: number;
  last_activity: Date | null;
}

export async function getClientUsageSummary(
  days: number = 30
): Promise<ClientUsageSummary[]> {
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT
      c.id                                                           AS client_id,
      c.client_name,
      COUNT(DISTINCT pu.id)                                          AS active_users,
      COUNT(pal.id)                                                  AS total_logins,
      SUM(CASE WHEN pal.created_at >= DATE_SUB(NOW(), INTERVAL ? DAY) THEN 1 ELSE 0 END)
                                                                     AS last_30_days_logins,
      0                                                              AS api_calls,
      SUM(CASE WHEN pal.page NOT IN ('LOGIN','LOGOUT') THEN 1 ELSE 0 END)
                                                                     AS report_views,
      MAX(pal.created_at)                                            AS last_activity
     FROM client_master c
     LEFT JOIN client_user pu  ON pu.client_id = c.id AND pu.is_active = 1
     LEFT JOIN portal_access_log pal ON pal.client_user_id = pu.id
     WHERE c.active_status = 1
     GROUP BY c.id, c.client_name
     ORDER BY last_activity DESC`,
    [days]
  );

  return rows as ClientUsageSummary[];
}

// ============================================================
// BULK OPERATIONS
// ============================================================

export interface BulkOperationJob {
  id: string;
  job_type: string;
  entity_type: string;
  status: string;
  total_records: number;
  processed_records: number;
  success_count: number;
  error_count: number;
  error_log?: any[];
  created_by: string;
  created_at: Date;
  completed_at?: Date;
}

export async function createBulkJob(
  jobType: string,
  entityType: string,
  totalRecords: number,
  createdBy: string,
  fileUrl?: string
): Promise<string> {
  const [result] = await db.execute<ResultSetHeader>(
    `INSERT INTO bulk_operation_jobs (
      job_type, entity_type, total_records, file_url, created_by
    ) VALUES (?, ?, ?, ?, ?)`,
    [jobType, entityType, totalRecords, fileUrl || null, createdBy]
  );
  return result.insertId.toString();
}

export async function updateBulkJobProgress(
  jobId: string,
  processed: number,
  success: number,
  errors: number,
  errorLog?: any[]
): Promise<void> {
  await db.execute(
    `UPDATE bulk_operation_jobs
     SET processed_records = ?, success_count = ?, error_count = ?,
         error_log = ?, status = CASE WHEN ? >= total_records THEN 'COMPLETED' ELSE 'PROCESSING' END
     WHERE id = ?`,
    [processed, success, errors, JSON.stringify(errorLog || []), processed, jobId]
  );
}

export async function getBulkJobs(limit: number = 50): Promise<BulkOperationJob[]> {
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT * FROM bulk_operation_jobs
     ORDER BY created_at DESC
     LIMIT ?`,
    [limit]
  );
  return rows as BulkOperationJob[];
}
