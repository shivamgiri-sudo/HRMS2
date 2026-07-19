import type { RowDataPacket } from "mysql2/promise";
import { db } from "../../db/mysql.js";

const TABLE_DDL = [
  `CREATE TABLE IF NOT EXISTS ats_question_bank (
    id CHAR(36) NOT NULL PRIMARY KEY,
    question_code VARCHAR(120) NOT NULL,
    process_key ENUM('inbound','outbound','backoffice','document','email','any') NOT NULL DEFAULT 'any',
    role_key ENUM('executive','team_leader','quality_auditor','any') NOT NULL DEFAULT 'any',
    section_key VARCHAR(100) NOT NULL,
    section_title VARCHAR(255) NOT NULL,
    question_type ENUM('single','multi','text') NOT NULL DEFAULT 'single',
    difficulty_level ENUM('basic','intermediate','advanced') NOT NULL DEFAULT 'intermediate',
    prompt TEXT NOT NULL,
    options_json JSON NULL,
    correct_answer_json JSON NULL,
    keywords_json JSON NULL,
    explanation TEXT NULL,
    marks DECIMAL(6,2) NOT NULL DEFAULT 10,
    manual_review TINYINT(1) NOT NULL DEFAULT 0,
    set_number INT UNSIGNED NOT NULL DEFAULT 1,
    active_status TINYINT(1) NOT NULL DEFAULT 1,
    usage_count INT UNSIGNED NOT NULL DEFAULT 0,
    created_by CHAR(36) NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY uq_question_code (question_code),
    INDEX idx_question_bank_lookup (process_key, role_key, section_key, active_status, set_number),
    INDEX idx_question_bank_difficulty (difficulty_level, active_status)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
  `CREATE TABLE IF NOT EXISTS ats_typing_passage_bank (
    id CHAR(36) NOT NULL PRIMARY KEY,
    passage_code VARCHAR(100) NOT NULL,
    process_key ENUM('inbound','outbound','backoffice','document','email','any') NOT NULL DEFAULT 'any',
    role_key ENUM('executive','team_leader','quality_auditor','any') NOT NULL DEFAULT 'any',
    difficulty_level ENUM('basic','intermediate','advanced') NOT NULL DEFAULT 'intermediate',
    title VARCHAR(255) NOT NULL,
    passage_text LONGTEXT NOT NULL,
    word_count INT UNSIGNED NOT NULL DEFAULT 0,
    character_count INT UNSIGNED NOT NULL DEFAULT 0,
    recommended_duration_seconds INT UNSIGNED NOT NULL DEFAULT 180,
    min_wpm_benchmark INT UNSIGNED NOT NULL DEFAULT 30,
    min_accuracy_benchmark DECIMAL(5,2) NOT NULL DEFAULT 92,
    set_number INT UNSIGNED NOT NULL DEFAULT 1,
    active_status TINYINT(1) NOT NULL DEFAULT 1,
    usage_count INT UNSIGNED NOT NULL DEFAULT 0,
    created_by CHAR(36) NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY uq_passage_code (passage_code),
    INDEX idx_passage_bank_lookup (process_key, role_key, active_status, set_number)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
  `CREATE TABLE IF NOT EXISTS ats_assessment_template (
    id CHAR(36) NOT NULL PRIMARY KEY,
    template_code VARCHAR(100) NOT NULL,
    template_name VARCHAR(255) NOT NULL,
    process_key ENUM('inbound','outbound','backoffice','document','email') NOT NULL,
    role_key ENUM('executive','team_leader','quality_auditor') NOT NULL,
    experience_level ENUM('any','fresher','experienced') NOT NULL DEFAULT 'any',
    difficulty_level ENUM('basic','intermediate','advanced') NOT NULL DEFAULT 'intermediate',
    duration_minutes INT UNSIGNED NOT NULL DEFAULT 30,
    passing_percentage DECIMAL(5,2) NOT NULL DEFAULT 60,
    gate_mode ENUM('advisory','soft_gate','hard_gate') NOT NULL DEFAULT 'advisory',
    template_version INT UNSIGNED NOT NULL DEFAULT 1,
    content_hash CHAR(64) NOT NULL,
    config_json JSON NOT NULL,
    source_type ENUM('built_in','custom') NOT NULL DEFAULT 'built_in',
    active_status TINYINT(1) NOT NULL DEFAULT 1,
    effective_from DATETIME NULL,
    effective_to DATETIME NULL,
    created_by CHAR(36) NULL,
    approved_by CHAR(36) NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY uq_assessment_template_version (template_code, template_version),
    UNIQUE KEY uq_assessment_template_hash (template_code, content_hash),
    INDEX idx_assessment_template_lookup (process_key, role_key, experience_level, active_status)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
  `CREATE TABLE IF NOT EXISTS ats_assessment_mapping (
    id CHAR(36) NOT NULL PRIMARY KEY,
    mapping_name VARCHAR(255) NOT NULL,
    branch_name VARCHAR(255) NULL,
    process_match VARCHAR(255) NULL,
    role_match VARCHAR(255) NULL,
    experience_match VARCHAR(100) NULL,
    vacancy_id CHAR(36) NULL,
    template_id CHAR(36) NOT NULL,
    priority INT NOT NULL DEFAULT 100,
    mandatory_flag TINYINT(1) NOT NULL DEFAULT 0,
    active_status TINYINT(1) NOT NULL DEFAULT 1,
    effective_from DATETIME NULL,
    effective_to DATETIME NULL,
    created_by CHAR(36) NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_assessment_mapping_match (active_status, branch_name, process_match, role_match, priority),
    INDEX idx_assessment_mapping_template (template_id)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
  `CREATE TABLE IF NOT EXISTS ats_candidate_assessment (
    id CHAR(36) NOT NULL PRIMARY KEY,
    candidate_id CHAR(36) NOT NULL,
    queue_token_id CHAR(36) NULL,
    cycle_key VARCHAR(120) NOT NULL,
    q_token_snapshot VARCHAR(100) NULL,
    template_id CHAR(36) NOT NULL,
    template_version INT UNSIGNED NOT NULL DEFAULT 1,
    public_token_hash CHAR(64) NOT NULL,
    status ENUM('assigned','in_progress','submitted_pending_scoring','manual_review','completed','technical_error','expired','cancelled','skipped') NOT NULL DEFAULT 'assigned',
    attempt_no TINYINT UNSIGNED NOT NULL DEFAULT 1,
    typing_attempts_used TINYINT UNSIGNED NOT NULL DEFAULT 0,
    assignment_source ENUM('automatic','mapping','manual','kiosk') NOT NULL DEFAULT 'automatic',
    assigned_by CHAR(36) NULL,
    assigned_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    started_at DATETIME NULL,
    submitted_at DATETIME NULL,
    completed_at DATETIME NULL,
    expires_at DATETIME NULL,
    overall_score DECIMAL(8,2) NULL,
    max_score DECIMAL(8,2) NULL,
    percentage DECIMAL(5,2) NULL,
    result ENUM('pass','fail','pending_review') NULL,
    manual_review_required TINYINT(1) NOT NULL DEFAULT 0,
    reviewed_by CHAR(36) NULL,
    reviewed_at DATETIME NULL,
    review_remarks VARCHAR(2000) NULL,
    section_scores JSON NULL,
    recommendation_json JSON NULL,
    integrity_flags JSON NULL,
    client_meta JSON NULL,
    failure_reason VARCHAR(1000) NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY uq_candidate_assessment_cycle (candidate_id, cycle_key, template_id, attempt_no),
    UNIQUE KEY uq_candidate_assessment_public_hash (public_token_hash),
    INDEX idx_candidate_assessment_candidate (candidate_id, status),
    INDEX idx_candidate_assessment_queue (queue_token_id),
    INDEX idx_candidate_assessment_status (status, assigned_at),
    INDEX idx_candidate_assessment_review (manual_review_required, status, submitted_at)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
  `CREATE TABLE IF NOT EXISTS ats_assessment_response (
    id CHAR(36) NOT NULL PRIMARY KEY,
    assessment_id CHAR(36) NOT NULL,
    question_id VARCHAR(120) NOT NULL,
    section_key VARCHAR(100) NOT NULL,
    question_type ENUM('single','multi','text') NOT NULL,
    question_snapshot JSON NOT NULL,
    answer_json JSON NULL,
    answer_text LONGTEXT NULL,
    marks_awarded DECIMAL(8,2) NULL,
    max_marks DECIMAL(8,2) NOT NULL DEFAULT 0,
    evaluation_mode ENUM('auto','keyword','manual') NOT NULL DEFAULT 'auto',
    evaluation_notes VARCHAR(2000) NULL,
    time_taken_seconds INT UNSIGNED NULL,
    answered_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    reviewed_by CHAR(36) NULL,
    reviewed_at DATETIME NULL,
    review_remarks VARCHAR(2000) NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY uq_assessment_question (assessment_id, question_id),
    INDEX idx_assessment_response_section (assessment_id, section_key),
    INDEX idx_assessment_response_review (assessment_id, evaluation_mode, reviewed_at)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
  `CREATE TABLE IF NOT EXISTS ats_typing_test_attempt (
    id CHAR(36) NOT NULL PRIMARY KEY,
    assessment_id CHAR(36) NOT NULL,
    attempt_no TINYINT UNSIGNED NOT NULL,
    reference_text LONGTEXT NOT NULL,
    typed_text LONGTEXT NULL,
    duration_limit_seconds INT UNSIGNED NOT NULL DEFAULT 180,
    elapsed_seconds INT UNSIGNED NULL,
    started_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    submitted_at DATETIME NULL,
    gross_wpm DECIMAL(8,2) NULL,
    net_wpm DECIMAL(8,2) NULL,
    accuracy_percentage DECIMAL(5,2) NULL,
    edit_distance INT UNSIGNED NULL,
    correct_characters INT UNSIGNED NULL,
    incorrect_characters INT UNSIGNED NULL,
    missing_characters INT UNSIGNED NULL,
    extra_characters INT UNSIGNED NULL,
    correct_words INT UNSIGNED NULL,
    incorrect_words INT UNSIGNED NULL,
    backspace_count INT UNSIGNED NOT NULL DEFAULT 0,
    paste_attempts INT UNSIGNED NOT NULL DEFAULT 0,
    score_percentage DECIMAL(5,2) NULL,
    passed_benchmark TINYINT(1) NULL,
    result_json JSON NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY uq_typing_assessment_attempt (assessment_id, attempt_no),
    INDEX idx_typing_assessment (assessment_id, submitted_at)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
  `CREATE TABLE IF NOT EXISTS ats_identity_otp (
    id CHAR(36) NOT NULL PRIMARY KEY,
    assessment_id CHAR(36) NOT NULL,
    candidate_id CHAR(36) NOT NULL,
    otp_hash CHAR(64) NOT NULL,
    channel ENUM('sms','email','sms_email','display') NOT NULL DEFAULT 'display',
    mobile_masked VARCHAR(20) NULL,
    email_masked VARCHAR(100) NULL,
    verified TINYINT(1) NOT NULL DEFAULT 0,
    attempt_count TINYINT UNSIGNED NOT NULL DEFAULT 0,
    issued_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    expires_at DATETIME NOT NULL,
    verified_at DATETIME NULL,
    ip_address VARCHAR(64) NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_identity_otp_assessment (assessment_id, verified, expires_at),
    INDEX idx_identity_otp_candidate (candidate_id, issued_at)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
  `CREATE TABLE IF NOT EXISTS ats_assessment_audit_log (
    id CHAR(36) NOT NULL PRIMARY KEY,
    assessment_id CHAR(36) NOT NULL,
    event_type VARCHAR(100) NOT NULL,
    event_payload JSON NULL,
    actor_type ENUM('candidate','system','recruiter','hr','admin') NOT NULL DEFAULT 'system',
    actor_id VARCHAR(100) NULL,
    ip_address VARCHAR(64) NULL,
    user_agent VARCHAR(1000) NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_assessment_audit (assessment_id, created_at),
    INDEX idx_assessment_audit_event (event_type, created_at),
    INDEX idx_assessment_audit_actor (actor_type, actor_id, created_at)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
];

type ColumnRow = RowDataPacket & { COLUMN_TYPE?: string; IS_NULLABLE?: string };
type IndexRow = RowDataPacket & { INDEX_NAME: string };

let ready: Promise<void> | null = null;

async function columnExists(table: string, column: string) {
  const [rows] = await db.execute<ColumnRow[]>(
    `SELECT COLUMN_TYPE, IS_NULLABLE
     FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?
     LIMIT 1`,
    [table, column],
  );
  return rows[0] ?? null;
}

async function addColumnIfMissing(table: string, column: string, definition: string) {
  if (!(await columnExists(table, column))) {
    await db.execute(`ALTER TABLE \`${table}\` ADD COLUMN \`${column}\` ${definition}`);
  }
}

async function indexExists(table: string, indexName: string) {
  const [rows] = await db.execute<IndexRow[]>(
    `SELECT DISTINCT INDEX_NAME
     FROM information_schema.STATISTICS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND INDEX_NAME = ?`,
    [table, indexName],
  );
  return rows.length > 0;
}

async function addIndexIfMissing(table: string, indexName: string, expression: string) {
  if (!(await indexExists(table, indexName))) {
    await db.execute(`ALTER TABLE \`${table}\` ADD ${expression}`);
  }
}

async function upgradeEarlierDraftSchema() {
  await addColumnIfMissing("ats_assessment_template", "experience_level", "ENUM('any','fresher','experienced') NOT NULL DEFAULT 'any'");
  await addColumnIfMissing("ats_assessment_template", "difficulty_level", "ENUM('basic','intermediate','advanced') NOT NULL DEFAULT 'intermediate'");
  await addColumnIfMissing("ats_assessment_template", "gate_mode", "ENUM('advisory','soft_gate','hard_gate') NOT NULL DEFAULT 'advisory'");
  await addColumnIfMissing("ats_assessment_template", "content_hash", "CHAR(64) NULL");
  await addColumnIfMissing("ats_assessment_template", "source_type", "ENUM('built_in','custom') NOT NULL DEFAULT 'built_in'");
  await db.execute(
    `UPDATE ats_assessment_template
     SET content_hash = SHA2(CAST(config_json AS CHAR), 256)
     WHERE content_hash IS NULL OR content_hash = ''`,
  );

  await addColumnIfMissing("ats_candidate_assessment", "cycle_key", "VARCHAR(120) NULL");
  await db.execute(
    `UPDATE ats_candidate_assessment
     SET cycle_key = COALESCE(NULLIF(q_token_snapshot, ''), queue_token_id, id)
     WHERE cycle_key IS NULL OR cycle_key = ''`,
  );
  await addColumnIfMissing("ats_candidate_assessment", "assignment_source", "ENUM('automatic','mapping','manual','kiosk') NOT NULL DEFAULT 'automatic'");
  await addColumnIfMissing("ats_candidate_assessment", "assigned_by", "CHAR(36) NULL");
  await addColumnIfMissing("ats_candidate_assessment", "manual_review_required", "TINYINT(1) NOT NULL DEFAULT 0");
  await addColumnIfMissing("ats_candidate_assessment", "reviewed_by", "CHAR(36) NULL");
  await addColumnIfMissing("ats_candidate_assessment", "reviewed_at", "DATETIME NULL");
  await addColumnIfMissing("ats_candidate_assessment", "review_remarks", "VARCHAR(2000) NULL");

  await addColumnIfMissing("ats_assessment_response", "question_snapshot", "JSON NULL");
  await db.execute(
    `UPDATE ats_assessment_response
     SET question_snapshot = JSON_OBJECT(
       'id', question_id,
       'sectionKey', section_key,
       'type', question_type,
       'marks', max_marks
     )
     WHERE question_snapshot IS NULL`,
  );
  await addColumnIfMissing("ats_assessment_response", "review_remarks", "VARCHAR(2000) NULL");

  await addColumnIfMissing("ats_candidate_assessment", "config_snapshot", "JSON NULL");
  await addColumnIfMissing("ats_candidate_assessment", "identity_verified", "TINYINT(1) NOT NULL DEFAULT 0");
  await addColumnIfMissing("ats_candidate_assessment", "identity_verified_at", "DATETIME NULL");

  await addColumnIfMissing("ats_typing_test_attempt", "edit_distance", "INT UNSIGNED NULL");
  await addColumnIfMissing("ats_typing_test_attempt", "passed_benchmark", "TINYINT(1) NULL");

  await addIndexIfMissing(
    "ats_candidate_assessment",
    "uq_candidate_assessment_cycle",
    "UNIQUE KEY `uq_candidate_assessment_cycle` (`candidate_id`,`cycle_key`,`template_id`,`attempt_no`)",
  );
  await addIndexIfMissing(
    "ats_candidate_assessment",
    "idx_candidate_assessment_review",
    "INDEX `idx_candidate_assessment_review` (`manual_review_required`,`status`,`submitted_at`)",
  );
}

export function ensureAssessmentSchema() {
  if (!ready) {
    ready = (async () => {
      for (const statement of TABLE_DDL) await db.execute(statement);
      await upgradeEarlierDraftSchema();
    })().catch((error) => {
      ready = null;
      throw error;
    });
  }
  return ready;
}
