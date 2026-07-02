-- Performance Feedback System Schema
-- Migration: 037_performance_feedback.sql
-- Purpose: 360-degree feedback, competency tracking, and development planning

-- ============================================================================
-- Table 1: performance_feedback_cycle
-- Purpose: Define feedback collection periods (quarterly, annual, ad-hoc)
-- ============================================================================
CREATE TABLE IF NOT EXISTS performance_feedback_cycle (
    cycle_id CHAR(36) PRIMARY KEY DEFAULT (UUID()),
    cycle_name VARCHAR(100) NOT NULL,
    start_date DATE NOT NULL,
    end_date DATE NOT NULL,
    status ENUM('draft', 'active', 'closed') DEFAULT 'draft',
    feedback_type ENUM('360', 'manager-only', 'peer-only', 'self') DEFAULT '360',
    appraisal_cycle_id CHAR(36) NULL, -- Optional link to appraisal_cycle
    created_by CHAR(36) NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_status (status),
    INDEX idx_dates (start_date, end_date),
    FOREIGN KEY (created_by) REFERENCES employees(id) ON DELETE RESTRICT,
    FOREIGN KEY (appraisal_cycle_id) REFERENCES appraisal_cycle(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ============================================================================
-- Table 2: competency_master
-- Purpose: Define competencies to evaluate (Communication, Leadership, etc.)
-- ============================================================================
CREATE TABLE IF NOT EXISTS competency_master (
    competency_id INT AUTO_INCREMENT PRIMARY KEY,
    competency_name VARCHAR(100) NOT NULL UNIQUE,
    description TEXT,
    category ENUM('core', 'leadership', 'technical', 'behavioral') DEFAULT 'core',
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_category (category),
    INDEX idx_active (is_active)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ============================================================================
-- Table 3: performance_feedback_request
-- Purpose: Individual feedback requests (e.g., John asks 3 peers + 1 manager)
-- ============================================================================
CREATE TABLE IF NOT EXISTS performance_feedback_request (
    request_id CHAR(36) PRIMARY KEY DEFAULT (UUID()),
    cycle_id CHAR(36) NOT NULL,
    employee_id CHAR(36) NOT NULL, -- Subject being evaluated
    reviewer_id CHAR(36) NOT NULL, -- Person giving feedback
    reviewer_type ENUM('manager', 'peer', 'direct-report', 'self') NOT NULL,
    status ENUM('pending', 'completed', 'declined', 'expired') DEFAULT 'pending',
    requested_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    completed_at TIMESTAMP NULL,
    reminder_sent_at TIMESTAMP NULL,
    FOREIGN KEY (cycle_id) REFERENCES performance_feedback_cycle(cycle_id) ON DELETE CASCADE,
    FOREIGN KEY (employee_id) REFERENCES employees(id) ON DELETE CASCADE,
    FOREIGN KEY (reviewer_id) REFERENCES employees(id) ON DELETE CASCADE,
    INDEX idx_cycle_employee (cycle_id, employee_id),
    INDEX idx_reviewer_status (reviewer_id, status),
    UNIQUE KEY unique_review (cycle_id, employee_id, reviewer_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ============================================================================
-- Table 4: performance_feedback_response
-- Purpose: Store actual feedback submissions (ratings + comments)
-- ============================================================================
CREATE TABLE IF NOT EXISTS performance_feedback_response (
    response_id CHAR(36) PRIMARY KEY DEFAULT (UUID()),
    request_id CHAR(36) NOT NULL,
    competency_id INT NOT NULL,
    rating TINYINT NOT NULL CHECK (rating BETWEEN 1 AND 5), -- 1=Poor, 5=Excellent
    comments TEXT,
    submitted_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (request_id) REFERENCES performance_feedback_request(request_id) ON DELETE CASCADE,
    FOREIGN KEY (competency_id) REFERENCES competency_master(competency_id) ON DELETE RESTRICT,
    INDEX idx_request (request_id),
    INDEX idx_competency (competency_id),
    UNIQUE KEY unique_response (request_id, competency_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ============================================================================
-- Table 5: performance_feedback_report
-- Purpose: Aggregated results per employee per cycle (avg scores, strengths, gaps)
-- ============================================================================
CREATE TABLE IF NOT EXISTS performance_feedback_report (
    report_id CHAR(36) PRIMARY KEY DEFAULT (UUID()),
    cycle_id CHAR(36) NOT NULL,
    employee_id CHAR(36) NOT NULL,
    overall_score DECIMAL(3, 2), -- Average of all competencies (1.00 - 5.00)
    strengths TEXT, -- Top 3 competencies
    development_areas TEXT, -- Bottom 3 competencies
    total_reviewers INT DEFAULT 0,
    manager_feedback TEXT, -- Summary from direct manager
    report_generated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    shared_with_employee_at TIMESTAMP NULL,
    FOREIGN KEY (cycle_id) REFERENCES performance_feedback_cycle(cycle_id) ON DELETE CASCADE,
    FOREIGN KEY (employee_id) REFERENCES employees(id) ON DELETE CASCADE,
    INDEX idx_cycle_employee (cycle_id, employee_id),
    INDEX idx_overall_score (overall_score),
    UNIQUE KEY unique_report (cycle_id, employee_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ============================================================================
-- Table 6: development_plan
-- Purpose: Action plans created from feedback (training, projects, mentoring)
-- ============================================================================
CREATE TABLE IF NOT EXISTS development_plan (
    plan_id CHAR(36) PRIMARY KEY DEFAULT (UUID()),
    report_id CHAR(36) NOT NULL,
    employee_id CHAR(36) NOT NULL,
    manager_id CHAR(36) NOT NULL,
    plan_start_date DATE NOT NULL,
    plan_end_date DATE NOT NULL,
    status ENUM('draft', 'active', 'completed', 'cancelled') DEFAULT 'draft',
    overall_notes TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (report_id) REFERENCES performance_feedback_report(report_id) ON DELETE CASCADE,
    FOREIGN KEY (employee_id) REFERENCES employees(id) ON DELETE CASCADE,
    FOREIGN KEY (manager_id) REFERENCES employees(id) ON DELETE RESTRICT,
    INDEX idx_employee_status (employee_id, status),
    INDEX idx_dates (plan_start_date, plan_end_date)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ============================================================================
-- Table 7: development_plan_goal
-- Purpose: Individual SMART goals within a development plan
-- ============================================================================
CREATE TABLE IF NOT EXISTS development_plan_goal (
    goal_id CHAR(36) PRIMARY KEY DEFAULT (UUID()),
    plan_id CHAR(36) NOT NULL,
    competency_id INT NULL, -- Link to competency being developed
    goal_description TEXT NOT NULL,
    action_steps TEXT, -- What the employee will do
    success_criteria TEXT, -- How success will be measured
    target_date DATE,
    status ENUM('not-started', 'in-progress', 'completed', 'deferred') DEFAULT 'not-started',
    progress_notes TEXT,
    training_need_id CHAR(36) NULL, -- Link to training_need table if training required
    completed_at TIMESTAMP NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (plan_id) REFERENCES development_plan(plan_id) ON DELETE CASCADE,
    FOREIGN KEY (competency_id) REFERENCES competency_master(competency_id) ON DELETE SET NULL,
    FOREIGN KEY (training_need_id) REFERENCES training_need(id) ON DELETE SET NULL,
    INDEX idx_plan_status (plan_id, status),
    INDEX idx_target_date (target_date)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ============================================================================
-- Seed Data: 10 Default Competencies
-- ============================================================================
INSERT INTO competency_master (competency_name, description, category) VALUES
('Communication', 'Ability to clearly convey information and listen effectively', 'core'),
('Teamwork', 'Collaborates well with others and contributes to team success', 'core'),
('Problem Solving', 'Identifies issues and develops effective solutions', 'core'),
('Accountability', 'Takes ownership of responsibilities and delivers results', 'core'),
('Adaptability', 'Adjusts to changing circumstances and embraces new approaches', 'behavioral'),
('Leadership', 'Guides and motivates others to achieve goals', 'leadership'),
('Time Management', 'Prioritizes tasks and meets deadlines consistently', 'behavioral'),
('Customer Focus', 'Understands and meets internal/external customer needs', 'core'),
('Technical Skills', 'Demonstrates proficiency in job-specific competencies', 'technical'),
('Initiative', 'Proactively identifies opportunities and takes action', 'behavioral')
ON DUPLICATE KEY UPDATE updated_at = CURRENT_TIMESTAMP;

-- ============================================================================
-- Verification Queries (commented out - use for manual testing)
-- ============================================================================
-- SELECT COUNT(*) AS table_count FROM information_schema.TABLES
-- WHERE TABLE_SCHEMA = 'mas_hrms'
-- AND TABLE_NAME IN ('performance_feedback_cycle', 'performance_feedback_request',
--                     'competency_master', 'performance_feedback_response',
--                     'performance_feedback_report', 'development_plan', 'development_plan_goal');

-- SELECT competency_id, competency_name, category FROM competency_master WHERE is_active = TRUE;
