-- =====================================================
-- Engagement activity badge additions
-- File: 039_engagement_activity_badges.sql
-- =====================================================

INSERT IGNORE INTO gamification_badge_master
  (badge_id, badge_name, badge_description, badge_icon, badge_category, points_value, criteria_json)
VALUES
  (UUID(), 'Payslip Champion', 'Acknowledged 10+ payslips', '✅', 'activity', 30,
   '{"type": "payslip", "threshold": "10_acknowledged", "criteria": "acknowledgement"}');
