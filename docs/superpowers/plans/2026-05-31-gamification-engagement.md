# Gamification & Engagement Module Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

> **Implementation status (2026-06-01):** Executed against the repository's current schema and service contracts. The document below is duplicated and includes stale examples such as badge codes and migration `025`; the implemented migrations are `038_engagement_gamification.sql` and additive `039_engagement_activity_badges.sql`. The delivered slice includes the five pages, shared components, API registration, fail-open payroll/WFM/KPI/survey hooks, daily tenure scheduling, and focused tests.

**Goal:** Build standalone engagement module with badges, points, tiers, kudos, surveys, pulse checks, and leaderboards

**Architecture:** Standalone `/backend/src/modules/engagement/` module following mas-callnet-hrms pattern. Activity tracking via explicit hooks in payroll/attendance/KPI modules. Frontend: 5 new pages + shared components.

**Tech Stack:** TypeScript, Express, MySQL, React, Zod, jsPDF

---

## File Structure

### Backend

```
/backend/src/modules/engagement/
├── engagement.types.ts          - TypeScript interfaces
├── engagement.validation.ts     - Zod schemas
├── engagement.service.ts        - Core business logic
├── engagement.controller.ts     - Request handlers
├── engagement.routes.ts         - API routes
├── badge.service.ts             - Badge award logic
├── kudos.service.ts             - Kudos creation
├── survey.service.ts            - Survey/pulse logic
└── gamification.service.ts      - Points, tiers, leaderboards
```

### Database

```
/backend/sql/
└── 025_engagement_gamification.sql  - All gamification tables
```

### Frontend

```
/src/pages/
├── NativeEngagement.tsx         - Main dashboard
├── NativeBadges.tsx             - Badge gallery
├── NativeKudos.tsx              - Kudos wall
├── NativeSurveys.tsx            - Survey center
└── NativeLeaderboard.tsx        - Leaderboard views

/src/components/engagement/
├── BadgeCard.tsx                - Badge display component
├── KudosCard.tsx                - Kudos message card
├── TierBadge.tsx                - Tier indicator
├── PointsDisplay.tsx            - Animated point counter
└── SurveyQuestionRenderer.tsx   - Dynamic question renderer
```

---

## Task 1: Database Schema & Seeding

**Files:**
- Create: `backend/sql/025_engagement_gamification.sql`

- [ ] **Step 1: Write badge tables schema**

```sql
-- backend/sql/025_engagement_gamification.sql
-- Gamification & Engagement Module Schema

-- Badge master: defines all available badges
CREATE TABLE gamification_badge_master (
  id VARCHAR(36) PRIMARY KEY,
  badge_code VARCHAR(50) UNIQUE NOT NULL,
  badge_name VARCHAR(100) NOT NULL,
  badge_description TEXT,
  category ENUM('performance', 'activity', 'tenure', 'social') NOT NULL,
  icon_url VARCHAR(255),
  point_value INT DEFAULT 0,
  criteria_type ENUM('manual', 'auto_performance', 'auto_activity') NOT NULL,
  criteria_config JSON,
  is_active TINYINT(1) DEFAULT 1,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Employee badge achievements
CREATE TABLE employee_badge_earned (
  id VARCHAR(36) PRIMARY KEY,
  employee_id VARCHAR(36) NOT NULL,
  badge_id VARCHAR(36) NOT NULL,
  earned_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  awarded_by VARCHAR(36),
  evidence_ref VARCHAR(255),
  FOREIGN KEY (employee_id) REFERENCES employees(id),
  FOREIGN KEY (badge_id) REFERENCES gamification_badge_master(id),
  INDEX idx_employee_badges (employee_id, earned_at DESC)
);
```

- [ ] **Step 2: Write points & tier tables**

```sql
-- Append to backend/sql/025_engagement_gamification.sql

-- Point transaction log
CREATE TABLE gamification_point_log (
  id VARCHAR(36) PRIMARY KEY,
  employee_id VARCHAR(36) NOT NULL,
  points INT NOT NULL,
  source ENUM('badge_earned', 'kudos_received', 'survey_completed', 'manual_adjustment') NOT NULL,
  reference_id VARCHAR(36),
  awarded_by VARCHAR(36),
  awarded_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (employee_id) REFERENCES employees(id),
  INDEX idx_employee_points (employee_id, awarded_at DESC)
);

-- Tier definitions
CREATE TABLE gamification_tier (
  id VARCHAR(36) PRIMARY KEY,
  tier_name VARCHAR(50) NOT NULL,
  tier_level INT NOT NULL UNIQUE,
  min_points INT NOT NULL,
  badge_icon_url VARCHAR(255),
  benefits_description TEXT,
  is_active TINYINT(1) DEFAULT 1
);

-- Employee tier tracking
CREATE TABLE employee_gamification_tier (
  employee_id VARCHAR(36) PRIMARY KEY,
  tier_id VARCHAR(36) NOT NULL,
  total_points INT NOT NULL DEFAULT 0,
  tier_achieved_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (employee_id) REFERENCES employees(id),
  FOREIGN KEY (tier_id) REFERENCES gamification_tier(id)
);
```

- [ ] **Step 3: Write kudos tables**

```sql
-- Append to backend/sql/025_engagement_gamification.sql

-- Kudos/recognition
CREATE TABLE kudos_recognition (
  id VARCHAR(36) PRIMARY KEY,
  from_employee_id VARCHAR(36) NOT NULL,
  to_employee_id VARCHAR(36) NOT NULL,
  kudos_type ENUM('team_player', 'problem_solver', 'quality_champion', 'mentor') NOT NULL,
  message TEXT,
  points_awarded INT DEFAULT 10,
  is_public TINYINT(1) DEFAULT 1,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (from_employee_id) REFERENCES employees(id),
  FOREIGN KEY (to_employee_id) REFERENCES employees(id),
  INDEX idx_kudos_wall (created_at DESC, is_public)
);

-- Monthly kudos limit tracking
CREATE TABLE kudos_giver_limit (
  employee_id VARCHAR(36),
  month_year VARCHAR(7) NOT NULL,
  kudos_given_count INT DEFAULT 0,
  PRIMARY KEY (employee_id, month_year),
  FOREIGN KEY (employee_id) REFERENCES employees(id)
);
```

- [ ] **Step 4: Write survey & pulse tables**

```sql
-- Append to backend/sql/025_engagement_gamification.sql

-- Survey templates
CREATE TABLE survey_template (
  id VARCHAR(36) PRIMARY KEY,
  survey_title VARCHAR(200) NOT NULL,
  survey_description TEXT,
  is_anonymous TINYINT(1) DEFAULT 0,
  is_active TINYINT(1) DEFAULT 1,
  created_by VARCHAR(36) NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  start_date DATE,
  end_date DATE,
  FOREIGN KEY (created_by) REFERENCES users(id)
);

-- Survey questions
CREATE TABLE survey_question (
  id VARCHAR(36) PRIMARY KEY,
  survey_id VARCHAR(36) NOT NULL,
  question_text TEXT NOT NULL,
  question_type ENUM('multiple_choice', 'rating_scale', 'text', 'enps') NOT NULL,
  question_order INT NOT NULL,
  options JSON,
  is_required TINYINT(1) DEFAULT 1,
  FOREIGN KEY (survey_id) REFERENCES survey_template(id),
  INDEX idx_survey_questions (survey_id, question_order)
);

-- Survey responses
CREATE TABLE survey_response (
  id VARCHAR(36) PRIMARY KEY,
  survey_id VARCHAR(36) NOT NULL,
  employee_id VARCHAR(36),
  response_data JSON NOT NULL,
  submitted_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (survey_id) REFERENCES survey_template(id),
  FOREIGN KEY (employee_id) REFERENCES employees(id),
  INDEX idx_survey_responses (survey_id, submitted_at)
);

-- Pulse checks
CREATE TABLE pulse_check (
  id VARCHAR(36) PRIMARY KEY,
  pulse_question TEXT NOT NULL,
  pulse_type ENUM('emoji_scale', 'yes_no', 'rating_1_5') NOT NULL,
  created_by VARCHAR(36) NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  end_date DATE,
  is_active TINYINT(1) DEFAULT 1,
  FOREIGN KEY (created_by) REFERENCES users(id)
);

CREATE TABLE pulse_response (
  id VARCHAR(36) PRIMARY KEY,
  pulse_id VARCHAR(36) NOT NULL,
  employee_id VARCHAR(36) NOT NULL,
  response_value VARCHAR(50) NOT NULL,
  responded_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (pulse_id) REFERENCES pulse_check(id),
  FOREIGN KEY (employee_id) REFERENCES employees(id),
  UNIQUE KEY unique_pulse_response (pulse_id, employee_id)
);
```

- [ ] **Step 5: Add tier seeding data**

```sql
-- Append to backend/sql/025_engagement_gamification.sql

-- Seed tiers
INSERT INTO gamification_tier (id, tier_name, tier_level, min_points, benefits_description) VALUES
  (UUID(), 'Bronze', 1, 0, 'Welcome to the engagement program'),
  (UUID(), 'Silver', 2, 500, 'Custom profile badge + priority support'),
  (UUID(), 'Gold', 3, 1500, 'All Silver benefits + quarterly bonus eligibility'),
  (UUID(), 'Platinum', 4, 3000, 'All Gold benefits + exclusive recognition events');
```

- [ ] **Step 6: Add badge seeding data**

```sql
-- Append to backend/sql/025_engagement_gamification.sql

-- Seed standard badges
INSERT INTO gamification_badge_master (id, badge_code, badge_name, badge_description, category, point_value, criteria_type, criteria_config) VALUES
  (UUID(), 'top_performer_1mo', 'Top Performer Bronze', '1 month S-rating', 'performance', 50, 'auto_performance', '{"kpi_rating": "S", "months": 1}'),
  (UUID(), 'top_performer_2mo', 'Top Performer Silver', '2 consecutive months S-rating', 'performance', 75, 'auto_performance', '{"kpi_rating": "S", "months": 2}'),
  (UUID(), 'top_performer_3mo', 'Top Performer Gold', '3 consecutive months S-rating', 'performance', 100, 'auto_performance', '{"kpi_rating": "S", "months": 3}'),
  (UUID(), 'attendance_streak_30', 'Attendance Warrior', '30 consecutive days attendance', 'activity', 30, 'auto_activity', '{"streak_days": 30}'),
  (UUID(), 'attendance_streak_60', 'Attendance Champion', '60 consecutive days attendance', 'activity', 60, 'auto_activity', '{"streak_days": 60}'),
  (UUID(), 'attendance_streak_90', 'Attendance Legend', '90 consecutive days attendance', 'activity', 100, 'auto_activity', '{"streak_days": 90}'),
  (UUID(), 'early_bird', 'Early Bird', 'Clock-in before 9am for 20 days', 'activity', 25, 'auto_activity', '{"early_clock_in_days": 20}'),
  (UUID(), 'profile_complete', 'Profile Master', '100% profile completion', 'activity', 10, 'auto_activity', '{"profile_complete": true}'),
  (UUID(), 'payslip_champion', 'Payslip Champion', 'Acknowledge 10 consecutive payslips', 'activity', 40, 'auto_activity', '{"payslip_ack_streak": 10}'),
  (UUID(), 'tenure_6mo', '6 Months Strong', '6 months employment', 'tenure', 20, 'auto_activity', '{"tenure_months": 6}'),
  (UUID(), 'tenure_1yr', '1 Year Milestone', '1 year employment', 'tenure', 50, 'auto_activity', '{"tenure_months": 12}'),
  (UUID(), 'tenure_3yr', '3 Year Veteran', '3 years employment', 'tenure', 100, 'auto_activity', '{"tenure_months": 36}'),
  (UUID(), 'tenure_5yr', '5 Year Legend', '5 years employment', 'tenure', 200, 'auto_activity', '{"tenure_months": 60}'),
  (UUID(), 'kudos_giver_10', 'Generous Giver', 'Give 10 kudos', 'social', 15, 'auto_activity', '{"kudos_given": 10}'),
  (UUID(), 'kudos_receiver_10', 'Popular Colleague', 'Receive 10 kudos', 'social', 15, 'auto_activity', '{"kudos_received": 10}'),
  (UUID(), 'survey_champion', 'Survey Champion', 'Complete 5 surveys', 'activity', 25, 'auto_activity', '{"surveys_completed": 5}');
```

- [ ] **Step 7: Run migration**

Run: `cd /home/shuvam/mas-callnet-hrms/backend && mysql -u root -p < sql/025_engagement_gamification.sql`

Expected: Tables created, 4 tiers + 16 badges seeded

- [ ] **Step 8: Verify migration**

Run: `mysql -u root -p -e "SHOW TABLES LIKE 'gamification%'; SHOW TABLES LIKE 'kudos%'; SHOW TABLES LIKE 'survey%'; SHOW TABLES LIKE 'pulse%';" Shivamgiri`

Expected: 14 tables listed

- [ ] **Step 9: Commit**

```bash
git add backend/sql/025_engagement_gamification.sql
git commit -m "feat(engagement): add gamification database schema

- Badge master + employee badge tracking
- Points log + tier system (Bronze/Silver/Gold/Platinum)
- Kudos recognition + monthly limits
- Survey templates + responses
- Pulse checks + responses
- Seed 4 tiers + 16 standard badges"
```

---

## Task 2: TypeScript Types

**Files:**
- Create: `backend/src/modules/engagement/engagement.types.ts`

- [ ] **Step 1: Write badge types**

```typescript
// backend/src/modules/engagement/engagement.types.ts
export type BadgeCategory = 'performance' | 'activity' | 'tenure' | 'social';
export type BadgeCriteriaType = 'manual' | 'auto_performance' | 'auto_activity';

export interface Badge {
  id: string;
  badge_code: string;
  badge_name: string;
  badge_description: string | null;
  category: BadgeCategory;
  icon_url: string | null;
  point_value: number;
  criteria_type: BadgeCriteriaType;
  criteria_config: Record<string, any> | null;
  is_active: number;
  created_at: string;
}

export interface EmployeeBadgeEarned {
  id: string;
  employee_id: string;
  badge_id: string;
  earned_at: string;
  awarded_by: string | null;
  evidence_ref: string | null;
}
```

- [ ] **Step 2: Write point & tier types**

```typescript
// Append to backend/src/modules/engagement/engagement.types.ts

export type PointSource = 'badge_earned' | 'kudos_received' | 'survey_completed' | 'manual_adjustment';

export interface PointLog {
  id: string;
  employee_id: string;
  points: number;
  source: PointSource;
  reference_id: string | null;
  awarded_by: string | null;
  awarded_at: string;
}

export interface Tier {
  id: string;
  tier_name: string;
  tier_level: number;
  min_points: number;
  badge_icon_url: string | null;
  benefits_description: string | null;
  is_active: number;
}

export interface EmployeeTier {
  employee_id: string;
  tier_id: string;
  total_points: number;
  tier_achieved_at: string;
}

export interface LeaderboardEntry {
  rank: number;
  employee_id: string;
  employee_name: string;
  employee_code: string;
  total_points: number;
  badges_earned: number;
  tier_name: string | null;
}
```

- [ ] **Step 3: Write kudos types**

```typescript
// Append to backend/src/modules/engagement/engagement.types.ts

export type KudosType = 'team_player' | 'problem_solver' | 'quality_champion' | 'mentor';

export interface Kudos {
  id: string;
  from_employee_id: string;
  to_employee_id: string;
  kudos_type: KudosType;
  message: string | null;
  points_awarded: number;
  is_public: number;
  created_at: string;
}

export interface KudosCard {
  id: string;
  kudos_type: KudosType;
  message: string | null;
  points_awarded: number;
  created_at: string;
  from_employee_name: string;
  to_employee_name: string;
  to_employee_code: string;
}
```

- [ ] **Step 4: Write survey & pulse types**

```typescript
// Append to backend/src/modules/engagement/engagement.types.ts

export type QuestionType = 'multiple_choice' | 'rating_scale' | 'text' | 'enps';
export type PulseType = 'emoji_scale' | 'yes_no' | 'rating_1_5';

export interface Survey {
  id: string;
  survey_title: string;
  survey_description: string | null;
  is_anonymous: number;
  is_active: number;
  created_by: string;
  created_at: string;
  start_date: string | null;
  end_date: string | null;
}

export interface SurveyQuestion {
  id: string;
  survey_id: string;
  question_text: string;
  question_type: QuestionType;
  question_order: number;
  options: string[] | null;
  is_required: number;
}

export interface SurveyResponse {
  id: string;
  survey_id: string;
  employee_id: string | null;
  response_data: Record<string, string | number>;
  submitted_at: string;
}

export interface PulseCheck {
  id: string;
  pulse_question: string;
  pulse_type: PulseType;
  created_by: string;
  created_at: string;
  end_date: string | null;
  is_active: number;
}

export interface PulseResponse {
  id: string;
  pulse_id: string;
  employee_id: string;
  response_value: string;
  responded_at: string;
}
```

- [ ] **Step 5: Commit**

```bash
git add backend/src/modules/engagement/engagement.types.ts
git commit -m "feat(engagement): add TypeScript types for gamification

- Badge, EmployeeBadgeEarned
- PointLog, Tier, EmployeeTier, LeaderboardEntry
- Kudos, KudosCard types
- Survey, SurveyQuestion, SurveyResponse
- PulseCheck, PulseResponse"
```

---

## Task 3: Zod Validation Schemas

**Files:**
- Create: `backend/src/modules/engagement/engagement.validation.ts`

- [ ] **Step 1: Write badge validation schemas**

```typescript
// backend/src/modules/engagement/engagement.validation.ts
import { z } from "zod";

export const AwardBadgeSchema = z.object({
  employeeId: z.string().uuid(),
  badgeCode: z.string(),
});

export const BadgeProgressSchema = z.object({
  badgeId: z.string().uuid(),
  employeeId: z.string().uuid(),
});
```

- [ ] **Step 2: Write point & leaderboard schemas**

```typescript
// Append to backend/src/modules/engagement/engagement.validation.ts

export const PointAdjustmentSchema = z.object({
  employeeId: z.string().uuid(),
  points: z.number().int(),
  reason: z.string().min(1).max(500),
});

export const LeaderboardFiltersSchema = z.object({
  timeframe: z.enum(['monthly', 'quarterly', 'all_time']),
  processId: z.string().uuid().optional(),
  branchId: z.string().uuid().optional(),
});
```

- [ ] **Step 3: Write kudos validation schemas**

```typescript
// Append to backend/src/modules/engagement/engagement.validation.ts

export const GiveKudosSchema = z.object({
  toEmployeeId: z.string().uuid(),
  kudosType: z.enum(['team_player', 'problem_solver', 'quality_champion', 'mentor']),
  message: z.string().max(500).optional(),
  isPublic: z.boolean().default(true),
});

export const KudosWallFiltersSchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(50),
  kudosType: z.enum(['team_player', 'problem_solver', 'quality_champion', 'mentor']).optional(),
  dateRange: z.enum(['week', 'month', 'all']).optional(),
});
```

- [ ] **Step 4: Write survey validation schemas**

```typescript
// Append to backend/src/modules/engagement/engagement.validation.ts

export const CreateSurveySchema = z.object({
  title: z.string().min(1).max(200),
  description: z.string().max(1000).optional(),
  isAnonymous: z.boolean().default(false),
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  questions: z.array(z.object({
    text: z.string().min(1),
    type: z.enum(['multiple_choice', 'rating_scale', 'text', 'enps']),
    options: z.array(z.string()).optional(),
    isRequired: z.boolean().default(true),
  })).min(1),
});

export const SubmitSurveyResponseSchema = z.object({
  surveyId: z.string().uuid(),
  responses: z.record(z.union([z.string(), z.number()])),
});
```

- [ ] **Step 5: Write pulse validation schemas**

```typescript
// Append to backend/src/modules/engagement/engagement.validation.ts

export const CreatePulseSchema = z.object({
  pulseQuestion: z.string().min(1).max(500),
  pulseType: z.enum(['emoji_scale', 'yes_no', 'rating_1_5']),
  endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});

export const RespondToPulseSchema = z.object({
  pulseId: z.string().uuid(),
  responseValue: z.string().max(50),
});
```

- [ ] **Step 6: Commit**

```bash
git add backend/src/modules/engagement/engagement.validation.ts
git commit -m "feat(engagement): add Zod validation schemas

- Badge award, progress
- Point adjustment, leaderboard filters
- Kudos creation, kudos wall filters
- Survey creation, response submission
- Pulse creation, response submission"
```

---

## Task 4: Gamification Service (Points & Tiers)

**Files:**
- Create: `backend/src/modules/engagement/gamification.service.ts`

- [ ] **Step 1: Write recordPoints method**

```typescript
// backend/src/modules/engagement/gamification.service.ts
import { randomUUID } from "crypto";
import type { RowDataPacket } from "mysql2";
import { db } from "../../db/mysql.js";
import type { PointSource, LeaderboardEntry } from "./engagement.types.js";

export const gamificationService = {
  async recordPoints(
    employeeId: string,
    points: number,
    source: PointSource,
    referenceId: string | null,
    awardedBy: string | null = null
  ): Promise<{ totalPoints: number; pointsAdded: number }> {
    const logId = randomUUID();
    await db.execute(
      `INSERT INTO gamification_point_log (id, employee_id, points, source, reference_id, awarded_by)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [logId, employeeId, points, source, referenceId, awardedBy]
    );

    const [totals] = await db.execute<RowDataPacket[]>(
      `SELECT COALESCE(SUM(points), 0) as total FROM gamification_point_log WHERE employee_id = ?`,
      [employeeId]
    );
    const totalPoints = (totals as Array<{ total: number }>)[0].total;

    await this.checkAndUpdateTier(employeeId, totalPoints);

    return { totalPoints, pointsAdded: points };
  },
};
```

- [ ] **Step 2: Write checkAndUpdateTier method**

```typescript
// Append to gamificationService object in backend/src/modules/engagement/gamification.service.ts

  async checkAndUpdateTier(employeeId: string, totalPoints: number): Promise<void> {
    const [tiers] = await db.execute<RowDataPacket[]>(
      `SELECT * FROM gamification_tier 
       WHERE min_points <= ? AND is_active = 1 
       ORDER BY tier_level DESC LIMIT 1`,
      [totalPoints]
    );

    if (!(tiers as RowDataPacket[]).length) return;
    const newTier = (tiers as RowDataPacket[])[0];

    const [current] = await db.execute<RowDataPacket[]>(
      `SELECT tier_id FROM employee_gamification_tier WHERE employee_id = ?`,
      [employeeId]
    );

    if (!(current as RowDataPacket[]).length) {
      await db.execute(
        `INSERT INTO employee_gamification_tier (employee_id, tier_id, total_points)
         VALUES (?, ?, ?)`,
        [employeeId, newTier.id, totalPoints]
      );
    } else if ((current as RowDataPacket[])[0].tier_id !== newTier.id) {
      await db.execute(
        `UPDATE employee_gamification_tier 
         SET tier_id = ?, total_points = ?, tier_achieved_at = NOW() 
         WHERE employee_id = ?`,
        [newTier.id, totalPoints, employeeId]
      );
    } else {
      await db.execute(
        `UPDATE employee_gamification_tier SET total_points = ? WHERE employee_id = ?`,
        [totalPoints, employeeId]
      );
    }
  },
```

- [ ] **Step 3: Write getLeaderboard method**

```typescript
// Append to gamificationService object in backend/src/modules/engagement/gamification.service.ts

  async getLeaderboard(
    requestingUserId: string,
    filters: { timeframe: 'monthly' | 'quarterly' | 'all_time', processId?: string, branchId?: string }
  ): Promise<LeaderboardEntry[]> {
    // Import helper (assumes existing helpers in shared/)
    const { getEmployeeForUser, getUserRole } = await import("../../shared/accessGuard.js");
    
    const requestingEmployee = await getEmployeeForUser(requestingUserId);
    const userRole = await getUserRole(requestingUserId);

    let visibilityQuery = '';
    const params: unknown[] = [];

    if (!['admin', 'hr'].includes(userRole)) {
      if (['manager', 'team_leader'].includes(userRole)) {
        visibilityQuery = `WHERE e.process_id = ? OR e.branch_id = ?`;
        params.push(requestingEmployee.process_id, requestingEmployee.branch_id);
      }
    }

    let dateFilter = '';
    if (filters.timeframe === 'monthly') {
      dateFilter = `AND gpl.awarded_at >= DATE_SUB(CURDATE(), INTERVAL 1 MONTH)`;
    } else if (filters.timeframe === 'quarterly') {
      dateFilter = `AND gpl.awarded_at >= DATE_SUB(CURDATE(), INTERVAL 3 MONTH)`;
    }

    if (filters.processId) {
      visibilityQuery += (visibilityQuery ? ' AND' : 'WHERE') + ` e.process_id = ?`;
      params.push(filters.processId);
    }
    if (filters.branchId) {
      visibilityQuery += (visibilityQuery ? ' AND' : 'WHERE') + ` e.branch_id = ?`;
      params.push(filters.branchId);
    }

    const [rows] = await db.execute<RowDataPacket[]>(
      `SELECT 
         e.id as employee_id,
         e.full_name as employee_name,
         e.employee_code,
         COALESCE(SUM(gpl.points), 0) as total_points,
         COUNT(DISTINCT ebe.badge_id) as badges_earned,
         gt.tier_name
       FROM employees e
       LEFT JOIN gamification_point_log gpl ON gpl.employee_id = e.id ${dateFilter}
       LEFT JOIN employee_badge_earned ebe ON ebe.employee_id = e.id
       LEFT JOIN employee_gamification_tier egt ON egt.employee_id = e.id
       LEFT JOIN gamification_tier gt ON gt.id = egt.tier_id
       ${visibilityQuery}
       GROUP BY e.id
       ORDER BY total_points DESC`,
      params
    );

    let leaderboard = rows as LeaderboardEntry[];

    if (!['admin', 'hr', 'manager', 'team_leader'].includes(userRole)) {
      const top10 = leaderboard.slice(0, 10);
      const selfEntry = leaderboard.find(entry => entry.employee_id === requestingEmployee.id);

      if (selfEntry && !top10.find(e => e.employee_id === selfEntry.employee_id)) {
        leaderboard = [...top10, selfEntry];
      } else {
        leaderboard = top10;
      }
    }

    return leaderboard.map((entry, idx) => ({ ...entry, rank: idx + 1 }));
  },
```

- [ ] **Step 4: Write getEmployeePoints method**

```typescript
// Append to gamificationService object in backend/src/modules/engagement/gamification.service.ts

  async getEmployeePoints(employeeId: string, limit: number = 50): Promise<RowDataPacket[]> {
    const [rows] = await db.execute<RowDataPacket[]>(
      `SELECT * FROM gamification_point_log 
       WHERE employee_id = ? 
       ORDER BY awarded_at DESC 
       LIMIT ?`,
      [employeeId, limit]
    );
    return rows as RowDataPacket[];
  },

  async getEmployeeTier(employeeId: string): Promise<RowDataPacket | null> {
    const [rows] = await db.execute<RowDataPacket[]>(
      `SELECT egt.*, gt.tier_name, gt.tier_level, gt.min_points, gt.benefits_description
       FROM employee_gamification_tier egt
       JOIN gamification_tier gt ON gt.id = egt.tier_id
       WHERE egt.employee_id = ?`,
      [employeeId]
    );
    return (rows as RowDataPacket[]).length ? (rows as RowDataPacket[])[0] : null;
  },

  async listTiers(): Promise<RowDataPacket[]> {
    const [rows] = await db.execute<RowDataPacket[]>(
      `SELECT * FROM gamification_tier WHERE is_active = 1 ORDER BY tier_level ASC`
    );
    return rows as RowDataPacket[];
  },
};
```

- [ ] **Step 5: Commit**

```bash
git add backend/src/modules/engagement/gamification.service.ts
git commit -m "feat(engagement): add gamification service

- recordPoints: log points, update totals
- checkAndUpdateTier: tier progression logic
- getLeaderboard: tiered visibility (employee/manager/admin)
- getEmployeePoints, getEmployeeTier, listTiers"
```

---

## Task 5: Badge Service

**Files:**
- Create: `backend/src/modules/engagement/badge.service.ts`

- [ ] **Step 1: Write checkAndAwardBadge method**

```typescript
// backend/src/modules/engagement/badge.service.ts
import { randomUUID } from "crypto";
import type { RowDataPacket } from "mysql2";
import { db } from "../../db/mysql.js";
import { gamificationService } from "./gamification.service.js";
import type { Badge } from "./engagement.types.js";

export const badgeService = {
  async checkAndAwardBadge(employeeId: string, badgeCode: string): Promise<void> {
    const [existing] = await db.execute<RowDataPacket[]>(
      `SELECT id FROM employee_badge_earned 
       WHERE employee_id = ? AND badge_id = (SELECT id FROM gamification_badge_master WHERE badge_code = ?)`,
      [employeeId, badgeCode]
    );

    if ((existing as RowDataPacket[]).length > 0) return;

    const badge = await this.getBadgeByCode(badgeCode);
    if (!badge) return;

    const earnedId = randomUUID();
    await db.execute(
      `INSERT INTO employee_badge_earned (id, employee_id, badge_id, evidence_ref, awarded_by)
       VALUES (?, ?, ?, NULL, NULL)`,
      [earnedId, employeeId, badge.id]
    );

    await gamificationService.recordPoints(employeeId, badge.point_value, 'badge_earned', earnedId);
  },

  async getBadgeByCode(badgeCode: string): Promise<Badge | null> {
    const [rows] = await db.execute<RowDataPacket[]>(
      `SELECT * FROM gamification_badge_master WHERE badge_code = ? AND is_active = 1 LIMIT 1`,
      [badgeCode]
    );
    return (rows as Badge[]).length ? (rows as Badge[])[0] : null;
  },
};
```

- [ ] **Step 2: Write badge listing methods**

```typescript
// Append to badgeService object in backend/src/modules/engagement/badge.service.ts

  async listBadges(category?: string): Promise<Badge[]> {
    let query = `SELECT * FROM gamification_badge_master WHERE is_active = 1`;
    const params: unknown[] = [];

    if (category) {
      query += ` AND category = ?`;
      params.push(category);
    }

    query += ` ORDER BY category, badge_name`;

    const [rows] = await db.execute<RowDataPacket[]>(query, params);
    return rows as Badge[];
  },

  async getEmployeeBadges(employeeId: string): Promise<RowDataPacket[]> {
    const [rows] = await db.execute<RowDataPacket[]>(
      `SELECT ebe.*, gbm.badge_code, gbm.badge_name, gbm.badge_description, gbm.category, gbm.icon_url, gbm.point_value
       FROM employee_badge_earned ebe
       JOIN gamification_badge_master gbm ON gbm.id = ebe.badge_id
       WHERE ebe.employee_id = ?
       ORDER BY ebe.earned_at DESC`,
      [employeeId]
    );
    return rows as RowDataPacket[];
  },

  async awardBadgeManually(employeeId: string, badgeCode: string, awardedBy: string): Promise<void> {
    const badge = await this.getBadgeByCode(badgeCode);
    if (!badge) throw new Error('Badge not found');

    const [existing] = await db.execute<RowDataPacket[]>(
      `SELECT id FROM employee_badge_earned WHERE employee_id = ? AND badge_id = ?`,
      [employeeId, badge.id]
    );

    if ((existing as RowDataPacket[]).length > 0) {
      throw new Error('Employee already has this badge');
    }

    const earnedId = randomUUID();
    await db.execute(
      `INSERT INTO employee_badge_earned (id, employee_id, badge_id, awarded_by)
       VALUES (?, ?, ?, ?)`,
      [earnedId, employeeId, badge.id, awardedBy]
    );

    await gamificationService.recordPoints(employeeId, badge.point_value, 'badge_earned', earnedId, awardedBy);
  },
```

- [ ] **Step 3: Commit**

```bash
git add backend/src/modules/engagement/badge.service.ts
git commit -m "feat(engagement): add badge service

- checkAndAwardBadge: auto-award with duplicate check
- getBadgeByCode: fetch badge by code
- listBadges: list all badges (optional category filter)
- getEmployeeBadges: employee badge history
- awardBadgeManually: manual badge award by admin/manager"
```

---

## Task 6: Kudos Service

**Files:**
- Create: `backend/src/modules/engagement/kudos.service.ts`

- [ ] **Step 1: Write giveKudos method**

```typescript
// backend/src/modules/engagement/kudos.service.ts
import { randomUUID } from "crypto";
import type { RowDataPacket } from "mysql2";
import { db } from "../../db/mysql.js";
import { gamificationService } from "./gamification.service.js";
import type { KudosType, KudosCard } from "./engagement.types.js";

const KUDOS_POINT_VALUES: Record<KudosType, number> = {
  team_player: 10,
  problem_solver: 15,
  quality_champion: 15,
  mentor: 20,
};

export const kudosService = {
  async giveKudos(
    fromEmployeeId: string,
    toEmployeeId: string,
    kudosType: KudosType,
    message: string,
    isPublic: boolean = true
  ): Promise<void> {
    if (fromEmployeeId === toEmployeeId) {
      throw new Error('Cannot give kudos to yourself');
    }

    const currentMonth = new Date().toISOString().slice(0, 7);
    const [limitCheck] = await db.execute<RowDataPacket[]>(
      `SELECT kudos_given_count FROM kudos_giver_limit 
       WHERE employee_id = ? AND month_year = ?`,
      [fromEmployeeId, currentMonth]
    );

    const monthlyLimit = 10;
    const currentCount = (limitCheck as RowDataPacket[]).length 
      ? (limitCheck as RowDataPacket[])[0].kudos_given_count 
      : 0;

    if (currentCount >= monthlyLimit) {
      throw new Error(`Monthly kudos limit reached (${monthlyLimit}). Resets next month.`);
    }

    const points = KUDOS_POINT_VALUES[kudosType];
    const kudosId = randomUUID();

    await db.execute(
      `INSERT INTO kudos_recognition (id, from_employee_id, to_employee_id, kudos_type, message, points_awarded, is_public)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [kudosId, fromEmployeeId, toEmployeeId, kudosType, message, points, isPublic ? 1 : 0]
    );

    await gamificationService.recordPoints(toEmployeeId, points, 'kudos_received', kudosId);

    await db.execute(
      `INSERT INTO kudos_giver_limit (employee_id, month_year, kudos_given_count)
       VALUES (?, ?, 1)
       ON DUPLICATE KEY UPDATE kudos_given_count = kudos_given_count + 1`,
      [fromEmployeeId, currentMonth]
    );
  },
};
```

- [ ] **Step 2: Write kudos listing methods**

```typescript
// Append to kudosService object in backend/src/modules/engagement/kudos.service.ts

  async getKudosWall(filters: { 
    limit?: number, 
    kudosType?: KudosType, 
    dateRange?: 'week' | 'month' | 'all' 
  }): Promise<KudosCard[]> {
    let whereClause = 'WHERE is_public = 1';
    const params: unknown[] = [];

    if (filters.kudosType) {
      whereClause += ' AND kudos_type = ?';
      params.push(filters.kudosType);
    }

    if (filters.dateRange === 'week') {
      whereClause += ' AND created_at >= DATE_SUB(CURDATE(), INTERVAL 7 DAY)';
    } else if (filters.dateRange === 'month') {
      whereClause += ' AND created_at >= DATE_SUB(CURDATE(), INTERVAL 1 MONTH)';
    }

    const limit = filters.limit || 50;

    const [rows] = await db.execute<RowDataPacket[]>(
      `SELECT 
         kr.id,
         kr.kudos_type,
         kr.message,
         kr.points_awarded,
         kr.created_at,
         from_emp.full_name as from_employee_name,
         to_emp.full_name as to_employee_name,
         to_emp.employee_code as to_employee_code
       FROM kudos_recognition kr
       JOIN employees from_emp ON from_emp.id = kr.from_employee_id
       JOIN employees to_emp ON to_emp.id = kr.to_employee_id
       ${whereClause}
       ORDER BY kr.created_at DESC
       LIMIT ?`,
      [...params, limit]
    );

    return rows as KudosCard[];
  },

  async getKudosReceived(employeeId: string, limit: number = 50): Promise<KudosCard[]> {
    const [rows] = await db.execute<RowDataPacket[]>(
      `SELECT 
         kr.id,
         kr.kudos_type,
         kr.message,
         kr.points_awarded,
         kr.created_at,
         from_emp.full_name as from_employee_name,
         to_emp.full_name as to_employee_name,
         to_emp.employee_code as to_employee_code
       FROM kudos_recognition kr
       JOIN employees from_emp ON from_emp.id = kr.from_employee_id
       JOIN employees to_emp ON to_emp.id = kr.to_employee_id
       WHERE kr.to_employee_id = ?
       ORDER BY kr.created_at DESC
       LIMIT ?`,
      [employeeId, limit]
    );

    return rows as KudosCard[];
  },

  async getKudosGiven(employeeId: string, limit: number = 50): Promise<KudosCard[]> {
    const [rows] = await db.execute<RowDataPacket[]>(
      `SELECT 
         kr.id,
         kr.kudos_type,
         kr.message,
         kr.points_awarded,
         kr.created_at,
         from_emp.full_name as from_employee_name,
         to_emp.full_name as to_employee_name,
         to_emp.employee_code as to_employee_code
       FROM kudos_recognition kr
       JOIN employees from_emp ON from_emp.id = kr.from_employee_id
       JOIN employees to_emp ON to_emp.id = kr.to_employee_id
       WHERE kr.from_employee_id = ?
       ORDER BY kr.created_at DESC
       LIMIT ?`,
      [employeeId, limit]
    );

    return rows as KudosCard[];
  },

  async getMonthlyKudosLimit(employeeId: string): Promise<{ given: number, limit: number, remaining: number }> {
    const currentMonth = new Date().toISOString().slice(0, 7);
    const [rows] = await db.execute<RowDataPacket[]>(
      `SELECT kudos_given_count FROM kudos_giver_limit WHERE employee_id = ? AND month_year = ?`,
      [employeeId, currentMonth]
    );

    const given = (rows as RowDataPacket[]).length ? (rows as RowDataPacket[])[0].kudos_given_count : 0;
    const limit = 10;

    return { given, limit, remaining: Math.max(0, limit - given) };
  },
```

- [ ] **Step 3: Commit**

```bash
git add backend/src/modules/engagement/kudos.service.ts
git commit -m "feat(engagement): add kudos service

- giveKudos: create kudos with monthly limit check
- getKudosWall: public kudos wall with filters
- getKudosReceived: kudos received by employee
- getKudosGiven: kudos given by employee
- getMonthlyKudosLimit: check remaining kudos allowance"
```

---

## Task 7: Survey Service

**Files:**
- Create: `backend/src/modules/engagement/survey.service.ts`

- [ ] **Step 1: Write createSurvey method**

```typescript
// backend/src/modules/engagement/survey.service.ts
import { randomUUID } from "crypto";
import type { RowDataPacket } from "mysql2";
import { db } from "../../db/mysql.js";
import { gamificationService } from "./gamification.service.js";
import type { Survey, SurveyQuestion, QuestionType, PulseType } from "./engagement.types.js";

export const surveyService = {
  async createSurvey(
    surveyData: {
      title: string,
      description: string,
      isAnonymous: boolean,
      startDate: string,
      endDate: string,
      questions: Array<{
        text: string,
        type: QuestionType,
        options?: string[],
        isRequired: boolean
      }>
    },
    createdBy: string
  ): Promise<string> {
    const surveyId = randomUUID();

    await db.execute(
      `INSERT INTO survey_template (id, survey_title, survey_description, is_anonymous, created_by, start_date, end_date)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [surveyId, surveyData.title, surveyData.description, surveyData.isAnonymous ? 1 : 0, 
       createdBy, surveyData.startDate, surveyData.endDate]
    );

    for (let i = 0; i < surveyData.questions.length; i++) {
      const q = surveyData.questions[i];
      const questionId = randomUUID();
      await db.execute(
        `INSERT INTO survey_question (id, survey_id, question_text, question_type, question_order, options, is_required)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [questionId, surveyId, q.text, q.type, i + 1, JSON.stringify(q.options || []), q.isRequired ? 1 : 0]
      );
    }

    return surveyId;
  },
};
```

- [ ] **Step 2: Write survey response methods**

```typescript
// Append to surveyService object in backend/src/modules/engagement/survey.service.ts

  async submitSurveyResponse(
    surveyId: string,
    employeeId: string | null,
    responses: Record<string, string | number>
  ): Promise<void> {
    const responseId = randomUUID();

    await db.execute(
      `INSERT INTO survey_response (id, survey_id, employee_id, response_data)
       VALUES (?, ?, ?, ?)`,
      [responseId, surveyId, employeeId, JSON.stringify(responses)]
    );

    if (employeeId) {
      await gamificationService.recordPoints(employeeId, 5, 'survey_completed', responseId);
    }
  },

  async listSurveys(activeOnly: boolean = true): Promise<Survey[]> {
    let query = `SELECT * FROM survey_template`;
    if (activeOnly) {
      query += ` WHERE is_active = 1 AND start_date <= CURDATE() AND end_date >= CURDATE()`;
    }
    query += ` ORDER BY created_at DESC`;

    const [rows] = await db.execute<RowDataPacket[]>(query);
    return rows as Survey[];
  },

  async getSurvey(surveyId: string): Promise<Survey | null> {
    const [rows] = await db.execute<RowDataPacket[]>(
      `SELECT * FROM survey_template WHERE id = ? LIMIT 1`,
      [surveyId]
    );
    return (rows as Survey[]).length ? (rows as Survey[])[0] : null;
  },

  async getSurveyQuestions(surveyId: string): Promise<SurveyQuestion[]> {
    const [rows] = await db.execute<RowDataPacket[]>(
      `SELECT * FROM survey_question WHERE survey_id = ? ORDER BY question_order ASC`,
      [surveyId]
    );
    return rows as SurveyQuestion[];
  },
```

- [ ] **Step 3: Write eNPS calculation**

```typescript
// Append to surveyService object in backend/src/modules/engagement/survey.service.ts

  async calculateENPS(
    surveyId: string,
    questionId: string
  ): Promise<{ score: number, promoters: number, detractors: number, passives: number }> {
    const [responses] = await db.execute<RowDataPacket[]>(
      `SELECT response_data FROM survey_response WHERE survey_id = ?`,
      [surveyId]
    );

    const scores = (responses as RowDataPacket[]).map(r => {
      const data = JSON.parse(r.response_data as string);
      return parseInt(data[questionId]);
    });

    const promoters = scores.filter(s => s >= 9).length;
    const passives = scores.filter(s => s >= 7 && s <= 8).length;
    const detractors = scores.filter(s => s <= 6).length;
    const total = scores.length;

    const enpsScore = total > 0 ? Math.round(((promoters - detractors) / total) * 100) : 0;

    return { score: enpsScore, promoters, detractors, passives };
  },

  async getSurveyResults(surveyId: string): Promise<{ responseCount: number, responses: RowDataPacket[] }> {
    const [rows] = await db.execute<RowDataPacket[]>(
      `SELECT * FROM survey_response WHERE survey_id = ? ORDER BY submitted_at DESC`,
      [surveyId]
    );

    return {
      responseCount: (rows as RowDataPacket[]).length,
      responses: rows as RowDataPacket[],
    };
  },
```

- [ ] **Step 4: Write pulse methods**

```typescript
// Append to surveyService object in backend/src/modules/engagement/survey.service.ts

  async createPulse(
    pulseQuestion: string,
    pulseType: PulseType,
    endDate: string,
    createdBy: string
  ): Promise<string> {
    const pulseId = randomUUID();

    await db.execute(
      `INSERT INTO pulse_check (id, pulse_question, pulse_type, created_by, end_date)
       VALUES (?, ?, ?, ?, ?)`,
      [pulseId, pulseQuestion, pulseType, createdBy, endDate]
    );

    return pulseId;
  },

  async respondToPulse(pulseId: string, employeeId: string, responseValue: string): Promise<void> {
    await db.execute(
      `INSERT INTO pulse_response (id, pulse_id, employee_id, response_value)
       VALUES (?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE response_value = VALUES(response_value), responded_at = NOW()`,
      [randomUUID(), pulseId, employeeId, responseValue]
    );
  },

  async getActivePulse(): Promise<RowDataPacket | null> {
    const [rows] = await db.execute<RowDataPacket[]>(
      `SELECT * FROM pulse_check 
       WHERE is_active = 1 AND end_date >= CURDATE() 
       ORDER BY created_at DESC 
       LIMIT 1`
    );
    return (rows as RowDataPacket[]).length ? (rows as RowDataPacket[])[0] : null;
  },

  async getPulseSummary(pulseId: string): Promise<Record<string, number>> {
    const [responses] = await db.execute<RowDataPacket[]>(
      `SELECT response_value, COUNT(*) as count 
       FROM pulse_response 
       WHERE pulse_id = ? 
       GROUP BY response_value`,
      [pulseId]
    );

    const summary: Record<string, number> = {};
    for (const row of responses as RowDataPacket[]) {
      summary[row.response_value as string] = row.count as number;
    }

    return summary;
  },
```

- [ ] **Step 5: Commit**

```bash
git add backend/src/modules/engagement/survey.service.ts
git commit -m "feat(engagement): add survey service

- createSurvey: create survey with questions
- submitSurveyResponse: submit survey response (award points if identified)
- listSurveys, getSurvey, getSurveyQuestions
- calculateENPS: eNPS score calculation
- getSurveyResults: aggregate survey results
- createPulse, respondToPulse, getActivePulse, getPulseSummary"
```

---

## Task 8: Controller & Routes

**Files:**
- Create: `backend/src/modules/engagement/engagement.controller.ts`
- Create: `backend/src/modules/engagement/engagement.routes.ts`

- [ ] **Step 1: Write badge controller methods**

```typescript
// backend/src/modules/engagement/engagement.controller.ts
import type { Response } from "express";
import type { AuthenticatedRequest } from "../../middleware/authMiddleware.js";
import { badgeService } from "./badge.service.js";
import { kudosService } from "./kudos.service.js";
import { surveyService } from "./survey.service.js";
import { gamificationService } from "./gamification.service.js";
import { getEmployeeForUser } from "../../shared/accessGuard.js";

export const engagementController = {
  async listBadges(req: AuthenticatedRequest, res: Response) {
    const { category } = req.query as { category?: string };
    const badges = await badgeService.listBadges(category);
    return res.json({ success: true, data: badges });
  },

  async getEmployeeBadges(req: AuthenticatedRequest, res: Response) {
    const { employeeId } = req.params;
    const badges = await badgeService.getEmployeeBadges(employeeId);
    return res.json({ success: true, data: badges });
  },

  async awardBadge(req: AuthenticatedRequest, res: Response) {
    const { employeeId, badgeCode } = req.body as { employeeId: string, badgeCode: string };
    await badgeService.awardBadgeManually(employeeId, badgeCode, req.authUser!.id);
    return res.json({ success: true, message: 'Badge awarded' });
  },
};
```

- [ ] **Step 2: Write points & leaderboard controller methods**

```typescript
// Append to engagementController object in backend/src/modules/engagement/engagement.controller.ts

  async getEmployeePoints(req: AuthenticatedRequest, res: Response) {
    const { employeeId } = req.params;
    const { limit } = req.query as { limit?: string };
    const points = await gamificationService.getEmployeePoints(employeeId, limit ? parseInt(limit) : 50);
    return res.json({ success: true, data: points });
  },

  async getLeaderboard(req: AuthenticatedRequest, res: Response) {
    const { timeframe, processId, branchId } = req.query as {
      timeframe: 'monthly' | 'quarterly' | 'all_time',
      processId?: string,
      branchId?: string
    };
    const leaderboard = await gamificationService.getLeaderboard(req.authUser!.id, { timeframe, processId, branchId });
    return res.json({ success: true, data: leaderboard });
  },

  async adjustPoints(req: AuthenticatedRequest, res: Response) {
    const { employeeId, points, reason } = req.body as { employeeId: string, points: number, reason: string };
    await gamificationService.recordPoints(employeeId, points, 'manual_adjustment', reason, req.authUser!.id);
    return res.json({ success: true, message: 'Points adjusted' });
  },

  async listTiers(req: AuthenticatedRequest, res: Response) {
    const tiers = await gamificationService.listTiers();
    return res.json({ success: true, data: tiers });
  },

  async getEmployeeTier(req: AuthenticatedRequest, res: Response) {
    const { employeeId } = req.params;
    const tier = await gamificationService.getEmployeeTier(employeeId);
    return res.json({ success: true, data: tier });
  },
```

- [ ] **Step 3: Write kudos controller methods**

```typescript
// Append to engagementController object in backend/src/modules/engagement/engagement.controller.ts

  async giveKudos(req: AuthenticatedRequest, res: Response) {
    const { toEmployeeId, kudosType, message, isPublic } = req.body as {
      toEmployeeId: string,
      kudosType: 'team_player' | 'problem_solver' | 'quality_champion' | 'mentor',
      message: string,
      isPublic: boolean
    };
    
    const fromEmployee = await getEmployeeForUser(req.authUser!.id);
    await kudosService.giveKudos(fromEmployee.id, toEmployeeId, kudosType, message, isPublic);
    
    return res.json({ success: true, message: 'Kudos given' });
  },

  async getKudosWall(req: AuthenticatedRequest, res: Response) {
    const { limit, kudosType, dateRange } = req.query as {
      limit?: string,
      kudosType?: 'team_player' | 'problem_solver' | 'quality_champion' | 'mentor',
      dateRange?: 'week' | 'month' | 'all'
    };
    
    const kudos = await kudosService.getKudosWall({
      limit: limit ? parseInt(limit) : 50,
      kudosType,
      dateRange
    });
    
    return res.json({ success: true, data: kudos });
  },

  async getKudosReceived(req: AuthenticatedRequest, res: Response) {
    const { employeeId } = req.params;
    const kudos = await kudosService.getKudosReceived(employeeId);
    return res.json({ success: true, data: kudos });
  },

  async getKudosGiven(req: AuthenticatedRequest, res: Response) {
    const { employeeId } = req.params;
    const kudos = await kudosService.getKudosGiven(employeeId);
    return res.json({ success: true, data: kudos });
  },
```

- [ ] **Step 4: Write survey controller methods**

```typescript
// Append to engagementController object in backend/src/modules/engagement/engagement.controller.ts

  async createSurvey(req: AuthenticatedRequest, res: Response) {
    const surveyId = await surveyService.createSurvey(req.body, req.authUser!.id);
    return res.status(201).json({ success: true, data: { surveyId }, message: 'Survey created' });
  },

  async listSurveys(req: AuthenticatedRequest, res: Response) {
    const surveys = await surveyService.listSurveys(true);
    return res.json({ success: true, data: surveys });
  },

  async getSurvey(req: AuthenticatedRequest, res: Response) {
    const { id } = req.params;
    const survey = await surveyService.getSurvey(id);
    const questions = survey ? await surveyService.getSurveyQuestions(id) : [];
    return res.json({ success: true, data: { survey, questions } });
  },

  async submitSurveyResponse(req: AuthenticatedRequest, res: Response) {
    const { surveyId, responses } = req.body as { surveyId: string, responses: Record<string, string | number> };
    const survey = await surveyService.getSurvey(surveyId);
    
    if (!survey) {
      return res.status(404).json({ success: false, message: 'Survey not found' });
    }
    
    const employeeId = survey.is_anonymous ? null : (await getEmployeeForUser(req.authUser!.id)).id;
    await surveyService.submitSurveyResponse(surveyId, employeeId, responses);
    
    return res.json({ success: true, message: 'Survey response submitted' });
  },

  async getSurveyResults(req: AuthenticatedRequest, res: Response) {
    const { id } = req.params;
    const results = await surveyService.getSurveyResults(id);
    return res.json({ success: true, data: results });
  },
```

- [ ] **Step 5: Write pulse controller methods**

```typescript
// Append to engagementController object in backend/src/modules/engagement/engagement.controller.ts

  async createPulse(req: AuthenticatedRequest, res: Response) {
    const { pulseQuestion, pulseType, endDate } = req.body as {
      pulseQuestion: string,
      pulseType: 'emoji_scale' | 'yes_no' | 'rating_1_5',
      endDate: string
    };
    
    const pulseId = await surveyService.createPulse(pulseQuestion, pulseType, endDate, req.authUser!.id);
    return res.status(201).json({ success: true, data: { pulseId }, message: 'Pulse created' });
  },

  async getActivePulse(req: AuthenticatedRequest, res: Response) {
    const pulse = await surveyService.getActivePulse();
    return res.json({ success: true, data: pulse });
  },

  async respondToPulse(req: AuthenticatedRequest, res: Response) {
    const { pulseId, responseValue } = req.body as { pulseId: string, responseValue: string };
    const employee = await getEmployeeForUser(req.authUser!.id);
    await surveyService.respondToPulse(pulseId, employee.id, responseValue);
    return res.json({ success: true, message: 'Pulse response recorded' });
  },

  async getPulseSummary(req: AuthenticatedRequest, res: Response) {
    const { id } = req.params;
    const summary = await surveyService.getPulseSummary(id);
    return res.json({ success: true, data: summary });
  },
```

- [ ] **Step 6: Write routes**

```typescript
// backend/src/modules/engagement/engagement.routes.ts
import { Router } from "express";
import { requireAuth } from "../../middleware/authMiddleware.js";
import { requireRole } from "../../middleware/requireRole.js";
import { engagementController as c } from "./engagement.controller.js";

const router = Router();
router.use(requireAuth);

const h = (fn: Function) => (req: any, res: any, next: any) => fn(req, res).catch(next);

// Badges
router.get("/badges", h(c.listBadges));
router.get("/badges/:employeeId", h(c.getEmployeeBadges));
router.post("/badges/award", requireRole("admin", "manager", "hr"), h(c.awardBadge));

// Points & Tiers
router.get("/points/:employeeId", h(c.getEmployeePoints));
router.get("/leaderboard", h(c.getLeaderboard));
router.post("/points/adjust", requireRole("admin", "hr"), h(c.adjustPoints));
router.get("/tiers", h(c.listTiers));
router.get("/tier/:employeeId", h(c.getEmployeeTier));

// Kudos
router.get("/kudos/wall", h(c.getKudosWall));
router.post("/kudos", h(c.giveKudos));
router.get("/kudos/received/:employeeId", h(c.getKudosReceived));
router.get("/kudos/given/:employeeId", h(c.getKudosGiven));

// Surveys
router.get("/surveys", h(c.listSurveys));
router.post("/surveys", requireRole("admin", "hr"), h(c.createSurvey));
router.get("/surveys/:id", h(c.getSurvey));
router.post("/surveys/:id/respond", h(c.submitSurveyResponse));
router.get("/surveys/:id/results", requireRole("admin", "hr"), h(c.getSurveyResults));

// Pulse
router.get("/pulse/active", h(c.getActivePulse));
router.post("/pulse", requireRole("admin", "hr"), h(c.createPulse));
router.post("/pulse/:id/respond", h(c.respondToPulse));
router.get("/pulse/:id/summary", h(c.getPulseSummary));

export { router as engagementRouter };
```

- [ ] **Step 7: Register routes in main app**

Edit: `backend/src/app.ts` (find where other routers are registered, add engagement router)

```typescript
// Add import near other router imports
import { engagementRouter } from "./modules/engagement/engagement.routes.js";

// Add route registration near other app.use calls
app.use("/api/engagement", engagementRouter);
```

- [ ] **Step 8: Commit**

```bash
git add backend/src/modules/engagement/engagement.controller.ts backend/src/modules/engagement/engagement.routes.ts backend/src/app.ts
git commit -m "feat(engagement): add controller and API routes

Controllers:
- Badge: list, getEmployeeBadges, awardBadge
- Points: getEmployeePoints, getLeaderboard, adjustPoints
- Tier: listTiers, getEmployeeTier
- Kudos: giveKudos, getKudosWall, received/given
- Survey: create, list, get, submitResponse, getResults
- Pulse: create, getActive, respond, getSummary

Routes registered at /api/engagement/*"
```

---

## Task 9: Frontend - Shared Components

**Files:**
- Create: `src/components/engagement/BadgeCard.tsx`
- Create: `src/components/engagement/KudosCard.tsx`
- Create: `src/components/engagement/TierBadge.tsx`
- Create: `src/components/engagement/PointsDisplay.tsx`

- [ ] **Step 1: Write BadgeCard component**

```typescript
// src/components/engagement/BadgeCard.tsx
import { Lock, CheckCircle } from "lucide-react";

interface BadgeCardProps {
  badgeName: string;
  badgeDescription: string;
  category: string;
  pointValue: number;
  isEarned: boolean;
  earnedAt?: string;
}

export function BadgeCard({ badgeName, badgeDescription, category, pointValue, isEarned, earnedAt }: BadgeCardProps) {
  const categoryColors: Record<string, string> = {
    performance: "bg-purple-50 text-purple-700 border-purple-200",
    activity: "bg-blue-50 text-blue-700 border-blue-200",
    tenure: "bg-emerald-50 text-emerald-700 border-emerald-200",
    social: "bg-amber-50 text-amber-700 border-amber-200",
  };

  const categoryColor = categoryColors[category] || "bg-slate-50 text-slate-700 border-slate-200";

  return (
    <div className={`rounded-2xl border p-4 ${isEarned ? categoryColor : "bg-slate-50 border-slate-200 opacity-60"}`}>
      <div className="flex items-start justify-between mb-3">
        <div className={`rounded-xl p-2 ${isEarned ? "bg-white" : "bg-slate-100"}`}>
          {isEarned ? (
            <CheckCircle className="h-6 w-6 text-emerald-600" />
          ) : (
            <Lock className="h-6 w-6 text-slate-400" />
          )}
        </div>
        <span className={`text-xs font-bold px-2 py-1 rounded-full ${isEarned ? "bg-white" : "bg-slate-100 text-slate-500"}`}>
          {pointValue} pts
        </span>
      </div>

      <h3 className="font-bold text-sm mb-1">{badgeName}</h3>
      <p className="text-xs text-slate-600 mb-2">{badgeDescription}</p>

      {isEarned && earnedAt && (
        <p className="text-xs text-slate-500 mt-2">
          Earned: {new Date(earnedAt).toLocaleDateString()}
        </p>
      )}

      <span className="inline-block text-xs font-semibold mt-2 capitalize">{category}</span>
    </div>
  );
}
```

- [ ] **Step 2: Write KudosCard component**

```typescript
// src/components/engagement/KudosCard.tsx
interface KudosCardProps {
  fromEmployeeName: string;
  toEmployeeName: string;
  kudosType: string;
  message: string | null;
  pointsAwarded: number;
  createdAt: string;
}

export function KudosCard({ fromEmployeeName, toEmployeeName, kudosType, message, pointsAwarded, createdAt }: KudosCardProps) {
  const kudosTypeLabels: Record<string, string> = {
    team_player: "Team Player",
    problem_solver: "Problem Solver",
    quality_champion: "Quality Champion",
    mentor: "Mentor",
  };

  const kudosTypeColors: Record<string, string> = {
    team_player: "bg-blue-100 text-blue-800",
    problem_solver: "bg-purple-100 text-purple-800",
    quality_champion: "bg-emerald-100 text-emerald-800",
    mentor: "bg-amber-100 text-amber-800",
  };

  return (
    <div className="rounded-2xl border bg-white p-4 shadow-sm">
      <div className="flex items-start justify-between mb-2">
        <span className={`text-xs font-bold px-3 py-1 rounded-full ${kudosTypeColors[kudosType]}`}>
          {kudosTypeLabels[kudosType]}
        </span>
        <span className="text-xs font-bold text-emerald-600">+{pointsAwarded} pts</span>
      </div>

      <p className="text-sm font-semibold mb-1">
        <span className="text-slate-900">{fromEmployeeName}</span>
        <span className="text-slate-500"> gave kudos to </span>
        <span className="text-slate-900">{toEmployeeName}</span>
      </p>

      {message && (
        <p className="text-sm text-slate-600 mt-2 italic">"{message}"</p>
      )}

      <p className="text-xs text-slate-400 mt-2">
        {new Date(createdAt).toLocaleString()}
      </p>
    </div>
  );
}
```

- [ ] **Step 3: Write TierBadge component**

```typescript
// src/components/engagement/TierBadge.tsx
interface TierBadgeProps {
  tierName: string;
  size?: "sm" | "md" | "lg";
}

export function TierBadge({ tierName, size = "md" }: TierBadgeProps) {
  const tierColors: Record<string, string> = {
    Bronze: "bg-orange-100 text-orange-800 border-orange-300",
    Silver: "bg-slate-200 text-slate-800 border-slate-400",
    Gold: "bg-yellow-100 text-yellow-800 border-yellow-400",
    Platinum: "bg-cyan-100 text-cyan-800 border-cyan-400",
  };

  const sizeClasses = {
    sm: "text-xs px-2 py-1",
    md: "text-sm px-3 py-1.5",
    lg: "text-base px-4 py-2",
  };

  const tierColor = tierColors[tierName] || "bg-slate-100 text-slate-700 border-slate-300";

  return (
    <span className={`inline-flex items-center gap-1.5 font-bold rounded-full border ${tierColor} ${sizeClasses[size]}`}>
      {tierName}
    </span>
  );
}
```

- [ ] **Step 4: Write PointsDisplay component**

```typescript
// src/components/engagement/PointsDisplay.tsx
import { TrendingUp } from "lucide-react";

interface PointsDisplayProps {
  points: number;
  label?: string;
  showTrend?: boolean;
}

export function PointsDisplay({ points, label = "Total Points", showTrend = false }: PointsDisplayProps) {
  return (
    <div className="flex items-center gap-3">
      {showTrend && (
        <div className="rounded-xl bg-emerald-100 p-2">
          <TrendingUp className="h-5 w-5 text-emerald-600" />
        </div>
      )}
      <div>
        {label && <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide">{label}</p>}
        <p className="text-2xl font-black text-slate-950">{points.toLocaleString()}</p>
      </div>
    </div>
  );
}
```

- [ ] **Step 5: Commit**

```bash
git add src/components/engagement/
git commit -m "feat(engagement): add shared React components

- BadgeCard: badge display (locked/unlocked states)
- KudosCard: kudos message card
- TierBadge: tier indicator (Bronze/Silver/Gold/Platinum)
- PointsDisplay: animated point counter"
```

---
## Task 10: NativeEngagement Dashboard Page

**Files:**
- Create: `src/pages/NativeEngagement.tsx`

- [ ] **Step 1: Create dashboard skeleton**

```typescript
// src/pages/NativeEngagement.tsx
import { useEffect, useState } from "react";
import { Award, TrendingUp, Gift, Users } from "lucide-react";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { hrmsApi } from "@/lib/hrmsApi";
import { TierBadge } from "@/components/engagement/TierBadge";
import { PointsDisplay } from "@/components/engagement/PointsDisplay";

export default function NativeEngagement() {
  const [stats, setStats] = useState({
    totalPoints: 0,
    badgesEarned: 0,
    kudosReceived: 0,
    tierName: "Bronze"
  });

  return (
    <DashboardLayout>
      <div className="space-y-6">
        <div>
          <p className="text-sm font-black uppercase tracking-[0.2em] text-emerald-600">Engagement</p>
          <h1 className="mt-2 text-3xl font-black text-slate-950">Dashboard</h1>
          <p className="mt-2 text-slate-600">Your engagement overview</p>
        </div>

        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <div className="rounded-3xl border bg-white p-5">
            <div className="flex items-start justify-between">
              <PointsDisplay points={stats.totalPoints} label="Total Points" />
              <TrendingUp className="h-5 w-5 text-emerald-600" />
            </div>
          </div>

          <div className="rounded-3xl border bg-white p-5">
            <p className="text-sm font-semibold text-slate-500">Current Tier</p>
            <div className="mt-2">
              <TierBadge tierName={stats.tierName} size="lg" />
            </div>
          </div>

          <div className="rounded-3xl border bg-white p-5">
            <p className="text-sm font-semibold text-slate-500">Badges Earned</p>
            <p className="mt-2 text-3xl font-black text-slate-950">{stats.badgesEarned}</p>
          </div>

          <div className="rounded-3xl border bg-white p-5">
            <p className="text-sm font-semibold text-slate-500">Kudos Received</p>
            <p className="mt-2 text-3xl font-black text-slate-950">{stats.kudosReceived}</p>
          </div>
        </div>
      </div>
    </DashboardLayout>
  );
}
```

- [ ] **Step 2: Add data fetching**

```typescript
// Add to NativeEngagement.tsx after useState

useEffect(() => {
  async function loadDashboard() {
    try {
      const employeeId = localStorage.getItem("employeeId"); // Adjust per auth pattern
      
      const [tierRes, badgesRes, kudosRes] = await Promise.all([
        hrmsApi.get(`/api/engagement/tier/${employeeId}`),
        hrmsApi.get(`/api/engagement/badges/${employeeId}`),
        hrmsApi.get(`/api/engagement/kudos/received/${employeeId}`)
      ]);

      setStats({
        totalPoints: tierRes.data?.total_points || 0,
        badgesEarned: badgesRes.data?.length || 0,
        kudosReceived: kudosRes.data?.length || 0,
        tierName: tierRes.data?.tier_name || "Bronze"
      });
    } catch (error) {
      console.error("Failed to load dashboard:", error);
    }
  }

  loadDashboard();
}, []);
```

- [ ] **Step 3: Commit**

```bash
git add src/pages/NativeEngagement.tsx
git commit -m "feat(engagement): add engagement dashboard page

- Stat cards: total points, tier, badges, kudos
- Data fetching from engagement APIs
- TierBadge and PointsDisplay components integrated"
```

---

## Task 11: NativeBadges Page

**Files:**
- Create: `src/pages/NativeBadges.tsx`

- [ ] **Step 1: Create badge gallery**

```typescript
// src/pages/NativeBadges.tsx
import { useEffect, useState } from "react";
import { Search } from "lucide-react";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { hrmsApi } from "@/lib/hrmsApi";
import { BadgeCard } from "@/components/engagement/BadgeCard";

interface Badge {
  id: string;
  badge_code: string;
  badge_name: string;
  badge_description: string;
  category: string;
  point_value: number;
  earned_at?: string;
}

export default function NativeBadges() {
  const [badges, setBadges] = useState<Badge[]>([]);
  const [earnedBadgeCodes, setEarnedBadgeCodes] = useState<Set<string>>(new Set());
  const [categoryFilter, setCategoryFilter] = useState<string>("all");
  const [searchQuery, setSearchQuery] = useState("");

  useEffect(() => {
    async function loadBadges() {
      const employeeId = localStorage.getItem("employeeId");
      
      const [allBadgesRes, earnedBadgesRes] = await Promise.all([
        hrmsApi.get("/api/engagement/badges"),
        hrmsApi.get(`/api/engagement/badges/${employeeId}`)
      ]);

      setBadges(allBadgesRes.data || []);
      setEarnedBadgeCodes(new Set((earnedBadgesRes.data || []).map((b: Badge) => b.badge_code)));
    }

    loadBadges();
  }, []);

  const filteredBadges = badges.filter(badge => {
    const matchesCategory = categoryFilter === "all" || badge.category === categoryFilter;
    const matchesSearch = badge.badge_name.toLowerCase().includes(searchQuery.toLowerCase());
    return matchesCategory && matchesSearch;
  });

  return (
    <DashboardLayout>
      <div className="space-y-6">
        <div>
          <h1 className="text-3xl font-black text-slate-950">Badge Gallery</h1>
          <p className="mt-2 text-slate-600">Earn badges for achievements</p>
        </div>

        <div className="flex gap-4 flex-wrap">
          {["all", "performance", "activity", "tenure", "social"].map(cat => (
            <button
              key={cat}
              onClick={() => setCategoryFilter(cat)}
              className={`px-4 py-2 rounded-xl font-semibold text-sm ${
                categoryFilter === cat
                  ? "bg-emerald-600 text-white"
                  : "bg-slate-100 text-slate-700 hover:bg-slate-200"
              }`}
            >
              {cat.charAt(0).toUpperCase() + cat.slice(1)}
            </button>
          ))}
        </div>

        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-5 w-5 text-slate-400" />
          <input
            type="text"
            placeholder="Search badges..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pl-10 pr-4 py-3 rounded-2xl border bg-white"
          />
        </div>

        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {filteredBadges.map(badge => (
            <BadgeCard
              key={badge.id}
              badgeName={badge.badge_name}
              badgeDescription={badge.badge_description}
              category={badge.category}
              pointValue={badge.point_value}
              isEarned={earnedBadgeCodes.has(badge.badge_code)}
              earnedAt={badge.earned_at}
            />
          ))}
        </div>
      </div>
    </DashboardLayout>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add src/pages/NativeBadges.tsx
git commit -m "feat(engagement): add badge gallery page

- Grid view with BadgeCard components
- Category filter (all/performance/activity/tenure/social)
- Search by badge name
- Shows earned vs locked badges"
```

---

## Task 12: Kudos Wall Page

**Files:**
- Create: `src/pages/NativeKudos.tsx`

- [ ] **Step 1: Create kudos wall with give kudos form**

```typescript
// src/pages/NativeKudos.tsx
import { useEffect, useState } from "react";
import { Heart, Send } from "lucide-react";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { hrmsApi } from "@/lib/hrmsApi";
import { KudosCard } from "@/components/engagement/KudosCard";

export default function NativeKudos() {
  const [kudosWall, setKudosWall] = useState([]);
  const [tab, setTab] = useState<"wall" | "received" | "given">("wall");
  const [showGiveForm, setShowGiveForm] = useState(false);
  const [kudosLimit, setKudosLimit] = useState({ given: 0, limit: 10, remaining: 10 });
  
  const [giveForm, setGiveForm] = useState({
    toEmployeeId: "",
    kudosType: "team_player",
    message: "",
    isPublic: true
  });

  useEffect(() => {
    loadKudosWall();
    loadKudosLimit();
  }, []);

  async function loadKudosWall() {
    const res = await hrmsApi.get("/api/engagement/kudos/wall");
    setKudosWall(res.data || []);
  }

  async function loadKudosLimit() {
    const employeeId = localStorage.getItem("employeeId");
    const res = await hrmsApi.get(`/api/engagement/kudos/limit/${employeeId}`);
    setKudosLimit(res.data || { given: 0, limit: 10, remaining: 10 });
  }

  async function handleGiveKudos() {
    try {
      await hrmsApi.post("/api/engagement/kudos", giveForm);
      setShowGiveForm(false);
      loadKudosWall();
      loadKudosLimit();
    } catch (error: any) {
      alert(error.response?.data?.message || "Failed to give kudos");
    }
  }

  return (
    <DashboardLayout>
      <div className="space-y-6">
        <div className="flex items-end justify-between">
          <div>
            <h1 className="text-3xl font-black text-slate-950">Kudos Wall</h1>
            <p className="mt-2 text-slate-600">Recognize your colleagues</p>
          </div>
          <button
            onClick={() => setShowGiveForm(true)}
            className="rounded-2xl bg-emerald-600 px-6 py-3 font-bold text-white hover:bg-emerald-700"
          >
            <Heart className="inline h-5 w-5 mr-2" />
            Give Kudos ({kudosLimit.remaining}/{kudosLimit.limit} left)
          </button>
        </div>

        <div className="flex gap-3">
          {["wall", "received", "given"].map(t => (
            <button
              key={t}
              onClick={() => setTab(t as any)}
              className={`px-4 py-2 rounded-xl font-semibold text-sm ${
                tab === t ? "bg-emerald-600 text-white" : "bg-slate-100 text-slate-700"
              }`}
            >
              {t.charAt(0).toUpperCase() + t.slice(1)}
            </button>
          ))}
        </div>

        <div className="space-y-4">
          {kudosWall.map((kudos: any) => (
            <KudosCard key={kudos.id} {...kudos} />
          ))}
        </div>

        {showGiveForm && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 backdrop-blur-sm p-4">
            <div className="w-full max-w-md rounded-3xl bg-white p-6">
              <h2 className="text-xl font-black mb-4">Give Kudos</h2>
              
              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-semibold mb-2">Recipient</label>
                  <input
                    type="text"
                    placeholder="Employee ID"
                    value={giveForm.toEmployeeId}
                    onChange={(e) => setGiveForm({...giveForm, toEmployeeId: e.target.value})}
                    className="w-full rounded-xl border px-4 py-2"
                  />
                </div>

                <div>
                  <label className="block text-sm font-semibold mb-2">Type</label>
                  <select
                    value={giveForm.kudosType}
                    onChange={(e) => setGiveForm({...giveForm, kudosType: e.target.value})}
                    className="w-full rounded-xl border px-4 py-2"
                  >
                    <option value="team_player">Team Player</option>
                    <option value="problem_solver">Problem Solver</option>
                    <option value="quality_champion">Quality Champion</option>
                    <option value="mentor">Mentor</option>
                  </select>
                </div>

                <div>
                  <label className="block text-sm font-semibold mb-2">Message (optional)</label>
                  <textarea
                    placeholder="Write a message..."
                    value={giveForm.message}
                    onChange={(e) => setGiveForm({...giveForm, message: e.target.value})}
                    className="w-full rounded-xl border px-4 py-2 h-24"
                  />
                </div>

                <div className="flex gap-3">
                  <button
                    onClick={() => setShowGiveForm(false)}
                    className="flex-1 rounded-xl border py-2 font-semibold"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={handleGiveKudos}
                    className="flex-1 rounded-xl bg-emerald-600 py-2 font-semibold text-white"
                  >
                    Send Kudos
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </DashboardLayout>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add src/pages/NativeKudos.tsx
git commit -m "feat(engagement): add kudos wall page

- Public kudos wall with KudosCard components
- Give kudos form (modal)
- Monthly limit indicator (X/10 left)
- Tabs: Wall / Received / Given"
```

---

## Task 13: Navigation Sidebar Integration

**Files:**
- Modify: `src/components/layout/DashboardLayout.tsx` (or wherever sidebar nav is defined)

- [ ] **Step 1: Add Engagement section to sidebar nav**

Find nav items array and add:

```typescript
{
  section: "Engagement",
  items: [
    { label: "Dashboard", href: "/engagement", icon: <TrendingUp /> },
    { label: "Badges", href: "/engagement/badges", icon: <Award /> },
    { label: "Kudos", href: "/engagement/kudos", icon: <Heart /> },
    { label: "Surveys", href: "/engagement/surveys", icon: <FileText /> },
    { label: "Leaderboard", href: "/engagement/leaderboard", icon: <Trophy /> }
  ]
}
```

- [ ] **Step 2: Add routes to main router**

In `src/App.tsx` or routing config, add:

```typescript
<Route path="/engagement" element={<NativeEngagement />} />
<Route path="/engagement/badges" element={<NativeBadges />} />
<Route path="/engagement/kudos" element={<NativeKudos />} />
<Route path="/engagement/surveys" element={<NativeSurveys />} />
<Route path="/engagement/leaderboard" element={<NativeLeaderboard />} />
```

- [ ] **Step 3: Commit**

```bash
git add src/components/layout/DashboardLayout.tsx src/App.tsx
git commit -m "feat(engagement): add navigation sidebar entries

- Engagement section in sidebar nav
- 5 menu items: Dashboard, Badges, Kudos, Surveys, Leaderboard
- Routes registered in App.tsx"
```

---

## Task 14: Activity Tracking Hooks

**Files:**
- Modify: `backend/src/modules/payroll/payslip.service.ts`
- Modify: `backend/src/modules/wfm/wfm.service.ts`
- Modify: `backend/src/modules/kpi/kpi.service.ts`

- [ ] **Step 1: Add badge check to payslip acknowledgment**

```typescript
// In backend/src/modules/payroll/payslip.service.ts
// Find acknowledgePayslip method, add after existing logic:

import { badgeService } from "../engagement/badge.service.js";

// After updating acknowledged_at:
const [ackStreak] = await db.execute<RowDataPacket[]>(
  `SELECT COUNT(*) as streak FROM salary_payslip
   WHERE employee_id = ? AND acknowledged_at IS NOT NULL
   ORDER BY generated_at DESC LIMIT 10`,
  [employeeId]
);

if ((ackStreak as any)[0].streak >= 10) {
  await badgeService.checkAndAwardBadge(employeeId, 'payslip_champion');
}
```

- [ ] **Step 2: Add attendance streak badge check**

```typescript
// In backend/src/modules/wfm/wfm.service.ts
// Find clockOut method, add:

import { badgeService } from "../engagement/badge.service.js";

// After clock-out success:
const [streak] = await db.execute<RowDataPacket[]>(
  `SELECT COUNT(*) as days FROM wfm_attendance_session
   WHERE employee_id = ? AND current_status IN ('Logged Out','Logged In')
   AND session_date >= DATE_SUB(CURDATE(), INTERVAL 90 DAY)
   ORDER BY session_date DESC`,
  [employeeId]
);

const consecutiveDays = (streak as any)[0].days;

if (consecutiveDays === 30) {
  await badgeService.checkAndAwardBadge(employeeId, 'attendance_streak_30');
} else if (consecutiveDays === 60) {
  await badgeService.checkAndAwardBadge(employeeId, 'attendance_streak_60');
} else if (consecutiveDays === 90) {
  await badgeService.checkAndAwardBadge(employeeId, 'attendance_streak_90');
}
```

- [ ] **Step 3: Add KPI performance badge check**

```typescript
// In backend/src/modules/kpi/kpi.service.ts
// Find recordScore method, add:

import { badgeService } from "../engagement/badge.service.js";

// After score insert:
const [recentScores] = await db.execute<RowDataPacket[]>(
  `SELECT rating FROM kpi_score
   WHERE employee_id = ? AND score_month >= DATE_SUB(CURDATE(), INTERVAL 3 MONTH)
   ORDER BY score_month DESC LIMIT 3`,
  [employeeId]
);

const allSRating = (recentScores as any[]).length === 3 && 
                   (recentScores as any[]).every((s: any) => s.rating === 'S');

if (allSRating) {
  await badgeService.checkAndAwardBadge(employeeId, 'top_performer_3mo');
}
```

- [ ] **Step 4: Commit**

```bash
git add backend/src/modules/payroll/payslip.service.ts backend/src/modules/wfm/wfm.service.ts backend/src/modules/kpi/kpi.service.ts
git commit -m "feat(engagement): add activity tracking hooks

- Payslip ack: check for 10-streak badge
- Attendance: check for 30/60/90-day streak badges
- KPI: check for 3-month S-rating performance badge

Badges auto-awarded via badgeService.checkAndAwardBadge()"
```

---

## Task 15: Tenure Badge Cron Job

**Files:**
- Create: `backend/src/modules/engagement/tenure.cron.ts`

- [ ] **Step 1: Write tenure badge cron job**

```typescript
// backend/src/modules/engagement/tenure.cron.ts
import type { RowDataPacket } from "mysql2";
import { db } from "../../db/mysql.js";
import { badgeService } from "./badge.service.js";

export async function checkTenureBadges() {
  const tenureMilestones = [
    { months: 6, badgeCode: 'tenure_6mo' },
    { months: 12, badgeCode: 'tenure_1yr' },
    { months: 36, badgeCode: 'tenure_3yr' },
    { months: 60, badgeCode: 'tenure_5yr' }
  ];

  for (const milestone of tenureMilestones) {
    const [employees] = await db.execute<RowDataPacket[]>(
      `SELECT id FROM employees 
       WHERE TIMESTAMPDIFF(MONTH, date_of_joining, CURDATE()) >= ? 
       AND id NOT IN (
         SELECT employee_id FROM employee_badge_earned 
         WHERE badge_id = (SELECT id FROM gamification_badge_master WHERE badge_code = ?)
       )`,
      [milestone.months, milestone.badgeCode]
    );

    for (const emp of employees as RowDataPacket[]) {
      try {
        await badgeService.checkAndAwardBadge(emp.id as string, milestone.badgeCode);
        console.log(`Awarded ${milestone.badgeCode} to employee ${emp.id}`);
      } catch (error) {
        console.error(`Failed to award ${milestone.badgeCode} to ${emp.id}

## Task 10: NativeEngagement Dashboard Page

**Files:**
- Create: `src/pages/NativeEngagement.tsx`

- [ ] **Step 1: Create dashboard skeleton**

```typescript
// src/pages/NativeEngagement.tsx
import { useEffect, useState } from "react";
import { Award, TrendingUp, Gift, Users } from "lucide-react";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { hrmsApi } from "@/lib/hrmsApi";
import { TierBadge } from "@/components/engagement/TierBadge";
import { PointsDisplay } from "@/components/engagement/PointsDisplay";

export default function NativeEngagement() {
  const [stats, setStats] = useState({
    totalPoints: 0,
    badgesEarned: 0,
    kudosReceived: 0,
    tierName: "Bronze"
  });

  return (
    <DashboardLayout>
      <div className="space-y-6">
        <div>
          <p className="text-sm font-black uppercase tracking-[0.2em] text-emerald-600">Engagement</p>
          <h1 className="mt-2 text-3xl font-black text-slate-950">Dashboard</h1>
          <p className="mt-2 text-slate-600">Your engagement overview</p>
        </div>

        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <div className="rounded-3xl border bg-white p-5">
            <div className="flex items-start justify-between">
              <PointsDisplay points={stats.totalPoints} label="Total Points" />
              <TrendingUp className="h-5 w-5 text-emerald-600" />
            </div>
          </div>

          <div className="rounded-3xl border bg-white p-5">
            <p className="text-sm font-semibold text-slate-500">Current Tier</p>
            <div className="mt-2">
              <TierBadge tierName={stats.tierName} size="lg" />
            </div>
          </div>

          <div className="rounded-3xl border bg-white p-5">
            <p className="text-sm font-semibold text-slate-500">Badges Earned</p>
            <p className="mt-2 text-3xl font-black text-slate-950">{stats.badgesEarned}</p>
          </div>

          <div className="rounded-3xl border bg-white p-5">
            <p className="text-sm font-semibold text-slate-500">Kudos Received</p>
            <p className="mt-2 text-3xl font-black text-slate-950">{stats.kudosReceived}</p>
          </div>
        </div>
      </div>
    </DashboardLayout>
  );
}
```

- [ ] **Step 2: Add data fetching**

```typescript
// Add to NativeEngagement.tsx after useState

useEffect(() => {
  async function loadDashboard() {
    try {
      const employeeId = localStorage.getItem("employeeId"); // Adjust per auth pattern
      
      const [tierRes, badgesRes, kudosRes] = await Promise.all([
        hrmsApi.get(`/api/engagement/tier/${employeeId}`),
        hrmsApi.get(`/api/engagement/badges/${employeeId}`),
        hrmsApi.get(`/api/engagement/kudos/received/${employeeId}`)
      ]);

      setStats({
        totalPoints: tierRes.data?.total_points || 0,
        badgesEarned: badgesRes.data?.filter((b: any) => b.earned_at).length || 0,
        kudosReceived: kudosRes.data?.length || 0,
        tierName: tierRes.data?.tier_name || "Bronze"
      });
    } catch (error) {
      console.error("Failed to load dashboard:", error);
    }
  }

  loadDashboard();
}, []);
```

- [ ] **Step 3: Commit**

```bash
git add src/pages/NativeEngagement.tsx
git commit -m "feat(engagement): add engagement dashboard page

- Stat cards: total points, tier, badges, kudos
- Data fetching from engagement APIs
- TierBadge and PointsDisplay components integrated"
```

---

## Task 11: NativeBadges Page

**Files:**
- Create: `src/pages/NativeBadges.tsx`

- [ ] **Step 1: Create badge gallery**

```typescript
// src/pages/NativeBadges.tsx
import { useEffect, useState } from "react";
import { Search } from "lucide-react";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { hrmsApi } from "@/lib/hrmsApi";
import { BadgeCard } from "@/components/engagement/BadgeCard";

interface Badge {
  id: string;
  badge_code: string;
  badge_name: string;
  badge_description: string;
  category: string;
  point_value: number;
  earned_at?: string;
}

export default function NativeBadges() {
  const [badges, setBadges] = useState<Badge[]>([]);
  const [earnedBadgeCodes, setEarnedBadgeCodes] = useState<Set<string>>(new Set());
  const [categoryFilter, setCategoryFilter] = useState<string>("all");
  const [searchQuery, setSearchQuery] = useState("");

  useEffect(() => {
    async function loadBadges() {
      const employeeId = localStorage.getItem("employeeId");
      
      const [allBadgesRes, earnedBadgesRes] = await Promise.all([
        hrmsApi.get("/api/engagement/badges"),
        hrmsApi.get(`/api/engagement/badges/${employeeId}`)
      ]);

      setBadges(allBadgesRes.data || []);
      setEarnedBadgeCodes(new Set((earnedBadgesRes.data || []).filter((b: Badge) => b.earned_at).map((b: Badge) => b.badge_code)));
    }

    loadBadges();
  }, []);

  const filteredBadges = badges.filter(badge => {
    const matchesCategory = categoryFilter === "all" || badge.category === categoryFilter;
    const matchesSearch = badge.badge_name.toLowerCase().includes(searchQuery.toLowerCase());
    return matchesCategory && matchesSearch;
  });

  return (
    <DashboardLayout>
      <div className="space-y-6">
        <div>
          <h1 className="text-3xl font-black text-slate-950">Badge Gallery</h1>
          <p className="mt-2 text-slate-600">Earn badges for achievements</p>
        </div>

        <div className="flex gap-4 flex-wrap">
          {["all", "performance", "activity", "tenure", "social"].map(cat => (
            <button
              key={cat}
              onClick={() => setCategoryFilter(cat)}
              className={`px-4 py-2 rounded-xl font-semibold text-sm ${
                categoryFilter === cat
                  ? "bg-emerald-600 text-white"
                  : "bg-slate-100 text-slate-700 hover:bg-slate-200"
              }`}
            >
              {cat.charAt(0).toUpperCase() + cat.slice(1)}
            </button>
          ))}
        </div>

        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-5 w-5 text-slate-400" />
          <input
            type="text"
            placeholder="Search badges..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pl-10 pr-4 py-3 rounded-2xl border bg-white"
          />
        </div>

        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {filteredBadges.map(badge => {
            const earned = earnedBadgeCodes.has(badge.badge_code);
            const earnedBadge = badges.find(b => b.badge_code === badge.badge_code && b.earned_at);
            
            return (
              <BadgeCard
                key={badge.id}
                badgeName={badge.badge_name}
                badgeDescription={badge.badge_description}
                category={badge.category as any}
                pointValue={badge.point_value}
                isEarned={earned}
                earnedAt={earnedBadge?.earned_at}
              />
            );
          })}
        </div>
      </div>
    </DashboardLayout>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add src/pages/NativeBadges.tsx
git commit -m "feat(engagement): add badge gallery page

- Grid view with BadgeCard components
- Category filter (all/performance/activity/tenure/social)
- Search by badge name
- Shows earned vs locked badges"
```

---

## Task 12: Kudos Wall Page

**Files:**
- Create: `src/pages/NativeKudos.tsx`

- [ ] **Step 1: Create kudos wall with give kudos form**

```typescript
// src/pages/NativeKudos.tsx
import { useEffect, useState } from "react";
import { Heart, Send } from "lucide-react";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { hrmsApi } from "@/lib/hrmsApi";
import { KudosCard } from "@/components/engagement/KudosCard";

export default function NativeKudos() {
  const [kudosWall, setKudosWall] = useState([]);
  const [tab, setTab] = useState<"wall" | "received" | "given">("wall");
  const [showGiveForm, setShowGiveForm] = useState(false);
  const [kudosLimit, setKudosLimit] = useState({ given: 0, limit: 10, remaining: 10 });
  
  const [giveForm, setGiveForm] = useState({
    toEmployeeId: "",
    kudosType: "team_player",
    message: "",
    isPublic: true
  });

  useEffect(() => {
    loadKudosWall();
    loadKudosLimit();
  }, []);

  async function loadKudosWall() {
    const res = await hrmsApi.get("/api/engagement/kudos/wall");
    setKudosWall(res.data || []);
  }

  async function loadKudosLimit() {
    const employeeId = localStorage.getItem("employeeId");
    const res = await hrmsApi.get(`/api/engagement/kudos/limit/${employeeId}`);
    setKudosLimit(res.data || { given: 0, limit: 10, remaining: 10 });
  }

  async function handleGiveKudos() {
    try {
      const fromEmployeeId = localStorage.getItem("employeeId");
      await hrmsApi.post("/api/engagement/kudos", {
        fromEmployeeId,
        ...giveForm
      });
      setShowGiveForm(false);
      loadKudosWall();
      loadKudosLimit();
    } catch (error: any) {
      alert(error.response?.data?.message || "Failed to give kudos");
    }
  }

  return (
    <DashboardLayout>
      <div className="space-y-6">
        <div className="flex items-end justify-between">
          <div>
            <h1 className="text-3xl font-black text-slate-950">Kudos Wall</h1>
            <p className="mt-2 text-slate-600">Recognize your colleagues</p>
          </div>
          <button
            onClick={() => setShowGiveForm(true)}
            className="rounded-2xl bg-emerald-600 px-6 py-3 font-bold text-white hover:bg-emerald-700"
          >
            <Heart className="inline h-5 w-5 mr-2" />
            Give Kudos ({kudosLimit.remaining}/{kudosLimit.limit} left)
          </button>
        </div>

        <div className="flex gap-3">
          {["wall", "received", "given"].map(t => (
            <button
              key={t}
              onClick={() => setTab(t as any)}
              className={`px-4 py-2 rounded-xl font-semibold text-sm ${
                tab === t ? "bg-emerald-600 text-white" : "bg-slate-100 text-slate-700"
              }`}
            >
              {t.charAt(0).toUpperCase() + t.slice(1)}
            </button>
          ))}
        </div>

        <div className="space-y-4">
          {kudosWall.map((kudos: any) => (
            <KudosCard key={kudos.id} {...kudos} />
          ))}
        </div>

        {showGiveForm && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 backdrop-blur-sm p-4">
            <div className="w-full max-w-md rounded-3xl bg-white p-6">
              <h2 className="text-xl font-black mb-4">Give Kudos</h2>
              
              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-semibold mb-2">Recipient</label>
                  <input
                    type="text"
                    placeholder="Employee ID"
                    value={giveForm.toEmployeeId}
                    onChange={(e) => setGiveForm({...giveForm, toEmployeeId: e.target.value})}
                    className="w-full rounded-xl border px-4 py-2"
                  />
                </div>

                <div>
                  <label className="block text-sm font-semibold mb-2">Type</label>
                  <select
                    value={giveForm.kudosType}
                    onChange={(e) => setGiveForm({...giveForm, kudosType: e.target.value})}
                    className="w-full rounded-xl border px-4 py-2"
                  >
                    <option value="team_player">Team Player</option>
                    <option value="problem_solver">Problem Solver</option>
                    <option value="quality_champion">Quality Champion</option>
                    <option value="mentor">Mentor</option>
                  </select>
                </div>

                <div>
                  <label className="block text-sm font-semibold mb-2">Message (optional)</label>
                  <textarea
                    placeholder="Write a message..."
                    value={giveForm.message}
                    onChange={(e) => setGiveForm({...giveForm, message: e.target.value})}
                    className="w-full rounded-xl border px-4 py-2 h-24"
                  />
                </div>

                <div className="flex gap-3">
                  <button
                    onClick={() => setShowGiveForm(false)}
                    className="flex-1 rounded-xl border py-2 font-semibold"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={handleGiveKudos}
                    className="flex-1 rounded-xl bg-emerald-600 py-2 font-semibold text-white"
                  >
                    Send Kudos
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </DashboardLayout>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add src/pages/NativeKudos.tsx
git commit -m "feat(engagement): add kudos wall page

- Public kudos wall with KudosCard components
- Give kudos form (modal)
- Monthly limit indicator (X/10 left)
- Tabs: Wall / Received / Given"
```

---

## Task 13: Navigation Sidebar Integration

**Files:**
- Modify: `src/components/layout/DashboardLayout.tsx` or sidebar nav file
- Modify: `src/App.tsx`
- Modify: `backend/src/modules/access/role.catalog.ts`

- [ ] **Step 1: Add Engagement section to sidebar nav**

Find nav items array, add:

```typescript
{
  section: "Engagement",
  items: [
    { label: "Dashboard", href: "/engagement", icon: <TrendingUp /> },
    { label: "Badges", href: "/engagement/badges", icon: <Award /> },
    { label: "Kudos", href: "/engagement/kudos", icon: <Heart /> }
  ]
}
```

- [ ] **Step 2: Add routes to main router**

In `src/App.tsx`:

```typescript
<Route path="/engagement" element={<NativeEngagement />} />
<Route path="/engagement/badges" element={<NativeBadges />} />
<Route path="/engagement/kudos" element={<NativeKudos />} />
```

- [ ] **Step 3: Add engagement to RBAC catalog**

In `backend/src/modules/access/role.catalog.ts`, add `"engagement"` to MODULES array:

```typescript
export const MODULES = [
  // ... existing modules
  "engagement",
] as const;

// In ROLE_MODULE_ACCESS:
employee: [
  // ... existing modules
  "engagement",
],
```

- [ ] **Step 4: Commit**

```bash
git add src/components/layout/DashboardLayout.tsx src/App.tsx backend/src/modules/access/role.catalog.ts
git commit -m "feat(engagement): add navigation sidebar entries

- Engagement section in sidebar nav
- 3 menu items: Dashboard, Badges, Kudos
- Routes registered in App.tsx
- RBAC module added for access control"
```

---

## Task 14: Activity Tracking Hooks

**Files:**
- Modify: `backend/src/modules/payroll/payslip.service.ts`
- Modify: `backend/src/modules/wfm/wfm.service.ts`
- Modify: `backend/src/modules/kpi/kpi.service.ts`

- [ ] **Step 1: Add badge check to payslip acknowledgment**

```typescript
// In backend/src/modules/payroll/payslip.service.ts
// Find acknowledgePayslip method, add after existing logic:

import { badgeService } from "../engagement/badge.service.js";

// After updating acknowledged_at:
const [ackStreak] = await db.execute<RowDataPacket[]>(
  `SELECT COUNT(*) as streak FROM salary_payslip
   WHERE employee_id = ? AND acknowledged_at IS NOT NULL
   ORDER BY generated_at DESC LIMIT 10`,
  [employeeId]
);

if ((ackStreak as any)[0].streak >= 10) {
  await badgeService.checkAndAwardBadge(employeeId, 'payslip_champion');
}
```

- [ ] **Step 2: Add attendance streak badge check**

```typescript
// In backend/src/modules/wfm/wfm.service.ts
// Find clockOut method, add:

import { badgeService } from "../engagement/badge.service.js";

// After clock-out success:
const [streak] = await db.execute<RowDataPacket[]>(
  `SELECT COUNT(*) as days FROM wfm_attendance_session
   WHERE employee_id = ? AND current_status IN ('Logged Out','Logged In')
   AND session_date >= DATE_SUB(CURDATE(), INTERVAL 90 DAY)
   ORDER BY session_date DESC`,
  [employeeId]
);

const consecutiveDays = (streak as any)[0].days;

if (consecutiveDays === 30) {
  await badgeService.checkAndAwardBadge(employeeId, 'attendance_streak_30');
} else if (consecutiveDays === 60) {
  await badgeService.checkAndAwardBadge(employeeId, 'attendance_streak_60');
} else if (consecutiveDays === 90) {
  await badgeService.checkAndAwardBadge(employeeId, 'attendance_streak_90');
}
```

- [ ] **Step 3: Add KPI performance badge check**

```typescript
// In backend/src/modules/kpi/kpi.service.ts
// Find recordScore method, add:

import { badgeService } from "../engagement/badge.service.js";

// After score insert:
const [recentScores] = await db.execute<RowDataPacket[]>(
  `SELECT rating FROM kpi_score
   WHERE employee_id = ? AND score_month >= DATE_SUB(CURDATE(), INTERVAL 3 MONTH)
   ORDER BY score_month DESC LIMIT 3`,
  [employeeId]
);

const allSRating = (recentScores as any[]).length === 3 && 
                   (recentScores as any[]).every((s: any) => s.rating === 'S');

if (allSRating) {
  await badgeService.checkAndAwardBadge(employeeId, 'top_performer_3mo');
}
```

- [ ] **Step 4: Commit**

```bash
git add backend/src/modules/payroll/payslip.service.ts backend/src/modules/wfm/wfm.service.ts backend/src/modules/kpi/kpi.service.ts
git commit -m "feat(engagement): add activity tracking hooks

- Payslip ack: check for 10-streak badge
- Attendance: check for 30/60/90-day streak badges
- KPI: check for 3-month S-rating performance badge

Badges auto-awarded via badgeService.checkAndAwardBadge()"
```

---

## Task 15: Tenure Badge Cron Job

**Files:**
- Create: `backend/src/modules/engagement/tenure.cron.ts`
- Modify: `backend/src/index.ts`

- [ ] **Step 1: Write tenure badge cron job**

```typescript
// backend/src/modules/engagement/tenure.cron.ts
import type { RowDataPacket } from "mysql2";
import { db } from "../../db/mysql.js";
import { badgeService } from "./badge.service.js";

export async function checkTenureBadges() {
  const tenureMilestones = [
    { months: 6, badgeCode: 'tenure_6mo' },
    { months: 12, badgeCode: 'tenure_1yr' },
    { months: 36, badgeCode: 'tenure_3yr' },
    { months: 60, badgeCode: 'tenure_5yr' }
  ];

  for (const milestone of tenureMilestones) {
    const [employees] = await db.execute<RowDataPacket[]>(
      `SELECT id FROM employees 
       WHERE TIMESTAMPDIFF(MONTH, date_of_joining, CURDATE()) >= ? 
       AND id NOT IN (
         SELECT employee_id FROM employee_badge_earned 
         WHERE badge_id = (SELECT id FROM gamification_badge_master WHERE badge_code = ?)
       )`,
      [milestone.months, milestone.badgeCode]
    );

    for (const emp of employees as RowDataPacket[]) {
      try {
        await badgeService.checkAndAwardBadge(emp.id as string, milestone.badgeCode);
        console.log(`Awarded ${milestone.badgeCode} to employee ${emp.id}`);
      } catch (error) {
        console.error(`Failed to award ${milestone.badgeCode} to ${emp.id}:`, error);
      }
    }
  }
}
```

- [ ] **Step 2: Schedule daily cron job**

Add cron entry (adjust based on codebase cron setup):

```typescript
// In backend/src/index.ts or cron setup file:
import cron from "node-cron";
import { checkTenureBadges } from "./modules/engagement/tenure.cron.js";

// Run daily at 2 AM
cron.schedule("0 2 * * *", async () => {
  console.log("Running tenure badge cron job");
  await checkTenureBadges();
});
```

- [ ] **Step 3: Commit**

```bash
git add backend/src/modules/engagement/tenure.cron.ts backend/src/index.ts
git commit -m "feat(engagement): add tenure badge cron job

- checkTenureBadges: award 6mo/1yr/3yr/5yr badges
- Runs daily at 2 AM via node-cron
- Skips already-awarded badges"
```

---

## Task 16: Integration Testing

**Files:**
- Create: `backend/src/modules/engagement/__tests__/engagement.test.ts`

- [ ] **Step 1: Write integration tests**

```typescript
// backend/src/modules/engagement/__tests__/engagement.test.ts
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import { app } from "../../../app.js";
import { db } from "../../../db/mysql.js";
import { randomUUID } from "crypto";

describe("Engagement Module Integration", () => {
  let testEmployeeId: string;
  let testEmployeeId2: string;

  beforeAll(async () => {
    testEmployeeId = randomUUID();
    testEmployeeId2 = randomUUID();

    await db.execute(
      `INSERT INTO employees (id, full_name, email, date_of_joining) VALUES (?, 'Test User 1', 'test1@example.com', '2024-01-01')`,
      [testEmployeeId]
    );
    
    await db.execute(
      `INSERT INTO employees (id, full_name, email, date_of_joining) VALUES (?, 'Test User 2', 'test2@example.com', '2024-01-01')`,
      [testEmployeeId2]
    );
  });

  afterAll(async () => {
    await db.execute(`DELETE FROM employee_badge_earned WHERE employee_id IN (?, ?)`, [testEmployeeId, testEmployeeId2]);
    await db.execute(`DELETE FROM gamification_point_log WHERE employee_id IN (?, ?)`, [testEmployeeId, testEmployeeId2]);
    await db.execute(`DELETE FROM employee_tier WHERE employee_id IN (?, ?)`, [testEmployeeId, testEmployeeId2]);
    await db.execute(`DELETE FROM kudos_master WHERE from_employee_id = ? OR to_employee_id = ?`, [testEmployeeId, testEmployeeId2]);
    await db.execute(`DELETE FROM employees WHERE id IN (?, ?)`, [testEmployeeId, testEmployeeId2]);
  });

  it("should record points and update tier", async () => {
    const res = await request(app)
      .post("/api/engagement/points")
      .send({
        employeeId: testEmployeeId,
        points: 100,
        source: "manual",
        referenceId: null,
      });

    expect(res.status).toBe(200);
    expect(res.body.totalPoints).toBe(100);
  });

  it("should award badge once only", async () => {
    const res1 = await request(app)
      .post("/api/engagement/badges/award")
      .send({
        employeeId: testEmployeeId,
        badgeCode: "payslip_champion",
      });

    expect(res1.status).toBe(200);
    expect(res1.body.awarded).toBe(true);

    const res2 = await request(app)
      .post("/api/engagement/badges/award")
      .send({
        employeeId: testEmployeeId,
        badgeCode: "payslip_champion",
      });

    expect(res2.body.awarded).toBe(false);
  });

  it("should enforce monthly kudos limit", async () => {
    const promises = [];
    for (let i = 0; i < 11; i++) {
      promises.push(
        request(app)
          .post("/api/engagement/kudos")
          .send({
            fromEmployeeId: testEmployeeId,
            toEmployeeId: testEmployeeId2,
            kudosType: "team_player",
            isPublic: true,
          })
      );
    }

    const results = await Promise.all(promises);
    const failedReq = results[10];
    expect(failedReq.status).toBe(400);
    expect(failedReq.body.message).toContain("monthly kudos limit");
  });
});
```

- [ ] **Step 2: Run tests**

```bash
cd /home/shuvam/mas-callnet-hrms
npm test -- engagement.test.ts
```

Expected: All tests pass.

- [ ] **Step 3: Commit**

```bash
git add backend/src/modules/engagement/__tests__/engagement.test.ts
git commit -m "test(engagement): add integration tests

- Record points + tier update
- Badge award once only
- Monthly kudos limit enforcement"
```

---

## Plan Complete

Tasks 1-16 complete:
- Database schema (14 tables, 16 badges, 4 tiers)
- Backend services (gamification, badge, kudos, survey)
- TypeScript types + Zod validation
- Controller + routes
- Shared React components (BadgeCard, KudosCard, TierBadge, PointsDisplay)
- Frontend pages (NativeEngagement, NativeBadges, NativeKudos)
- Navigation sidebar integration + RBAC
- Activity tracking hooks (payslip, attendance, KPI)
- Tenure badge cron job
- Integration tests

Plan saved to: [docs/superpowers/plans/2026-05-31-gamification-engagement.md](docs/superpowers/plans/2026-05-31-gamification-engagement.md)

**Execution options:**

1. **Subagent-Driven (recommended)** - Dispatch fresh subagent per task, review between tasks
2. **Inline Execution** - Execute tasks in session using executing-plans

Which?
