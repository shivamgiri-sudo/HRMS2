-- Create missing engagement/gamification tables

-- Employee badges earned
CREATE TABLE IF NOT EXISTS employee_badge_earned (
  earned_id CHAR(36) PRIMARY KEY,
  employee_id CHAR(36) NOT NULL,
  badge_id CHAR(36) NOT NULL,
  earned_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  reason TEXT,
  awarded_by CHAR(36),
  metadata_json JSON,
  INDEX idx_employee (employee_id),
  INDEX idx_badge (badge_id),
  FOREIGN KEY (employee_id) REFERENCES employees(id) ON DELETE CASCADE,
  FOREIGN KEY (badge_id) REFERENCES gamification_badge_master(badge_id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Gamification points ledger
CREATE TABLE IF NOT EXISTS gamification_points_ledger (
  transaction_id CHAR(36) PRIMARY KEY,
  employee_id CHAR(36) NOT NULL,
  points_delta INT NOT NULL,
  transaction_type VARCHAR(50) NOT NULL,
  reference_id CHAR(36),
  description TEXT,
  balance_after INT NOT NULL DEFAULT 0,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_employee (employee_id),
  INDEX idx_type (transaction_type),
  INDEX idx_created (created_at),
  FOREIGN KEY (employee_id) REFERENCES employees(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Gamification tier master
CREATE TABLE IF NOT EXISTS gamification_tier_master (
  tier_id CHAR(36) PRIMARY KEY,
  tier_name VARCHAR(100) NOT NULL,
  tier_level INT NOT NULL UNIQUE,
  min_points INT NOT NULL,
  max_points INT,
  tier_color VARCHAR(20),
  tier_icon VARCHAR(255),
  benefits_json JSON,
  is_active TINYINT(1) NOT NULL DEFAULT 1,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_level (tier_level),
  INDEX idx_points (min_points, max_points),
  INDEX idx_active (is_active)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Employee tier status
CREATE TABLE IF NOT EXISTS employee_tier_status (
  status_id CHAR(36) PRIMARY KEY,
  employee_id CHAR(36) NOT NULL UNIQUE,
  current_tier_id CHAR(36),
  total_points INT NOT NULL DEFAULT 0,
  points_to_next_tier INT,
  tier_achieved_at TIMESTAMP,
  last_updated TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_employee (employee_id),
  INDEX idx_tier (current_tier_id),
  FOREIGN KEY (employee_id) REFERENCES employees(id) ON DELETE CASCADE,
  FOREIGN KEY (current_tier_id) REFERENCES gamification_tier_master(tier_id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Kudos templates
CREATE TABLE IF NOT EXISTS kudos_templates (
  kudos_template_id CHAR(36) PRIMARY KEY,
  kudos_title VARCHAR(255) NOT NULL,
  kudos_message_template TEXT,
  kudos_icon VARCHAR(255),
  points_value INT NOT NULL DEFAULT 0,
  is_active TINYINT(1) NOT NULL DEFAULT 1,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Kudos sent
CREATE TABLE IF NOT EXISTS kudos_sent (
  kudos_id CHAR(36) PRIMARY KEY,
  sender_id CHAR(36) NOT NULL,
  receiver_id CHAR(36) NOT NULL,
  kudos_template_id CHAR(36),
  custom_message TEXT,
  points_awarded INT NOT NULL DEFAULT 0,
  is_anonymous TINYINT(1) NOT NULL DEFAULT 0,
  sent_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_sender (sender_id),
  INDEX idx_receiver (receiver_id),
  INDEX idx_sent_at (sent_at),
  FOREIGN KEY (sender_id) REFERENCES employees(id) ON DELETE CASCADE,
  FOREIGN KEY (receiver_id) REFERENCES employees(id) ON DELETE CASCADE,
  FOREIGN KEY (kudos_template_id) REFERENCES kudos_templates(kudos_template_id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Kudos reactions
CREATE TABLE IF NOT EXISTS kudos_reactions (
  reaction_id CHAR(36) PRIMARY KEY,
  kudos_id CHAR(36) NOT NULL,
  employee_id CHAR(36) NOT NULL,
  reaction_type VARCHAR(50) NOT NULL DEFAULT 'like',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uk_kudos_employee (kudos_id, employee_id),
  FOREIGN KEY (kudos_id) REFERENCES kudos_sent(kudos_id) ON DELETE CASCADE,
  FOREIGN KEY (employee_id) REFERENCES employees(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Survey master
CREATE TABLE IF NOT EXISTS survey_master (
  survey_id CHAR(36) PRIMARY KEY,
  survey_title VARCHAR(255) NOT NULL,
  survey_description TEXT,
  survey_type VARCHAR(50) NOT NULL DEFAULT 'feedback',
  points_reward INT NOT NULL DEFAULT 0,
  is_anonymous TINYINT(1) NOT NULL DEFAULT 0,
  is_active TINYINT(1) NOT NULL DEFAULT 1,
  start_date DATE,
  end_date DATE,
  created_by CHAR(36),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Survey questions
CREATE TABLE IF NOT EXISTS survey_questions (
  question_id CHAR(36) PRIMARY KEY,
  survey_id CHAR(36) NOT NULL,
  question_text TEXT NOT NULL,
  question_type VARCHAR(50) NOT NULL,
  options_json JSON,
  scale_min INT,
  scale_max INT,
  is_required TINYINT(1) NOT NULL DEFAULT 1,
  display_order INT NOT NULL DEFAULT 0,
  INDEX idx_survey (survey_id),
  FOREIGN KEY (survey_id) REFERENCES survey_master(survey_id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Survey responses
CREATE TABLE IF NOT EXISTS survey_response (
  response_id CHAR(36) PRIMARY KEY,
  survey_id CHAR(36) NOT NULL,
  employee_id CHAR(36),
  responses_json JSON NOT NULL,
  submitted_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_survey (survey_id),
  INDEX idx_employee (employee_id),
  FOREIGN KEY (survey_id) REFERENCES survey_master(survey_id) ON DELETE CASCADE,
  FOREIGN KEY (employee_id) REFERENCES employees(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Pulse checks
CREATE TABLE IF NOT EXISTS pulse_check (
  pulse_id CHAR(36) PRIMARY KEY,
  employee_id CHAR(36) NOT NULL,
  mood_score INT NOT NULL CHECK (mood_score BETWEEN 1 AND 5),
  feedback_text TEXT,
  submitted_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_employee (employee_id),
  INDEX idx_submitted (submitted_at),
  FOREIGN KEY (employee_id) REFERENCES employees(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Insert default tiers if none exist
INSERT IGNORE INTO gamification_tier_master (tier_id, tier_name, tier_level, min_points, max_points, tier_color, is_active)
VALUES
  (UUID(), 'Bronze', 1, 0, 499, '#CD7F32', 1),
  (UUID(), 'Silver', 2, 500, 999, '#C0C0C0', 1),
  (UUID(), 'Gold', 3, 1000, 1999, '#FFD700', 1),
  (UUID(), 'Platinum', 4, 2000, NULL, '#E5E4E2', 1);

-- Insert default kudos templates if none exist
INSERT IGNORE INTO kudos_templates (kudos_template_id, kudos_title, kudos_message_template, points_value, is_active)
VALUES
  (UUID(), 'Great Work', 'Awesome job on this!', 10, 1),
  (UUID(), 'Team Player', 'Thanks for being such a great team player!', 15, 1),
  (UUID(), 'Problem Solver', 'Great problem solving skills!', 20, 1),
  (UUID(), 'Helpful', 'Thanks for helping out!', 10, 1),
  (UUID(), 'Going Above & Beyond', 'You went above and beyond!', 25, 1);
