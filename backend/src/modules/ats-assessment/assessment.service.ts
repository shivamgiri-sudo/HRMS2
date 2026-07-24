import { createHash, createHmac, randomInt, randomUUID, timingSafeEqual } from "crypto";
import type { RowDataPacket } from "mysql2/promise";
import { db } from "../../db/mysql.js";
import {
  DEFAULT_ASSESSMENT_TEMPLATES,
  getDefaultTemplate,
  publicTemplate,
  type AssessmentProcess,
  type AssessmentQuestionDefinition,
  type AssessmentRole,
  type AssessmentTemplateDefinition,
} from "./assessment.catalog.js";
import { ensureAssessmentSchema } from "./assessment.schema.js";
import { calculateTypingScore } from "./typing-scoring.js";
import { questionBankService } from "./question-bank.service.js";
import { emailService } from "../communication/email.service.js";
import { assessmentInvitationEmail } from "../ats/email.templates.js";

type ActorType = "candidate" | "system" | "recruiter" | "hr" | "admin";
type Meta = {
  ip?: string | null;
  userAgent?: string | null;
  actorType?: ActorType;
  actorId?: string | null;
};
type Executor = { execute: (sql: string, values?: unknown[]) => Promise<any> };

type CandidateRow = RowDataPacket & {
  candidate_id: string;
  candidate_code: string | null;
  full_name: string | null;
  mobile: string | null;
  email: string | null;
  branch_name: string | null;
  process_name: string | null;
  role_name: string | null;
  experience: string | null;
  queue_token_id: string | null;
  token_number: string | null;
};

type TemplateRow = RowDataPacket & {
  id: string;
  template_code: string;
  template_name: string;
  process_key: AssessmentProcess;
  role_key: AssessmentRole;
  experience_level: "any" | "fresher" | "experienced";
  difficulty_level: "basic" | "intermediate" | "advanced";
  duration_minutes: number;
  passing_percentage: number;
  gate_mode: "advisory" | "soft_gate" | "hard_gate";
  template_version: number;
  content_hash: string;
  config_json: string | AssessmentTemplateDefinition;
  source_type: "built_in" | "custom";
  active_status: number;
  created_at?: Date | string;
  updated_at?: Date | string;
};

type MappingRow = RowDataPacket & {
  id: string;
  mapping_name: string;
  branch_name: string | null;
  process_match: string | null;
  role_match: string | null;
  experience_match: string | null;
  vacancy_id: string | null;
  template_id: string;
  priority: number;
  mandatory_flag: number;
  active_status: number;
  effective_from: Date | string | null;
  effective_to: Date | string | null;
  template_code?: string;
  template_name?: string;
  process_key?: AssessmentProcess;
  role_key?: AssessmentRole;
};

type AttemptStatus =
  | "assigned"
  | "in_progress"
  | "submitted_pending_scoring"
  | "manual_review"
  | "completed"
  | "technical_error"
  | "expired"
  | "cancelled"
  | "skipped";

type AttemptRow = RowDataPacket & {
  id: string;
  candidate_id: string;
  queue_token_id: string | null;
  cycle_key: string;
  q_token_snapshot: string | null;
  template_id: string;
  template_version: number;
  public_token_hash: string;
  status: AttemptStatus;
  attempt_no: number;
  typing_attempts_used: number;
  assignment_source: "automatic" | "mapping" | "manual" | "kiosk";
  assigned_by: string | null;
  assigned_at: Date | string;
  started_at: Date | string | null;
  submitted_at: Date | string | null;
  completed_at: Date | string | null;
  expires_at: Date | string | null;
  overall_score: number | null;
  max_score: number | null;
  percentage: number | null;
  result: "pass" | "fail" | "pending_review" | null;
  manual_review_required: number;
  reviewed_by: string | null;
  reviewed_at: Date | string | null;
  review_remarks: string | null;
  section_scores: unknown;
  recommendation_json: unknown;
  integrity_flags: unknown;
  client_meta: unknown;
  config_snapshot: unknown;
  failure_reason: string | null;
  created_at?: Date | string;
  updated_at?: Date | string;
  candidate_name?: string | null;
  candidate_code?: string | null;
  candidate_mobile?: string | null;
  branch_name?: string | null;
  template_name?: string | null;
  template_code?: string | null;
  process_key?: AssessmentProcess;
  role_key?: AssessmentRole;
  duration_minutes?: number;
  passing_percentage?: number;
};

type ResponseRow = RowDataPacket & {
  id: string;
  assessment_id: string;
  question_id: string;
  section_key: string;
  question_type: "single" | "multi" | "text";
  question_snapshot: unknown;
  answer_json: unknown;
  answer_text: string | null;
  marks_awarded: number | null;
  max_marks: number;
  evaluation_mode: "auto" | "keyword" | "manual";
  evaluation_notes: string | null;
  time_taken_seconds: number | null;
  reviewed_by: string | null;
  reviewed_at: Date | string | null;
  review_remarks: string | null;
};

type TypingRow = RowDataPacket & {
  id: string;
  assessment_id: string;
  attempt_no: number;
  reference_text: string;
  typed_text: string | null;
  duration_limit_seconds: number;
  elapsed_seconds: number | null;
  started_at: Date | string;
  submitted_at: Date | string | null;
  gross_wpm: number | null;
  net_wpm: number | null;
  accuracy_percentage: number | null;
  edit_distance: number | null;
  correct_characters: number | null;
  incorrect_characters: number | null;
  missing_characters: number | null;
  extra_characters: number | null;
  correct_words: number | null;
  incorrect_words: number | null;
  backspace_count: number;
  paste_attempts: number;
  score_percentage: number | null;
  passed_benchmark: number | null;
  result_json: unknown;
};

type SectionScore = {
  title: string;
  awarded: number;
  maximum: number;
  percentage: number;
};

const MAX_TEXT_ANSWER_LENGTH = 10_000;
const MAX_TYPING_TEXT_LENGTH = 20_000;
const ASSIGNMENT_START_WINDOW_HOURS = 12;
const ASSESSMENT_GRACE_SECONDS = 120;
const TYPING_GRACE_SECONDS = 30;
const TYPING_WEIGHT_MARKS = 20;

let seedReady: Promise<void> | null = null;

function appError(message: string, statusCode: number, code: string) {
  return Object.assign(new Error(message), { statusCode, code });
}

export function isAssessmentEnabled() {
  return String(process.env.ATS_ASSESSMENT_ENABLED ?? "false").toLowerCase() === "true";
}

function guardEnabled() {
  if (!isAssessmentEnabled()) {
    throw appError("Candidate assessment is currently disabled", 503, "ASSESSMENT_DISABLED");
  }
}

function assessmentSecret() {
  const dedicated = process.env.ATS_ASSESSMENT_TOKEN_SECRET?.trim();
  if (dedicated) return dedicated;
  if (process.env.NODE_ENV === "production") {
    throw appError(
      "ATS_ASSESSMENT_TOKEN_SECRET must be configured before enabling candidate assessment",
      503,
      "ASSESSMENT_SECRET_MISSING",
    );
  }
  return process.env.JWT_SECRET || process.env.AUTH_JWT_SECRET || "hrms2-assessment-local-secret-change-me";
}

function parseJson<T>(value: unknown, fallback: T): T {
  if (value === null || value === undefined) return fallback;
  if (typeof value === "string") {
    try {
      return JSON.parse(value) as T;
    } catch {
      return fallback;
    }
  }
  return value as T;
}

function round(value: number, digits = 2) {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function canonical(value: unknown) {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function sha256(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

function dateMs(value: Date | string | null | undefined) {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  const milliseconds = date.getTime();
  return Number.isFinite(milliseconds) ? milliseconds : null;
}

function nowIso() {
  return new Date().toISOString();
}

function safeEqual(left: string, right: string) {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
}

function makePublicToken(attemptId: string, candidateId: string) {
  const payload = Buffer.from(JSON.stringify({ version: 1, attemptId, candidateId })).toString("base64url");
  const signature = createHmac("sha256", assessmentSecret()).update(payload).digest("base64url");
  return `${payload}.${signature}`;
}

function readPublicToken(token: string) {
  const [payload, suppliedSignature] = String(token ?? "").split(".");
  if (!payload || !suppliedSignature) throw appError("Invalid assessment link", 401, "INVALID_ASSESSMENT_TOKEN");
  const expectedSignature = createHmac("sha256", assessmentSecret()).update(payload).digest("base64url");
  if (!safeEqual(suppliedSignature, expectedSignature)) {
    throw appError("Invalid assessment link", 401, "INVALID_ASSESSMENT_TOKEN");
  }

  try {
    const decoded = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as {
      version?: number;
      attemptId?: string;
      candidateId?: string;
    };
    if (decoded.version !== 1 || !decoded.attemptId || !decoded.candidateId) throw new Error("invalid");
    return { attemptId: decoded.attemptId, candidateId: decoded.candidateId };
  } catch {
    throw appError("Invalid assessment link", 401, "INVALID_ASSESSMENT_TOKEN");
  }
}

async function rows<T>(executor: Executor, sql: string, values: unknown[] = []) {
  const [result] = await executor.execute(sql, values);
  return result as T[];
}

async function safeAudit(
  assessmentId: string,
  eventType: string,
  payload: unknown = {},
  meta: Meta = {},
  executor: Executor = db,
) {
  try {
    await executor.execute(
      `INSERT INTO ats_assessment_audit_log (
        id, assessment_id, event_type, event_payload, actor_type, actor_id, ip_address, user_agent
      ) VALUES (?, ?, ?, CAST(? AS JSON), ?, ?, ?, ?)`,
      [
        randomUUID(),
        assessmentId,
        eventType.slice(0, 100),
        JSON.stringify(payload ?? {}),
        meta.actorType ?? "system",
        meta.actorId ?? null,
        meta.ip ?? null,
        meta.userAgent ?? null,
      ],
    );
  } catch (error) {
    console.error("Assessment audit write failed", { assessmentId, eventType, error });
  }
}

export function normalizeAssessmentProcess(value: unknown): AssessmentProcess | null {
  const normalized = canonical(value);
  if (!normalized) return null;
  if (/\b(outbound|sales|telecall|tele caller|lead generation|collection)\b/.test(normalized)) return "outbound";
  if (/\b(document|kyc|verification|document assessment|document review)\b/.test(normalized)) return "document";
  if (/\b(email|mail|chat|written support)\b/.test(normalized)) return "email";
  if (/\b(back office|backoffice|data entry|non voice|nonvoice|data processing)\b/.test(normalized)) return "backoffice";
  if (/\b(inbound|customer care|customer service|voice support|call centre|call center)\b/.test(normalized)) return "inbound";
  return null;
}

export function normalizeAssessmentRole(value: unknown): AssessmentRole {
  const normalized = canonical(value);
  if (/\b(quality|quality analyst|quality auditor|qa|auditor)\b/.test(normalized)) return "quality_auditor";
  if (/\b(team leader|team lead|tl|supervisor|assistant manager)\b/.test(normalized)) return "team_leader";
  return "executive";
}

export function classifyExperience(value: unknown): "fresher" | "experienced" {
  const normalized = canonical(value);
  if (!normalized || /\b(fresher|no experience|0 year|0 1 year)\b/.test(normalized)) return "fresher";
  return "experienced";
}

function templateDefinition(row: TemplateRow) {
  return parseJson<AssessmentTemplateDefinition>(
    row.config_json,
    getDefaultTemplate(row.process_key, row.role_key),
  );
}

function attemptDefinition(attempt: AttemptRow, template: TemplateRow): AssessmentTemplateDefinition {
  if (attempt.config_snapshot) {
    const snapshot = parseJson<AssessmentTemplateDefinition | null>(attempt.config_snapshot, null);
    if (snapshot) return snapshot;
  }
  return templateDefinition(template);
}

function contentHash(template: AssessmentTemplateDefinition) {
  return sha256(JSON.stringify(template));
}

async function syncBuiltInTemplatesInternal() {
  for (const definition of DEFAULT_ASSESSMENT_TEMPLATES) {
    const hash = contentHash(definition);
    const existing = await rows<TemplateRow>(
      db,
      `SELECT *
       FROM ats_assessment_template
       WHERE template_code = ?
       ORDER BY template_version DESC
       LIMIT 1`,
      [definition.code],
    );
    const latest = existing[0];

    if (latest?.content_hash === hash) {
      await db.execute(
        `UPDATE ats_assessment_template
         SET template_name = ?, process_key = ?, role_key = ?, experience_level = ?,
             difficulty_level = ?, duration_minutes = ?, passing_percentage = ?,
             config_json = CAST(? AS JSON), source_type = 'built_in', active_status = 1,
             updated_at = NOW()
         WHERE id = ?`,
        [
          definition.name,
          definition.process,
          definition.role,
          definition.experienceLevel,
          definition.difficulty,
          definition.durationMinutes,
          definition.passingPercentage,
          JSON.stringify(definition),
          latest.id,
        ],
      );
      continue;
    }

    const version = Number(latest?.template_version ?? 0) + 1;
    try {
      await db.execute(
        `UPDATE ats_assessment_template
         SET active_status = 0
         WHERE template_code = ? AND source_type = 'built_in'`,
        [definition.code],
      );
      await db.execute(
        `INSERT INTO ats_assessment_template (
          id, template_code, template_name, process_key, role_key, experience_level,
          difficulty_level, duration_minutes, passing_percentage, gate_mode,
          template_version, content_hash, config_json, source_type, active_status
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'advisory', ?, ?, CAST(? AS JSON), 'built_in', 1)`,
        [
          randomUUID(),
          definition.code,
          definition.name,
          definition.process,
          definition.role,
          definition.experienceLevel,
          definition.difficulty,
          definition.durationMinutes,
          definition.passingPercentage,
          version,
          hash,
          JSON.stringify(definition),
        ],
      );
    } catch (error) {
      const databaseError = error as { code?: string };
      if (databaseError.code !== "ER_DUP_ENTRY") throw error;
      // Compatibility for an earlier draft schema that had template_code as a
      // single-column unique key. Updating that draft row is safe because this
      // branch has not been merged into production.
      await db.execute(
        `UPDATE ats_assessment_template
         SET template_name = ?, process_key = ?, role_key = ?, experience_level = ?,
             difficulty_level = ?, duration_minutes = ?, passing_percentage = ?,
             content_hash = ?, config_json = CAST(? AS JSON), source_type = 'built_in',
             active_status = 1, updated_at = NOW()
         WHERE template_code = ?`,
        [
          definition.name,
          definition.process,
          definition.role,
          definition.experienceLevel,
          definition.difficulty,
          definition.durationMinutes,
          definition.passingPercentage,
          hash,
          JSON.stringify(definition),
          definition.code,
        ],
      );
    }
  }
}

async function ensureReady() {
  guardEnabled();
  await ensureAssessmentSchema();
  if (!seedReady) {
    seedReady = syncBuiltInTemplatesInternal().catch((error) => {
      seedReady = null;
      throw error;
    });
  }
  await seedReady;
}

export async function syncDefaultTemplates() {
  guardEnabled();
  await ensureAssessmentSchema();
  await syncBuiltInTemplatesInternal();
  return { templates: DEFAULT_ASSESSMENT_TEMPLATES.length };
}

async function findCandidateByPublicCredentials(queueToken: string, mobile: string) {
  const normalizedToken = String(queueToken ?? "").trim();
  const normalizedMobile = String(mobile ?? "").replace(/\D/g, "").slice(-10);
  if (!normalizedToken || !/^[6-9]\d{9}$/.test(normalizedMobile)) {
    throw appError(
      "Enter a valid queue token and registered mobile number",
      400,
      "INVALID_CANDIDATE_CREDENTIALS",
    );
  }

  const candidates = await rows<CandidateRow>(
    db,
    `SELECT
       c.id AS candidate_id,
       c.candidate_code,
       c.full_name,
       c.mobile,
       c.email,
       COALESCE(NULLIF(c.branch_display_name, ''), NULLIF(c.applied_for_branch, '')) AS branch_name,
       COALESCE(NULLIF(c.applied_for_process, ''), NULLIF(c.role_applied, '')) AS process_name,
       COALESCE(NULLIF(c.role_applied, ''), NULLIF(c.applied_for_process, '')) AS role_name,
       c.experience,
       qt.id AS queue_token_id,
       COALESCE(NULLIF(qt.token_number, ''), NULLIF(c.q_token, ''), qt.token) AS token_number
     FROM ats_candidate c
     LEFT JOIN ats_queue_token qt
       ON qt.candidate_id = c.id
      AND (qt.status = 'active' OR qt.queue_status IN ('waiting','called','in_interview'))
     WHERE RIGHT(REGEXP_REPLACE(COALESCE(c.mobile, ''), '[^0-9]', ''), 10) = ?
       AND (
         COALESCE(NULLIF(qt.token_number, ''), NULLIF(c.q_token, ''), qt.token) = ?
         OR c.q_token = ?
       )
     ORDER BY qt.created_at DESC
     LIMIT 1`,
    [normalizedMobile, normalizedToken, normalizedToken],
  );

  if (!candidates[0]) {
    throw appError(
      "Candidate not found. Check the queue token and registered mobile number.",
      404,
      "CANDIDATE_NOT_FOUND",
    );
  }
  if (!candidates[0].token_number) {
    throw appError("No active queue token is available for this candidate", 409, "QUEUE_TOKEN_REQUIRED");
  }
  return candidates[0];
}

async function findCandidateById(candidateId: string) {
  const candidates = await rows<CandidateRow>(
    db,
    `SELECT
       c.id AS candidate_id,
       c.candidate_code,
       c.full_name,
       c.mobile,
       c.email,
       COALESCE(NULLIF(c.branch_display_name, ''), NULLIF(c.applied_for_branch, '')) AS branch_name,
       COALESCE(NULLIF(c.applied_for_process, ''), NULLIF(c.role_applied, '')) AS process_name,
       COALESCE(NULLIF(c.role_applied, ''), NULLIF(c.applied_for_process, '')) AS role_name,
       c.experience,
       qt.id AS queue_token_id,
       COALESCE(NULLIF(qt.token_number, ''), NULLIF(c.q_token, ''), qt.token) AS token_number
     FROM ats_candidate c
     LEFT JOIN ats_queue_token qt
       ON qt.candidate_id = c.id
      AND (qt.status = 'active' OR qt.queue_status IN ('waiting','called','in_interview'))
     WHERE c.id = ?
     ORDER BY qt.created_at DESC
     LIMIT 1`,
    [candidateId],
  );
  if (!candidates[0]) throw appError("Candidate not found", 404, "CANDIDATE_NOT_FOUND");
  if (!candidates[0].token_number) {
    throw appError("Candidate does not have an active queue token", 409, "QUEUE_TOKEN_REQUIRED");
  }
  return candidates[0];
}

function cycleKey(candidate: CandidateRow) {
  return candidate.queue_token_id
    ? `queue:${candidate.queue_token_id}`
    : `token:${String(candidate.token_number).trim()}`;
}

function ruleMatches(rule: string | null, actual: string | null | undefined) {
  if (!rule || !rule.trim() || rule.trim() === "*") return true;
  const actualValue = canonical(actual);
  if (!actualValue) return false;
  return rule
    .split(",")
    .map((entry) => canonical(entry))
    .filter(Boolean)
    .some((entry) => entry === actualValue || actualValue.includes(entry) || entry.includes(actualValue));
}

async function resolveTemplate(candidate: CandidateRow) {
  const mappings = await rows<MappingRow>(
    db,
    `SELECT m.*, t.template_code, t.template_name, t.process_key, t.role_key
     FROM ats_assessment_mapping m
     JOIN ats_assessment_template t ON t.id = m.template_id
     WHERE m.active_status = 1
       AND t.active_status = 1
       AND (m.effective_from IS NULL OR m.effective_from <= NOW())
       AND (m.effective_to IS NULL OR m.effective_to >= NOW())
     ORDER BY m.priority ASC, m.created_at ASC
     LIMIT 500`,
  );

  const experience = classifyExperience(candidate.experience);
  const matching = mappings
    .filter((mapping) =>
      ruleMatches(mapping.branch_name, candidate.branch_name)
      && ruleMatches(mapping.process_match, candidate.process_name)
      && ruleMatches(mapping.role_match, candidate.role_name)
      && ruleMatches(mapping.experience_match, experience),
    )
    .map((mapping) => ({
      mapping,
      specificity:
        (mapping.branch_name ? 8 : 0)
        + (mapping.process_match ? 6 : 0)
        + (mapping.role_match ? 4 : 0)
        + (mapping.experience_match ? 2 : 0)
        + (mapping.vacancy_id ? 10 : 0),
    }))
    .sort((left, right) =>
      Number(left.mapping.priority) - Number(right.mapping.priority)
      || right.specificity - left.specificity,
    );

  if (matching[0]) {
    const template = await rows<TemplateRow>(
      db,
      `SELECT * FROM ats_assessment_template WHERE id = ? AND active_status = 1 LIMIT 1`,
      [matching[0].mapping.template_id],
    );
    if (template[0]) {
      return { template: template[0], source: "mapping" as const, mappingId: matching[0].mapping.id };
    }
  }

  const process = normalizeAssessmentProcess(candidate.process_name);
  const role = normalizeAssessmentRole(candidate.role_name);
  if (!process) {
    throw appError(
      "The candidate's process is not mapped to an assessment. Ask HR to assign the correct process assessment.",
      409,
      "ASSESSMENT_MAPPING_REQUIRED",
    );
  }

  const templates = await rows<TemplateRow>(
    db,
    `SELECT *
     FROM ats_assessment_template
     WHERE process_key = ?
       AND role_key = ?
       AND active_status = 1
       AND experience_level IN ('any', ?)
       AND (effective_from IS NULL OR effective_from <= NOW())
       AND (effective_to IS NULL OR effective_to >= NOW())
     ORDER BY (experience_level = ?) DESC, template_version DESC
     LIMIT 1`,
    [process, role, experience, experience],
  );
  if (!templates[0]) {
    throw appError("Assessment template is not configured", 404, "ASSESSMENT_TEMPLATE_NOT_FOUND");
  }
  return { template: templates[0], source: "automatic" as const, mappingId: null };
}

async function attemptById(attemptId: string, executor: Executor = db, lock = false) {
  const attempts = await rows<AttemptRow>(
    executor,
    `SELECT * FROM ats_candidate_assessment WHERE id = ? LIMIT 1${lock ? " FOR UPDATE" : ""}`,
    [attemptId],
  );
  if (!attempts[0]) throw appError("Assessment session not found", 404, "ASSESSMENT_NOT_FOUND");
  return attempts[0];
}

async function attemptByToken(token: string, executor: Executor = db, lock = false) {
  const identity = readPublicToken(token);
  const attempt = await attemptById(identity.attemptId, executor, lock);
  if (attempt.candidate_id !== identity.candidateId) {
    throw appError("Invalid assessment link", 401, "INVALID_ASSESSMENT_TOKEN");
  }
  const suppliedHash = sha256(token);
  if (!attempt.public_token_hash || !safeEqual(attempt.public_token_hash, suppliedHash)) {
    throw appError("Assessment link has been revoked or is no longer valid", 401, "ASSESSMENT_TOKEN_REVOKED");
  }
  return attempt;
}

async function loadTemplate(templateId: string, executor: Executor = db) {
  const templates = await rows<TemplateRow>(
    executor,
    `SELECT * FROM ats_assessment_template WHERE id = ? LIMIT 1`,
    [templateId],
  );
  if (!templates[0]) throw appError("Assessment template is missing", 500, "ASSESSMENT_TEMPLATE_MISSING");
  return templates[0];
}

async function createOrReuseAssignment(
  candidate: CandidateRow,
  template: TemplateRow,
  source: "automatic" | "mapping" | "manual" | "kiosk",
  assignedBy: string | null,
  meta: Meta,
) {
  const connection = await db.getConnection();
  try {
    await connection.beginTransaction();
    const executor = connection as unknown as Executor;
    await connection.execute(`SELECT id FROM ats_candidate WHERE id = ? FOR UPDATE`, [candidate.candidate_id]);
    const currentCycle = cycleKey(candidate);
    const existing = await rows<AttemptRow>(
      executor,
      `SELECT *
       FROM ats_candidate_assessment
       WHERE candidate_id = ? AND cycle_key = ? AND attempt_no = 1
       ORDER BY created_at DESC
       LIMIT 1
       FOR UPDATE`,
      [candidate.candidate_id, currentCycle],
    );

    let attempt = existing[0];
    if (!attempt) {
      const attemptId = randomUUID();
      const token = makePublicToken(attemptId, candidate.candidate_id);

      const baseDefinition = templateDefinition(template);
      const { config: randomizedConfig, fromBank } =
        await questionBankService.buildRandomizedTemplate(baseDefinition);

      await connection.execute(
        `INSERT INTO ats_candidate_assessment (
          id, candidate_id, queue_token_id, cycle_key, q_token_snapshot,
          template_id, template_version, public_token_hash, status, attempt_no,
          assignment_source, assigned_by, expires_at, client_meta, config_snapshot
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'assigned', 1, ?, ?, DATE_ADD(NOW(), INTERVAL ? HOUR), CAST(? AS JSON), CAST(? AS JSON))`,
        [
          attemptId,
          candidate.candidate_id,
          candidate.queue_token_id,
          currentCycle,
          candidate.token_number,
          template.id,
          template.template_version,
          sha256(token),
          source,
          assignedBy,
          ASSIGNMENT_START_WINDOW_HOURS,
          JSON.stringify({ ...meta, mappingSource: source }),
          JSON.stringify(randomizedConfig),
        ],
      );
      attempt = await attemptById(attemptId, executor, true);
      await safeAudit(
        attemptId,
        "ASSESSMENT_ASSIGNED",
        { templateCode: template.template_code, source, randomized: fromBank },
        { ...meta, actorType: meta.actorType ?? (assignedBy ? "recruiter" : "candidate"), actorId: assignedBy },
        executor,
      );
    }

    await connection.commit();
    const token = makePublicToken(attempt.id, attempt.candidate_id);
    return { attempt, token };
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

function publicAssignmentResult(candidate: CandidateRow, attempt: AttemptRow, template: TemplateRow, token: string) {
  return {
    token,
    launchUrl: `/api/ats-ext/assessment#token=${encodeURIComponent(token)}`,
    candidate: {
      id: candidate.candidate_id,
      code: candidate.candidate_code,
      name: candidate.full_name,
      queueToken: candidate.token_number,
    },
    assessment: {
      id: attempt.id,
      status: attempt.status,
      attemptNo: 1,
      maxAssessmentAttempts: 1,
      maxTypingAttempts: 2,
      template: publicTemplate(attemptDefinition(attempt, template)),
      expiresAt: attempt.expires_at,
    },
  };
}

export async function lookupOrAssignAssessment(input: {
  queueToken: string;
  mobile: string;
  meta?: Meta;
}) {
  await ensureReady();
  const candidate = await findCandidateByPublicCredentials(input.queueToken, input.mobile);
  const currentCycle = cycleKey(candidate);
  const existing = await rows<AttemptRow>(
    db,
    `SELECT *
     FROM ats_candidate_assessment
     WHERE candidate_id = ? AND cycle_key = ? AND attempt_no = 1
     ORDER BY created_at DESC
     LIMIT 1`,
    [candidate.candidate_id, currentCycle],
  );

  if (existing[0]) {
    const template = await loadTemplate(existing[0].template_id);
    const token = makePublicToken(existing[0].id, existing[0].candidate_id);
    return publicAssignmentResult(candidate, existing[0], template, token);
  }

  const resolved = await resolveTemplate(candidate);
  const { attempt, token } = await createOrReuseAssignment(
    candidate,
    resolved.template,
    resolved.source === "mapping" ? "mapping" : "kiosk",
    null,
    { ...input.meta, actorType: "candidate" },
  );
  return publicAssignmentResult(candidate, attempt, resolved.template, token);
}

export async function assignAssessmentManually(input: {
  candidateId: string;
  templateId: string;
  actorId: string;
  sendEmail?: boolean;
  meta?: Meta;
}) {
  await ensureReady();
  const candidate = await findCandidateById(input.candidateId);
  const template = await loadTemplate(input.templateId);
  if (!template.active_status) throw appError("Assessment template is inactive", 409, "TEMPLATE_INACTIVE");
  const { attempt, token } = await createOrReuseAssignment(
    candidate,
    template,
    "manual",
    input.actorId,
    { ...input.meta, actorType: input.meta?.actorType ?? "recruiter", actorId: input.actorId },
  );
  const result = publicAssignmentResult(candidate, attempt, template, token);

  // Send assessment invitation email to the candidate (non-blocking)
  if ((input.sendEmail !== false) && candidate.email && emailService.isConfigured()) {
    // Resolve recruiter name and mobile from employees table
    const recruiterRows = await rows<RowDataPacket>(
      db,
      `SELECT full_name, mobile FROM employees WHERE user_id = ? AND active_status = 1 LIMIT 1`,
      [input.actorId],
    );
    const recruiterName = (recruiterRows[0]?.full_name as string | null) ?? "Your Recruiter";
    const recruiterMobile = (recruiterRows[0]?.mobile as string | null) ?? "—";

    const frontendBase = (process.env.FRONTEND_URL ?? "").replace(/\/+$/, "");
    const assessmentLink = frontendBase
      ? `${frontendBase}/api/ats-ext/assessment#token=${encodeURIComponent(token)}`
      : result.launchUrl;

    const expiresAt = attempt.expires_at
      ? new Intl.DateTimeFormat("en-IN", {
          day: "2-digit", month: "short", year: "numeric",
          hour: "numeric", minute: "2-digit", hour12: true,
        }).format(new Date(attempt.expires_at))
      : "12 hours from now";

    emailService
      .send({
        to: candidate.email,
        subject: "Complete Your Pre-Employment Assessment — MAS Callnet",
        html: assessmentInvitationEmail({
          candidateName: candidate.full_name ?? "Candidate",
          tokenNumber: candidate.token_number ?? "—",
          assessmentLink,
          recruiterName,
          recruiterMobile,
          expiresAt,
        }),
        text: `Dear ${candidate.full_name ?? "Candidate"}, your assessment link: ${assessmentLink} (valid until ${expiresAt}). Contact your recruiter ${recruiterName} at ${recruiterMobile} for help.`,
      })
      .catch((err: unknown) => {
        console.error("[assessment] Failed to send invitation email:", err instanceof Error ? err.message : err);
      });
  }

  return result;
}

export function getRemainingSeconds(attempt: Pick<AttemptRow, "status" | "expires_at">) {
  if (attempt.status !== "in_progress" || !attempt.expires_at) return null;
  const deadline = dateMs(attempt.expires_at);
  if (deadline === null) return null;
  return Math.max(0, Math.ceil((deadline - Date.now()) / 1000));
}

function answerValue(response?: ResponseRow) {
  if (!response) return null;
  return response.answer_text ?? parseJson(response.answer_json, null);
}

function hasAnswer(value: unknown) {
  if (value === null || value === undefined) return false;
  if (typeof value === "string") return value.trim().length > 0;
  if (Array.isArray(value)) return value.length > 0;
  return true;
}

function candidateQuestion(question: AssessmentQuestionDefinition) {
  const { correctAnswer: _correctAnswer, keywords: _keywords, explanation: _explanation, ...safe } = question;
  return safe;
}

function serializeTyping(row: TypingRow, includeReference = false) {
  return {
    id: row.id,
    attemptNo: Number(row.attempt_no),
    startedAt: row.started_at,
    submittedAt: row.submitted_at,
    durationSeconds: Number(row.duration_limit_seconds),
    elapsedSeconds: row.elapsed_seconds,
    grossWpm: row.gross_wpm,
    netWpm: row.net_wpm,
    accuracy: row.accuracy_percentage,
    score: row.score_percentage,
    passedBenchmark: row.passed_benchmark === null ? null : Boolean(row.passed_benchmark),
    backspaceCount: Number(row.backspace_count ?? 0),
    pasteAttempts: Number(row.paste_attempts ?? 0),
    result: row.submitted_at ? parseJson(row.result_json, null) : null,
    active: !row.submitted_at,
    ...(includeReference ? { passage: row.reference_text } : {}),
  };
}

async function expireUnstartedAttempt(attempt: AttemptRow) {
  const expiry = dateMs(attempt.expires_at);
  if (attempt.status === "assigned" && expiry !== null && expiry <= Date.now()) {
    await db.execute(
      `UPDATE ats_candidate_assessment
       SET status = 'expired', failure_reason = 'Assessment was not started within the assignment window'
       WHERE id = ? AND status = 'assigned'`,
      [attempt.id],
    );
    await safeAudit(attempt.id, "ASSESSMENT_EXPIRED_BEFORE_START", {}, { actorType: "system" });
    return true;
  }
  return false;
}

async function loadSessionData(attempt: AttemptRow) {
  const template = await loadTemplate(attempt.template_id);
  const definition = attemptDefinition(attempt, template);
  const responses = await rows<ResponseRow>(
    db,
    `SELECT * FROM ats_assessment_response WHERE assessment_id = ? ORDER BY answered_at ASC`,
    [attempt.id],
  );
  const typingAttempts = await rows<TypingRow>(
    db,
    `SELECT * FROM ats_typing_test_attempt WHERE assessment_id = ? ORDER BY attempt_no ASC`,
    [attempt.id],
  );
  const candidates = await rows<CandidateRow>(
    db,
    `SELECT
       id AS candidate_id, candidate_code, full_name, mobile,
       COALESCE(NULLIF(branch_display_name, ''), NULLIF(applied_for_branch, '')) AS branch_name,
       COALESCE(NULLIF(applied_for_process, ''), NULLIF(role_applied, '')) AS process_name,
       COALESCE(NULLIF(role_applied, ''), NULLIF(applied_for_process, '')) AS role_name,
       experience, NULL AS queue_token_id, q_token AS token_number
     FROM ats_candidate WHERE id = ? LIMIT 1`,
    [attempt.candidate_id],
  );
  const safeTemplate = publicTemplate(definition);
  const questionsVisible = attempt.status !== "assigned" && attempt.status !== "expired";

  return {
    candidate: candidates[0]
      ? {
          id: candidates[0].candidate_id,
          code: candidates[0].candidate_code,
          name: candidates[0].full_name,
          queueToken: attempt.q_token_snapshot,
        }
      : { id: attempt.candidate_id },
    assessment: {
      id: attempt.id,
      status: attempt.status,
      attemptNo: attempt.attempt_no,
      maxAssessmentAttempts: 1,
      typingAttemptsUsed: Number(attempt.typing_attempts_used ?? 0),
      maxTypingAttempts: 2,
      assignedAt: attempt.assigned_at,
      startedAt: attempt.started_at,
      submittedAt: attempt.submitted_at,
      completedAt: attempt.completed_at,
      expiresAt: attempt.expires_at,
      remainingSeconds: getRemainingSeconds(attempt),
      percentage: attempt.percentage,
      result: attempt.result,
      sectionScores: parseJson<Record<string, SectionScore>>(attempt.section_scores, {}),
      recommendation: parseJson(attempt.recommendation_json, null),
      integrityFlags: parseJson<unknown[]>(attempt.integrity_flags, []),
      manualReviewRequired: Boolean(attempt.manual_review_required),
      reviewRemarks: attempt.review_remarks,
      template: {
        ...safeTemplate,
        questions: questionsVisible ? safeTemplate.questions : [],
      },
    },
    template: {
      ...safeTemplate,
      questions: questionsVisible ? safeTemplate.questions : [],
    },
    responses: responses.map((response) => ({
      questionId: response.question_id,
      answer: answerValue(response),
      marksAwarded:
        attempt.status === "completed" || attempt.status === "manual_review"
          ? response.marks_awarded
          : undefined,
    })),
    typingAttempts: typingAttempts.map((typing) => serializeTyping(typing, !typing.submitted_at)),
  };
}

export async function getAssessmentSession(token: string) {
  await ensureReady();
  let attempt = await attemptByToken(token);
  if (await expireUnstartedAttempt(attempt)) attempt = await attemptByToken(token);

  const remaining = getRemainingSeconds(attempt);
  if (attempt.status === "in_progress" && remaining === 0) {
    await submitAssessment(token, { autoSubmit: true, reason: "assessment_timer_expired" });
    attempt = await attemptByToken(token);
  }
  return loadSessionData(attempt);
}

export async function startAssessment(token: string, meta: Meta = {}) {
  await ensureReady();
  const connection = await db.getConnection();
  try {
    await connection.beginTransaction();
    const executor = connection as unknown as Executor;
    const attempt = await attemptByToken(token, executor, true);
    const template = await loadTemplate(attempt.template_id, executor);

    if (attempt.status === "assigned") {
      const identityCheckEnabled = String(process.env.ATS_IDENTITY_CHECK_ENABLED ?? "false").toLowerCase() === "true";
      if (identityCheckEnabled && !(attempt as unknown as { identity_verified: number }).identity_verified) {
        throw appError(
          "Identity must be verified before starting the assessment. Request an OTP first.",
          403,
          "IDENTITY_NOT_VERIFIED",
        );
      }
      const assignmentExpiry = dateMs(attempt.expires_at);
      if (assignmentExpiry !== null && assignmentExpiry <= Date.now()) {
        await connection.execute(
          `UPDATE ats_candidate_assessment
           SET status = 'expired', failure_reason = 'Assessment was not started within the assignment window'
           WHERE id = ?`,
          [attempt.id],
        );
        await safeAudit(
          attempt.id,
          "ASSESSMENT_EXPIRED_BEFORE_START",
          {},
          { ...meta, actorType: "system" },
          executor,
        );
        await connection.commit();
        return loadSessionData(await attemptByToken(token));
      }
      const durationSeconds = Number(template.duration_minutes) * 60 + ASSESSMENT_GRACE_SECONDS;
      await connection.execute(
        `UPDATE ats_candidate_assessment
         SET status = 'in_progress', started_at = COALESCE(started_at, NOW()),
             expires_at = DATE_ADD(NOW(), INTERVAL ? SECOND)
         WHERE id = ? AND status = 'assigned'`,
        [durationSeconds, attempt.id],
      );
      await safeAudit(attempt.id, "ASSESSMENT_STARTED", { durationSeconds }, { ...meta, actorType: "candidate" }, executor);
    } else if (attempt.status !== "in_progress") {
      throw appError(
        "The single assessment attempt has already been used",
        409,
        "ASSESSMENT_ATTEMPT_USED",
      );
    }
    await connection.commit();
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
  return getAssessmentSession(token);
}

function validateAnswer(question: AssessmentQuestionDefinition, answer: unknown) {
  if (question.type === "single") {
    if (typeof answer !== "string" || !answer.trim()) {
      throw appError("Select one answer", 400, "INVALID_ANSWER");
    }
    if (answer.length > 500 || !question.options?.includes(answer)) {
      throw appError("Invalid answer option", 400, "INVALID_ANSWER");
    }
    return answer;
  }

  if (question.type === "multi") {
    if (!Array.isArray(answer) || answer.length === 0 || answer.length > 20) {
      throw appError("Select at least one valid answer", 400, "INVALID_ANSWER");
    }
    const clean = [...new Set(answer.map((value) => String(value)))];
    if (clean.some((value) => value.length > 500 || !question.options?.includes(value))) {
      throw appError("Invalid answer option", 400, "INVALID_ANSWER");
    }
    return clean;
  }

  if (typeof answer !== "string" || !answer.trim()) {
    throw appError("Enter a written answer", 400, "INVALID_ANSWER");
  }
  if (answer.length > MAX_TEXT_ANSWER_LENGTH) {
    throw appError("Written answer is too long", 400, "ANSWER_TOO_LONG");
  }
  return answer;
}

export async function saveResponse(
  token: string,
  questionId: string,
  answer: unknown,
  timeTakenSeconds?: number,
) {
  await ensureReady();
  const attempt = await attemptByToken(token);
  if (attempt.status !== "in_progress") throw appError("Assessment is not open", 409, "ASSESSMENT_NOT_OPEN");
  if (getRemainingSeconds(attempt) === 0) {
    await submitAssessment(token, { autoSubmit: true, reason: "assessment_timer_expired" });
    throw appError("Assessment time has ended and the attempt was submitted", 409, "ASSESSMENT_TIME_ENDED");
  }

  const template = await loadTemplate(attempt.template_id);
  const definition = attemptDefinition(attempt, template);
  const question = definition.questions.find((item) => item.id === questionId);
  if (!question) throw appError("Question not found", 404, "QUESTION_NOT_FOUND");
  const validated = validateAnswer(question, answer);
  const answerText = typeof validated === "string" ? validated : null;
  const answerJson = answerText === null ? JSON.stringify(validated) : null;
  const evaluationMode = question.manualReview ? "manual" : question.type === "text" ? "keyword" : "auto";
  const timeTaken = timeTakenSeconds === undefined
    ? null
    : Math.max(0, Math.min(86_400, Math.floor(Number(timeTakenSeconds) || 0)));

  if (answerJson !== null) {
    await db.execute(
      `INSERT INTO ats_assessment_response (
        id, assessment_id, question_id, section_key, question_type, question_snapshot,
        answer_json, answer_text, max_marks, evaluation_mode, time_taken_seconds
      ) VALUES (?, ?, ?, ?, ?, CAST(? AS JSON), CAST(? AS JSON), NULL, ?, ?, ?)
      ON DUPLICATE KEY UPDATE
        question_snapshot = VALUES(question_snapshot), answer_json = VALUES(answer_json),
        answer_text = NULL, max_marks = VALUES(max_marks), evaluation_mode = VALUES(evaluation_mode),
        time_taken_seconds = VALUES(time_taken_seconds), answered_at = NOW(), updated_at = NOW()`,
      [
        randomUUID(),
        attempt.id,
        question.id,
        question.sectionKey,
        question.type,
        JSON.stringify(question),
        answerJson,
        question.marks,
        evaluationMode,
        timeTaken,
      ],
    );
  } else {
    await db.execute(
      `INSERT INTO ats_assessment_response (
        id, assessment_id, question_id, section_key, question_type, question_snapshot,
        answer_json, answer_text, max_marks, evaluation_mode, time_taken_seconds
      ) VALUES (?, ?, ?, ?, ?, CAST(? AS JSON), NULL, ?, ?, ?, ?)
      ON DUPLICATE KEY UPDATE
        question_snapshot = VALUES(question_snapshot), answer_json = NULL,
        answer_text = VALUES(answer_text), max_marks = VALUES(max_marks),
        evaluation_mode = VALUES(evaluation_mode), time_taken_seconds = VALUES(time_taken_seconds),
        answered_at = NOW(), updated_at = NOW()`,
      [
        randomUUID(),
        attempt.id,
        question.id,
        question.sectionKey,
        question.type,
        JSON.stringify(question),
        answerText,
        question.marks,
        evaluationMode,
        timeTaken,
      ],
    );
  }
  return { saved: true };
}

export async function recordIntegrityEvent(
  token: string,
  eventType: string,
  details: unknown,
  meta: Meta = {},
) {
  await ensureReady();
  const attempt = await attemptByToken(token);
  const flags = parseJson<Array<Record<string, unknown>>>(attempt.integrity_flags, []);
  flags.push({ eventType: eventType.slice(0, 100), at: nowIso(), details });
  await db.execute(
    `UPDATE ats_candidate_assessment SET integrity_flags = CAST(? AS JSON) WHERE id = ?`,
    [JSON.stringify(flags.slice(-100)), attempt.id],
  );
  await safeAudit(
    attempt.id,
    eventType,
    details,
    { ...meta, actorType: "candidate" },
  );
  return { recorded: true, count: flags.length };
}

export async function startTypingAttempt(token: string, meta: Meta = {}) {
  await ensureReady();
  const connection = await db.getConnection();
  try {
    await connection.beginTransaction();
    const executor = connection as unknown as Executor;
    const attempt = await attemptByToken(token, executor, true);
    if (attempt.status !== "in_progress") throw appError("Assessment is not open", 409, "ASSESSMENT_NOT_OPEN");
    if (getRemainingSeconds(attempt) === 0) throw appError("Assessment time has ended", 409, "ASSESSMENT_TIME_ENDED");

    const template = await loadTemplate(attempt.template_id, executor);
    const definition = attemptDefinition(attempt, template);
    if (!definition.typing.required) {
      throw appError("Typing test is not required for this assessment", 400, "TYPING_NOT_REQUIRED");
    }

    const active = await rows<TypingRow>(
      executor,
      `SELECT *
       FROM ats_typing_test_attempt
       WHERE assessment_id = ? AND submitted_at IS NULL
       ORDER BY attempt_no DESC
       LIMIT 1
       FOR UPDATE`,
      [attempt.id],
    );
    let typing = active[0];

    if (!typing) {
      const count = await rows<RowDataPacket & { total: number }>(
        executor,
        `SELECT COUNT(*) AS total FROM ats_typing_test_attempt WHERE assessment_id = ?`,
        [attempt.id],
      );
      const used = Number(count[0]?.total ?? 0);
      if (used >= 2) {
        throw appError("Maximum two typing attempts are allowed", 409, "TYPING_ATTEMPTS_USED");
      }
      const typingId = randomUUID();
      const attemptNo = used + 1;
      await connection.execute(
        `INSERT INTO ats_typing_test_attempt (
          id, assessment_id, attempt_no, reference_text, duration_limit_seconds
        ) VALUES (?, ?, ?, ?, ?)`,
        [typingId, attempt.id, attemptNo, definition.typing.passage, definition.typing.durationSeconds],
      );
      await connection.execute(
        `UPDATE ats_candidate_assessment SET typing_attempts_used = ? WHERE id = ?`,
        [attemptNo, attempt.id],
      );
      typing = (await rows<TypingRow>(
        executor,
        `SELECT * FROM ats_typing_test_attempt WHERE id = ? LIMIT 1`,
        [typingId],
      ))[0];
    }

    await safeAudit(
      attempt.id,
      "TYPING_ATTEMPT_STARTED",
      { attemptNo: typing.attempt_no },
      { ...meta, actorType: "candidate" },
      executor,
    );
    await connection.commit();
    return {
      id: typing.id,
      attemptNo: Number(typing.attempt_no),
      maxAttempts: 2,
      passage: typing.reference_text,
      durationSeconds: Number(typing.duration_limit_seconds),
      startedAt: typing.started_at,
    };
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

export async function submitTypingAttempt(
  token: string,
  typingAttemptId: string,
  input: { typedText: string; backspaceCount?: number; pasteAttempts?: number },
  meta: Meta = {},
) {
  await ensureReady();
  if (String(input.typedText ?? "").length > MAX_TYPING_TEXT_LENGTH) {
    throw appError("Typed text is too long", 400, "TYPING_TEXT_TOO_LONG");
  }

  const connection = await db.getConnection();
  try {
    await connection.beginTransaction();
    const executor = connection as unknown as Executor;
    const attempt = await attemptByToken(token, executor, true);
    if (attempt.status !== "in_progress") throw appError("Assessment is not open", 409, "ASSESSMENT_NOT_OPEN");
    const template = await loadTemplate(attempt.template_id, executor);
    const definition = attemptDefinition(attempt, template);
    const typingRows = await rows<TypingRow>(
      executor,
      `SELECT *
       FROM ats_typing_test_attempt
       WHERE id = ? AND assessment_id = ?
       LIMIT 1
       FOR UPDATE`,
      [typingAttemptId, attempt.id],
    );
    const typing = typingRows[0];
    if (!typing) throw appError("Typing attempt not found", 404, "TYPING_ATTEMPT_NOT_FOUND");

    if (typing.submitted_at) {
      const existingResult = parseJson<Record<string, unknown>>(typing.result_json, {});
      await connection.commit();
      return { ...existingResult, attemptNo: typing.attempt_no, attemptsRemaining: 2 - typing.attempt_no, alreadySubmitted: true };
    }

    const started = dateMs(typing.started_at) ?? Date.now();
    const actualElapsed = Math.max(1, Math.floor((Date.now() - started) / 1000));
    const elapsed = Math.min(actualElapsed, Number(typing.duration_limit_seconds) + TYPING_GRACE_SECONDS);
    const scored = calculateTypingScore({
      referenceText: typing.reference_text,
      typedText: String(input.typedText ?? ""),
      elapsedSeconds: elapsed,
      minNetWpm: definition.typing.minNetWpm,
      minAccuracy: definition.typing.minAccuracy,
    });
    const pasteAttempts = Math.max(0, Math.min(10_000, Math.floor(Number(input.pasteAttempts ?? 0))));
    const backspaceCount = Math.max(0, Math.min(1_000_000, Math.floor(Number(input.backspaceCount ?? 0))));

    await connection.execute(
      `UPDATE ats_typing_test_attempt
       SET typed_text = ?, elapsed_seconds = ?, submitted_at = NOW(),
           gross_wpm = ?, net_wpm = ?, accuracy_percentage = ?, edit_distance = ?,
           correct_characters = ?, incorrect_characters = ?, missing_characters = ?,
           extra_characters = ?, correct_words = ?, incorrect_words = ?,
           backspace_count = ?, paste_attempts = ?, score_percentage = ?,
           passed_benchmark = ?, result_json = CAST(? AS JSON)
       WHERE id = ?`,
      [
        String(input.typedText ?? ""),
        elapsed,
        scored.grossWpm,
        scored.netWpm,
        scored.accuracy,
        scored.editDistance,
        scored.correctCharacters,
        scored.incorrectCharacters,
        scored.missingCharacters,
        scored.extraCharacters,
        scored.correctWords,
        scored.incorrectWords,
        backspaceCount,
        pasteAttempts,
        scored.score,
        scored.passedBenchmark ? 1 : 0,
        JSON.stringify(scored),
        typing.id,
      ],
    );
    if (pasteAttempts > 0 || actualElapsed > Number(typing.duration_limit_seconds) + TYPING_GRACE_SECONDS) {
      const flags = parseJson<Array<Record<string, unknown>>>(attempt.integrity_flags, []);
      if (pasteAttempts > 0) flags.push({ eventType: "paste_attempt", at: nowIso(), details: { pasteAttempts } });
      if (actualElapsed > Number(typing.duration_limit_seconds) + TYPING_GRACE_SECONDS) {
        flags.push({ eventType: "late_typing_submission", at: nowIso(), details: { actualElapsed } });
      }
      await connection.execute(
        `UPDATE ats_candidate_assessment SET integrity_flags = CAST(? AS JSON) WHERE id = ?`,
        [JSON.stringify(flags.slice(-100)), attempt.id],
      );
    }
    await safeAudit(
      attempt.id,
      "TYPING_ATTEMPT_SUBMITTED",
      {
        attemptNo: typing.attempt_no,
        netWpm: scored.netWpm,
        accuracy: scored.accuracy,
        pasteAttempts,
      },
      { ...meta, actorType: "candidate" },
      executor,
    );
    await connection.commit();
    return {
      ...scored,
      attemptNo: Number(typing.attempt_no),
      attemptsRemaining: 2 - Number(typing.attempt_no),
    };
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

function scoreQuestion(question: AssessmentQuestionDefinition, response?: ResponseRow) {
  const value = answerValue(response);
  if (question.type === "single") {
    return {
      awarded: canonical(value) === canonical(question.correctAnswer) ? question.marks : 0,
      manual: false,
      notes: "Automatic exact-option scoring",
    };
  }
  if (question.type === "multi") {
    const actual = Array.isArray(value) ? value.map(canonical).sort() : [];
    const expected = Array.isArray(question.correctAnswer)
      ? question.correctAnswer.map(canonical).sort()
      : [];
    return {
      awarded: JSON.stringify(actual) === JSON.stringify(expected) ? question.marks : 0,
      manual: false,
      notes: "Automatic multi-option scoring",
    };
  }

  const text = canonical(value);
  const keywords = question.keywords ?? [];
  const hits = keywords.filter((keyword) => text.includes(canonical(keyword))).length;
  const coverage = keywords.length ? hits / keywords.length : 0;
  return {
    awarded: round(question.marks * coverage),
    manual: false,
    notes: `Keyword coverage ${hits}/${keywords.length}`,
  };
}

function addSectionScore(
  sections: Record<string, SectionScore>,
  key: string,
  title: string,
  awarded: number,
  maximum: number,
) {
  sections[key] ??= { title, awarded: 0, maximum: 0, percentage: 0 };
  sections[key].awarded += awarded;
  sections[key].maximum += maximum;
}

function finishSectionScores(sections: Record<string, SectionScore>) {
  for (const section of Object.values(sections)) {
    section.awarded = round(section.awarded);
    section.maximum = round(section.maximum);
    section.percentage = section.maximum ? round((section.awarded / section.maximum) * 100) : 0;
  }
  return sections;
}

async function ensureResponseSnapshots(
  executor: Executor,
  assessmentId: string,
  questions: AssessmentQuestionDefinition[],
) {
  for (const question of questions) {
    await executor.execute(
      `INSERT INTO ats_assessment_response (
        id, assessment_id, question_id, section_key, question_type, question_snapshot,
        answer_json, answer_text, marks_awarded, max_marks, evaluation_mode, evaluation_notes
      ) VALUES (?, ?, ?, ?, ?, CAST(? AS JSON), NULL, NULL, 0, ?, ?, 'No answer submitted')
      ON DUPLICATE KEY UPDATE
        question_snapshot = VALUES(question_snapshot), max_marks = VALUES(max_marks)`,
      [
        randomUUID(),
        assessmentId,
        question.id,
        question.sectionKey,
        question.type,
        JSON.stringify(question),
        question.marks,
        question.manualReview ? "manual" : question.type === "text" ? "keyword" : "auto",
      ],
    );
  }
}

async function finalizeAssessment(
  executor: Executor,
  attempt: AttemptRow,
  definition: AssessmentTemplateDefinition,
  options: { allowIncomplete: boolean },
) {
  await ensureResponseSnapshots(executor, attempt.id, definition.questions);
  const responses = await rows<ResponseRow>(
    executor,
    `SELECT * FROM ats_assessment_response WHERE assessment_id = ? FOR UPDATE`,
    [attempt.id],
  );
  const responseMap = new Map(responses.map((response) => [response.question_id, response]));
  const missing = definition.questions.filter((question) => !hasAnswer(answerValue(responseMap.get(question.id))));
  if (missing.length && !options.allowIncomplete) {
    throw appError(
      `Please answer all questions (${missing.length} remaining)`,
      400,
      "ASSESSMENT_INCOMPLETE",
    );
  }

  const typingAttempts = await rows<TypingRow>(
    executor,
    `SELECT *
     FROM ats_typing_test_attempt
     WHERE assessment_id = ? AND submitted_at IS NOT NULL
     ORDER BY score_percentage DESC, attempt_no ASC
     LIMIT 1
     FOR UPDATE`,
    [attempt.id],
  );
  const bestTyping = typingAttempts[0];
  if (definition.typing.required && !bestTyping && !options.allowIncomplete) {
    throw appError("Complete at least one typing attempt", 400, "TYPING_REQUIRED");
  }

  const sections: Record<string, SectionScore> = {};
  let awarded = 0;
  let maximum = 0;
  let manualReviewRequired = false;

  for (const question of definition.questions) {
    const response = responseMap.get(question.id);
    const score = scoreQuestion(question, response);
    awarded += score.awarded;
    maximum += question.marks;
    manualReviewRequired ||= score.manual;
    addSectionScore(sections, question.sectionKey, question.sectionTitle, score.awarded, question.marks);
    await executor.execute(
      `UPDATE ats_assessment_response
       SET marks_awarded = ?, evaluation_notes = ?, evaluation_mode = ?
       WHERE assessment_id = ? AND question_id = ?`,
      [score.awarded, score.notes, score.manual ? "manual" : question.type === "text" ? "keyword" : "auto", attempt.id, question.id],
    );
  }

  let typingPassed: boolean | null = null;
  if (definition.typing.required) {
    const typingScore = Number(bestTyping?.score_percentage ?? 0);
    const typingMarks = round((typingScore / 100) * TYPING_WEIGHT_MARKS);
    awarded += typingMarks;
    maximum += TYPING_WEIGHT_MARKS;
    typingPassed = Boolean(bestTyping?.passed_benchmark);
    addSectionScore(sections, "typing", "Typing Test", typingMarks, TYPING_WEIGHT_MARKS);
  }

  finishSectionScores(sections);
  const percentage = maximum ? round((awarded / maximum) * 100) : 0;
  const preliminaryPassed = percentage >= definition.passingPercentage && typingPassed !== false;
  const status: AttemptStatus = manualReviewRequired ? "manual_review" : "completed";
  const result: "pass" | "fail" | "pending_review" = manualReviewRequired
    ? "pending_review"
    : preliminaryPassed
      ? "pass"
      : "fail";
  const recommendation = {
    decision: manualReviewRequired
      ? "Manual review required"
      : preliminaryPassed
        ? "Recommended"
        : "Not recommended",
    process: definition.process,
    role: definition.role,
    typingPassed,
    preliminaryResult: preliminaryPassed ? "pass" : "fail",
    advisoryOnly: true,
  };

  await executor.execute(
    `UPDATE ats_candidate_assessment
     SET status = ?, submitted_at = COALESCE(submitted_at, NOW()), completed_at = NOW(),
         overall_score = ?, max_score = ?, percentage = ?, result = ?,
         manual_review_required = ?, section_scores = CAST(? AS JSON),
         recommendation_json = CAST(? AS JSON), failure_reason = NULL
     WHERE id = ?`,
    [
      status,
      round(awarded),
      round(maximum),
      percentage,
      result,
      manualReviewRequired ? 1 : 0,
      JSON.stringify(sections),
      JSON.stringify(recommendation),
      attempt.id,
    ],
  );

  return {
    status,
    result,
    preliminaryResult: preliminaryPassed ? "pass" : "fail",
    percentage,
    score: round(awarded),
    maxScore: round(maximum),
    passingPercentage: definition.passingPercentage,
    sectionScores: sections,
    recommendation,
    manualReviewRequired,
    incompleteQuestions: missing.length,
    typing: bestTyping
      ? {
          attemptNo: Number(bestTyping.attempt_no),
          netWpm: Number(bestTyping.net_wpm ?? 0),
          accuracy: Number(bestTyping.accuracy_percentage ?? 0),
          passedBenchmark: typingPassed,
        }
      : null,
  };
}

export async function submitAssessment(
  token: string,
  options: { autoSubmit?: boolean; reason?: string } = {},
  meta: Meta = {},
) {
  await ensureReady();
  const connection = await db.getConnection();
  try {
    await connection.beginTransaction();
    const executor = connection as unknown as Executor;
    const attempt = await attemptByToken(token, executor, true);
    if (["manual_review", "completed"].includes(attempt.status)) {
      await connection.commit();
      return {
        status: attempt.status,
        result: attempt.result,
        percentage: attempt.percentage,
        score: attempt.overall_score,
        maxScore: attempt.max_score,
        sectionScores: parseJson(attempt.section_scores, {}),
        recommendation: parseJson(attempt.recommendation_json, null),
        manualReviewRequired: Boolean(attempt.manual_review_required),
        alreadySubmitted: true,
      };
    }
    if (attempt.status !== "in_progress") {
      throw appError("The single assessment attempt is not open", 409, "ASSESSMENT_NOT_OPEN");
    }

    await connection.execute(
      `UPDATE ats_candidate_assessment SET status = 'submitted_pending_scoring' WHERE id = ?`,
      [attempt.id],
    );
    const template = await loadTemplate(attempt.template_id, executor);
    const definition = attemptDefinition(attempt, template);
    const result = await finalizeAssessment(executor, attempt, definition, {
      allowIncomplete: Boolean(options.autoSubmit),
    });
    await safeAudit(
      attempt.id,
      options.autoSubmit ? "ASSESSMENT_AUTO_SUBMITTED" : "ASSESSMENT_SUBMITTED",
      { ...result, reason: options.reason ?? null },
      { ...meta, actorType: options.autoSubmit ? "system" : "candidate" },
      executor,
    );
    await connection.commit();
    return result;
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

export async function getAssessmentResult(token: string) {
  const session = await getAssessmentSession(token);
  if (!["completed", "manual_review"].includes(session.assessment.status)) {
    throw appError("Assessment result is not available yet", 409, "RESULT_NOT_AVAILABLE");
  }
  return session;
}

export async function getCandidateAssessmentSummary(candidateId: string) {
  await ensureReady();
  const attempts = await rows<AttemptRow>(
    db,
    `SELECT a.*, c.full_name AS candidate_name, c.candidate_code,
            c.mobile AS candidate_mobile, t.template_name, t.template_code,
            t.process_key, t.role_key, t.duration_minutes, t.passing_percentage
     FROM ats_candidate_assessment a
     JOIN ats_candidate c ON c.id = a.candidate_id
     JOIN ats_assessment_template t ON t.id = a.template_id
     WHERE a.candidate_id = ?
     ORDER BY a.created_at DESC
     LIMIT 1`,
    [candidateId],
  );
  const attempt = attempts[0];
  if (!attempt) return null;
  const typing = await rows<TypingRow>(
    db,
    `SELECT *
     FROM ats_typing_test_attempt
     WHERE assessment_id = ? AND submitted_at IS NOT NULL
     ORDER BY score_percentage DESC, attempt_no ASC
     LIMIT 1`,
    [attempt.id],
  );
  return {
    id: attempt.id,
    candidateId: attempt.candidate_id,
    candidateName: attempt.candidate_name,
    candidateCode: attempt.candidate_code,
    templateName: attempt.template_name,
    templateCode: attempt.template_code,
    process: attempt.process_key,
    role: attempt.role_key,
    status: attempt.status,
    result: attempt.result,
    percentage: attempt.percentage,
    score: attempt.overall_score,
    maxScore: attempt.max_score,
    sectionScores: parseJson(attempt.section_scores, {}),
    recommendation: parseJson(attempt.recommendation_json, null),
    integrityFlags: parseJson(attempt.integrity_flags, []),
    manualReviewRequired: Boolean(attempt.manual_review_required),
    reviewRemarks: attempt.review_remarks,
    typing: typing[0]
      ? {
          attemptNo: Number(typing[0].attempt_no),
          grossWpm: typing[0].gross_wpm,
          netWpm: typing[0].net_wpm,
          accuracy: typing[0].accuracy_percentage,
          score: typing[0].score_percentage,
          passedBenchmark: Boolean(typing[0].passed_benchmark),
        }
      : null,
    assignedAt: attempt.assigned_at,
    startedAt: attempt.started_at,
    submittedAt: attempt.submitted_at,
    completedAt: attempt.completed_at,
  };
}

export async function listAssessmentAttempts(filters: {
  status?: string;
  process?: string;
  role?: string;
  search?: string;
  limit?: number;
  offset?: number;
}) {
  await ensureReady();
  const conditions = ["1 = 1"];
  const parameters: unknown[] = [];
  if (filters.status) {
    conditions.push("a.status = ?");
    parameters.push(filters.status);
  }
  if (filters.process) {
    conditions.push("t.process_key = ?");
    parameters.push(filters.process);
  }
  if (filters.role) {
    conditions.push("t.role_key = ?");
    parameters.push(filters.role);
  }
  if (filters.search?.trim()) {
    const query = `%${filters.search.trim()}%`;
    conditions.push("(c.full_name LIKE ? OR c.mobile LIKE ? OR c.candidate_code LIKE ? OR a.q_token_snapshot LIKE ?)");
    parameters.push(query, query, query, query);
  }
  const limit = Math.max(1, Math.min(200, Number(filters.limit ?? 50)));
  const offset = Math.max(0, Number(filters.offset ?? 0));

  return rows<RowDataPacket>(
    db,
    `SELECT
       a.id, a.candidate_id, c.candidate_code, c.full_name, c.mobile,
       a.q_token_snapshot, a.status, a.result, a.percentage,
       a.manual_review_required, a.assigned_at, a.started_at, a.submitted_at,
       a.completed_at, t.template_name, t.template_code, t.process_key, t.role_key,
       (SELECT MAX(net_wpm) FROM ats_typing_test_attempt x
        WHERE x.assessment_id = a.id AND x.submitted_at IS NOT NULL) AS best_net_wpm,
       (SELECT MAX(accuracy_percentage) FROM ats_typing_test_attempt x
        WHERE x.assessment_id = a.id AND x.submitted_at IS NOT NULL) AS best_accuracy,
       JSON_LENGTH(COALESCE(a.integrity_flags, JSON_ARRAY())) AS integrity_flag_count
     FROM ats_candidate_assessment a
     JOIN ats_candidate c ON c.id = a.candidate_id
     JOIN ats_assessment_template t ON t.id = a.template_id
     WHERE ${conditions.join(" AND ")}
     ORDER BY a.assigned_at DESC
     LIMIT ${limit} OFFSET ${offset}`,
    parameters,
  );
}

export async function getAssessmentAttemptDetail(attemptId: string) {
  await ensureReady();
  const attempts = await rows<AttemptRow>(
    db,
    `SELECT a.*, c.full_name AS candidate_name, c.candidate_code,
            c.mobile AS candidate_mobile,
            COALESCE(NULLIF(c.branch_display_name, ''), NULLIF(c.applied_for_branch, '')) AS branch_name,
            t.template_name, t.template_code, t.process_key, t.role_key,
            t.duration_minutes, t.passing_percentage
     FROM ats_candidate_assessment a
     JOIN ats_candidate c ON c.id = a.candidate_id
     JOIN ats_assessment_template t ON t.id = a.template_id
     WHERE a.id = ? LIMIT 1`,
    [attemptId],
  );
  const attempt = attempts[0];
  if (!attempt) throw appError("Assessment attempt not found", 404, "ASSESSMENT_NOT_FOUND");
  const template = await loadTemplate(attempt.template_id);
  const responses = await rows<ResponseRow>(
    db,
    `SELECT * FROM ats_assessment_response WHERE assessment_id = ? ORDER BY answered_at ASC`,
    [attempt.id],
  );
  const typing = await rows<TypingRow>(
    db,
    `SELECT * FROM ats_typing_test_attempt WHERE assessment_id = ? ORDER BY attempt_no ASC`,
    [attempt.id],
  );
  const audit = await rows<RowDataPacket>(
    db,
    `SELECT event_type, event_payload, actor_type, actor_id, ip_address, created_at
     FROM ats_assessment_audit_log
     WHERE assessment_id = ? ORDER BY created_at ASC`,
    [attempt.id],
  );
  return {
    attempt: {
      ...attempt,
      section_scores: parseJson(attempt.section_scores, {}),
      recommendation_json: parseJson(attempt.recommendation_json, null),
      integrity_flags: parseJson(attempt.integrity_flags, []),
      client_meta: parseJson(attempt.client_meta, {}),
    },
    template: attemptDefinition(attempt, template),
    responses: responses.map((response) => ({
      ...response,
      question_snapshot: parseJson(response.question_snapshot, {}),
      answer: answerValue(response),
    })),
    typingAttempts: typing.map((item) => ({
      ...serializeTyping(item),
      typedText: item.typed_text,
      referenceText: item.reference_text,
    })),
    audit: audit.map((item) => ({
      ...item,
      event_payload: parseJson(item.event_payload, {}),
    })),
  };
}

export async function reviewAssessment(input: {
  attemptId: string;
  reviewerId: string;
  scores: Array<{ questionId: string; marks: number; remarks?: string | null }>;
  decisionOverride?: "pass" | "fail" | null;
  reviewRemarks: string;
  meta?: Meta;
}) {
  await ensureReady();
  const connection = await db.getConnection();
  try {
    await connection.beginTransaction();
    const executor = connection as unknown as Executor;
    const attempt = await attemptById(input.attemptId, executor, true);
    if (attempt.status !== "manual_review") {
      throw appError("This assessment is not awaiting manual review", 409, "REVIEW_NOT_REQUIRED");
    }
    const template = await loadTemplate(attempt.template_id, executor);
    const definition = attemptDefinition(attempt, template);
    const manualQuestions = definition.questions.filter((question) => question.manualReview);
    const supplied = new Map(input.scores.map((score) => [score.questionId, score]));

    for (const question of manualQuestions) {
      const score = supplied.get(question.id);
      if (!score || !Number.isFinite(Number(score.marks))) {
        throw appError(`A score is required for ${question.id}`, 400, "REVIEW_SCORE_REQUIRED");
      }
      const marks = Number(score.marks);
      if (marks < 0 || marks > question.marks) {
        throw appError(
          `Score for ${question.id} must be between 0 and ${question.marks}`,
          400,
          "INVALID_REVIEW_SCORE",
        );
      }
      await connection.execute(
        `UPDATE ats_assessment_response
         SET marks_awarded = ?, evaluation_mode = 'manual', reviewed_by = ?,
             reviewed_at = NOW(), review_remarks = ?, evaluation_notes = 'Manually reviewed'
         WHERE assessment_id = ? AND question_id = ?`,
        [marks, input.reviewerId, String(score.remarks ?? "").slice(0, 2000) || null, attempt.id, question.id],
      );
    }

    const responses = await rows<ResponseRow>(
      executor,
      `SELECT * FROM ats_assessment_response WHERE assessment_id = ? FOR UPDATE`,
      [attempt.id],
    );
    const sections: Record<string, SectionScore> = {};
    let awarded = 0;
    let maximum = 0;
    for (const response of responses) {
      const snapshot = parseJson<AssessmentQuestionDefinition>(response.question_snapshot, {
        id: response.question_id,
        sectionKey: response.section_key,
        sectionTitle: response.section_key,
        type: response.question_type,
        prompt: response.question_id,
        marks: Number(response.max_marks),
        difficulty: "intermediate",
      });
      const marks = Number(response.marks_awarded ?? 0);
      const max = Number(response.max_marks ?? snapshot.marks ?? 0);
      awarded += marks;
      maximum += max;
      addSectionScore(sections, response.section_key, snapshot.sectionTitle ?? response.section_key, marks, max);
    }

    const bestTyping = await rows<TypingRow>(
      executor,
      `SELECT *
       FROM ats_typing_test_attempt
       WHERE assessment_id = ? AND submitted_at IS NOT NULL
       ORDER BY score_percentage DESC, attempt_no ASC
       LIMIT 1`,
      [attempt.id],
    );
    let typingPassed: boolean | null = null;
    if (definition.typing.required) {
      const typingMarks = round((Number(bestTyping[0]?.score_percentage ?? 0) / 100) * TYPING_WEIGHT_MARKS);
      awarded += typingMarks;
      maximum += TYPING_WEIGHT_MARKS;
      typingPassed = Boolean(bestTyping[0]?.passed_benchmark);
      addSectionScore(sections, "typing", "Typing Test", typingMarks, TYPING_WEIGHT_MARKS);
    }
    finishSectionScores(sections);

    const percentage = maximum ? round((awarded / maximum) * 100) : 0;
    const computedResult: "pass" | "fail" =
      percentage >= definition.passingPercentage && typingPassed !== false ? "pass" : "fail";
    const finalResult = input.decisionOverride ?? computedResult;
    if (input.decisionOverride && input.decisionOverride !== computedResult && !input.reviewRemarks.trim()) {
      throw appError("Review remarks are required when overriding the computed result", 400, "OVERRIDE_REASON_REQUIRED");
    }
    const recommendation = {
      decision: finalResult === "pass" ? "Recommended" : "Not recommended",
      process: definition.process,
      role: definition.role,
      typingPassed,
      computedResult,
      reviewedResult: finalResult,
      advisoryOnly: true,
    };

    await connection.execute(
      `UPDATE ats_candidate_assessment
       SET status = 'completed', result = ?, overall_score = ?, max_score = ?,
           percentage = ?, manual_review_required = 0, reviewed_by = ?, reviewed_at = NOW(),
           review_remarks = ?, section_scores = CAST(? AS JSON),
           recommendation_json = CAST(? AS JSON), completed_at = NOW()
       WHERE id = ?`,
      [
        finalResult,
        round(awarded),
        round(maximum),
        percentage,
        input.reviewerId,
        input.reviewRemarks.trim().slice(0, 2000),
        JSON.stringify(sections),
        JSON.stringify(recommendation),
        attempt.id,
      ],
    );
    await safeAudit(
      attempt.id,
      "ASSESSMENT_MANUAL_REVIEW_COMPLETED",
      { computedResult, finalResult, percentage },
      { ...input.meta, actorType: input.meta?.actorType ?? "hr", actorId: input.reviewerId },
      executor,
    );
    await connection.commit();
    return {
      status: "completed",
      result: finalResult,
      computedResult,
      percentage,
      score: round(awarded),
      maxScore: round(maximum),
      sectionScores: sections,
      recommendation,
    };
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

export async function getAssessmentDashboard() {
  await ensureReady();
  const metrics = await rows<RowDataPacket>(
    db,
    `SELECT
       COUNT(*) AS total_assigned,
       SUM(status = 'assigned') AS waiting_to_start,
       SUM(status = 'in_progress') AS in_progress,
       SUM(status = 'manual_review') AS awaiting_review,
       SUM(status = 'completed') AS completed,
       SUM(result = 'pass') AS passed,
       SUM(result = 'fail') AS failed,
       ROUND(AVG(CASE WHEN status = 'completed' THEN percentage END), 2) AS average_score,
       ROUND(100 * SUM(result = 'pass') / NULLIF(SUM(result IN ('pass','fail')), 0), 2) AS pass_rate
     FROM ats_candidate_assessment`,
  );
  const byProcess = await rows<RowDataPacket>(
    db,
    `SELECT t.process_key, t.role_key, COUNT(*) AS total,
            SUM(a.status = 'completed') AS completed,
            SUM(a.result = 'pass') AS passed,
            ROUND(AVG(CASE WHEN a.status = 'completed' THEN a.percentage END), 2) AS average_score
     FROM ats_candidate_assessment a
     JOIN ats_assessment_template t ON t.id = a.template_id
     GROUP BY t.process_key, t.role_key
     ORDER BY t.process_key, t.role_key`,
  );
  return { metrics: metrics[0] ?? {}, byProcess };
}

export async function listTemplates() {
  await ensureReady();
  const templates = await rows<TemplateRow>(
    db,
    `SELECT id, template_code, template_name, process_key, role_key, experience_level,
            difficulty_level, duration_minutes, passing_percentage, gate_mode,
            template_version, content_hash, config_json, source_type, active_status, created_at, updated_at
     FROM ats_assessment_template
     ORDER BY process_key, role_key, template_version DESC`,
  );
  return templates;
}

export async function setTemplateActive(templateId: string, active: boolean, actorId: string, meta: Meta = {}) {
  await ensureReady();
  const template = await loadTemplate(templateId);
  await db.execute(
    `UPDATE ats_assessment_template SET active_status = ? WHERE id = ?`,
    [active ? 1 : 0, templateId],
  );
  await safeAudit(
    templateId,
    "ASSESSMENT_TEMPLATE_STATUS_CHANGED",
    { templateCode: template.template_code, active },
    { ...meta, actorType: meta.actorType ?? "admin", actorId },
  );
  return { id: templateId, active };
}

export async function createCustomTemplate(
  definition: AssessmentTemplateDefinition,
  actorId: string,
) {
  await ensureReady();
  if (!definition.code?.trim() || !definition.name?.trim()) {
    throw appError("Template code and name are required", 400, "INVALID_TEMPLATE");
  }
  if (!Array.isArray(definition.questions) || definition.questions.length < 1) {
    throw appError("Template must contain at least one question", 400, "INVALID_TEMPLATE");
  }
  if (definition.typing.maxAttempts !== 2) {
    throw appError("Typing attempts must remain fixed at two", 400, "INVALID_TEMPLATE");
  }
  const code = definition.code.trim().toUpperCase().replace(/[^A-Z0-9_-]/g, "-").slice(0, 100);
  const existing = await rows<TemplateRow>(
    db,
    `SELECT * FROM ats_assessment_template WHERE template_code = ? ORDER BY template_version DESC LIMIT 1`,
    [code],
  );
  const version = Number(existing[0]?.template_version ?? 0) + 1;
  const hash = contentHash({ ...definition, code });
  const id = randomUUID();
  await db.execute(
    `UPDATE ats_assessment_template SET active_status = 0 WHERE template_code = ? AND source_type = 'custom'`,
    [code],
  );
  await db.execute(
    `INSERT INTO ats_assessment_template (
      id, template_code, template_name, process_key, role_key, experience_level,
      difficulty_level, duration_minutes, passing_percentage, gate_mode,
      template_version, content_hash, config_json, source_type, active_status, created_by
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'advisory', ?, ?, CAST(? AS JSON), 'custom', 1, ?)`,
    [
      id,
      code,
      definition.name.trim(),
      definition.process,
      definition.role,
      definition.experienceLevel ?? "any",
      definition.difficulty,
      definition.durationMinutes,
      definition.passingPercentage,
      version,
      hash,
      JSON.stringify({ ...definition, code }),
      actorId,
    ],
  );
  return { id, code, version };
}

export async function listMappings() {
  await ensureReady();
  return rows<MappingRow>(
    db,
    `SELECT m.*, t.template_code, t.template_name, t.process_key, t.role_key
     FROM ats_assessment_mapping m
     JOIN ats_assessment_template t ON t.id = m.template_id
     ORDER BY m.active_status DESC, m.priority ASC, m.mapping_name ASC`,
  );
}

export async function saveMapping(
  input: {
    id?: string;
    mappingName: string;
    branchName?: string | null;
    processMatch?: string | null;
    roleMatch?: string | null;
    experienceMatch?: string | null;
    vacancyId?: string | null;
    templateId: string;
    priority?: number;
    mandatoryFlag?: boolean;
    activeStatus?: boolean;
  },
  actorId: string,
) {
  await ensureReady();
  await loadTemplate(input.templateId);
  const id = input.id || randomUUID();
  const priority = Math.max(-10_000, Math.min(10_000, Math.floor(Number(input.priority ?? 100))));
  await db.execute(
    `INSERT INTO ats_assessment_mapping (
      id, mapping_name, branch_name, process_match, role_match, experience_match,
      vacancy_id, template_id, priority, mandatory_flag, active_status, created_by
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON DUPLICATE KEY UPDATE
      mapping_name = VALUES(mapping_name), branch_name = VALUES(branch_name),
      process_match = VALUES(process_match), role_match = VALUES(role_match),
      experience_match = VALUES(experience_match), vacancy_id = VALUES(vacancy_id),
      template_id = VALUES(template_id), priority = VALUES(priority),
      mandatory_flag = VALUES(mandatory_flag), active_status = VALUES(active_status),
      updated_at = NOW()`,
    [
      id,
      input.mappingName.trim().slice(0, 255),
      input.branchName?.trim() || null,
      input.processMatch?.trim() || null,
      input.roleMatch?.trim() || null,
      input.experienceMatch?.trim() || null,
      input.vacancyId?.trim() || null,
      input.templateId,
      priority,
      input.mandatoryFlag ? 1 : 0,
      input.activeStatus === false ? 0 : 1,
      actorId,
    ],
  );
  return { id };
}

export async function setMappingActive(mappingId: string, active: boolean) {
  await ensureReady();
  await db.execute(`UPDATE ats_assessment_mapping SET active_status = ? WHERE id = ?`, [active ? 1 : 0, mappingId]);
  return { id: mappingId, active };
}

export async function cancelUnstartedAssessment(
  attemptId: string,
  actorId: string,
  reason: string,
  meta: Meta = {},
) {
  await ensureReady();
  if (!reason.trim()) throw appError("Cancellation reason is required", 400, "REASON_REQUIRED");
  const result = await db.execute(
    `UPDATE ats_candidate_assessment
     SET status = 'cancelled', failure_reason = ?
     WHERE id = ? AND status = 'assigned'`,
    [reason.trim().slice(0, 1000), attemptId],
  );
  const affected = Number((result as any)?.[0]?.affectedRows ?? 0);
  if (!affected) throw appError("Only an unstarted assessment can be cancelled", 409, "ASSESSMENT_CANNOT_BE_CANCELLED");
  await safeAudit(
    attemptId,
    "ASSESSMENT_CANCELLED",
    { reason },
    { ...meta, actorType: meta.actorType ?? "admin", actorId },
  );
  return { cancelled: true };
}

const OTP_TTL_SECONDS = 300;
const OTP_MAX_ATTEMPTS = 3;

function generateOtp(): string {
  const digits = Array.from({ length: 6 }, () => randomInt(0, 10));
  return digits.join("");
}

function maskMobile(mobile: string | null): string | null {
  if (!mobile) return null;
  return mobile.slice(0, 2) + "XXXXXX" + mobile.slice(-2);
}

function maskEmail(email: string | null): string | null {
  if (!email) return null;
  const [local, domain] = email.split("@");
  if (!local || !domain) return null;
  const visible = local.length > 2 ? local.slice(0, 2) : local.slice(0, 1);
  return visible + "****@" + domain;
}

export async function issueIdentityOtp(token: string, meta: Meta = {}) {
  await ensureReady();
  const attempt = await attemptByToken(token);

  if (attempt.status !== "assigned") {
    throw appError("Assessment is not in a state that requires identity verification", 409, "IDENTITY_OTP_NOT_APPLICABLE");
  }
  if ((attempt as unknown as { identity_verified: number }).identity_verified) {
    return { alreadyVerified: true, mobileMasked: null, emailMasked: null };
  }

  const candidate = await rows<CandidateRow>(
    db,
    `SELECT id, mobile, email, full_name, candidate_code,
            aadhar_number_masked, pan_number_masked, bank_account_no_masked
     FROM ats_candidate WHERE id = ? LIMIT 1`,
    [attempt.candidate_id],
  );
  const mobile = candidate[0]?.mobile ?? null;
  const email = candidate[0]?.email ?? null;
  const mobileMasked = maskMobile(mobile);
  const emailMasked = maskEmail(email);

  // Expire any prior unverified OTPs for this attempt so only the newest is active
  await db.execute(
    `UPDATE ats_identity_otp SET expires_at = NOW() WHERE assessment_id = ? AND verified = 0`,
    [attempt.id],
  );

  const otp = generateOtp();
  const otpHash = sha256(attempt.id + ":" + otp);

  const smsEnabled = process.env.ATS_OTP_SMS_ENABLED === "true";
  // Email delivery uses the project's existing SMTP config — enabled by default if SMTP is configured
  const emailEnabled = process.env.ATS_OTP_EMAIL_ENABLED !== "false" && emailService.isConfigured();

  let channel: "sms" | "email" | "sms_email" | "display";
  if (smsEnabled && emailEnabled) channel = "sms_email";
  else if (smsEnabled) channel = "sms";
  else if (emailEnabled) channel = "email";
  else channel = "display";

  await db.execute(
    `INSERT INTO ats_identity_otp
       (id, assessment_id, candidate_id, otp_hash, channel, mobile_masked, email_masked, expires_at, ip_address)
     VALUES (?, ?, ?, ?, ?, ?, ?, DATE_ADD(NOW(), INTERVAL ? SECOND), ?)`,
    [
      randomUUID(),
      attempt.id,
      attempt.candidate_id,
      otpHash,
      channel,
      mobileMasked,
      emailMasked,
      OTP_TTL_SECONDS,
      meta.ip ?? null,
    ],
  );

  await safeAudit(attempt.id, "IDENTITY_OTP_ISSUED", { channel, mobileMasked, emailMasked }, meta);

  // --- Delivery ---
  if (smsEnabled && mobile) {
    // Plug your SMS gateway here: sendSms(mobile, `Your MAS Callnet assessment OTP is ${otp}`)
    console.info(`[OTP-SMS] ${attempt.id} → ${mobileMasked}`);
  }
  if (emailEnabled && email) {
    if (emailService.isConfigured()) {
      await emailService.send({
        to: email,
        subject: "Your MAS Callnet Assessment OTP",
        html: `
          <div style="font-family:Inter,Arial,sans-serif;max-width:520px;margin:auto;padding:32px 24px;background:#f4f7fa;border-radius:12px">
            <div style="background:#102f50;border-radius:8px 8px 0 0;padding:20px 24px">
              <h2 style="color:#fff;margin:0;font-size:18px">MAS Callnet — Candidate Assessment</h2>
            </div>
            <div style="background:#fff;border-radius:0 0 8px 8px;padding:24px">
              <p style="margin:0 0 16px;color:#122033">Hello <b>${candidate[0]?.full_name ?? "Candidate"}</b>,</p>
              <p style="margin:0 0 16px;color:#122033">Use the OTP below to verify your identity and begin your assessment:</p>
              <div style="text-align:center;margin:24px 0">
                <span style="display:inline-block;font-size:36px;font-weight:900;letter-spacing:10px;color:#0c7c72;background:#eaf7f5;padding:16px 32px;border-radius:10px">${otp}</span>
              </div>
              <p style="margin:0 0 8px;color:#66788a;font-size:13px">This OTP is valid for <b>${Math.floor(OTP_TTL_SECONDS / 60)} minutes</b>.</p>
              <p style="margin:0;color:#66788a;font-size:13px">Do not share this OTP with anyone. MAS Callnet staff will never ask for your OTP.</p>
            </div>
          </div>`,
        text: `Your MAS Callnet assessment OTP is: ${otp}\nValid for ${Math.floor(OTP_TTL_SECONDS / 60)} minutes. Do not share this with anyone.`,
      }).catch((err: unknown) => {
        console.error("[OTP-EMAIL] delivery failed", { assessmentId: attempt.id, emailMasked, err });
      });
    } else {
      console.warn("[OTP-EMAIL] email not configured — OTP not sent to candidate");
    }
  }

  return {
    alreadyVerified: false,
    mobileMasked,
    emailMasked,
    channel,
    // Only returned when no delivery channel is configured (display/kiosk mode)
    displayOtp: channel === "display" ? otp : undefined,
    expiresInSeconds: OTP_TTL_SECONDS,
  };
}

export async function verifyIdentityOtp(token: string, otp: string, meta: Meta = {}) {
  await ensureReady();
  const attempt = await attemptByToken(token);

  if ((attempt as unknown as { identity_verified: number }).identity_verified) {
    return { verified: true, alreadyVerified: true, channel: null };
  }

  const cleanOtp = String(otp ?? "").trim();
  const expectedHash = sha256(attempt.id + ":" + cleanOtp);

  const otpRows = await rows<
    RowDataPacket & { id: string; otp_hash: string; verified: number; attempt_count: number; expires_at: Date | string }
  >(
    db,
    `SELECT id, otp_hash, verified, attempt_count, expires_at
     FROM ats_identity_otp
     WHERE assessment_id = ? AND verified = 0
     ORDER BY created_at DESC LIMIT 1`,
    [attempt.id],
  );

  const record = otpRows[0];
  if (!record) {
    throw appError("No active OTP found. Request a new one.", 404, "IDENTITY_OTP_NOT_FOUND");
  }

  const expiry = dateMs(record.expires_at);
  if (expiry !== null && expiry <= Date.now()) {
    throw appError("OTP has expired. Request a new one.", 410, "IDENTITY_OTP_EXPIRED");
  }

  if (record.attempt_count >= OTP_MAX_ATTEMPTS) {
    throw appError("Maximum OTP attempts exceeded. Request a new one.", 429, "IDENTITY_OTP_MAX_ATTEMPTS");
  }

  await db.execute(
    `UPDATE ats_identity_otp SET attempt_count = attempt_count + 1 WHERE id = ?`,
    [record.id],
  );

  if (!safeEqual(record.otp_hash, expectedHash)) {
    const remaining = OTP_MAX_ATTEMPTS - record.attempt_count - 1;
    throw appError(`Incorrect OTP. ${remaining} attempt(s) remaining.`, 400, "IDENTITY_OTP_INCORRECT");
  }

  await db.execute(
    `UPDATE ats_identity_otp SET verified = 1, verified_at = NOW() WHERE id = ?`,
    [record.id],
  );
  await db.execute(
    `UPDATE ats_candidate_assessment SET identity_verified = 1, identity_verified_at = NOW() WHERE id = ?`,
    [attempt.id],
  );

  await safeAudit(attempt.id, "IDENTITY_VERIFIED", { method: "otp" }, { ...meta, actorType: "candidate" });

  return { verified: true, alreadyVerified: false };
}

export const assessmentService = {
  isAssessmentEnabled,
  ensureAssessmentSchema,
  syncDefaultTemplates,
  lookupOrAssignAssessment,
  assignAssessmentManually,
  getAssessmentSession,
  startAssessment,
  saveResponse,
  recordIntegrityEvent,
  startTypingAttempt,
  submitTypingAttempt,
  submitAssessment,
  getAssessmentResult,
  getCandidateAssessmentSummary,
  listAssessmentAttempts,
  getAssessmentAttemptDetail,
  reviewAssessment,
  getAssessmentDashboard,
  listTemplates,
  setTemplateActive,
  createCustomTemplate,
  listMappings,
  saveMapping,
  setMappingActive,
  cancelUnstartedAssessment,
  issueIdentityOtp,
  verifyIdentityOtp,
};
