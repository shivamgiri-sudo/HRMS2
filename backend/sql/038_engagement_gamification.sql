-- =====================================================
-- Engagement & Gamification Schema
-- File: 038_engagement_gamification.sql
-- Description: 11 tables for badges, points, tiers, kudos, surveys, pulse checks
-- =====================================================

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
    FOREIGN KEY (employee_id) REFERENCES employees(employee_id) ON DELETE CASCADE,
    FOREIGN KEY (badge_id) REFERENCES gamification_badge_master(badge_id) ON DELETE CASCADE,
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
    FOREIGN KEY (employee_id) REFERENCES employees(employee_id) ON DELETE CASCADE,
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
    FOREIGN KEY (employee_id) REFERENCES employees(employee_id) ON DELETE CASCADE,
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
    FOREIGN KEY (sender_id) REFERENCES employees(employee_id) ON DELETE CASCADE,
    FOREIGN KEY (receiver_id) REFERENCES employees(employee_id) ON DELETE CASCADE,
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
    FOREIGN KEY (employee_id) REFERENCES employees(employee_id) ON DELETE SET NULL,
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
    FOREIGN KEY (employee_id) REFERENCES employees(employee_id) ON DELETE CASCADE,
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
INSERT INTO gamification_badge_master (badge_id, badge_name, badge_description, badge_icon, badge_category, points_value, criteria_json) VALUES
(UUID(), 'Top Performer', 'Exceeded KPI targets for 3 consecutive months', '🏆', 'performance', 100, '{"type": "kpi", "threshold": "3_months", "criteria": "exceed_target"}'),
(UUID(), 'Revenue Champion', 'Generated highest revenue in quarter', '💰', 'performance', 150, '{"type": "revenue", "threshold": "quarterly_top", "criteria": "highest_revenue"}'),
(UUID(), 'Quality Star', 'Maintained 95%+ quality score for 2 months', '⭐', 'performance', 75, '{"type": "quality", "threshold": "95_percent", "duration": "2_months"}'),
(UUID(), 'Customer Hero', 'Received 5+ positive customer feedbacks', '🦸', 'performance', 80, '{"type": "feedback", "threshold": "5_positive", "criteria": "customer_satisfaction"}');

-- Activity Badges
INSERT INTO gamification_badge_master (badge_id, badge_name, badge_description, badge_icon, badge_category, points_value, criteria_json) VALUES
(UUID(), 'Early Bird', 'Logged in before 9 AM for 20 consecutive days', '🌅', 'activity', 50, '{"type": "attendance", "threshold": "20_days", "criteria": "before_9am"}'),
(UUID(), 'Perfect Attendance', 'No absences for 3 months', '📅', 'activity', 100, '{"type": "attendance", "threshold": "3_months", "criteria": "zero_absence"}'),
(UUID(), 'Team Player', 'Sent 20+ kudos to colleagues', '🤝', 'activity', 60, '{"type": "kudos", "threshold": "20_sent", "criteria": "peer_recognition"}'),
(UUID(), 'Survey Champion', 'Completed 10+ surveys/pulse checks', '📊', 'activity', 40, '{"type": "survey", "threshold": "10_completed", "criteria": "participation"}');

-- Tenure Badges
INSERT INTO gamification_badge_master (badge_id, badge_name, badge_description, badge_icon, badge_category, points_value, criteria_json) VALUES
(UUID(), '6 Month Milestone', 'Completed 6 months with the company', '🎯', 'tenure', 50, '{"type": "tenure", "threshold": "6_months", "criteria": "continuous_service"}'),
(UUID(), '1 Year Anniversary', 'Completed 1 year with the company', '🎂', 'tenure', 100, '{"type": "tenure", "threshold": "12_months", "criteria": "continuous_service"}'),
(UUID(), '2 Year Veteran', 'Completed 2 years with the company', '🏅', 'tenure', 200, '{"type": "tenure", "threshold": "24_months", "criteria": "continuous_service"}'),
(UUID(), '5 Year Legend', 'Completed 5 years with the company', '👑', 'tenure', 500, '{"type": "tenure", "threshold": "60_months", "criteria": "continuous_service"}');

-- Social Badges
INSERT INTO gamification_badge_master (badge_id, badge_name, badge_description, badge_icon, badge_category, points_value, criteria_json) VALUES
(UUID(), 'Kudos Magnet', 'Received 30+ kudos from peers', '🌟', 'social', 90, '{"type": "kudos", "threshold": "30_received", "criteria": "peer_appreciated"}'),
(UUID(), 'Mentor', 'Helped onboard 3+ new employees', '🎓', 'social', 120, '{"type": "mentorship", "threshold": "3_mentees", "criteria": "onboarding_support"}'),
(UUID(), 'Feedback Guru', 'Provided 20+ constructive peer feedbacks', '💬', 'social', 70, '{"type": "feedback", "threshold": "20_given", "criteria": "peer_feedback"}');

-- =====================================================
-- SEED DATA: TIERS
-- =====================================================

INSERT INTO gamification_tier_master (tier_id, tier_name, tier_level, min_points, max_points, tier_color, tier_icon, benefits_json) VALUES
(UUID(), 'Bronze', 1, 0, 499, '#CD7F32', '🥉', '{"perks": ["Basic profile badge", "Access to standard surveys"]}'),
(UUID(), 'Silver', 2, 500, 1499, '#C0C0C0', '🥈', '{"perks": ["Silver profile badge", "Priority survey feedback", "Monthly recognition"]}'),
(UUID(), 'Gold', 3, 1500, 2999, '#FFD700', '🥇', '{"perks": ["Gold profile badge", "Quarterly bonus eligibility", "Featured in newsletter"]}'),
(UUID(), 'Platinum', 4, 3000, 4999, '#E5E4E2', '💎', '{"perks": ["Platinum profile badge", "Exclusive training access", "Leadership visibility", "Special parking spot"]}'),
(UUID(), 'Diamond', 5, 5000, NULL, '#B9F2FF', '💠', '{"perks": ["Diamond profile badge", "Executive mentorship", "Annual recognition event", "Extra paid day off", "Premium benefits"]}');

-- =====================================================
-- SEED DATA: KUDOS TEMPLATES
-- =====================================================

INSERT INTO kudos_master (kudos_template_id, kudos_title, kudos_message_template, kudos_icon, kudos_category, points_value) VALUES
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
SET @survey1_id = UUID();
INSERT INTO survey_master (survey_id, survey_title, survey_description, survey_type, start_date, end_date, is_anonymous, is_active, points_reward, target_audience_json) VALUES
(@survey1_id, 'Monthly Engagement Survey', 'Help us understand your work experience and engagement levels', 'engagement', CURDATE(), DATE_ADD(CURDATE(), INTERVAL 30 DAY), TRUE, TRUE, 25, '{"all_employees": true}');

-- Survey 1 Questions
INSERT INTO survey_question (question_id, survey_id, question_text, question_type, question_order, is_required, options_json, scale_min, scale_max, scale_labels_json) VALUES
(UUID(), @survey1_id, 'How satisfied are you with your current role?', 'scale', 1, TRUE, NULL, 1, 5, '{"1": "Very Dissatisfied", "5": "Very Satisfied"}'),
(UUID(), @survey1_id, 'Do you feel valued as a team member?', 'rating', 2, TRUE, NULL, 1, 5, '{"1": "Not at all", "5": "Absolutely"}'),
(UUID(), @survey1_id, 'What do you enjoy most about working here?', 'text', 3, FALSE, NULL, NULL, NULL, NULL),
(UUID(), @survey1_id, 'How would you rate work-life balance?', 'scale', 4, TRUE, NULL, 1, 5, '{"1": "Poor", "5": "Excellent"}'),
(UUID(), @survey1_id, 'Would you recommend this company to a friend?', 'yes_no', 5, TRUE, '["Yes", "No"]', NULL, NULL, NULL);

-- Survey 2: Team Feedback Survey
SET @survey2_id = UUID();
INSERT INTO survey_master (survey_id, survey_title, survey_description, survey_type, start_date, end_date, is_anonymous, is_active, points_reward, target_audience_json) VALUES
(@survey2_id, 'Team Feedback Survey', 'Share your thoughts on team collaboration and communication', 'feedback', CURDATE(), DATE_ADD(CURDATE(), INTERVAL 14 DAY), TRUE, TRUE, 20, '{"all_employees": true}');

-- Survey 2 Questions
INSERT INTO survey_question (question_id, survey_id, question_text, question_type, question_order, is_required, options_json, scale_min, scale_max, scale_labels_json) VALUES
(UUID(), @survey2_id, 'How effective is communication within your team?', 'scale', 1, TRUE, NULL, 1, 5, '{"1": "Very Poor", "5": "Excellent"}'),
(UUID(), @survey2_id, 'What communication tools do you use most?', 'multiple_choice', 2, TRUE, '["Email", "Slack", "Teams", "Phone", "In-person", "Other"]', NULL, NULL, NULL),
(UUID(), @survey2_id, 'Does your team hold regular meetings?', 'single_choice', 3, TRUE, '["Daily", "Weekly", "Bi-weekly", "Monthly", "Rarely", "Never"]', NULL, NULL, NULL),
(UUID(), @survey2_id, 'What could improve team collaboration?', 'text', 4, FALSE, NULL, NULL, NULL, NULL);

-- =====================================================
-- END OF SCHEMA
-- =====================================================
