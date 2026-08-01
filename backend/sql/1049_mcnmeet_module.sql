-- MCNmeet Meetings & Broadcasts Module
-- Migration: 1049_mcnmeet_module.sql
-- Safe to run multiple times (IF NOT EXISTS)

CREATE TABLE IF NOT EXISTS mcnmeet_meeting (
  id              VARCHAR(36) PRIMARY KEY,
  meeting_code    VARCHAR(20) NOT NULL UNIQUE,
  title           VARCHAR(255) NOT NULL,
  description     TEXT,
  meeting_type    ENUM('team_meeting','live_broadcast','training_induction','interview','coaching_1on1','compliance_policy') NOT NULL DEFAULT 'team_meeting',
  status          ENUM('draft','scheduled','live','completed','cancelled') NOT NULL DEFAULT 'scheduled',
  host_employee_id VARCHAR(36) NOT NULL,
  co_host_ids     JSON,
  start_at        DATETIME NOT NULL,
  end_at          DATETIME,
  duration_minutes INT,
  timezone        VARCHAR(50) DEFAULT 'Asia/Kolkata',
  mcnmeet_room_name VARCHAR(80) NOT NULL,
  mcnmeet_join_url  VARCHAR(255) NOT NULL,
  google_meet_backup_url VARCHAR(255),
  recording_required TINYINT(1) DEFAULT 0,
  attendance_required TINYINT(1) DEFAULT 0,
  acknowledgement_required TINYINT(1) DEFAULT 0,
  recording_url   VARCHAR(500),
  created_by      VARCHAR(36) NOT NULL,
  created_at      DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at      DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  cancelled_at    DATETIME,
  cancelled_by    VARCHAR(36),
  cancel_reason   TEXT,
  INDEX idx_meeting_status (status),
  INDEX idx_meeting_start (start_at),
  INDEX idx_meeting_host (host_employee_id),
  INDEX idx_meeting_type (meeting_type)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS mcnmeet_meeting_audience (
  id              VARCHAR(36) PRIMARY KEY,
  meeting_id      VARCHAR(36) NOT NULL,
  audience_type   ENUM('all_company','branch','department','process','lob','designation','reporting_manager_team','selected_employees') NOT NULL,
  audience_value  VARCHAR(255),
  audience_label  VARCHAR(255),
  created_at      DATETIME DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_audience_meeting (meeting_id),
  CONSTRAINT fk_audience_meeting FOREIGN KEY (meeting_id) REFERENCES mcnmeet_meeting(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS mcnmeet_meeting_invitee (
  id                      VARCHAR(36) PRIMARY KEY,
  meeting_id              VARCHAR(36) NOT NULL,
  employee_id             VARCHAR(36) NOT NULL,
  invite_status           ENUM('pending','accepted','declined') DEFAULT 'pending',
  joined_status           ENUM('not_joined','joined','late') DEFAULT 'not_joined',
  acknowledgement_status  ENUM('pending','acknowledged') DEFAULT 'pending',
  joined_at               DATETIME,
  left_at                 DATETIME,
  duration_seconds        INT,
  remarks                 TEXT,
  created_at              DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at              DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uk_meeting_employee (meeting_id, employee_id),
  INDEX idx_invitee_meeting (meeting_id),
  INDEX idx_invitee_employee (employee_id),
  CONSTRAINT fk_invitee_meeting FOREIGN KEY (meeting_id) REFERENCES mcnmeet_meeting(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS mcnmeet_meeting_event (
  id              VARCHAR(36) PRIMARY KEY,
  meeting_id      VARCHAR(36) NOT NULL,
  event_type      ENUM('created','scheduled','started','ended','cancelled','recording_added','invitees_resolved','attendance_marked') NOT NULL,
  actor_id        VARCHAR(36),
  event_data      JSON,
  created_at      DATETIME DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_event_meeting (meeting_id),
  CONSTRAINT fk_event_meeting FOREIGN KEY (meeting_id) REFERENCES mcnmeet_meeting(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
