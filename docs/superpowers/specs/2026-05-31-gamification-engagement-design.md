# Gamification & Engagement Module Design

**Date:** 2026-05-31  
**Author:** Design Session (Claude + User)  
**Status:** Approved  
**Priority:** Critical (0% coverage identified in assessment)

---

## Context & Motivation

Assessment of mas-callnet-hrms identified **complete absence** of employee engagement and gamification features. Current KPI leaderboard is performance-based only (not gamification). This creates a critical gap in user experience and employee motivation.

**Business need:**
- Drive platform adoption through engagement mechanics
- Recognize and reward consistent activity and performance excellence
- Enable peer recognition and social engagement
- Gather feedback via surveys and pulse checks
- Track employee sentiment (eNPS)

**Success criteria:**
- Employees earn badges for performance + activity milestones
- Point accumulation system with tier progression (Bronze/Silver/Gold/Platinum)
- Kudos system for peer recognition with monthly limits (spam prevention)
- Survey creation and response tracking (anonymous + identified modes)
- Pulse checks for lightweight feedback
- Leaderboards with tiered visibility (employees see top 10 + self, managers see team, admins see all)

---

## Architecture

### Module Structure

**Standalone module:** `/backend/src/modules/engagement/`

Follows existing mas-callnet-hrms pattern (34 standalone modules). Clean separation enables independent testing, deployment, and feature toggling.

**Files:**
- `engagement.routes.ts` - API route definitions
- `engagement.controller.ts` - Request handlers
- `engagement.service.ts` - Core business logic
- `engagement.types.ts` - TypeScript interfaces
- `engagement.validation.ts` - Zod schemas for input validation
- `badge.service.ts` - Badge award logic, auto-tracking
- `kudos.service.ts` - Kudos creation, monthly limits
- `survey.service.ts` - Survey/pulse creation, response handling, eNPS calculation
- `gamification.service.ts` - Points, tiers, leaderboards

**Integration approach:**
- Activity tracking: explicit hooks in source modules (payroll, attendance, KPI)
- No event bus (simpler than event-driven architecture for this use case)
- Direct service calls: `await badgeService.trackActivity(...)` in existing modules

---

## Database Schema

### Badge System

```sql
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
  criteria_config JSON, -- {"kpi_rating": "S", "months": 3} or {"streak_days": 30}
  is_active TINYINT(1) DEFAULT 1,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Employee badge achievements
CREATE TABLE employee_badge_earned (
  id VARCHAR(36) PRIMARY KEY,
  employee_id VARCHAR(36) NOT NULL,
  badge_id VARCHAR(36) NOT NULL,
  earned_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  awarded_by VARCHAR(36), -- NULL for auto-awards, user_id for manual awards
  evidence_ref VARCHAR(255), -- kpi_score_id, attendance_session_id, etc.
  FOREIGN KEY (employee_id) REFERENCES employees(id),
  FOREIGN KEY (badge_id) REFERENCES gamification_badge_master(id),
  INDEX idx_employee_badges (employee_id, earned_at DESC)
);
```

**Badge categories:**
- **Performance:** KPI excellence, top performer streaks (3+ months S-rating)
- **Activity:** Profile completion, attendance streaks (30 days), early bird (clock-in before 9am)
- **Tenure:** 6mo/1yr/3yr/5yr milestones
- **Social:** Kudos received count thresholds

**Standard badge set (15-20 badges):**
- Top Performer Bronze/Silver/Gold (1/2/3 months S-rating)
- Attendance Streak 30/60/90 days
- Early Bird (20 days clock-in before 9am)
- Profile Complete (100% profile filled)
- Payslip Ack Champion (10 consecutive months)
- Tenure milestones (6mo, 1yr, 3yr, 5yr)
- Kudos Giver/Receiver (10/25/50 kudos)
- Survey Champion (5 surveys completed)

### Points & Tiers

```sql
-- Point transaction log
CREATE TABLE gamification_point_log (
  id VARCHAR(36) PRIMARY KEY,
  employee_id VARCHAR(36) NOT NULL,
  points INT NOT NULL,
  source ENUM('badge_earned', 'kudos_received', 'survey_completed', 'manual_adjustment') NOT NULL,
  reference_id VARCHAR(36), -- badge_id, kudos_id, survey_response_id
  awarded_by VARCHAR(36), -- for manual adjustments
  awarded_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (employee_id) REFERENCES employees(id),
  INDEX idx_employee_points (employee_id, awarded_at DESC)
);

-- Tier definitions
CREATE TABLE gamification_tier (
  id VARCHAR(36) PRIMARY KEY,
  tier_name VARCHAR(50) NOT NULL, -- Bronze, Silver, Gold, Platinum
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

**Point mechanics:**
- **Lifetime accumulation:** points never expire, total always grows
- **Tier progression:** thresholds unlock tiers (0-500 Bronze, 501-1500 Silver, 1501-3000 Gold, 3001+ Platinum)
- **Monthly leaderboards:** separate query filters point_log by date range for monthly rankings

**Point values:**
- Badge earned: 10-100 points (varies by badge, defined in `badge_master.point_value`)
- Kudos received: 10-20 points (varies by kudos type)
- Survey completed: 5 points
- Manual adjustment: admin-specified (can be negative)

### Kudos System

```sql
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

-- Monthly kudos limit tracking (spam prevention)
CREATE TABLE kudos_giver_limit (
  employee_id VARCHAR(36),
  month_year VARCHAR(7) NOT NULL, -- "2026-05"
  kudos_given_count INT DEFAULT 0,
  PRIMARY KEY (employee_id, month_year),
  FOREIGN KEY (employee_id) REFERENCES employees(id)
);
```

**Kudos categories with point values:**
- Team Player: 10 points
- Problem Solver: 15 points
- Quality Champion: 15 points
- Mentor: 20 points

**Monthly limit:** 10 kudos per employee per month (prevents spam, encourages thoughtful recognition)

### Surveys & Pulse Checks

```sql
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
  options JSON, -- ["Option A", "Option B"] for multiple_choice
  is_required TINYINT(1) DEFAULT 1,
  FOREIGN KEY (survey_id) REFERENCES survey_template(id),
  INDEX idx_survey_questions (survey_id, question_order)
);

-- Survey responses
CREATE TABLE survey_response (
  id VARCHAR(36) PRIMARY KEY,
  survey_id VARCHAR(36) NOT NULL,
  employee_id VARCHAR(36), -- NULL if anonymous
  response_data JSON NOT NULL, -- {question_id: answer, ...}
  submitted_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (survey_id) REFERENCES survey_template(id),
  FOREIGN KEY (employee_id) REFERENCES employees(id),
  INDEX idx_survey_responses (survey_id, submitted_at)
);

-- Pulse checks (lightweight quick polls)
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
  response_value VARCHAR(50) NOT NULL, -- "😊", "yes", "4"
  responded_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (pulse_id) REFERENCES pulse_check(id),
  FOREIGN KEY (employee_id) REFERENCES employees(id),
  UNIQUE KEY unique_pulse_response (pulse_id, employee_id)
);
```

**Survey features:**
- Anonymous vs identified mode (per survey)
- Question types: multiple choice, rating scale (1-5), text, eNPS (0-10)
- Date-bound surveys (start/end dates)
- Survey completion awards 5 points (identified surveys only)

**Pulse features:**
- Lightweight 1-2 question polls
- Quick response types: emoji scale, yes/no, rating 1-5
- Aggregate results shown after submission
- Auto-expire after end date

---

## API Endpoints

### Badges

```
GET    /api/engagement/badges                    // list all available badges
GET    /api/engagement/badges/:employeeId        // badges earned by employee
POST   /api/engagement/badges/award              // manual badge award (admin/manager)
GET    /api/engagement/badges/progress/:badgeId  // progress toward badge (if auto-tracked)
```

**Authorization:**
- All employees: view badges, see own progress
- Managers: award badges to direct reports
- Admin/HR: award any badge, create new badge definitions

### Points & Tiers

```
GET    /api/engagement/points/:employeeId        // point log for employee
GET    /api/engagement/leaderboard               // leaderboard (tiered visibility)
POST   /api/engagement/points/adjust             // manual point adjustment (admin only)
GET    /api/engagement/tiers                     // list tier definitions
GET    /api/engagement/tier/:employeeId          // current tier for employee
```

**Leaderboard query parameters:**
- `timeframe`: monthly | quarterly | all_time
- `processId`: filter by process (optional)
- `branchId`: filter by branch (optional)

**Leaderboard tiered visibility:**
- **Employees:** See top 10 + own rank (e.g., "Your Rank: #47")
- **Managers:** See full team leaderboard (same process/branch)
- **Admin/HR:** See all leaderboards, export CSV

### Kudos

```
GET    /api/engagement/kudos/wall                // public kudos wall (recent 50)
POST   /api/engagement/kudos                     // give kudos
GET    /api/engagement/kudos/received/:employeeId // kudos received by employee
GET    /api/engagement/kudos/given/:employeeId   // kudos given by employee
```

**Kudos validation:**
- Monthly limit check: 10 kudos per employee per month
- Cannot give kudos to self
- Private kudos (is_public=false) not shown on wall but receiver notified

### Surveys

```
GET    /api/engagement/surveys                   // list active surveys
POST   /api/engagement/surveys                   // create survey (admin/HR)
GET    /api/engagement/surveys/:id               // survey details
POST   /api/engagement/surveys/:id/respond       // submit response
GET    /api/engagement/surveys/:id/results       // results (admin/HR only)
PATCH  /api/engagement/surveys/:id/status        // activate/deactivate survey
```

**Survey results include:**
- Response rate (completed / total employees)
- Question-by-question breakdown (aggregated)
- eNPS score (for eNPS questions): promoters%, detractors%, passives%, score
- Export CSV option (admin/HR)

### Pulse Checks

```
GET    /api/engagement/pulse/active              // active pulse checks
POST   /api/engagement/pulse                     // create pulse (admin/HR)
POST   /api/engagement/pulse/:id/respond         // respond to pulse
GET    /api/engagement/pulse/:id/summary         // pulse results summary
```

**Pulse summary format:**
```json
{
  "pulse_id": "uuid",
  "pulse_question": "How are you feeling today?",
  "pulse_type": "emoji_scale",
  "total_responses": 145,
  "response_breakdown": {
    "😊": 65,
    "😐": 45,
    "😞": 35
  }
}
```

### Dashboard

```
GET    /api/engagement/dashboard/:employeeId     // employee engagement overview
GET    /api/engagement/stats/company             // company-wide stats (admin/HR)
```

**Employee dashboard data:**
- Total points, current tier
- Badges earned count, recent badges
- Kudos received/given count (current month)
- Leaderboard rank
- Active surveys/pulse checks
- Recent activity feed (badge earned, kudos received, tier up)

**Company stats (admin/HR):**
- Total engagement activity (badges, kudos, surveys)
- Survey response rates
- Leaderboard distribution (employees per tier)
- Most popular badges
- Average eNPS score trend

---

## Badge Auto-Award Logic

### Activity Tracking Integration Points

**Payslip acknowledgment:**
```typescript
// In: /backend/src/modules/payroll/payslip.service.ts
async acknowledgePayslip(payslipId: string, employeeId: string) {
  // ... existing ack logic ...
  
  await badgeService.trackActivity({
    employeeId,
    activityType: 'payslip_acknowledged',
    referenceId: payslipId,
    timestamp: new Date()
  });
  
  // Check for consecutive ack badge (10 months)
  const ackStreak = await this.getPayslipAckStreak(employeeId);
  if (ackStreak >= 10) {
    await badgeService.checkAndAwardBadge(employeeId, 'payslip_champion');
  }
}
```

**Attendance streak:**
```typescript
// In: /backend/src/modules/wfm/wfm.service.ts
async clockOut(sessionId: string, employeeId: string) {
  // ... existing clock-out logic ...
  
  const streak = await attendanceService.getConsecutiveDaysStreak(employeeId);
  
  if (streak === 30) {
    await badgeService.checkAndAwardBadge(employeeId, 'attendance_streak_30');
  } else if (streak === 60) {
    await badgeService.checkAndAwardBadge(employeeId, 'attendance_streak_60');
  } else if (streak === 90) {
    await badgeService.checkAndAwardBadge(employeeId, 'attendance_streak_90');
  }
}
```

**KPI performance:**
```typescript
// In: /backend/src/modules/kpi/kpi.service.ts
async recordScore(scoreInput: RecordScoreInput) {
  // ... existing score recording ...
  
  // Check for 3-month S-rating streak
  const recentScores = await this.getEmployeeScores(scoreInput.employeeId, { last: 3 });
  const allSRating = recentScores.every(s => s.rating === 'S');
  
  if (allSRating) {
    await badgeService.checkAndAwardBadge(scoreInput.employeeId, 'top_performer_3mo');
  }
}
```

### Badge Award Service

```typescript
// /backend/src/modules/engagement/badge.service.ts
async checkAndAwardBadge(employeeId: string, badgeCode: string): Promise<void> {
  // Check if already earned
  const existing = await db.execute(
    `SELECT id FROM employee_badge_earned 
     WHERE employee_id = ? AND badge_id = (SELECT id FROM gamification_badge_master WHERE badge_code = ?)`,
    [employeeId, badgeCode]
  );
  
  if (existing.length > 0) return; // already has badge
  
  // Award badge
  const badge = await this.getBadgeByCode(badgeCode);
  const earnedId = randomUUID();
  
  await db.execute(
    `INSERT INTO employee_badge_earned (id, employee_id, badge_id, evidence_ref, awarded_by)
     VALUES (?, ?, ?, NULL, NULL)`,
    [earnedId, employeeId, badge.id]
  );
  
  // Award points
  await gamificationService.recordPoints(
    employeeId, 
    badge.point_value, 
    'badge_earned', 
    earnedId
  );
  
  // Check tier progression
  await gamificationService.checkAndUpdateTier(employeeId);
  
  // Notify employee
  await inboxService.notify(
    employeeId, 
    `You earned the ${badge.badge_name} badge! +${badge.point_value} points`
  );
}
```

### Tenure Badge Cron Job

**Daily cron (runs at midnight):**
```typescript
async function checkTenureBadges() {
  const tenureMilestones = [
    { months: 6, badgeCode: 'tenure_6mo' },
    { months: 12, badgeCode: 'tenure_1yr' },
    { months: 36, badgeCode: 'tenure_3yr' },
    { months: 60, badgeCode: 'tenure_5yr' }
  ];
  
  for (const milestone of tenureMilestones) {
    const employees = await db.execute(
      `SELECT id FROM employees 
       WHERE TIMESTAMPDIFF(MONTH, date_of_joining, CURDATE()) >= ? 
       AND id NOT IN (
         SELECT employee_id FROM employee_badge_earned 
         WHERE badge_id = (SELECT id FROM gamification_badge_master WHERE badge_code = ?)
       )`,
      [milestone.months, milestone.badgeCode]
    );
    
    for (const emp of employees) {
      await badgeService.checkAndAwardBadge(emp.id, milestone.badgeCode);
    }
  }
}
```

---

## Point System Implementation

### Point Recording

```typescript
// /backend/src/modules/engagement/gamification.service.ts
async recordPoints(
  employeeId: string,
  points: number,
  source: 'badge_earned' | 'kudos_received' | 'survey_completed' | 'manual_adjustment',
  referenceId: string | null,
  awardedBy: string | null = null
): Promise<{ totalPoints: number, pointsAdded: number }> {
  const logId = randomUUID();
  
  await db.execute(
    `INSERT INTO gamification_point_log (id, employee_id, points, source, reference_id, awarded_by)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [logId, employeeId, points, source, referenceId, awardedBy]
  );
  
  // Calculate total points
  const [totals] = await db.execute(
    `SELECT COALESCE(SUM(points), 0) as total FROM gamification_point_log WHERE employee_id = ?`,
    [employeeId]
  );
  const totalPoints = totals[0].total;
  
  // Check tier progression
  await this.checkAndUpdateTier(employeeId, totalPoints);
  
  return { totalPoints, pointsAdded: points };
}
```

### Tier Progression

```typescript
async checkAndUpdateTier(employeeId: string, totalPoints: number): Promise<void> {
  // Get appropriate tier for point total
  const [tiers] = await db.execute(
    `SELECT * FROM gamification_tier 
     WHERE min_points <= ? AND is_active = 1 
     ORDER BY tier_level DESC LIMIT 1`,
    [totalPoints]
  );
  
  if (!tiers.length) return;
  const newTier = tiers[0];
  
  // Check current tier
  const [current] = await db.execute(
    `SELECT tier_id FROM employee_gamification_tier WHERE employee_id = ?`,
    [employeeId]
  );
  
  if (!current.length) {
    // First tier assignment
    await db.execute(
      `INSERT INTO employee_gamification_tier (employee_id, tier_id, total_points)
       VALUES (?, ?, ?)`,
      [employeeId, newTier.id, totalPoints]
    );
    await inboxService.notify(employeeId, `Welcome to ${newTier.tier_name} tier!`);
  } else if (current[0].tier_id !== newTier.id) {
    // Tier upgrade
    await db.execute(
      `UPDATE employee_gamification_tier 
       SET tier_id = ?, total_points = ?, tier_achieved_at = NOW() 
       WHERE employee_id = ?`,
      [newTier.id, totalPoints, employeeId]
    );
    await inboxService.notify(employeeId, `Congratulations! You've reached ${newTier.tier_name} tier!`);
  } else {
    // Same tier, just update points
    await db.execute(
      `UPDATE employee_gamification_tier SET total_points = ? WHERE employee_id = ?`,
      [totalPoints, employeeId]
    );
  }
}
```

### Tier Seeding

```sql
-- Initial tier data
INSERT INTO gamification_tier (id, tier_name, tier_level, min_points, benefits_description) VALUES
  (UUID(), 'Bronze', 1, 0, 'Welcome to the engagement program'),
  (UUID(), 'Silver', 2, 500, 'Custom profile badge + priority support'),
  (UUID(), 'Gold', 3, 1500, 'All Silver benefits + quarterly bonus eligibility'),
  (UUID(), 'Platinum', 4, 3000, 'All Gold benefits + exclusive recognition events');
```

---

## Leaderboard Implementation

### Leaderboard Query with Tiered Visibility

```typescript
async getLeaderboard(
  requestingUserId: string,
  filters: { 
    timeframe: 'monthly' | 'quarterly' | 'all_time', 
    processId?: string, 
    branchId?: string 
  }
): Promise<LeaderboardEntry[]> {
  const requestingEmployee = await getEmployeeForUser(requestingUserId);
  const userRole = await getUserRole(requestingUserId);
  
  // Determine visibility scope
  let visibilityQuery = '';
  const params: unknown[] = [];
  
  if (['admin', 'hr'].includes(userRole)) {
    // Full visibility - no restrictions
    visibilityQuery = '';
  } else if (['manager', 'team_leader'].includes(userRole)) {
    // Team visibility - same process/branch
    visibilityQuery = `WHERE e.process_id = ? OR e.branch_id = ?`;
    params.push(requestingEmployee.process_id, requestingEmployee.branch_id);
  }
  // Employee visibility handled after query
  
  // Timeframe filter
  let dateFilter = '';
  if (filters.timeframe === 'monthly') {
    dateFilter = `AND gpl.awarded_at >= DATE_SUB(CURDATE(), INTERVAL 1 MONTH)`;
  } else if (filters.timeframe === 'quarterly') {
    dateFilter = `AND gpl.awarded_at >= DATE_SUB(CURDATE(), INTERVAL 3 MONTH)`;
  }
  
  // Process/branch filter
  if (filters.processId) {
    visibilityQuery += (visibilityQuery ? ' AND' : 'WHERE') + ` e.process_id = ?`;
    params.push(filters.processId);
  }
  if (filters.branchId) {
    visibilityQuery += (visibilityQuery ? ' AND' : 'WHERE') + ` e.branch_id = ?`;
    params.push(filters.branchId);
  }
  
  const [rows] = await db.execute(
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
  
  // Apply employee-level visibility: top 10 + self
  if (!['admin', 'hr', 'manager', 'team_leader'].includes(userRole)) {
    const top10 = leaderboard.slice(0, 10);
    const selfEntry = leaderboard.find(entry => entry.employee_id === requestingEmployee.id);
    
    if (selfEntry && !top10.find(e => e.employee_id === selfEntry.employee_id)) {
      leaderboard = [...top10, selfEntry];
    } else {
      leaderboard = top10;
    }
  }
  
  // Add rank
  return leaderboard.map((entry, idx) => ({ ...entry, rank: idx + 1 }));
}
```

---

## Kudos Implementation

### Kudos Service

```typescript
// /backend/src/modules/engagement/kudos.service.ts
async giveKudos(
  fromEmployeeId: string,
  toEmployeeId: string,
  kudosType: 'team_player' | 'problem_solver' | 'quality_champion' | 'mentor',
  message: string,
  isPublic: boolean = true
): Promise<void> {
  // Validate: cannot give kudos to self
  if (fromEmployeeId === toEmployeeId) {
    throw new Error('Cannot give kudos to yourself');
  }
  
  // Check monthly limit
  const currentMonth = new Date().toISOString().slice(0, 7); // "2026-05"
  const [limitCheck] = await db.execute(
    `SELECT kudos_given_count FROM kudos_giver_limit 
     WHERE employee_id = ? AND month_year = ?`,
    [fromEmployeeId, currentMonth]
  );
  
  const monthlyLimit = 10;
  const currentCount = limitCheck.length ? limitCheck[0].kudos_given_count : 0;
  
  if (currentCount >= monthlyLimit) {
    throw new Error(`Monthly kudos limit reached (${monthlyLimit}). Resets next month.`);
  }
  
  // Point value per kudos type
  const pointValues = {
    team_player: 10,
    problem_solver: 15,
    quality_champion: 15,
    mentor: 20
  };
  const points = pointValues[kudosType];
  
  // Create kudos record
  const kudosId = randomUUID();
  await db.execute(
    `INSERT INTO kudos_recognition (id, from_employee_id, to_employee_id, kudos_type, message, points_awarded, is_public)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [kudosId, fromEmployeeId, toEmployeeId, kudosType, message, points, isPublic]
  );
  
  // Award points to receiver
  await gamificationService.recordPoints(toEmployeeId, points, 'kudos_received', kudosId);
  
  // Update giver limit
  await db.execute(
    `INSERT INTO kudos_giver_limit (employee_id, month_year, kudos_given_count)
     VALUES (?, ?, 1)
     ON DUPLICATE KEY UPDATE kudos_given_count = kudos_given_count + 1`,
    [fromEmployeeId, currentMonth]
  );
  
  // Notify receiver
  const fromEmployee = await getEmployeeById(fromEmployeeId);
  await inboxService.notify(
    toEmployeeId,
    `${fromEmployee.full_name} gave you kudos: ${kudosType.replace('_', ' ')}! +${points} points`
  );
}
```

### Kudos Wall Query

```typescript
async getKudosWall(
  filters: { 
    limit?: number, 
    kudosType?: string, 
    dateRange?: 'week' | 'month' | 'all' 
  }
): Promise<KudosCard[]> {
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
  
  const [rows] = await db.execute(
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
}
```

---

## Survey & Pulse Implementation

### Survey Service

```typescript
// /backend/src/modules/engagement/survey.service.ts
async createSurvey(
  surveyData: {
    title: string,
    description: string,
    isAnonymous: boolean,
    startDate: string,
    endDate: string,
    questions: Array<{
      text: string,
      type: 'multiple_choice' | 'rating_scale' | 'text' | 'enps',
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
  
  // Insert questions
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
}

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
  
  // Award points for completion (identified surveys only)
  if (employeeId) {
    await gamificationService.recordPoints(employeeId, 5, 'survey_completed', responseId);
  }
}
```

### eNPS Calculation

```typescript
async calculateENPS(
  surveyId: string, 
  questionId: string
): Promise<{ 
  score: number, 
  promoters: number, 
  detractors: number, 
  passives: number 
}> {
  const [responses] = await db.execute(
    `SELECT response_data FROM survey_response WHERE survey_id = ?`,
    [surveyId]
  );
  
  const scores = responses.map(r => {
    const data = JSON.parse(r.response_data);
    return parseInt(data[questionId]);
  });
  
  const promoters = scores.filter(s => s >= 9).length;
  const passives = scores.filter(s => s >= 7 && s <= 8).length;
  const detractors = scores.filter(s => s <= 6).length;
  const total = scores.length;
  
  const enpsScore = Math.round(((promoters - detractors) / total) * 100);
  
  return { score: enpsScore, promoters, detractors, passives };
}
```

### Pulse Service

```typescript
async createPulse(
  pulseQuestion: string,
  pulseType: 'emoji_scale' | 'yes_no' | 'rating_1_5',
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
}

async respondToPulse(
  pulseId: string, 
  employeeId: string, 
  responseValue: string
): Promise<void> {
  await db.execute(
    `INSERT INTO pulse_response (id, pulse_id, employee_id, response_value)
     VALUES (?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE response_value = VALUES(response_value), responded_at = NOW()`,
    [randomUUID(), pulseId, employeeId, responseValue]
  );
}

async getPulseSummary(pulseId: string): Promise<Record<string, number>> {
  const [responses] = await db.execute(
    `SELECT response_value, COUNT(*) as count 
     FROM pulse_response 
     WHERE pulse_id = ? 
     GROUP BY response_value`,
    [pulseId]
  );
  
  const summary: Record<string, number> = {};
  for (const row of responses) {
    summary[row.response_value] = row.count;
  }
  
  return summary;
}
```

---

## Frontend Pages

### Page Structure

```
/src/pages/
├── NativeEngagement.tsx        - Main dashboard
├── NativeBadges.tsx            - Badge gallery
├── NativeKudos.tsx             - Kudos wall + give kudos
├── NativeSurveys.tsx           - Survey center
└── NativeLeaderboard.tsx       - Leaderboard views
```

### Shared Components

```
/src/components/engagement/
├── BadgeCard.tsx               - Badge display (locked/unlocked)
├── KudosCard.tsx               - Kudos message card
├── TierBadge.tsx               - Tier indicator (Bronze/Silver/Gold/Platinum)
├── PointsDisplay.tsx           - Animated point counter
└── SurveyQuestionRenderer.tsx  - Dynamic question type rendering
```

### Navigation

Add "Engagement" section to main sidebar:
```
📊 Engagement
  ├── Dashboard
  ├── Badges
  ├── Kudos
  ├── Surveys
  └── Leaderboard
```

### Page Features

**NativeEngagement.tsx (Dashboard):**
- Stat cards: Total Points, Current Tier, Badges Earned, Kudos Received
- Quick actions: Give Kudos, View Badges, Take Survey
- Recent activity feed: badge earned, kudos received, tier up, survey completed
- Active pulse check banner (if any)

**NativeBadges.tsx:**
- Grid view: all badges (locked/unlocked state)
- Filter by category: Performance, Activity, Tenure, Social
- Badge detail modal: description, criteria, progress (if auto-tracked), earned date
- Search badges by name

**NativeKudos.tsx:**
- Public kudos wall: recent 50 kudos with filters (type, date range)
- "Give Kudos" form: select recipient, choose type, write message
- Monthly limit indicator: "5/10 kudos given this month"
- Tabs: Kudos Wall | Received | Given

**NativeSurveys.tsx:**
- Active surveys list: title, deadline, completion status ("Not Started", "In Progress", "Completed")
- Survey response form: dynamic question renderer (radio, rating, textarea, NPS scale)
- Progress indicator: "Question 3 of 10"
- Admin view: create survey, view results (response rate, breakdowns, eNPS), export CSV

**NativeLeaderboard.tsx:**
- Tabs: Monthly | Quarterly | All-Time
- Tiered visibility: employees see top 10 + own rank badge ("Your Rank: #47")
- Managers: toggle team view / full view
- Admin: full leaderboard + export CSV
- Filter by process/branch (if admin/manager)
- Leaderboard table: Rank, Name, Points, Badges, Tier Badge

---

## Error Handling

**Badge award errors:**
- Badge already earned: silently skip (idempotent)
- Invalid badge code: log error, notify admin
- Activity tracking failure: log but don't block source operation

**Kudos errors:**
- Monthly limit reached: return 400 with "Limit reached, resets YYYY-MM-01"
- Self-kudos attempt: return 400 "Cannot give kudos to yourself"
- Invalid recipient: return 404

**Survey errors:**
- Anonymous survey + employee_id mismatch: reject with 403
- Survey expired: return 410 "Survey has ended"
- Missing required questions: return 400 with field errors

**Point calculation errors:**
- Negative points (manual adjustment only): allowed for admins, log audit trail
- Tier progression failure: log error, retry on next point event

---

## Testing Strategy

**Unit tests:**
- Badge award logic: auto-award conditions, duplicate prevention
- Point calculation: tier progression thresholds, lifetime accumulation
- Kudos monthly limit: boundary conditions (10/10, 11/10)
- eNPS calculation: promoters/passives/detractors formula
- Leaderboard visibility: role-based filtering (employee vs manager vs admin)

**Integration tests:**
- End-to-end badge earn flow: activity → tracking → badge → points → tier
- Kudos flow: give → notify → points → leaderboard update
- Survey submission: anonymous vs identified, point award, response storage

**Manual testing:**
- UI rendering: badge grid (locked/unlocked states), kudos wall cards
- Leaderboard visibility: verify employees only see top 10 + self
- Survey question types: multiple choice, rating, text, eNPS rendering
- Pulse check: banner display, quick response, aggregate results

---

## Deployment Plan

**Phase 1: Core Infrastructure (Week 1)**
- Database schema creation (`025_engagement_gamification.sql`)
- Backend module scaffolding (`engagement.routes.ts`, `engagement.service.ts`)
- Badge master seeding (15-20 standard badges)
- Tier seeding (Bronze/Silver/Gold/Platinum)

**Phase 2: Badge System (Week 2)**
- Badge CRUD APIs
- Auto-award logic + activity tracking hooks
- Tenure badge cron job
- Badge UI (`NativeBadges.tsx`, `BadgeCard.tsx`)

**Phase 3: Points & Leaderboard (Week 2-3)**
- Point recording service
- Tier progression logic
- Leaderboard query with tiered visibility
- Leaderboard UI (`NativeLeaderboard.tsx`, `TierBadge.tsx`)

**Phase 4: Kudos (Week 3)**
- Kudos service + monthly limit tracking
- Kudos wall query
- Kudos UI (`NativeKudos.tsx`, `KudosCard.tsx`)

**Phase 5: Surveys & Pulse (Week 4)**
- Survey creation + response APIs
- eNPS calculation
- Pulse service
- Survey UI (`NativeSurveys.tsx`, `SurveyQuestionRenderer.tsx`)

**Phase 6: Dashboard & Polish (Week 4-5)**
- Engagement dashboard (`NativeEngagement.tsx`)
- Activity feed
- Notifications integration
- Admin analytics dashboard

**Phase 7: Testing & Launch (Week 5)**
- Integration testing
- Manual QA
- Performance testing (leaderboard queries with 1000+ employees)
- Soft launch to pilot group
- Full rollout

---

## Performance Considerations

**Leaderboard queries:**
- Index on `gamification_point_log(employee_id, awarded_at DESC)`
- Index on `employee_badge_earned(employee_id, earned_at DESC)`
- Consider materialized view for leaderboard if query time > 2s with 1000+ employees

**Badge auto-award:**
- Async processing: badge checks run in background, don't block source operations
- Debounce: avoid duplicate badge checks within same transaction

**Kudos wall:**
- Limit to 50 most recent kudos (pagination if needed)
- Index on `kudos_recognition(created_at DESC, is_public)`

**Survey responses:**
- No N+1 queries: batch employee lookups
- Response data stored as JSON (flexible schema, easy to query aggregates)

---

## Security & Privacy

**Anonymous surveys:**
- `employee_id` NULL in `survey_response` for anonymous mode
- Results dashboard never shows individual anonymous responses
- Admin cannot reverse-engineer employee from response data

**Kudos spam prevention:**
- Monthly limit enforced at DB level (unique constraint on `kudos_giver_limit`)
- Cannot give kudos to self (validated in service layer)

**Leaderboard privacy:**
- Employees only see top 10 + self (no full list exposure)
- Private tier progression: tier achievements notified only to employee (not broadcast)

**Point adjustments:**
- Manual adjustments logged with `awarded_by` (admin accountability)
- Audit trail in `gamification_point_log` (never delete, only add negative adjustments)

---

## Success Metrics

**Engagement KPIs:**
- Daily active users in engagement module (target: 40% of workforce)
- Badge earn rate (target: avg 2 badges per employee per quarter)
- Kudos given per month (target: 5+ kudos per active giver)
- Survey response rate (target: 70%+ for identified surveys)
- Leaderboard visits per week (target: 3+ per employee)

**Platform adoption:**
- Time to first badge (target: < 7 days for new employees)
- Tier progression rate (target: 30% reach Silver within 3 months)
- Kudos wall engagement (target: 50% of employees give kudos within first month)

**Sentiment tracking:**
- eNPS trend over time (monitor quarterly)
- Pulse check response rates (target: 80%+ for quick polls)

---

## Future Enhancements (Out of Scope)

1. **Social feed:** Activity stream showing all engagement events (like LinkedIn feed)
2. **Challenges:** Time-bound competitions (e.g., "March Attendance Challenge")
3. **Rewards marketplace:** Redeem points for perks (extra PTO day, parking spot)
4. **Team badges:** Group achievements (entire team hits KPI target)
5. **Badge trading:** Collectible badge variants with rarity levels
6. **Advanced analytics:** Engagement correlation with performance, retention
7. **Mobile push notifications:** Real-time badge earn notifications
8. **Badge visibility controls:** Employees choose which badges to display on profile

---

## Appendices

### Appendix A: Standard Badge Set

| Badge Code | Badge Name | Category | Criteria | Points |
|------------|------------|----------|----------|--------|
| `top_performer_1mo` | Top Performer Bronze | Performance | 1 month S-rating | 50 |
| `top_performer_2mo` | Top Performer Silver | Performance | 2 consecutive months S-rating | 75 |
| `top_performer_3mo` | Top Performer Gold | Performance | 3 consecutive months S-rating | 100 |
| `attendance_streak_30` | Attendance Warrior | Activity | 30 consecutive days attendance | 30 |
| `attendance_streak_60` | Attendance Champion | Activity | 60 consecutive days attendance | 60 |
| `attendance_streak_90` | Attendance Legend | Activity | 90 consecutive days attendance | 100 |
| `early_bird` | Early Bird | Activity | Clock-in before 9am for 20 days | 25 |
| `profile_complete` | Profile Master | Activity | 100% profile completion | 10 |
| `payslip_champion` | Payslip Champion | Activity | Acknowledge 10 consecutive payslips | 40 |
| `tenure_6mo` | 6 Months Strong | Tenure | 6 months employment | 20 |
| `tenure_1yr` | 1 Year Milestone | Tenure | 1 year employment | 50 |
| `tenure_3yr` | 3 Year Veteran | Tenure | 3 years employment | 100 |
| `tenure_5yr` | 5 Year Legend | Tenure | 5 years employment | 200 |
| `kudos_giver_10` | Generous Giver | Social | Give 10 kudos | 15 |
| `kudos_receiver_10` | Popular Colleague | Social | Receive 10 kudos | 15 |
| `survey_champion` | Survey Champion | Activity | Complete 5 surveys | 25 |

### Appendix B: Kudos Type Descriptions

| Kudos Type | Description | Points |
|------------|-------------|--------|
| Team Player | Goes above and beyond to help teammates | 10 |
| Problem Solver | Found creative solution to tough challenge | 15 |
| Quality Champion | Consistently delivers high-quality work | 15 |
| Mentor | Helped onboard or train team members | 20 |

### Appendix C: Survey Question Type Specs

**Multiple Choice:**
```json
{
  "question_type": "multiple_choice",
  "options": ["Option A", "Option B", "Option C", "Option D"],
  "allow_multiple": false
}
```

**Rating Scale (1-5):**
```json
{
  "question_type": "rating_scale",
  "min": 1,
  "max": 5,
  "labels": ["Very Dissatisfied", "Dissatisfied", "Neutral", "Satisfied", "Very Satisfied"]
}
```

**Text Response:**
```json
{
  "question_type": "text",
  "max_length": 500
}
```

**eNPS (0-10):**
```json
{
  "question_type": "enps",
  "question_text": "How likely are you to recommend this company to a friend?"
}
```

---

**End of Design Document**
