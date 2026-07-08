import { randomUUID } from "crypto";
import type { RowDataPacket } from "mysql2";
import { db } from "../../db/mysql.js";
import { validateEpfCompliance } from "../employees/epfComplianceValidation.service.js";
import type { EpfProfileInput, EpfNomineeInput } from "../employees/epfComplianceValidation.service.js";

interface BatchFilter {
  branchId?: string | null;
  establishmentId?: string | null;
  status?: string | null;
}

interface QueueFilter {
  batchId?: string | null;
  itemStatus?: string | null;
  branchId?: string | null;
  search?: string | null;
  limit?: number;
  offset?: number;
}

async function logPfAudit(input: {
  batchId?: string | null;
  batchItemId?: string | null;
  employeeId?: string | null;
  actionType: string;
  actorUserId?: string | null;
  actorType?: string;
  remarks?: string | null;
  oldValue?: unknown;
  newValue?: unknown;
}) {
  await db.execute(
    `INSERT INTO pf_creation_audit_log
       (id, batch_id, batch_item_id, employee_id, action_type, actor_user_id, actor_type, remarks, old_value, new_value)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      randomUUID(),
      input.batchId ?? null,
      input.batchItemId ?? null,
      input.employeeId ?? null,
      input.actionType,
      input.actorUserId ?? null,
      input.actorType ?? "system",
      input.remarks ?? null,
      input.oldValue ? JSON.stringify(input.oldValue) : null,
      input.newValue ? JSON.stringify(input.newValue) : null,
    ],
  );
}

export const pfCreationService = {
  async generateBatchFromJoiners(
    filters: { branchId?: string | null; establishmentId?: string | null },
    actorUserId: string,
  ) {
    const whereClauses = [
      "p.status = 'payroll_approved'",
      "p.consent_status = 'confirmed'",
      "e.active_status = 1",
    ];
    const params: unknown[] = [];

    if (filters.branchId) {
      whereClauses.push("p.branch_id = ?");
      params.push(filters.branchId);
    }
    if (filters.establishmentId) {
      whereClauses.push("p.pf_establishment_id = ?");
      params.push(filters.establishmentId);
    }

    const [candidates] = await db.execute<RowDataPacket[]>(
      `SELECT p.id AS profile_id, p.employee_id, p.uan_masked, p.branch_id
         FROM employee_epf_compliance_profile p
         JOIN employees e ON e.id = p.employee_id
        WHERE ${whereClauses.join(" AND ")}
          AND p.pf_applicable = 1
          AND NOT EXISTS (
            SELECT 1 FROM pf_creation_batch_item bi
              JOIN pf_creation_batch b ON b.id = bi.batch_id
             WHERE bi.employee_id = p.employee_id
               AND bi.item_status NOT IN ('rejected_by_epfo','correction_required','closed')
          )
        ORDER BY e.date_of_joining ASC`,
      params,
    );

    if (candidates.length === 0) {
      return { batch: null, message: "No eligible employees found for PF batch creation." };
    }

    const batchId = randomUUID();
    const batchNumber = `PF-${Date.now()}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`;

    await db.execute(
      `INSERT INTO pf_creation_batch
         (id, batch_number, establishment_id, branch_id, status, total_items, created_by)
       VALUES (?, ?, ?, ?, 'draft', ?, ?)`,
      [
        batchId,
        batchNumber,
        filters.establishmentId ?? null,
        filters.branchId ?? null,
        candidates.length,
        actorUserId,
      ],
    );

    for (const candidate of candidates) {
      await db.execute(
        `INSERT INTO pf_creation_batch_item
           (id, batch_id, employee_id, epf_profile_id, item_status)
         VALUES (?, ?, ?, ?, 'draft')`,
        [randomUUID(), batchId, candidate.employee_id, candidate.profile_id],
      );
    }

    await logPfAudit({
      batchId,
      actionType: "BATCH_CREATED",
      actorUserId,
      actorType: "payroll",
      newValue: { total_items: candidates.length, branch_id: filters.branchId },
    });

    const [batchRows] = await db.execute<RowDataPacket[]>(
      "SELECT * FROM pf_creation_batch WHERE id = ?",
      [batchId],
    );
    return { batch: batchRows[0], message: `Batch created with ${candidates.length} employees.` };
  },

  async validateBatch(batchId: string, actorUserId: string) {
    const [items] = await db.execute<RowDataPacket[]>(
      `SELECT bi.id AS item_id, bi.employee_id, bi.epf_profile_id
         FROM pf_creation_batch_item bi
        WHERE bi.batch_id = ?
          AND bi.item_status IN ('draft','validation_failed','correction_required')`,
      [batchId],
    );

    await db.execute(
      "UPDATE pf_creation_batch SET status = 'validating', updated_at = NOW() WHERE id = ?",
      [batchId],
    );

    let validCount = 0;
    let errorCount = 0;

    for (const item of items) {
      const [profileRows] = await db.execute<RowDataPacket[]>(
        "SELECT * FROM employee_epf_compliance_profile WHERE id = ? LIMIT 1",
        [item.epf_profile_id],
      );
      const profile = profileRows[0];
      if (!profile) {
        await db.execute(
          `UPDATE pf_creation_batch_item
              SET item_status = 'validation_failed',
                  validation_errors = ?,
                  error_count = 1,
                  updated_at = NOW()
            WHERE id = ?`,
          [JSON.stringify([{ code: "NO_EPF_PROFILE", message: "EPF compliance profile not found" }]), item.item_id],
        );
        errorCount++;
        continue;
      }

      const [nomineeRows] = await db.execute<RowDataPacket[]>(
        "SELECT * FROM employee_epf_nominee WHERE profile_id = ?",
        [profile.id],
      );

      const profileInput: EpfProfileInput = {
        employee_name: profile.employee_name,
        father_or_spouse_name: profile.father_or_spouse_name,
        relationship_type: profile.relationship_type,
        date_of_birth: profile.date_of_birth,
        gender: profile.gender,
        marital_status: profile.marital_status,
        mobile_number: profile.mobile_number,
        personal_email: profile.personal_email,
        aadhaar_number: profile.aadhaar_masked,
        pan_number: profile.pan_masked,
        uan_number: profile.uan_masked,
        previous_pf_member: Number(profile.previous_pf_member) === 1,
        previous_eps_member: Number(profile.previous_eps_member) === 1,
        international_worker: Number(profile.international_worker) === 1,
        excluded_employee: Number(profile.excluded_employee) === 1,
        joining_date: profile.joining_date,
        basic_wage: Number(profile.basic_wage ?? 0),
        gross_monthly_wage: Number(profile.gross_monthly_wage ?? 0),
      };

      const nominees: EpfNomineeInput[] = nomineeRows.map((n: any) => ({
        nominee_name: n.nominee_name,
        relationship: n.relationship,
        date_of_birth: n.date_of_birth,
        share_percentage: Number(n.share_percentage ?? 0),
        guardian_name: n.guardian_name,
        guardian_relationship: n.guardian_relationship,
        aadhaar_last4: n.aadhaar_last4,
        address_line: n.address_line,
        city: n.city,
        state: n.state,
        pincode: n.pincode,
        is_primary: Boolean(n.is_primary),
      }));

      const summary = await validateEpfCompliance(item.employee_id, profileInput, nominees);
      const errors = summary.issues.filter((i) => i.severity === "error");
      const warnings = summary.issues.filter((i) => i.severity === "warning");

      const [bankRows] = await db.execute<RowDataPacket[]>(
        "SELECT verified FROM employee_bank_detail WHERE employee_id = ? AND verified = 1 LIMIT 1",
        [item.employee_id],
      );
      if (bankRows.length === 0) {
        errors.push({
          code: "BANK_NOT_VERIFIED",
          severity: "error",
          status: "failed",
          message: "Bank account is not verified.",
          field_name: "bank_account",
        });
      }

      if (!profile.pf_establishment_id) {
        errors.push({
          code: "MISSING_ESTABLISHMENT",
          severity: "error",
          status: "failed",
          message: "PF establishment mapping is missing.",
          field_name: "pf_establishment_id",
        });
      }

      const newStatus = errors.length > 0 ? "validation_failed" : "ready_for_epfo";
      if (errors.length === 0) validCount++;
      else errorCount++;

      await db.execute(
        `UPDATE pf_creation_batch_item
            SET item_status = ?,
                validation_errors = ?,
                validation_warnings = ?,
                error_count = ?,
                updated_at = NOW()
          WHERE id = ?`,
        [
          newStatus,
          errors.length > 0 ? JSON.stringify(errors) : null,
          warnings.length > 0 ? JSON.stringify(warnings) : null,
          errors.length,
          item.item_id,
        ],
      );
    }

    await db.execute(
      `UPDATE pf_creation_batch
          SET status = 'validated',
              valid_items = ?,
              error_items = ?,
              updated_at = NOW()
        WHERE id = ?`,
      [validCount, errorCount, batchId],
    );

    await logPfAudit({
      batchId,
      actionType: "BATCH_VALIDATED",
      actorUserId,
      actorType: "payroll",
      newValue: { valid_items: validCount, error_items: errorCount },
    });

    return { valid_items: validCount, error_items: errorCount, total: items.length };
  },

  async exportBatch(batchId: string, templateId: string | null, actorUserId: string) {
    let tplId = templateId;
    if (!tplId) {
      const [tplRows] = await db.execute<RowDataPacket[]>(
        "SELECT id FROM pf_export_template WHERE active_status = 1 ORDER BY created_at ASC LIMIT 1",
      );
      if (tplRows.length === 0) throw Object.assign(new Error("No export template configured"), { statusCode: 400 });
      tplId = tplRows[0].id;
    }

    const [tplRows] = await db.execute<RowDataPacket[]>(
      "SELECT * FROM pf_export_template WHERE id = ? AND active_status = 1 LIMIT 1",
      [tplId],
    );
    const template = tplRows[0];
    if (!template) throw Object.assign(new Error("Export template not found"), { statusCode: 404 });

    const columns = typeof template.columns === "string" ? JSON.parse(template.columns) : template.columns;

    const [itemRows] = await db.execute<RowDataPacket[]>(
      `SELECT bi.*, p.*, e.employee_code, e.date_of_joining, e.mobile,
              b.branch_name, pm.process_name
         FROM pf_creation_batch_item bi
         JOIN employee_epf_compliance_profile p ON p.id = bi.epf_profile_id
         JOIN employees e ON e.id = bi.employee_id
         LEFT JOIN branch_master b ON b.id = p.branch_id
         LEFT JOIN process_master pm ON pm.id = p.process_id
        WHERE bi.batch_id = ?
          AND bi.item_status = 'ready_for_epfo'
        ORDER BY e.employee_code`,
      [batchId],
    );

    if (itemRows.length === 0) {
      throw Object.assign(new Error("No items ready for export in this batch"), { statusCode: 400 });
    }

    const exportRows = itemRows.map((row: any) => {
      const record: Record<string, unknown> = {};
      for (const col of columns) {
        let value = row[col.source_field] ?? null;
        if (col.transform === "DD/MM/YYYY" && value) {
          const d = new Date(value);
          value = `${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")}/${d.getFullYear()}`;
        } else if (col.transform === "yn_flag") {
          value = Number(value) === 1 ? "Y" : "N";
        } else if (col.transform === "gender_short") {
          const g = String(value ?? "").toLowerCase();
          value = g.startsWith("m") ? "M" : g.startsWith("f") ? "F" : "T";
        }
        record[col.key] = value;
      }
      return record;
    });

    for (const item of itemRows) {
      await db.execute(
        `UPDATE pf_creation_batch_item
            SET item_status = 'exported',
                uan_at_export = ?,
                updated_at = NOW()
          WHERE id = ?`,
        [item.uan_masked ?? null, item.id],
      );
    }

    await db.execute(
      `UPDATE pf_creation_batch
          SET status = 'exported',
              exported_at = NOW(),
              export_template_id = ?,
              updated_at = NOW()
        WHERE id = ?`,
      [tplId, batchId],
    );

    await logPfAudit({
      batchId,
      actionType: "BATCH_EXPORTED",
      actorUserId,
      actorType: "payroll",
      newValue: { template_id: tplId, exported_count: itemRows.length },
    });

    return {
      columns: columns.map((c: any) => ({ key: c.key, label: c.label })),
      rows: exportRows,
      file_format: template.file_format,
      exported_count: itemRows.length,
    };
  },

  async importAcknowledgement(
    batchId: string,
    records: Array<{ employee_code: string; uan_assigned?: string; member_id?: string; status: string; error_message?: string }>,
    actorUserId: string,
  ) {
    let successCount = 0;
    let failCount = 0;

    for (const record of records) {
      const [empRows] = await db.execute<RowDataPacket[]>(
        "SELECT id FROM employees WHERE employee_code = ? LIMIT 1",
        [record.employee_code],
      );
      if (empRows.length === 0) {
        failCount++;
        continue;
      }
      const employeeId = empRows[0].id;

      const [itemRows] = await db.execute<RowDataPacket[]>(
        "SELECT id FROM pf_creation_batch_item WHERE batch_id = ? AND employee_id = ? LIMIT 1",
        [batchId, employeeId],
      );
      if (itemRows.length === 0) {
        failCount++;
        continue;
      }
      const itemId = itemRows[0].id;

      const isSuccess = record.status === "success" || record.status === "created";
      const newStatus = isSuccess ? "pf_created" : "rejected_by_epfo";

      await db.execute(
        `UPDATE pf_creation_batch_item
            SET item_status = ?,
                epfo_response_code = ?,
                epfo_response_message = ?,
                epfo_uan_assigned = ?,
                epfo_member_id_assigned = ?,
                updated_at = NOW()
          WHERE id = ?`,
        [
          newStatus,
          record.status,
          record.error_message ?? null,
          record.uan_assigned ?? null,
          record.member_id ?? null,
          itemId,
        ],
      );

      if (isSuccess && record.uan_assigned) {
        const [existingUan] = await db.execute<RowDataPacket[]>(
          "SELECT uan FROM employee_uan WHERE employee_id = ? LIMIT 1",
          [employeeId],
        );
        if (existingUan.length === 0) {
          await db.execute(
            `INSERT INTO employee_uan (id, employee_id, uan, epf_join_date, is_active)
             SELECT UUID(), ?, ?, e.date_of_joining, 1
               FROM employees e WHERE e.id = ?`,
            [employeeId, record.uan_assigned, employeeId],
          );
        }

        await db.execute(
          `UPDATE employee_epf_compliance_profile
              SET uan_masked = ?,
                  universal_account_status = 'active',
                  updated_at = NOW()
            WHERE employee_id = ?`,
          [record.uan_assigned.replace(/^.{8}/, "XXXXXXXX"), employeeId],
        );

        await db.execute(
          `UPDATE employee_epf_ecr_readiness
              SET ecr_status = 'ready',
                  blocked_reason = NULL,
                  ready_at = NOW(),
                  last_checked_at = NOW(),
                  checked_by = ?
            WHERE employee_id = ?`,
          [actorUserId, employeeId],
        );
        successCount++;
      } else if (isSuccess) {
        successCount++;
      } else {
        failCount++;
      }

      await logPfAudit({
        batchId,
        batchItemId: itemId,
        employeeId,
        actionType: isSuccess ? "EPFO_UAN_CREATED" : "EPFO_REJECTED",
        actorUserId,
        actorType: "payroll",
        newValue: { uan: record.uan_assigned, member_id: record.member_id, epfo_status: record.status },
      });
    }

    const finalStatus = failCount === 0 ? "completed" : successCount === 0 ? "failed" : "partial_success";
    await db.execute(
      `UPDATE pf_creation_batch
          SET status = ?,
              uploaded_at = NOW(),
              updated_at = NOW()
        WHERE id = ?`,
      [finalStatus, batchId],
    );

    return { success_count: successCount, fail_count: failCount, batch_status: finalStatus };
  },

  async getQueue(filters: QueueFilter) {
    const whereClauses: string[] = [];
    const params: unknown[] = [];

    if (filters.batchId) {
      whereClauses.push("bi.batch_id = ?");
      params.push(filters.batchId);
    }
    if (filters.itemStatus) {
      whereClauses.push("bi.item_status = ?");
      params.push(filters.itemStatus);
    }
    if (filters.branchId) {
      whereClauses.push("p.branch_id = ?");
      params.push(filters.branchId);
    }
    if (filters.search) {
      whereClauses.push("(e.employee_code LIKE ? OR e.full_name LIKE ?)");
      params.push(`%${filters.search}%`, `%${filters.search}%`);
    }

    const where = whereClauses.length > 0 ? `WHERE ${whereClauses.join(" AND ")}` : "";
    const limit = filters.limit ?? 100;
    const offset = filters.offset ?? 0;

    const [rows] = await db.execute<RowDataPacket[]>(
      `SELECT bi.id, bi.batch_id, bi.employee_id, bi.item_status, bi.error_count,
              bi.validation_errors, bi.validation_warnings,
              bi.epfo_uan_assigned, bi.epfo_member_id_assigned,
              e.employee_code, e.full_name, e.date_of_joining,
              p.uan_masked, p.aadhaar_masked, p.pan_masked,
              p.basic_wage, p.pf_wage, p.pf_applicable,
              p.previous_pf_member, p.previous_eps_member,
              p.bank_verification_status, p.pan_verification_status,
              p.uan_verification_status,
              b.branch_name, pm.process_name,
              pcb.batch_number
         FROM pf_creation_batch_item bi
         JOIN employees e ON e.id = bi.employee_id
         LEFT JOIN employee_epf_compliance_profile p ON p.id = bi.epf_profile_id
         LEFT JOIN branch_master b ON b.id = p.branch_id
         LEFT JOIN process_master pm ON pm.id = p.process_id
         LEFT JOIN pf_creation_batch pcb ON pcb.id = bi.batch_id
        ${where}
        ORDER BY bi.updated_at DESC
        LIMIT ? OFFSET ?`,
      [...params, limit, offset],
    );

    const [countRows] = await db.execute<RowDataPacket[]>(
      `SELECT COUNT(*) AS total
         FROM pf_creation_batch_item bi
         JOIN employees e ON e.id = bi.employee_id
         LEFT JOIN employee_epf_compliance_profile p ON p.id = bi.epf_profile_id
        ${where}`,
      params,
    );

    return { items: rows, total: (countRows[0] as any)?.total ?? 0 };
  },

  async getBatches(filters: BatchFilter) {
    const whereClauses: string[] = [];
    const params: unknown[] = [];

    if (filters.status) {
      whereClauses.push("b.status = ?");
      params.push(filters.status);
    }
    if (filters.branchId) {
      whereClauses.push("b.branch_id = ?");
      params.push(filters.branchId);
    }
    if (filters.establishmentId) {
      whereClauses.push("b.establishment_id = ?");
      params.push(filters.establishmentId);
    }

    const where = whereClauses.length > 0 ? `WHERE ${whereClauses.join(" AND ")}` : "";

    const [rows] = await db.execute<RowDataPacket[]>(
      `SELECT b.*, br.branch_name, est.establishment_name,
              u.full_name AS created_by_name
         FROM pf_creation_batch b
         LEFT JOIN branch_master br ON br.id = b.branch_id
         LEFT JOIN pf_establishment_master est ON est.id = b.establishment_id
         LEFT JOIN employees u ON u.user_id = b.created_by
        ${where}
        ORDER BY b.created_at DESC
        LIMIT 50`,
      params,
    );
    return rows;
  },

  async getBatchDetail(batchId: string) {
    const [batchRows] = await db.execute<RowDataPacket[]>(
      "SELECT * FROM pf_creation_batch WHERE id = ? LIMIT 1",
      [batchId],
    );
    if (batchRows.length === 0) return null;

    const [items] = await db.execute<RowDataPacket[]>(
      `SELECT bi.*, e.employee_code, e.full_name, e.date_of_joining,
              p.uan_masked, p.aadhaar_masked, p.pan_masked, p.basic_wage
         FROM pf_creation_batch_item bi
         JOIN employees e ON e.id = bi.employee_id
         LEFT JOIN employee_epf_compliance_profile p ON p.id = bi.epf_profile_id
        WHERE bi.batch_id = ?
        ORDER BY e.employee_code`,
      [batchId],
    );

    return { batch: batchRows[0], items };
  },

  async getEmployeePfStatus(employeeId: string) {
    const [items] = await db.execute<RowDataPacket[]>(
      `SELECT bi.item_status, bi.error_count, bi.validation_errors,
              bi.epfo_uan_assigned, bi.epfo_member_id_assigned,
              bi.epfo_response_message,
              pcb.batch_number, pcb.status AS batch_status
         FROM pf_creation_batch_item bi
         JOIN pf_creation_batch pcb ON pcb.id = bi.batch_id
        WHERE bi.employee_id = ?
        ORDER BY bi.created_at DESC
        LIMIT 5`,
      [employeeId],
    );
    return items;
  },

  async getReadinessReport(branchId?: string | null) {
    const where = branchId ? "WHERE p.branch_id = ?" : "";
    const params = branchId ? [branchId] : [];

    const [rows] = await db.execute<RowDataPacket[]>(
      `SELECT
          b.branch_name,
          pm.process_name,
          COUNT(*) AS total_employees,
          SUM(CASE WHEN ecr.ecr_status = 'ready' THEN 1 ELSE 0 END) AS pf_ready,
          SUM(CASE WHEN ecr.ecr_status = 'pending' OR ecr.ecr_status IS NULL THEN 1 ELSE 0 END) AS pf_pending,
          SUM(CASE WHEN p.pf_applicable = 0 THEN 1 ELSE 0 END) AS pf_not_applicable,
          SUM(CASE WHEN bi.item_status = 'validation_failed' THEN 1 ELSE 0 END) AS pf_error
         FROM employee_epf_compliance_profile p
         JOIN employees e ON e.id = p.employee_id AND e.active_status = 1
         LEFT JOIN branch_master b ON b.id = p.branch_id
         LEFT JOIN process_master pm ON pm.id = p.process_id
         LEFT JOIN employee_epf_ecr_readiness ecr ON ecr.employee_id = p.employee_id
         LEFT JOIN pf_creation_batch_item bi ON bi.employee_id = p.employee_id
           AND bi.id = (SELECT bi2.id FROM pf_creation_batch_item bi2 WHERE bi2.employee_id = p.employee_id ORDER BY bi2.created_at DESC LIMIT 1)
        ${where}
        GROUP BY b.branch_name, pm.process_name
        ORDER BY b.branch_name, pm.process_name`,
      params,
    );
    return rows;
  },

  async getEstablishments() {
    const [rows] = await db.execute<RowDataPacket[]>(
      "SELECT * FROM pf_establishment_master WHERE active_status = 1 ORDER BY establishment_name",
    );
    return rows;
  },

  async getExportTemplates() {
    const [rows] = await db.execute<RowDataPacket[]>(
      "SELECT id, template_name, template_code, version, file_format FROM pf_export_template WHERE active_status = 1 ORDER BY template_name",
    );
    return rows;
  },
};
