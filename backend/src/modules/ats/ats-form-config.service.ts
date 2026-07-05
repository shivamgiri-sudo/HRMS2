import { db } from '../../db/mysql.js';
import type { RowDataPacket, ResultSetHeader } from 'mysql2';

const DEFAULT_FIELDS = [
  { k:'name',       lb:'Full Name',       t:'text',     ic:'👤', ph:'Enter your full name',    ok:null,                      section:'Basic Details', visible:true, required:true,  sort_order:1  },
  { k:'mobile',     lb:'Mobile Number',   t:'tel',      ic:'📞', ph:'10-digit mobile number',  ok:null,                      section:'Basic Details', visible:true, required:true,  sort_order:2  },
  { k:'email',      lb:'Email Address',   t:'email',    ic:'✉️', ph:'your.email@example.com',  ok:null,                      section:'Basic Details', visible:true, required:false, sort_order:3  },
  { k:'address',    lb:'Address',         t:'textarea', ic:'📍', ph:'Your residential address', ok:null,                     section:'Basic Details', visible:true, required:true,  sort_order:4  },
  { k:'education',  lb:'Education',       t:'select',   ic:'🎓', ph:null, ok:'educationOptions',  section:'Basic Details', visible:true, required:true,  sort_order:5  },
  { k:'experience', lb:'Experience',      t:'select',   ic:'💼', ph:null, ok:'experienceOptions', section:'Basic Details', visible:true, required:true,  sort_order:6  },
  { k:'gender',     lb:'Gender',          t:'select',   ic:'🧑', ph:null, ok:'genderOptions',     section:'Basic Details', visible:true, required:true,  sort_order:7  },
  { k:'roleApplied',      lb:'Role Applied',             t:'select', ic:'🗂️', ph:null, ok:'roleOptions',           section:'Job Details', visible:true, required:true,  sort_order:8  },
  { k:'recruiterName',    lb:'Recruiter Name',           t:'select', ic:'🤝', ph:null, ok:'recruiterOptions',      section:'Job Details', visible:true, required:true,  sort_order:9  },
  { k:'branch',           lb:'Branch',                   t:'select', ic:'🏢', ph:null, ok:'branchOptions',         section:'Job Details', visible:true, required:true,  sort_order:10 },
  { k:'rotationalShift',  lb:'Rotational Shift',         t:'select', ic:'🔄', ph:null, ok:'yesNoOptions',          section:'Job Details', visible:true, required:true,  sort_order:11 },
  { k:'preferredShift',   lb:'Preferred Shift',          t:'select', ic:'🕐', ph:null, ok:'preferredShiftOptions', section:'Job Details', visible:true, required:true,  sort_order:12 },
  { k:'nightShiftComfort', lb:'Night Shift Comfort',     t:'select', ic:'🌙', ph:null, ok:'nightShiftComfortOptions', section:'Job Details', visible:true, required:true, sort_order:13 },
  { k:'leavesRequired',   lb:'Leaves Required in 3 Months', t:'select', ic:'📅', ph:null, ok:'yesNoOptions', section:'Job Details', visible:true, required:true, sort_order:14 },
  { k:'ownTwoWheeler',         lb:'Own 2 Wheeler',               t:'select', ic:'🛵', ph:null, ok:'yesNoOptions', section:'Verification', visible:true, required:true,  sort_order:15 },
  { k:'idProofAvailable',      lb:'ID Proof Available',          t:'select', ic:'🪪', ph:null, ok:'yesNoOptions', section:'Verification', visible:true, required:true,  sort_order:16 },
  { k:'educationProofAvailable', lb:'Education Proof Available', t:'select', ic:'📄', ph:null, ok:'yesNoOptions', section:'Verification', visible:true, required:true,  sort_order:17 },
  { k:'resumeFile', lb:'Upload Resume',            t:'file',   ic:'📎', ph:null, ok:null, section:'Verification', visible:true, required:false, sort_order:18 },
  { k:'selfieFile', lb:'Capture Selfie (Optional)', t:'camera', ic:'📷', ph:null, ok:null, section:'Verification', visible:true, required:false, sort_order:19 },
];

const DEFAULT_OPTIONS: Record<string, string[]> = {
  roleOptions:            ['Inbound Agent','Outbound Agent','Back Office','Team Leader','Quality Analyst'],
  educationOptions:       ['10th Pass','12th Pass','Graduate','Post Graduate','Diploma'],
  experienceOptions:      ['Fresher','0-1 Year','1-2 Years','2-3 Years','3+ Years'],
  preferredShiftOptions:  ['Morning (6AM-2PM)','Afternoon (2PM-10PM)','Night (10PM-6AM)','Rotational'],
  nightShiftComfortOptions: ['Comfortable','Not Comfortable','On Request'],
  genderOptions:          ['Male','Female','Other'],
};

interface ConfigRow extends RowDataPacket {
  config_key: string;
  config_value: unknown;
}

interface BranchRow extends RowDataPacket {
  id?: string;
  branch_name: string;
  branch_code?: string | null;
}

interface BranchAliasRow extends RowDataPacket {
  canonical_key: string;
  display_name?: string | null;
  alias_text?: string | null;
}

interface RecruiterRow extends RowDataPacket {
  name: string;
  employee_code?: string | null;
  email?: string | null;
  mobile?: string | null;
  employee_id?: string | null;
}

interface FieldSchemaItem {
  k?: string;
  t?: string;
  visible?: boolean;
  required?: boolean;
  [key: string]: unknown;
}

export const atsFormConfigService = {
  async getBootstrap() {
    const [rows] = await db.execute<ConfigRow[]>(
      'SELECT config_key, config_value FROM ats_form_config WHERE 1=1'
    );
    const configMap: Record<string, unknown> = {};
    for (const row of rows) {
      configMap[row.config_key as string] = row.config_value;
    }

    const [branchRows] = await db.execute<BranchRow[]>(
      'SELECT DISTINCT branch_name FROM branch_master WHERE active_status = 1 ORDER BY branch_name ASC'
    );
    const branchOptions = branchRows.map((r) => r.branch_name);

    // Get branch aliases (display names like Trapezoid, Okaya, etc.)
    const [aliasRows] = await db.execute<BranchAliasRow[]>(
      `SELECT canonical_key, MAX(display_name) AS display_name, MIN(alias_text) AS alias_text
       FROM ats_branch_alias_master
       WHERE active_status = 1
       GROUP BY canonical_key
       ORDER BY display_name ASC`
    );
    const branchAliases = aliasRows.map((r) => ({
      canonical: r.canonical_key,
      display: r.display_name,
      alias: r.alias_text
    }));

    const [recruiterRows] = await db.execute<RecruiterRow[]>(
      'SELECT name FROM ats_recruiter WHERE active_status = 1 ORDER BY sort_order ASC, name ASC'
    );
    let recruiterOptions = recruiterRows.map((r) => r.name);

    // Try to fetch contact details from ats_recruiter_roster (if available)
    let rosterRows: RecruiterRow[] = [];
    try {
      [rosterRows] = await db.execute<RecruiterRow[]>(
        'SELECT name, email, mobile FROM ats_recruiter_roster WHERE active_status = 1'
      );
    } catch {
      rosterRows = [];
    }
    const recruiterDetails = recruiterOptions.map(name => {
      const roster = rosterRows.find((r) => r.name === name);
      return {
        name,
        email: roster?.email || null,
        mobile: roster?.mobile || null,
      };
    });
    if (recruiterOptions.length === 0) {
      // Primary: employees with hr/recruiter/branch_head roles via user_roles table
      const [roleRecruiters] = await db.execute<RowDataPacket[]>(
        `SELECT DISTINCT
           e.id AS employee_id,
           TRIM(CONCAT(e.first_name, ' ', COALESCE(e.last_name, ''))) AS name,
           COALESCE(e.office_email, e.official_email, e.email) AS email,
           e.mobile
         FROM user_roles ur
         JOIN auth_user au ON au.id = ur.user_id
         JOIN employees e  ON e.user_id = au.id
         WHERE ur.active_status = 1
           AND ur.role_key IN ('hr', 'recruitment_hr', 'recruiter', 'branch_head')
           AND e.active_status = 1
         ORDER BY name`
      );
      const roleRows = roleRecruiters as RecruiterRow[];
      if (roleRows.length > 0) {
        recruiterOptions = roleRows.map((r) => String(r.name));
        recruiterDetails.length = 0;
        for (const r of roleRows) {
          recruiterDetails.push({ name: String(r.name), email: r.email || null, mobile: r.mobile || null });
        }
      } else {
        // Fallback: designation-name match
        const [employeeRecruiters] = await db.execute<RowDataPacket[]>(
          `SELECT DISTINCT
             TRIM(CONCAT(e.first_name, ' ', COALESCE(e.last_name, ''))) AS name,
             COALESCE(e.office_email, e.official_email, e.email) AS email,
             e.mobile
           FROM employees e
           LEFT JOIN department_master d  ON d.id  = e.department_id
           LEFT JOIN designation_master des ON des.id = e.designation_id
           WHERE e.active_status = 1
             AND (
               LOWER(COALESCE(des.designation_name,'')) LIKE '%recruiter%'
               OR LOWER(COALESCE(des.designation_name,'')) LIKE '%hr%'
             )
           ORDER BY name`
        );
        const empRows = employeeRecruiters as RecruiterRow[];
        recruiterOptions = empRows.map((r) => String(r.name));
        recruiterDetails.length = 0;
        for (const r of empRows) {
          recruiterDetails.push({ name: String(r.name), email: r.email || null, mobile: r.mobile || null });
        }
      }
    }

    return {
      fields:                   configMap['formFields']             ?? DEFAULT_FIELDS,
      recruiterOptions,
      recruiterDetails,         // NEW: Full recruiter contact details
      branchOptions:            branchOptions.length > 0 ? branchOptions : ['Mumbai','Delhi','Bangalore'],
      branchAliases,            // NEW: Branch display names
      roleOptions:              configMap['roleOptions']             ?? DEFAULT_OPTIONS.roleOptions,
      educationOptions:         configMap['educationOptions']        ?? DEFAULT_OPTIONS.educationOptions,
      experienceOptions:        configMap['experienceOptions']       ?? DEFAULT_OPTIONS.experienceOptions,
      preferredShiftOptions:    configMap['preferredShiftOptions']   ?? DEFAULT_OPTIONS.preferredShiftOptions,
      nightShiftComfortOptions: configMap['nightShiftComfortOptions'] ?? DEFAULT_OPTIONS.nightShiftComfortOptions,
      genderOptions:            configMap['genderOptions']           ?? DEFAULT_OPTIONS.genderOptions,
      yesNoOptions:             ['Yes','No'],
      companyName:              'Mas Callnet India Pvt Ltd',
    };
  },

  async getAllConfigs() {
    const [rows] = await db.execute<RowDataPacket[]>(
      'SELECT id, config_key, config_label, config_type, config_value, sort_order, updated_at FROM ats_form_config ORDER BY sort_order ASC'
    );
    return rows as RowDataPacket[];
  },

  async updateOptionList(configKey: string, values: string[], updatedBy: string) {
    if (configKey === 'formFields') throw new Error('Use the fields endpoint to update field schema');
    await db.execute(
      `INSERT INTO ats_form_config (id, config_key, config_label, config_type, config_value, updated_by)
       VALUES (UUID(), ?, ?, 'option_list', ?, ?)
       ON DUPLICATE KEY UPDATE config_value = VALUES(config_value), updated_by = VALUES(updated_by), updated_at = NOW()`,
      [configKey, configKey, JSON.stringify(values), updatedBy]
    );
  },

  async updateFieldSchema(fields: FieldSchemaItem[], updatedBy: string) {
    const safe = fields.map((f) => {
      if (f.k === 'name' || f.k === 'mobile') return { ...f, visible: true };
      if (f.t === 'file' || f.t === 'camera') return { ...f, required: false };
      return f;
    });
    await db.execute(
      `INSERT INTO ats_form_config (id, config_key, config_label, config_type, config_value, updated_by)
       VALUES (UUID(), 'formFields', 'Form Field Schema', 'field_schema', ?, ?)
       ON DUPLICATE KEY UPDATE config_value = VALUES(config_value), updated_by = VALUES(updated_by), updated_at = NOW()`,
      [JSON.stringify(safe), updatedBy]
    );
  },

  async getRecruitersByBranch(branchDisplayName: string) {
    // Resolve the canonical branch key from the display name
    const [aliasRows] = await db.execute<BranchAliasRow[]>(
      `SELECT canonical_key, display_name, alias_text
       FROM ats_branch_alias_master
       WHERE active_status = 1
         AND (display_name = ? OR alias_text = ? OR canonical_key = ?)
       LIMIT 1`,
      [branchDisplayName, branchDisplayName, branchDisplayName]
    );
    const alias = aliasRows[0] ?? null;
    const canonicalKey: string = alias?.canonical_key ?? branchDisplayName;
    const branchLookupValues = [
      canonicalKey,
      branchDisplayName,
      alias?.display_name ?? "",
      alias?.alias_text ?? "",
    ].filter((value, index, all) => value && all.indexOf(value) === index);

    // Look up the branch_name in branch_master matching this canonical key
    const branchPlaceholders = branchLookupValues.map(() => "?").join(",");
    const [branchRows] = await db.execute<BranchRow[]>(
      `SELECT id, branch_name, branch_code
       FROM branch_master
       WHERE active_status = 1
         AND (branch_name IN (${branchPlaceholders}) OR branch_code IN (${branchPlaceholders}))
       LIMIT 1`,
      [...branchLookupValues, ...branchLookupValues]
    );
    const branchRow = branchRows[0] ?? null;
    const branchName: string = branchRow?.branch_name ?? canonicalKey;

    // 1. Prefer active employees at the resolved branch so inactive roster rows do not leak through.
    if (branchRow?.id) {
      const [empRows] = await db.execute<RecruiterRow[]>(
        `SELECT DISTINCT
           e.id AS employee_id,
           e.employee_code,
           TRIM(CONCAT(e.first_name, ' ', COALESCE(e.last_name, ''))) AS name,
           COALESCE(e.office_email, e.official_email, e.email) AS email,
           e.mobile
         FROM employees e
         LEFT JOIN department_master d ON d.id = e.department_id
         LEFT JOIN designation_master des ON des.id = e.designation_id
         LEFT JOIN user_roles ur ON ur.user_id = e.user_id AND ur.active_status = 1
         WHERE e.active_status = 1
           AND e.branch_id = ?
           AND (
             (
               (LOWER(COALESCE(d.dept_name,'')) LIKE '%human resource%' OR LOWER(COALESCE(d.dept_name,'')) LIKE '%admin/hr%')
               AND (
                 LOWER(COALESCE(des.designation_name,'')) LIKE '%executive%'
                 OR LOWER(COALESCE(des.designation_name,'')) LIKE '%recruiter%'
                 OR LOWER(COALESCE(des.designation_name,'')) LIKE '%hr manager%'
               )
             )
             OR
             LOWER(COALESCE(des.designation_name,'')) LIKE '%recruiter%'
             OR LOWER(COALESCE(des.designation_name,'')) LIKE '%hr%'
             OR ur.role_key IN ('hr', 'recruitment_hr', 'recruiter', 'branch_head', 'admin', 'super_admin')
           )
         ORDER BY name ASC`,
        [branchRow.id]
      );
      if (empRows.length > 0) {
        return empRows.map((r) => ({
          name: String(r.name),
          employee_code: r.employee_code || null,
          email: r.email || null,
          mobile: r.mobile || null,
          employee_id: r.employee_id || null,
        }));
      }
    }

    // 2. Fallback: employees with hr/recruiter/branch_head roles at this branch (via user_roles).
    // Keep the dropdown employee-driven so inactive roster rows never appear in registration.
    const [roleRows] = await db.execute<RecruiterRow[]>(
      `SELECT DISTINCT
         e.id AS employee_id,
         e.employee_code,
         TRIM(CONCAT(e.first_name, ' ', COALESCE(e.last_name, ''))) AS name,
         COALESCE(e.office_email, e.official_email, e.email) AS email,
         e.mobile
       FROM user_roles ur
       JOIN auth_user au ON au.id = ur.user_id
       JOIN employees e  ON e.user_id = au.id
       WHERE ur.active_status = 1
         AND ur.role_key IN ('hr', 'recruitment_hr', 'recruiter', 'branch_head', 'admin', 'super_admin')
         AND e.active_status = 1
         AND e.branch_id = ?
       ORDER BY name ASC`,
      [branchRow?.id ?? ""]
    );
    if (roleRows.length > 0) {
      return roleRows.map((r) => ({
        name: String(r.name),
        employee_code: r.employee_code || null,
        email: r.email || null,
        mobile: r.mobile || null,
        employee_id: r.employee_id || null,
      }));
    }

    // 3. Roster fallback: branch aliases in legacy roster rows may not match branch_master exactly.
    const rosterLookupValues = [
      ...branchLookupValues,
      branchRow?.branch_name ?? "",
      branchRow?.branch_code ?? "",
      branchName,
    ].filter((value, index, all) => value && all.indexOf(value) === index);
    const rosterPlaceholders = rosterLookupValues.map(() => "?").join(",");
    if (rosterLookupValues.length > 0) {
      const [rosterRows] = await db.execute<RecruiterRow[]>(
        `SELECT DISTINCT
           e.id AS employee_id,
           e.employee_code,
           TRIM(COALESCE(r.name, CONCAT(e.first_name, ' ', COALESCE(e.last_name, '')))) AS name,
           COALESCE(r.email, e.office_email, e.official_email, e.email) AS email,
           COALESCE(r.mobile, e.mobile) AS mobile
         FROM ats_recruiter_roster r
         JOIN employees e ON e.id = r.employee_id AND e.active_status = 1
         WHERE r.active_status = 1
           AND r.branch IN (${rosterPlaceholders})
         ORDER BY name ASC`,
        rosterLookupValues
      );
      if (rosterRows.length > 0) {
        return rosterRows.map((r) => ({
          name: String(r.name),
          employee_code: r.employee_code || null,
          email: r.email || null,
          mobile: r.mobile || null,
          employee_id: r.employee_id || null,
        }));
      }
    }

    // 4. Last resort: employees with HR/Recruiter designation names at this branch.
    const [empRows] = await db.execute<RecruiterRow[]>(
      `SELECT DISTINCT
         e.id AS employee_id,
         e.employee_code,
         TRIM(CONCAT(e.first_name, ' ', COALESCE(e.last_name, ''))) AS name,
         COALESCE(e.office_email, e.official_email, e.email) AS email,
         e.mobile
       FROM employees e
       LEFT JOIN department_master d ON d.id = e.department_id
       LEFT JOIN designation_master des ON des.id = e.designation_id
       WHERE e.active_status = 1
         AND e.branch_id = ?
         AND (
           (
             (LOWER(COALESCE(d.dept_name,'')) LIKE '%human resource%' OR LOWER(COALESCE(d.dept_name,'')) LIKE '%admin/hr%')
             AND (
               LOWER(COALESCE(des.designation_name,'')) LIKE '%executive%'
               OR LOWER(COALESCE(des.designation_name,'')) LIKE '%recruiter%'
               OR LOWER(COALESCE(des.designation_name,'')) LIKE '%hr manager%'
             )
           )
           OR LOWER(COALESCE(des.designation_name,'')) LIKE '%recruiter%'
           OR LOWER(COALESCE(des.designation_name,'')) LIKE '%hr%'
         )
       ORDER BY name ASC`,
      [branchRow?.id ?? ""]
    );
    return empRows.map((r) => ({
      name: String(r.name),
      employee_code: r.employee_code || null,
      email: r.email || null,
      mobile: r.mobile || null,
      employee_id: r.employee_id || null,
    }));
  },

  async listRecruiters() {
    const [rows] = await db.execute<RowDataPacket[]>(
      'SELECT id, name, active_status, sort_order, created_at FROM ats_recruiter ORDER BY sort_order ASC, name ASC'
    );
    return rows as RowDataPacket[];
  },

  async createRecruiter(name: string) {
    await db.execute<ResultSetHeader>(
      'INSERT INTO ats_recruiter (id, name) VALUES (UUID(), ?)',
      [name.trim()]
    );
    const [rows] = await db.execute<RowDataPacket[]>(
      'SELECT id, name, active_status, sort_order FROM ats_recruiter ORDER BY created_at DESC LIMIT 1'
    );
    return (rows as RowDataPacket[])[0];
  },

  async updateRecruiter(id: string, data: { name?: string; active_status?: number; sort_order?: number }) {
    const sets: string[] = [];
    const params: unknown[] = [];
    if (data.name          !== undefined) { sets.push('name = ?');          params.push(data.name.trim()); }
    if (data.active_status !== undefined) { sets.push('active_status = ?'); params.push(data.active_status); }
    if (data.sort_order    !== undefined) { sets.push('sort_order = ?');    params.push(data.sort_order); }
    if (sets.length === 0) return;
    params.push(id);
    await db.execute(`UPDATE ats_recruiter SET ${sets.join(', ')}, updated_at = NOW() WHERE id = ?`, params);
  },

  async deleteRecruiter(id: string) {
    await db.execute('UPDATE ats_recruiter SET active_status = 0, updated_at = NOW() WHERE id = ?', [id]);
  },

  async listBranchAliases() {
    const [rows] = await db.execute<RowDataPacket[]>(
      `SELECT id, canonical_key, display_name, alias_text, active_status, created_at, updated_at
       FROM ats_branch_alias_master
       ORDER BY display_name ASC`
    );
    return rows as RowDataPacket[];
  },

  async createBranchAlias(canonical: string, display: string, alias: string | null) {
    await db.execute<ResultSetHeader>(
      'INSERT INTO ats_branch_alias_master (id, canonical_key, display_name, alias_text) VALUES (UUID(), ?, ?, ?)',
      [canonical.trim(), display.trim(), alias?.trim() || null]
    );
    const [rows] = await db.execute<RowDataPacket[]>(
      'SELECT id, canonical_key, display_name, alias_text, active_status FROM ats_branch_alias_master ORDER BY created_at DESC LIMIT 1'
    );
    return (rows as RowDataPacket[])[0];
  },

  async updateBranchAlias(id: string, data: { canonical_key?: string; display_name?: string; alias_text?: string; active_status?: number }) {
    const sets: string[] = [];
    const params: unknown[] = [];
    if (data.canonical_key !== undefined) { sets.push('canonical_key = ?'); params.push(data.canonical_key.trim()); }
    if (data.display_name  !== undefined) { sets.push('display_name = ?');  params.push(data.display_name.trim()); }
    if (data.alias_text    !== undefined) { sets.push('alias_text = ?');    params.push(data.alias_text?.trim() || null); }
    if (data.active_status !== undefined) { sets.push('active_status = ?'); params.push(data.active_status); }
    if (sets.length === 0) return;
    params.push(id);
    await db.execute(`UPDATE ats_branch_alias_master SET ${sets.join(', ')}, updated_at = NOW() WHERE id = ?`, params);
  },

  async deleteBranchAlias(id: string) {
    await db.execute('DELETE FROM ats_branch_alias_master WHERE id = ?', [id]);
  },
};
