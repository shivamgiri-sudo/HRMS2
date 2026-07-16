import { db } from '../../db/mysql.js';

const TABLES = [
`CREATE TABLE IF NOT EXISTS ats_assessment_template (
 id CHAR(36) PRIMARY KEY, template_code VARCHAR(100) NOT NULL UNIQUE, template_name VARCHAR(255) NOT NULL,
 process_key ENUM('inbound','outbound','backoffice','document','email') NOT NULL,
 role_key ENUM('executive','team_leader','quality_auditor') NOT NULL,
 duration_minutes INT NOT NULL DEFAULT 30, passing_percentage DECIMAL(5,2) NOT NULL DEFAULT 60,
 template_version INT NOT NULL DEFAULT 1, config_json JSON NOT NULL, active_status TINYINT(1) NOT NULL DEFAULT 1,
 created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
 INDEX idx_aat_lookup(process_key,role_key,active_status))`,
`CREATE TABLE IF NOT EXISTS ats_candidate_assessment (
 id CHAR(36) PRIMARY KEY, candidate_id CHAR(36) NOT NULL, queue_token_id CHAR(36) NULL, q_token_snapshot VARCHAR(100) NULL,
 template_id CHAR(36) NOT NULL, template_version INT NOT NULL DEFAULT 1, public_token_hash CHAR(64) NULL UNIQUE,
 status ENUM('assigned','in_progress','manual_review','completed','technical_error','expired','cancelled','skipped') NOT NULL DEFAULT 'assigned',
 attempt_no TINYINT UNSIGNED NOT NULL DEFAULT 1, typing_attempts_used TINYINT UNSIGNED NOT NULL DEFAULT 0,
 assigned_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, started_at DATETIME NULL, submitted_at DATETIME NULL, completed_at DATETIME NULL,
 expires_at DATETIME NULL, overall_score DECIMAL(8,2) NULL, max_score DECIMAL(8,2) NULL, percentage DECIMAL(5,2) NULL,
 result ENUM('pass','fail','pending_review') NULL, section_scores JSON NULL, recommendation_json JSON NULL,
 integrity_flags JSON NULL, client_meta JSON NULL, failure_reason VARCHAR(500) NULL,
 created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
 UNIQUE KEY uq_aca_once(candidate_id,queue_token_id,template_id,attempt_no), INDEX idx_aca_candidate(candidate_id,status), INDEX idx_aca_status(status,assigned_at))`,
`CREATE TABLE IF NOT EXISTS ats_assessment_response (
 id CHAR(36) PRIMARY KEY, assessment_id CHAR(36) NOT NULL, question_id VARCHAR(120) NOT NULL, section_key VARCHAR(100) NOT NULL,
 question_type VARCHAR(40) NOT NULL, answer_json JSON NULL, answer_text LONGTEXT NULL, marks_awarded DECIMAL(8,2) NULL,
 max_marks DECIMAL(8,2) NOT NULL DEFAULT 0, evaluation_mode ENUM('auto','keyword','manual') NOT NULL DEFAULT 'auto',
 evaluation_notes VARCHAR(1000) NULL, time_taken_seconds INT NULL, answered_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
 created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
 UNIQUE KEY uq_aar_question(assessment_id,question_id), INDEX idx_aar_section(assessment_id,section_key))`,
`CREATE TABLE IF NOT EXISTS ats_typing_test_attempt (
 id CHAR(36) PRIMARY KEY, assessment_id CHAR(36) NOT NULL, attempt_no TINYINT UNSIGNED NOT NULL, reference_text LONGTEXT NOT NULL,
 typed_text LONGTEXT NULL, duration_limit_seconds INT NOT NULL DEFAULT 180, elapsed_seconds INT NULL,
 started_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, submitted_at DATETIME NULL, gross_wpm DECIMAL(8,2) NULL,
 net_wpm DECIMAL(8,2) NULL, accuracy_percentage DECIMAL(5,2) NULL, correct_characters INT NULL,
 incorrect_characters INT NULL, missing_characters INT NULL, extra_characters INT NULL, correct_words INT NULL,
 incorrect_words INT NULL, backspace_count INT NOT NULL DEFAULT 0, paste_attempts INT NOT NULL DEFAULT 0,
 score_percentage DECIMAL(5,2) NULL, result_json JSON NULL,
 created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
 UNIQUE KEY uq_atta_attempt(assessment_id,attempt_no), INDEX idx_atta_assessment(assessment_id,submitted_at))`,
`CREATE TABLE IF NOT EXISTS ats_assessment_audit_log (
 id CHAR(36) PRIMARY KEY, assessment_id CHAR(36) NOT NULL, event_type VARCHAR(80) NOT NULL, event_payload JSON NULL,
 actor_type ENUM('candidate','system','recruiter','hr','admin') NOT NULL DEFAULT 'system', actor_id VARCHAR(100) NULL,
 ip_address VARCHAR(64) NULL, user_agent VARCHAR(1000) NULL, created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
 INDEX idx_aaal_assessment(assessment_id,created_at), INDEX idx_aaal_event(event_type,created_at))`,
];

let ready: Promise<void> | null = null;
async function addColumnIfMissing(table: string, column: string, definition: string) {
 const [rows] = await db.execute<any[]>(`SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME=? AND COLUMN_NAME=? LIMIT 1`,[table,column]);
 if (!rows.length) await db.execute(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
}
export function ensureAssessmentSchema(){
 if (!ready) ready=(async()=>{ for(const sql of TABLES) await db.execute(sql); await addColumnIfMissing('ats_interview_submission','assessment_attempt_id','CHAR(36) NULL'); await addColumnIfMissing('ats_interview_submission','assessment_snapshot_json','JSON NULL'); await addColumnIfMissing('ats_interview_submission','assessment_override_reason','VARCHAR(500) NULL'); })().catch(e=>{ready=null;throw e;});
 return ready;
}
