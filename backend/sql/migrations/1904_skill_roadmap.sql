-- Migration 448: Skill Roadmap (developer-roadmap.sh integration)
-- Additive only. Safe to re-run (IF NOT EXISTS / INSERT IGNORE).

-- Catalogue of roadmaps imported from nilbuild/developer-roadmap
CREATE TABLE IF NOT EXISTS skill_roadmaps (
  id            VARCHAR(64)  NOT NULL,          -- slug, e.g. "qa", "backend"
  label         VARCHAR(128) NOT NULL,
  description   TEXT,
  node_count    INT          NOT NULL DEFAULT 0,
  is_active     TINYINT(1)   NOT NULL DEFAULT 1,
  created_at    DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at    DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Individual skill nodes within a roadmap
CREATE TABLE IF NOT EXISTS skill_roadmap_nodes (
  id            VARCHAR(128) NOT NULL,          -- "<roadmap_id>:<node_slug>"
  roadmap_id    VARCHAR(64)  NOT NULL,
  node_slug     VARCHAR(64)  NOT NULL,
  label         VARCHAR(256) NOT NULL,
  description   TEXT,
  sort_order    INT          NOT NULL DEFAULT 0,
  is_active     TINYINT(1)   NOT NULL DEFAULT 1,
  created_at    DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_srn_roadmap (roadmap_id),
  CONSTRAINT fk_srn_roadmap FOREIGN KEY (roadmap_id) REFERENCES skill_roadmaps(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Per-employee skill state
CREATE TABLE IF NOT EXISTS employee_skill_states (
  id            CHAR(36)     NOT NULL,
  employee_id   CHAR(36)     NOT NULL,
  roadmap_id    VARCHAR(64)  NOT NULL,
  node_id       VARCHAR(128) NOT NULL,
  status        ENUM('none','in_progress','done') NOT NULL DEFAULT 'none',
  updated_by    CHAR(36),
  notes         TEXT,
  updated_at    DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  created_at    DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_ess_emp_node (employee_id, node_id),
  KEY idx_ess_employee (employee_id),
  KEY idx_ess_roadmap  (employee_id, roadmap_id),
  CONSTRAINT fk_ess_node FOREIGN KEY (node_id) REFERENCES skill_roadmap_nodes(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Which roadmaps are assigned to which employee
CREATE TABLE IF NOT EXISTS employee_roadmap_assignments (
  id            CHAR(36)    NOT NULL,
  employee_id   CHAR(36)    NOT NULL,
  roadmap_id    VARCHAR(64) NOT NULL,
  assigned_by   CHAR(36),
  assigned_at   DATETIME    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  is_active     TINYINT(1)  NOT NULL DEFAULT 1,
  PRIMARY KEY (id),
  UNIQUE KEY uq_era (employee_id, roadmap_id),
  KEY idx_era_employee (employee_id),
  CONSTRAINT fk_era_roadmap FOREIGN KEY (roadmap_id) REFERENCES skill_roadmaps(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Required skills per designation (links role to roadmap nodes)
CREATE TABLE IF NOT EXISTS designation_required_skills (
  id              CHAR(36)     NOT NULL,
  designation_id  CHAR(36)     NOT NULL,
  node_id         VARCHAR(128) NOT NULL,
  created_by      CHAR(36),
  created_at      DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_drs (designation_id, node_id),
  CONSTRAINT fk_drs_node FOREIGN KEY (node_id) REFERENCES skill_roadmap_nodes(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Seed roadmaps relevant to BPO/call-centre workforce
INSERT IGNORE INTO skill_roadmaps (id, label, description, node_count) VALUES
  ('qa',           'QA Engineer',       'Software Quality Assurance roadmap',          146),
  ('data-analyst', 'Data Analyst',      'Data Analysis & BI roadmap',                  102),
  ('backend',      'Backend Developer', 'Backend software development roadmap',         156),
  ('frontend',     'Frontend Developer','Frontend web development roadmap',             140),
  ('python',       'Python',            'Python programming language roadmap',           86),
  ('sql',          'SQL',               'SQL & relational databases roadmap',            112),
  ('excel',        'Excel / BI',        'Excel and business intelligence skills',        40),
  ('prompt-engineering', 'Prompt Engineering', 'AI prompt engineering skills',          60),
  ('cyber-security',     'Cyber Security',     'Cybersecurity fundamentals roadmap',    130);
