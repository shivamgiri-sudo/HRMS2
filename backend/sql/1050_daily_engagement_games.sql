-- Migration: Daily Engagement Games & Activities
-- All points integrate with existing gamification_points_ledger
-- Date: 2026-08-01

-- ============================================================================
-- FEATURE 1: Daily Login Rewards + Streaks
-- ============================================================================

CREATE TABLE IF NOT EXISTS employee_daily_login (
  id CHAR(36) PRIMARY KEY,
  employee_id CHAR(36) NOT NULL,
  login_date DATE NOT NULL,
  points_awarded INT DEFAULT 0,
  streak_day INT DEFAULT 1,
  streak_multiplier DECIMAL(3,2) DEFAULT 1.00,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_employee_login_date (employee_id, login_date),
  INDEX idx_login_date (login_date),
  INDEX idx_employee_streak (employee_id, streak_day)
);

-- Add streak columns to employee_tier_status if not exists
-- (safe to run multiple times)
SET @col_exists = (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'employee_tier_status' AND COLUMN_NAME = 'current_streak');
SET @sql = IF(@col_exists = 0,
  'ALTER TABLE employee_tier_status ADD COLUMN current_streak INT DEFAULT 0',
  'SELECT 1');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @col_exists = (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'employee_tier_status' AND COLUMN_NAME = 'longest_streak');
SET @sql = IF(@col_exists = 0,
  'ALTER TABLE employee_tier_status ADD COLUMN longest_streak INT DEFAULT 0',
  'SELECT 1');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @col_exists = (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'employee_tier_status' AND COLUMN_NAME = 'last_login_date');
SET @sql = IF(@col_exists = 0,
  'ALTER TABLE employee_tier_status ADD COLUMN last_login_date DATE',
  'SELECT 1');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- ============================================================================
-- FEATURE 2: Reward Wheel
-- ============================================================================

CREATE TABLE IF NOT EXISTS reward_wheel_segment (
  id CHAR(36) PRIMARY KEY,
  position INT NOT NULL,
  label VARCHAR(100) NOT NULL,
  reward_type ENUM('points', 'badge', 'leave_hours', 'voucher', 'retry', 'jackpot') NOT NULL,
  reward_value INT,
  probability DECIMAL(5,2) DEFAULT 12.50,
  color VARCHAR(20),
  icon VARCHAR(50),
  is_active BOOLEAN DEFAULT TRUE,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_wheel_position (position)
);

CREATE TABLE IF NOT EXISTS reward_wheel_spin (
  id CHAR(36) PRIMARY KEY,
  employee_id CHAR(36) NOT NULL,
  spin_date DATE NOT NULL,
  segment_id CHAR(36) NOT NULL,
  reward_type VARCHAR(50),
  reward_value INT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_employee_spin_date (employee_id, spin_date),
  INDEX idx_spin_date (spin_date)
);

-- Seed default wheel segments
INSERT IGNORE INTO reward_wheel_segment (id, position, label, reward_type, reward_value, probability, color, icon) VALUES
  (UUID(), 1, '5 Points', 'points', 5, 25.00, '#60a5fa', 'coins'),
  (UUID(), 2, '10 Points', 'points', 10, 20.00, '#34d399', 'coins'),
  (UUID(), 3, '25 Points', 'points', 25, 15.00, '#fbbf24', 'coins'),
  (UUID(), 4, '50 Points', 'points', 50, 8.00, '#f97316', 'coins'),
  (UUID(), 5, 'Try Again', 'retry', 0, 15.00, '#94a3b8', 'refresh-cw'),
  (UUID(), 6, '100 Points!', 'jackpot', 100, 5.00, '#ec4899', 'trophy'),
  (UUID(), 7, '15 Points', 'points', 15, 7.00, '#8b5cf6', 'coins'),
  (UUID(), 8, '20 Points', 'points', 20, 5.00, '#14b8a6', 'coins');

-- ============================================================================
-- FEATURE 3: Daily Trivia
-- ============================================================================

CREATE TABLE IF NOT EXISTS daily_trivia_question (
  id CHAR(36) PRIMARY KEY,
  question_date DATE UNIQUE,
  question_text TEXT NOT NULL,
  category ENUM('company', 'process', 'industry', 'general', 'fun') DEFAULT 'general',
  option_a VARCHAR(255) NOT NULL,
  option_b VARCHAR(255) NOT NULL,
  option_c VARCHAR(255),
  option_d VARCHAR(255),
  correct_option CHAR(1) NOT NULL,
  explanation TEXT,
  points_correct INT DEFAULT 10,
  points_participate INT DEFAULT 2,
  created_by CHAR(36),
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_trivia_date (question_date),
  INDEX idx_trivia_category (category)
);

CREATE TABLE IF NOT EXISTS daily_trivia_response (
  id CHAR(36) PRIMARY KEY,
  question_id CHAR(36) NOT NULL,
  employee_id CHAR(36) NOT NULL,
  selected_option CHAR(1) NOT NULL,
  is_correct BOOLEAN,
  time_taken_seconds INT,
  points_awarded INT,
  answered_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_trivia_response (question_id, employee_id),
  INDEX idx_trivia_employee (employee_id)
);

-- ============================================================================
-- FEATURE 4: Word Puzzle (Wordle-style)
-- ============================================================================

CREATE TABLE IF NOT EXISTS daily_word_puzzle (
  id CHAR(36) PRIMARY KEY,
  puzzle_date DATE UNIQUE,
  word CHAR(5) NOT NULL,
  hint VARCHAR(255),
  category VARCHAR(50),
  difficulty ENUM('easy', 'medium', 'hard') DEFAULT 'medium',
  created_by CHAR(36),
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_puzzle_date (puzzle_date)
);

CREATE TABLE IF NOT EXISTS daily_word_attempt (
  id CHAR(36) PRIMARY KEY,
  puzzle_id CHAR(36) NOT NULL,
  employee_id CHAR(36) NOT NULL,
  guess_1 CHAR(5),
  guess_2 CHAR(5),
  guess_3 CHAR(5),
  guess_4 CHAR(5),
  guess_5 CHAR(5),
  guess_6 CHAR(5),
  solved BOOLEAN DEFAULT FALSE,
  attempts_used INT DEFAULT 0,
  points_awarded INT DEFAULT 0,
  completed_at DATETIME,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_puzzle_attempt (puzzle_id, employee_id),
  INDEX idx_puzzle_employee (employee_id)
);

-- ============================================================================
-- FEATURE 5: Weekly Contests
-- ============================================================================

CREATE TABLE IF NOT EXISTS engagement_contest (
  id CHAR(36) PRIMARY KEY,
  title VARCHAR(255) NOT NULL,
  description TEXT,
  contest_type ENUM('photo', 'caption', 'referral', 'poll', 'challenge', 'meme') NOT NULL,
  banner_image_url VARCHAR(500),
  caption_image_url VARCHAR(500),
  start_date DATETIME NOT NULL,
  end_date DATETIME NOT NULL,
  voting_end_date DATETIME,
  prize_points INT DEFAULT 100,
  prize_description VARCHAR(255),
  status ENUM('draft', 'active', 'voting', 'completed') DEFAULT 'draft',
  winner_employee_id CHAR(36),
  created_by CHAR(36),
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_contest_status (status),
  INDEX idx_contest_dates (start_date, end_date)
);

CREATE TABLE IF NOT EXISTS engagement_contest_entry (
  id CHAR(36) PRIMARY KEY,
  contest_id CHAR(36) NOT NULL,
  employee_id CHAR(36) NOT NULL,
  entry_type ENUM('text', 'image', 'link') DEFAULT 'text',
  entry_text TEXT,
  entry_image_url VARCHAR(500),
  vote_count INT DEFAULT 0,
  is_winner BOOLEAN DEFAULT FALSE,
  submitted_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_contest_entry (contest_id, employee_id),
  INDEX idx_entry_votes (contest_id, vote_count DESC)
);

CREATE TABLE IF NOT EXISTS engagement_contest_vote (
  id CHAR(36) PRIMARY KEY,
  contest_id CHAR(36) NOT NULL,
  entry_id CHAR(36) NOT NULL,
  voter_employee_id CHAR(36) NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_contest_vote (contest_id, voter_employee_id),
  INDEX idx_vote_entry (entry_id)
);

-- ============================================================================
-- FEATURE 7: Tip of the Day
-- ============================================================================

CREATE TABLE IF NOT EXISTS daily_tip (
  id CHAR(36) PRIMARY KEY,
  tip_date DATE UNIQUE,
  category ENUM('productivity', 'tech', 'communication', 'company', 'industry', 'wellness', 'fun_fact') DEFAULT 'general',
  title VARCHAR(255) NOT NULL,
  content TEXT NOT NULL,
  media_url VARCHAR(500),
  learn_more_url VARCHAR(500),
  source VARCHAR(100),
  created_by CHAR(36),
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_tip_date (tip_date),
  INDEX idx_tip_category (category)
);

CREATE TABLE IF NOT EXISTS daily_tip_read (
  id CHAR(36) PRIMARY KEY,
  tip_id CHAR(36) NOT NULL,
  employee_id CHAR(36) NOT NULL,
  points_awarded INT DEFAULT 2,
  read_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_tip_read (tip_id, employee_id),
  INDEX idx_tip_employee (employee_id)
);

-- ============================================================================
-- FEATURE 11: Quick Polls
-- ============================================================================

CREATE TABLE IF NOT EXISTS quick_poll (
  id CHAR(36) PRIMARY KEY,
  question VARCHAR(255) NOT NULL,
  poll_type ENUM('fun', 'feedback', 'decision') DEFAULT 'fun',
  option_1 VARCHAR(100) NOT NULL,
  option_2 VARCHAR(100) NOT NULL,
  option_3 VARCHAR(100),
  option_4 VARCHAR(100),
  created_by CHAR(36),
  approved_by CHAR(36),
  status ENUM('pending', 'active', 'closed') DEFAULT 'pending',
  start_date DATETIME,
  end_date DATETIME,
  total_votes INT DEFAULT 0,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_poll_status (status),
  INDEX idx_poll_dates (start_date, end_date)
);

CREATE TABLE IF NOT EXISTS quick_poll_vote (
  id CHAR(36) PRIMARY KEY,
  poll_id CHAR(36) NOT NULL,
  employee_id CHAR(36) NOT NULL,
  selected_option INT NOT NULL,
  points_awarded INT DEFAULT 2,
  voted_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_poll_vote (poll_id, employee_id),
  INDEX idx_poll_employee (employee_id)
);

-- ============================================================================
-- FEATURE 12: Brain Teaser
-- ============================================================================

CREATE TABLE IF NOT EXISTS brain_teaser (
  id CHAR(36) PRIMARY KEY,
  teaser_date DATE UNIQUE,
  category ENUM('logic', 'math', 'pattern', 'riddle', 'lateral') DEFAULT 'logic',
  question TEXT NOT NULL,
  answer VARCHAR(255) NOT NULL,
  hint_1 VARCHAR(255),
  hint_2 VARCHAR(255),
  explanation TEXT,
  difficulty ENUM('easy', 'medium', 'hard') DEFAULT 'medium',
  points_no_hint INT DEFAULT 15,
  points_one_hint INT DEFAULT 10,
  points_two_hints INT DEFAULT 5,
  created_by CHAR(36),
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_teaser_date (teaser_date)
);

CREATE TABLE IF NOT EXISTS brain_teaser_attempt (
  id CHAR(36) PRIMARY KEY,
  teaser_id CHAR(36) NOT NULL,
  employee_id CHAR(36) NOT NULL,
  submitted_answer VARCHAR(255),
  is_correct BOOLEAN,
  hints_used INT DEFAULT 0,
  time_taken_secs INT,
  points_awarded INT,
  attempted_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_teaser_attempt (teaser_id, employee_id),
  INDEX idx_teaser_employee (employee_id)
);

-- ============================================================================
-- FEATURE 8: Knowledge Quiz
-- ============================================================================

CREATE TABLE IF NOT EXISTS knowledge_quiz (
  id CHAR(36) PRIMARY KEY,
  title VARCHAR(255) NOT NULL,
  description TEXT,
  category ENUM('policy', 'product', 'process', 'compliance', 'soft_skills', 'general') DEFAULT 'general',
  difficulty ENUM('beginner', 'intermediate', 'advanced') DEFAULT 'beginner',
  time_per_question_secs INT DEFAULT 30,
  passing_score_percent INT DEFAULT 60,
  points_perfect INT DEFAULT 25,
  points_pass INT DEFAULT 15,
  points_participate INT DEFAULT 5,
  is_active BOOLEAN DEFAULT TRUE,
  release_date DATE,
  created_by CHAR(36),
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_quiz_active (is_active),
  INDEX idx_quiz_category (category)
);

CREATE TABLE IF NOT EXISTS knowledge_quiz_question (
  id CHAR(36) PRIMARY KEY,
  quiz_id CHAR(36) NOT NULL,
  question_order INT,
  question_text TEXT NOT NULL,
  option_a VARCHAR(255) NOT NULL,
  option_b VARCHAR(255) NOT NULL,
  option_c VARCHAR(255),
  option_d VARCHAR(255),
  correct_option CHAR(1) NOT NULL,
  explanation TEXT,
  INDEX idx_quiz_question (quiz_id, question_order)
);

CREATE TABLE IF NOT EXISTS knowledge_quiz_attempt (
  id CHAR(36) PRIMARY KEY,
  quiz_id CHAR(36) NOT NULL,
  employee_id CHAR(36) NOT NULL,
  score_percent INT,
  correct_count INT,
  total_questions INT,
  time_taken_secs INT,
  points_awarded INT,
  completed_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_quiz_attempt (quiz_id, employee_id),
  INDEX idx_quiz_employee (employee_id)
);

-- ============================================================================
-- FEATURE 15: Employee Spotlight
-- ============================================================================

CREATE TABLE IF NOT EXISTS employee_spotlight (
  id CHAR(36) PRIMARY KEY,
  employee_id CHAR(36) NOT NULL,
  spotlight_week DATE NOT NULL,
  fun_facts TEXT,
  hobbies TEXT,
  favorite_quote VARCHAR(500),
  hidden_talent VARCHAR(255),
  bucket_list_item VARCHAR(255),
  nomination_count INT DEFAULT 0,
  points_awarded INT DEFAULT 100,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_spotlight_week (spotlight_week),
  INDEX idx_spotlight_employee (employee_id)
);

CREATE TABLE IF NOT EXISTS employee_spotlight_nomination (
  id CHAR(36) PRIMARY KEY,
  nominee_id CHAR(36) NOT NULL,
  nominator_id CHAR(36) NOT NULL,
  reason TEXT,
  nomination_week DATE,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_nomination (nominee_id, nominator_id, nomination_week),
  INDEX idx_nomination_week (nomination_week)
);

-- ============================================================================
-- FEATURE 16: Virtual Coffee Roulette
-- ============================================================================

CREATE TABLE IF NOT EXISTS coffee_roulette_opt_in (
  id CHAR(36) PRIMARY KEY,
  employee_id CHAR(36) NOT NULL UNIQUE,
  is_active BOOLEAN DEFAULT TRUE,
  preferred_days SET('monday','tuesday','wednesday','thursday','friday'),
  last_paired_date DATE,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_coffee_active (is_active)
);

CREATE TABLE IF NOT EXISTS coffee_roulette_pairing (
  id CHAR(36) PRIMARY KEY,
  employee_1_id CHAR(36) NOT NULL,
  employee_2_id CHAR(36) NOT NULL,
  pairing_week DATE NOT NULL,
  meeting_date DATETIME,
  status ENUM('scheduled', 'completed', 'skipped', 'rescheduled') DEFAULT 'scheduled',
  points_awarded_1 BOOLEAN DEFAULT FALSE,
  points_awarded_2 BOOLEAN DEFAULT FALSE,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_pairing_week (pairing_week),
  INDEX idx_pairing_emp1 (employee_1_id, pairing_week),
  INDEX idx_pairing_emp2 (employee_2_id, pairing_week)
);

-- ============================================================================
-- FEATURE 17: Icebreaker Questions
-- ============================================================================

CREATE TABLE IF NOT EXISTS icebreaker_question (
  id CHAR(36) PRIMARY KEY,
  question_text VARCHAR(255) NOT NULL,
  category ENUM('fun', 'career', 'preference', 'hypothetical') DEFAULT 'fun',
  is_active BOOLEAN DEFAULT TRUE,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS employee_icebreaker_answer (
  id CHAR(36) PRIMARY KEY,
  employee_id CHAR(36) NOT NULL,
  question_id CHAR(36) NOT NULL,
  answer TEXT,
  answered_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_icebreaker_answer (employee_id, question_id),
  INDEX idx_icebreaker_employee (employee_id)
);

-- Seed some icebreaker questions
INSERT IGNORE INTO icebreaker_question (id, question_text, category) VALUES
  (UUID(), 'If you could have any superpower, what would it be?', 'hypothetical'),
  (UUID(), 'What''s your go-to comfort food?', 'preference'),
  (UUID(), 'What''s the best advice you''ve ever received?', 'career'),
  (UUID(), 'If you weren''t in this profession, what would you be doing?', 'hypothetical'),
  (UUID(), 'What''s on your bucket list?', 'fun'),
  (UUID(), 'What''s your hidden talent?', 'fun'),
  (UUID(), 'Morning person or night owl?', 'preference'),
  (UUID(), 'What''s a skill you''d love to learn?', 'career'),
  (UUID(), 'What''s your favorite way to unwind after work?', 'preference'),
  (UUID(), 'If you could travel anywhere, where would it be?', 'hypothetical');

-- ============================================================================
-- Seed sample daily tips
-- ============================================================================

INSERT IGNORE INTO daily_tip (id, tip_date, category, title, content, source) VALUES
  (UUID(), CURDATE(), 'productivity', 'The 2-Minute Rule',
   'If a task takes less than 2 minutes to complete, do it immediately. This prevents small tasks from piling up and cluttering your to-do list.',
   'Productivity Team'),
  (UUID(), DATE_ADD(CURDATE(), INTERVAL 1 DAY), 'tech', 'Excel Shortcut',
   'Press Ctrl+; to instantly insert today''s date in any cell. No more typing dates manually!',
   'IT Tips'),
  (UUID(), DATE_ADD(CURDATE(), INTERVAL 2 DAY), 'wellness', 'Take a Walk',
   'Studies show that a 5-minute walk every hour can boost productivity by 15% and reduce stress significantly.',
   'Wellness Team'),
  (UUID(), DATE_ADD(CURDATE(), INTERVAL 3 DAY), 'company', 'Did You Know?',
   'MAS Callnet was founded in 2008 and has grown to serve clients across multiple industries with offices in Noida and Ahmedabad.',
   'HR Team'),
  (UUID(), DATE_ADD(CURDATE(), INTERVAL 4 DAY), 'communication', 'Email Tip',
   'Use the "5 Sentences" rule - keep your emails to 5 sentences or less. It respects the reader''s time and increases response rates.',
   'Communication Team');

-- ============================================================================
-- Seed sample trivia questions
-- ============================================================================

INSERT IGNORE INTO daily_trivia_question (id, question_date, question_text, category, option_a, option_b, option_c, option_d, correct_option, explanation) VALUES
  (UUID(), CURDATE(), 'In what year was MAS Callnet founded?', 'company',
   '2005', '2008', '2010', '2012', 'B',
   'MAS Callnet was established in 2008 and has been growing ever since!'),
  (UUID(), DATE_ADD(CURDATE(), INTERVAL 1 DAY), 'Which keyboard shortcut copies selected text?', 'general',
   'Ctrl+V', 'Ctrl+X', 'Ctrl+C', 'Ctrl+Z', 'C',
   'Ctrl+C copies, Ctrl+V pastes, Ctrl+X cuts, and Ctrl+Z undoes.'),
  (UUID(), DATE_ADD(CURDATE(), INTERVAL 2 DAY), 'What does KPI stand for?', 'industry',
   'Key Performance Indicator', 'Knowledge Process Index', 'Key Process Integration', 'Knowledge Performance Index', 'A',
   'KPI stands for Key Performance Indicator - a measurable value that shows how effectively goals are being achieved.');

-- ============================================================================
-- Seed sample word puzzles
-- ============================================================================

INSERT IGNORE INTO daily_word_puzzle (id, puzzle_date, word, hint, category, difficulty) VALUES
  (UUID(), CURDATE(), 'TEAMS', 'Groups working together', 'HR Terms', 'easy'),
  (UUID(), DATE_ADD(CURDATE(), INTERVAL 1 DAY), 'GOALS', 'What you aim to achieve', 'HR Terms', 'easy'),
  (UUID(), DATE_ADD(CURDATE(), INTERVAL 2 DAY), 'FOCUS', 'Concentrate on the task', 'Productivity', 'medium'),
  (UUID(), DATE_ADD(CURDATE(), INTERVAL 3 DAY), 'LEARN', 'Gain knowledge', 'HR Terms', 'easy'),
  (UUID(), DATE_ADD(CURDATE(), INTERVAL 4 DAY), 'TRUST', 'Foundation of teamwork', 'Company Values', 'medium');

-- ============================================================================
-- Seed sample brain teasers
-- ============================================================================

INSERT IGNORE INTO brain_teaser (id, teaser_date, category, question, answer, hint_1, hint_2, explanation, difficulty) VALUES
  (UUID(), CURDATE(), 'logic',
   'A bat and a ball cost $1.10 in total. The bat costs $1.00 more than the ball. How much does the ball cost?',
   '5 cents', 'It''s not 10 cents', 'Think about the difference, not just the total',
   'If the ball costs X, the bat costs X + $1. So X + (X + $1) = $1.10. Therefore 2X = $0.10, so X = $0.05 (5 cents).',
   'medium'),
  (UUID(), DATE_ADD(CURDATE(), INTERVAL 1 DAY), 'pattern',
   'What comes next in the sequence: 2, 6, 12, 20, 30, ?',
   '42', 'Look at the differences between numbers', 'The differences increase by 2 each time',
   'The differences are 4, 6, 8, 10, 12. Next difference is 12, so 30 + 12 = 42.',
   'medium'),
  (UUID(), DATE_ADD(CURDATE(), INTERVAL 2 DAY), 'riddle',
   'I have cities, but no houses. I have mountains, but no trees. I have water, but no fish. What am I?',
   'A map', 'You can find me on a wall or in your phone', 'I help you navigate',
   'A map has representations of cities, mountains, and water, but none of the actual things.',
   'easy');

SELECT 'Daily Engagement Games migration completed successfully' AS status;
