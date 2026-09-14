-- Extend gamification_points_ledger.transaction_type ENUM
-- to include all daily-game and engagement transaction types
-- used by daily-login, trivia, brain-teaser, word-puzzle, tip-read, and quick-poll services.
ALTER TABLE gamification_points_ledger
  MODIFY COLUMN transaction_type ENUM(
    'badge_earned',
    'kudos_sent',
    'kudos_received',
    'survey_completed',
    'pulse_completed',
    'manual_adjustment',
    'tier_bonus',
    'activity_bonus',
    'daily_login',
    'login_streak_bonus',
    'trivia_correct',
    'trivia_participate',
    'puzzle_solved',
    'puzzle_participate',
    'brain_teaser_correct',
    'brain_teaser_participate',
    'tip_read',
    'poll_voted',
    'wheel_spin',
    'wheel_jackpot',
    'quiz_completed',
    'contest_winner',
    'spotlight_featured'
  ) NOT NULL;
