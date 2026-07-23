-- =====================================================
-- Engagement & Gamification Schema
-- File: 038_engagement_gamification.sql
-- Description: 11 tables for badges, points, tiers, kudos, surveys, pulse checks
-- =====================================================

-- =====================================================
-- 0. SCHEMA COMPATIBILITY FOR gamification_badge_master
--    Production tables were created from a pre-038 schema that used
--    different column names. Handle ALL differences here so that
--    the CREATE TABLE IF NOT EXISTS and INSERTs below always succeed.
-- =====================================================

-- 0a. Rename id -> badge_id (only when id exists and badge_id does not)
SET @has_old = (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='gamification_badge_master' AND COLUMN_NAME='id');
SET @has_new = (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='gamification_badge_master' AND COLUMN_NAME='badge_id');
SET @sql = IF(@has_old>0 AND @has_new=0, 'ALTER TABLE gamification_badge_master CHANGE COLUMN id badge_id CHAR(36) NOT NULL', 'SELECT ''gbm badge_id ok'' AS n');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- 0b. Rename category -> badge_category as VARCHAR (no ENUM truncation on old values)
SET @col = (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='gamification_badge_master' AND COLUMN_NAME='category');
SET @sql = IF(@col>0, 'ALTER TABLE gamification_badge_master CHANGE COLUMN category badge_category VARCHAR(50) NOT NULL', 'SELECT ''gbm badge_category rename ok'' AS n');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- 0c. Normalise old category values not in the canonical ENUM
--     043_demo_data used: teamwork, attendance, learning
SET @col = (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='gamification_badge_master' AND COLUMN_NAME='badge_category');
SET @sql = IF(@col>0, 'UPDATE gamification_badge_master SET badge_category = CASE badge_category WHEN ''teamwork'' THEN ''social'' WHEN ''attendance'' THEN ''activity'' WHEN ''learning'' THEN ''activity'' ELSE badge_category END WHERE badge_category NOT IN (''performance'',''activity'',''tenure'',''social'')', 'SELECT ''gbm category data ok'' AS n');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- 0d. Tighten badge_category to ENUM now that all values are valid
SET @col = (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='gamification_badge_master' AND COLUMN_NAME='badge_category' AND DATA_TYPE='varchar');
SET @sql = IF(@col>0, 'ALTER TABLE gamification_badge_master MODIFY COLUMN badge_category ENUM(''performance'',''activity'',''tenure'',''social'') NOT NULL', 'SELECT ''gbm badge_category enum ok'' AS n');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- 0e. Rename point_value -> points_value
SET @col = (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='gamification_badge_master' AND COLUMN_NAME='point_value');
SET @sql = IF(@col>0, 'ALTER TABLE gamification_badge_master CHANGE COLUMN point_value points_value INT NOT NULL DEFAULT 0', 'SELECT ''gbm points_value ok'' AS n');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- 0f. Rename active_status -> is_active
SET @col = (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='gamification_badge_master' AND COLUMN_NAME='active_status');
SET @sql = IF(@col>0, 'ALTER TABLE gamification_badge_master CHANGE COLUMN active_status is_active TINYINT(1) NOT NULL DEFAULT 1', 'SELECT ''gbm is_active ok'' AS n');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- 0g. Drop badge_code (not in canonical schema)
SET @col = (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='gamification_badge_master' AND COLUMN_NAME='badge_code');
SET @sql = IF(@col>0, 'ALTER TABLE gamification_badge_master DROP COLUMN badge_code', 'SELECT ''gbm badge_code absent ok'' AS n');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- 0h. Add badge_icon if missing
SET @col = (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='gamification_badge_master' AND COLUMN_NAME='badge_icon');
SET @sql = IF(@col=0, 'ALTER TABLE gamification_badge_master ADD COLUMN badge_icon VARCHAR(255) NULL', 'SELECT ''gbm badge_icon ok'' AS n');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- 0i. Add criteria_json if missing
SET @col = (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='gamification_badge_master' AND COLUMN_NAME='criteria_json');
SET @sql = IF(@col=0, 'ALTER TABLE gamification_badge_master ADD COLUMN criteria_json JSON NULL COMMENT ''Badge earning criteria''', 'SELECT ''gbm criteria_json ok'' AS n');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- 0j. Add is_active if still missing (tables that never had active_status either)
SET @col = (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='gamification_badge_master' AND COLUMN_NAME='is_active');
SET @sql = IF(@col=0, 'ALTER TABLE gamification_badge_master ADD COLUMN is_active TINYINT(1) NOT NULL DEFAULT 1', 'SELECT ''gbm is_active present ok'' AS n');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- 0k. Add created_at if missing
SET @col = (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='gamification_badge_master' AND COLUMN_NAME='created_at');
SET @sql = IF(@col=0, 'ALTER TABLE gamification_badge_master ADD COLUMN created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP', 'SELECT ''gbm created_at ok'' AS n');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- 0l. Add updated_at if missing
SET @col = (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='gamification_badge_master' AND COLUMN_NAME='updated_at');
SET @sql = IF(@col=0, 'ALTER TABLE gamification_badge_master ADD COLUMN updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP', 'SELECT ''gbm updated_at ok'' AS n');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- =====================================================
-- 0B. SCHEMA COMPATIBILITY FOR employee_badge_earned
--     043_demo_data used: id (not earned_id), earned_date (not earned_at)
-- =====================================================

-- 0B-a. Rename id -> earned_id
SET @has_old = (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='employee_badge_earned' AND COLUMN_NAME='id');
SET @has_new = (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='employee_badge_earned' AND COLUMN_NAME='earned_id');
SET @sql = IF(@has_old>0 AND @has_new=0, 'ALTER TABLE employee_badge_earned CHANGE COLUMN id earned_id CHAR(36) NOT NULL', 'SELECT ''ebe earned_id ok'' AS n');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- 0B-b. Rename earned_date -> earned_at
SET @col = (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='employee_badge_earned' AND COLUMN_NAME='earned_date');
SET @sql = IF(@col>0, 'ALTER TABLE employee_badge_earned CHANGE COLUMN earned_date earned_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP', 'SELECT ''ebe earned_at ok'' AS n');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- 0B-c. Add metadata_json if missing
SET @col = (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='employee_badge_earned' AND COLUMN_NAME='metadata_json');
SET @sql = IF(@col=0, 'ALTER TABLE employee_badge_earned ADD COLUMN metadata_json JSON NULL COMMENT ''Additional context''', 'SELECT ''ebe metadata_json ok'' AS n');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- =====================================================
-- 0C. SCHEMA COMPATIBILITY FOR gamification_point_log
--     This table is referenced by 043_demo_data.sql but was never defined
--     in any migration. Create it here with IF NOT EXISTS so production
--     databases that already have it are unaffected and fresh databases
--     get it created before 043 tries to insert into it.
-- =====================================================
CREATE TABLE IF NOT EXISTS gamification_point_log (
    id            CHAR(36)     NOT NULL DEFAULT (UUID()) PRIMARY KEY,
    employee_id   VARCHAR(36)  NOT NULL,
    points_earned INT          NOT NULL DEFAULT 0,
    points_source VARCHAR(50)  NOT NULL COMMENT 'badge, kudos, survey, manual, etc.',
    source_ref_id VARCHAR(36)  NULL     COMMENT 'ID of the badge/kudos/survey that triggered this',
    awarded_date  DATE         NOT NULL,
    awarded_by    VARCHAR(36)  NULL,
    notes         TEXT         NULL,
    created_at    TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_gpl_employee   (employee_id),
    INDEX idx_gpl_source     (points_source),
    INDEX idx_gpl_awarded    (awarded_date)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='Points awarded to employees from badges, kudos, surveys etc.';

-- =====================================================
-- 1. BADGE MASTER
-- =====================================================
CREATE TABLE IF NOT EXISTS gamification_badge_master (
    badge_id CHAR(36) PRIMARY KEY,
    badge_name VARCHAR(100) NOT NULL,
    badge_description TEXT,
    badge_icon VARCHAR(255),
    badge_category ENUM('performance', 'activity', 'tenure', 'social') NOT NULL,
    points_value INT NOT NULL DEFAULT 0,
    criteria_json JSON COMMENT 'Badge earning criteria',
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY uq_badge_name (badge_name),
    INDEX idx_category (badge_category),
    INDEX idx_active (is_active)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- =====================================================
-- 2. EMPLOYEE BADGE EARNED
-- =====================================================
CREATE TABLE IF NOT EXISTS employee_badge_earned (
    earned_id CHAR(36) PRIMARY KEY,
    employee_id VARCHAR(36) NOT NULL,
    badge_id CHAR(36) NOT NULL,
    earned_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    reason TEXT COMMENT 'Why badge was awarded',
    awarded_by VARCHAR(36) COMMENT 'Admin/system that awarded',
    metadata_json JSON COMMENT 'Additional context',
    FOREIGN KEY (employee_id) REFERENCES employees(id) ON DELETE CASCADE,
    FOREIGN KEY (badge_id) REFERENCES gamification_badge_master(badge_id) ON DELETE CASCADE,
    UNIQUE KEY uq_employee_badge (employee_id, badge_id),
    INDEX idx_employee (employee_id),
    INDEX idx_badge (badge_id),
    INDEX idx_earned_at (earned_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- =====================================================
-- 3. GAMIFICATION POINTS LEDGER
-- =====================================================
CREATE TABLE IF NOT EXISTS gamification_points_ledger (
    transaction_id CHAR(36) PRIMARY KEY,
    employee_id VARCHAR(36) NOT NULL,
    points_delta INT NOT NULL COMMENT 'Positive for earned, negative for spent',
    transaction_type ENUM('badge_earned', 'kudos_sent', 'kudos_received', 'survey_completed', 'pulse_completed', 'manual_adjustment', 'tier_bonus', 'activity_bonus') NOT NULL,
    reference_id CHAR(36) COMMENT 'ID of related record (badge, kudos, etc)',
    description VARCHAR(255),
    balance_after INT NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (employee_id) REFERENCES employees(id) ON DELETE CASCADE,
    INDEX idx_employee (employee_id),
    INDEX idx_type (transaction_type),
    INDEX idx_created (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- =====================================================
-- 4. GAMIFICATION TIER MASTER
-- =====================================================
CREATE TABLE IF NOT EXISTS gamification_tier_master (
    tier_id CHAR(36) PRIMARY KEY,
    tier_name VARCHAR(50) NOT NULL,
    tier_level INT NOT NULL UNIQUE,
    min_points INT NOT NULL,
    max_points INT,
    tier_color VARCHAR(7) COMMENT 'Hex color code',
    tier_icon VARCHAR(255),
    benefits_json JSON COMMENT 'Perks at this tier',
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_level (tier_level),
    INDEX idx_points (min_points, max_points)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- =====================================================
-- 5. EMPLOYEE TIER STATUS
-- =====================================================
CREATE TABLE IF NOT EXISTS employee_tier_status (
    status_id CHAR(36) PRIMARY KEY,
    employee_id VARCHAR(36) NOT NULL UNIQUE,
    current_tier_id CHAR(36) NOT NULL,
    total_points INT NOT NULL DEFAULT 0,
    points_to_next_tier INT,
    tier_achieved_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    last_updated TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (employee_id) REFERENCES employees(id) ON DELETE CASCADE,
    FOREIGN KEY (current_tier_id) REFERENCES gamification_tier_master(tier_id) ON DELETE RESTRICT,
    INDEX idx_employee (employee_id),
    INDEX idx_tier (current_tier_id),
    INDEX idx_points (total_points)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- =====================================================
-- 6. KUDOS MASTER
-- =====================================================
CREATE TABLE IF NOT EXISTS kudos_master (
    kudos_template_id CHAR(36) PRIMARY KEY,
    kudos_title VARCHAR(100) NOT NULL,
    kudos_message_template TEXT,
    kudos_icon VARCHAR(255),
    kudos_category VARCHAR(50),
    points_value INT NOT NULL DEFAULT 10,
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY uq_kudos_title (kudos_title),
    INDEX idx_category (kudos_category),
    INDEX idx_active (is_active)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- =====================================================
-- 7. KUDOS TRANSACTION
-- =====================================================
CREATE TABLE IF NOT EXISTS kudos_transaction (
    kudos_id CHAR(36) PRIMARY KEY,
    sender_id VARCHAR(36) NOT NULL,
    receiver_id VARCHAR(36) NOT NULL,
    kudos_template_id CHAR(36),
    custom_message TEXT,
    points_awarded INT NOT NULL DEFAULT 10,
    sent_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    is_anonymous BOOLEAN DEFAULT FALSE,
    FOREIGN KEY (sender_id) REFERENCES employees(id) ON DELETE CASCADE,
    FOREIGN KEY (receiver_id) REFERENCES employees(id) ON DELETE CASCADE,
    FOREIGN KEY (kudos_template_id) REFERENCES kudos_master(kudos_template_id) ON DELETE SET NULL,
    INDEX idx_sender (sender_id),
    INDEX idx_receiver (receiver_id),
    INDEX idx_sent_at (sent_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- =====================================================
-- 8. SURVEY MASTER
-- =====================================================
CREATE TABLE IF NOT EXISTS survey_master (
    survey_id CHAR(36) PRIMARY KEY,
    survey_title VARCHAR(255) NOT NULL,
    survey_description TEXT,
    survey_type ENUM('engagement', 'feedback', 'pulse', 'custom') NOT NULL,
    start_date DATE,
    end_date DATE,
    is_anonymous BOOLEAN DEFAULT TRUE,
    is_active BOOLEAN DEFAULT TRUE,
    points_reward INT DEFAULT 0,
    target_audience_json JSON COMMENT 'Employee filters',
    created_by VARCHAR(36),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY uq_survey_title (survey_title),
    INDEX idx_type (survey_type),
    INDEX idx_active (is_active),
    INDEX idx_dates (start_date, end_date)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- =====================================================
-- 9. SURVEY QUESTION
-- =====================================================
CREATE TABLE IF NOT EXISTS survey_question (
    question_id CHAR(36) PRIMARY KEY,
    survey_id CHAR(36) NOT NULL,
    question_text TEXT NOT NULL,
    question_type ENUM('text', 'rating', 'multiple_choice', 'single_choice', 'yes_no', 'scale') NOT NULL,
    question_order INT NOT NULL,
    is_required BOOLEAN DEFAULT TRUE,
    options_json JSON COMMENT 'For multiple/single choice questions',
    scale_min INT COMMENT 'For scale questions',
    scale_max INT COMMENT 'For scale questions',
    scale_labels_json JSON COMMENT 'Labels for scale endpoints',
    FOREIGN KEY (survey_id) REFERENCES survey_master(survey_id) ON DELETE CASCADE,
    UNIQUE KEY uq_survey_question_order (survey_id, question_order),
    INDEX idx_survey (survey_id),
    INDEX idx_order (survey_id, question_order)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- =====================================================
-- 10. SURVEY RESPONSE
-- =====================================================
CREATE TABLE IF NOT EXISTS survey_response (
    response_id CHAR(36) PRIMARY KEY,
    survey_id CHAR(36) NOT NULL,
    question_id CHAR(36) NOT NULL,
    employee_id VARCHAR(36),
    response_text TEXT,
    response_value INT COMMENT 'For ratings/scales',
    response_choices_json JSON COMMENT 'For multiple choice',
    submitted_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (survey_id) REFERENCES survey_master(survey_id) ON DELETE CASCADE,
    FOREIGN KEY (question_id) REFERENCES survey_question(question_id) ON DELETE CASCADE,
    FOREIGN KEY (employee_id) REFERENCES employees(id) ON DELETE SET NULL,
    UNIQUE KEY uq_survey_employee_question (survey_id, question_id, employee_id),
    INDEX idx_survey (survey_id),
    INDEX idx_question (question_id),
    INDEX idx_employee (employee_id),
    INDEX idx_submitted (submitted_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- =====================================================
-- 11. PULSE CHECK
-- =====================================================
CREATE TABLE IF NOT EXISTS pulse_check (
    pulse_id CHAR(36) PRIMARY KEY,
    employee_id VARCHAR(36) NOT NULL,
    mood_rating INT NOT NULL COMMENT '1-5 scale',
    energy_level INT COMMENT '1-5 scale',
    stress_level INT COMMENT '1-5 scale',
    workload_perception ENUM('too_light', 'manageable', 'heavy', 'overwhelming'),
    feedback_text TEXT,
    submitted_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    week_start_date DATE NOT NULL,
    FOREIGN KEY (employee_id) REFERENCES employees(id) ON DELETE CASCADE,
    INDEX idx_employee (employee_id),
    INDEX idx_submitted (submitted_at),
    INDEX idx_week (week_start_date),
    INDEX idx_mood (mood_rating),
    UNIQUE KEY unique_employee_week (employee_id, week_start_date)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- =====================================================
-- SEED DATA: BADGES
-- =====================================================

-- Performance Badges
INSERT IGNORE INTO gamification_badge_master (badge_id, badge_name, badge_description, badge_icon, badge_category, points_value, criteria_json) VALUES
(UUID(), 'Top Performer', 'Exceeded KPI targets for 3 consecutive months', '🏆', 'performance', 100, '{"type": "kpi", "threshold": "3_months", "criteria": "exceed_target"}'),
(UUID(), 'Revenue Champion', 'Generated highest revenue in quarter', '💰', 'performance', 150, '{"type": "revenue", "threshold": "quarterly_top", "criteria": "highest_revenue"}'),
(UUID(), 'Quality Star', 'Maintained 95%+ quality score for 2 months', '⭐', 'performance', 75, '{"type": "quality", "threshold": "95_percent", "duration": "2_months"}'),
(UUID(), 'Customer Hero', 'Received 5+ positive customer feedbacks', '🦸', 'performance', 80, '{"type": "feedback", "threshold": "5_positive", "criteria": "customer_satisfaction"}');

-- Activity Badges
INSERT IGNORE INTO gamification_badge_master (badge_id, badge_name, badge_description, badge_icon, badge_category, points_value, criteria_json) VALUES
(UUID(), 'Early Bird', 'Logged in before 9 AM for 20 consecutive days', '🌅', 'activity', 50, '{"type": "attendance", "threshold": "20_days", "criteria": "before_9am"}'),
(UUID(), 'Perfect Attendance', 'No absences for 3 months', '📅', 'activity', 100, '{"type": "attendance", "threshold": "3_months", "criteria": "zero_absence"}'),
(UUID(), 'Team Player', 'Sent 20+ kudos to colleagues', '🤝', 'activity', 60, '{"type": "kudos", "threshold": "20_sent", "criteria": "peer_recognition"}'),
(UUID(), 'Survey Champion', 'Completed 10+ surveys/pulse checks', '📊', 'activity', 40, '{"type": "survey", "threshold": "10_completed", "criteria": "participation"}');

-- Tenure Badges
INSERT IGNORE INTO gamification_badge_master (badge_id, badge_name, badge_description, badge_icon, badge_category, points_value, criteria_json) VALUES
(UUID(), '6 Month Milestone', 'Completed 6 months with the company', '🎯', 'tenure', 50, '{"type": "tenure", "threshold": "6_months", "criteria": "continuous_service"}'),
(UUID(), '1 Year Anniversary', 'Completed 1 year with the company', '🎂', 'tenure', 100, '{"type": "tenure", "threshold": "12_months", "criteria": "continuous_service"}'),
(UUID(), '2 Year Veteran', 'Completed 2 years with the company', '🏅', 'tenure', 200, '{"type": "tenure", "threshold": "24_months", "criteria": "continuous_service"}'),
(UUID(), '5 Year Legend', 'Completed 5 years with the company', '👑', 'tenure', 500, '{"type": "tenure", "threshold": "60_months", "criteria": "continuous_service"}');

-- Social Badges
INSERT IGNORE INTO gamification_badge_master (badge_id, badge_name, badge_description, badge_icon, badge_category, points_value, criteria_json) VALUES
(UUID(), 'Kudos Magnet', 'Received 30+ kudos from peers', '🌟', 'social', 90, '{"type": "kudos", "threshold": "30_received", "criteria": "peer_appreciated"}'),
(UUID(), 'Mentor', 'Helped onboard 3+ new employees', '🎓', 'social', 120, '{"type": "mentorship", "threshold": "3_mentees", "criteria": "onboarding_support"}'),
(UUID(), 'Feedback Guru', 'Provided 20+ constructive peer feedbacks', '💬', 'social', 70, '{"type": "feedback", "threshold": "20_given", "criteria": "peer_feedback"}');

-- =====================================================
-- SEED DATA: TIERS
-- =====================================================

INSERT IGNORE INTO gamification_tier_master (tier_id, tier_name, tier_level, min_points, max_points, tier_color, tier_icon, benefits_json) VALUES
(UUID(), 'Bronze', 1, 0, 499, '#CD7F32', '🥉', '{"perks": ["Basic profile badge", "Access to standard surveys"]}'),
(UUID(), 'Silver', 2, 500, 1499, '#C0C0C0', '🥈', '{"perks": ["Silver profile badge", "Priority survey feedback", "Monthly recognition"]}'),
(UUID(), 'Gold', 3, 1500, 2999, '#FFD700', '🥇', '{"perks": ["Gold profile badge", "Quarterly bonus eligibility", "Featured in newsletter"]}'),
(UUID(), 'Platinum', 4, 3000, 4999, '#E5E4E2', '💎', '{"perks": ["Platinum profile badge", "Exclusive training access", "Leadership visibility", "Special parking spot"]}'),
(UUID(), 'Diamond', 5, 5000, NULL, '#B9F2FF', '💠', '{"perks": ["Diamond profile badge", "Executive mentorship", "Annual recognition event", "Extra paid day off", "Premium benefits"]}');

-- =====================================================
-- SEED DATA: KUDOS TEMPLATES
-- =====================================================

INSERT IGNORE INTO kudos_master (kudos_template_id, kudos_title, kudos_message_template, kudos_icon, kudos_category, points_value) VALUES
(UUID(), 'Great Job!', 'Amazing work on {task}! Your effort really shows.', '👏', 'general', 10),
(UUID(), 'Team Player', 'Thanks for being such a great team player! Your collaboration makes all the difference.', '🤝', 'teamwork', 15),
(UUID(), 'Problem Solver', 'Your innovative solution to {problem} was brilliant!', '💡', 'innovation', 20),
(UUID(), 'Customer Champion', 'You went above and beyond for our customer. Excellent service!', '🏆', 'customer_service', 15),
(UUID(), 'Mentor Appreciation', 'Thank you for your guidance and support. I learned so much from you!', '🎓', 'mentorship', 20),
(UUID(), 'Quality Excellence', 'Your attention to detail and quality is outstanding!', '⭐', 'quality', 15),
(UUID(), 'Speed Demon', 'Lightning-fast delivery without compromising quality. Impressive!', '⚡', 'efficiency', 15),
(UUID(), 'Positive Vibes', 'Your positive attitude makes the workplace better for everyone!', '😊', 'attitude', 10);

-- =====================================================
-- SEED DATA: SAMPLE SURVEYS
-- =====================================================

-- Survey 1: Monthly Engagement Survey
SET @survey1_id = COALESCE(
  (SELECT survey_id FROM survey_master WHERE survey_title = 'Monthly Engagement Survey' LIMIT 1),
  '00000000-0000-0000-0000-000000000381'
);
INSERT IGNORE INTO survey_master (survey_id, survey_title, survey_description, survey_type, start_date, end_date, is_anonymous, is_active, points_reward, target_audience_json) VALUES
(@survey1_id, 'Monthly Engagement Survey', 'Help us understand your work experience and engagement levels', 'engagement', CURDATE(), DATE_ADD(CURDATE(), INTERVAL 30 DAY), TRUE, TRUE, 25, '{"all_employees": true}');

-- Survey 1 Questions
INSERT IGNORE INTO survey_question
  (id, survey_id, question_text, question_type, display_order, is_required, options_json)
VALUES
  (UUID(), @survey1_id, 'How satisfied are you with your current role?', 'scale', 1, TRUE, '{"min":1,"max":5,"labels":{"1":"Very Dissatisfied","5":"Very Satisfied"}}'),
  (UUID(), @survey1_id, 'Do you feel valued as a team member?', 'rating', 2, TRUE, '{"min":1,"max":5,"labels":{"1":"Not at all","5":"Absolutely"}}'),
  (UUID(), @survey1_id, 'What do you enjoy most about working here?', 'text', 3, FALSE, NULL),
  (UUID(), @survey1_id, 'How would you rate work-life balance?', 'scale', 4, TRUE, '{"min":1,"max":5,"labels":{"1":"Poor","5":"Excellent"}}'),
  (UUID(), @survey1_id, 'Would you recommend this company to a friend?', 'yes_no', 5, TRUE, '["Yes", "No"]');

-- Survey 2: Team Feedback Survey
SET @survey2_id = COALESCE(
  (SELECT survey_id FROM survey_master WHERE survey_title = 'Team Feedback Survey' LIMIT 1),
  '00000000-0000-0000-0000-000000000382'
);
INSERT IGNORE INTO survey_master (survey_id, survey_title, survey_description, survey_type, start_date, end_date, is_anonymous, is_active, points_reward, target_audience_json) VALUES
(@survey2_id, 'Team Feedback Survey', 'Share your thoughts on team collaboration and communication', 'feedback', CURDATE(), DATE_ADD(CURDATE(), INTERVAL 14 DAY), TRUE, TRUE, 20, '{"all_employees": true}');

-- Survey 2 Questions
INSERT IGNORE INTO survey_question
  (id, survey_id, question_text, question_type, display_order, is_required, options_json)
VALUES
  (UUID(), @survey2_id, 'How effective is communication within your team?', 'scale', 1, TRUE, '{"min":1,"max":5,"labels":{"1":"Very Poor","5":"Excellent"}}'),
  (UUID(), @survey2_id, 'What communication tools do you use most?', 'multiple_choice', 2, TRUE, '["Email", "Slack", "Teams", "Phone", "In-person", "Other"]'),
  (UUID(), @survey2_id, 'Does your team hold regular meetings?', 'single_choice', 3, TRUE, '["Daily", "Weekly", "Bi-weekly", "Monthly", "Rarely", "Never"]'),
  (UUID(), @survey2_id, 'What could improve team collaboration?', 'text', 4, FALSE, NULL);

-- =====================================================
-- END OF SCHEMA
-- =====================================================
