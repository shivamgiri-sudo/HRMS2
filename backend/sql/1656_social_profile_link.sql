-- Migration 1656: Social profile links ("MAS Connect" public handles)
--
-- Until now every company social URL was hardcoded in the React bundle, in five
-- places across two pages (src/pages/AuthClean.tsx SOCIAL_LINKS, and the
-- Instagram / Facebook / X / LinkedIn cards in src/pages/NativeSocialFeed.tsx).
-- Correcting a handle meant a code change plus a full frontend deploy, and the
-- copies had already drifted apart -- the login page pointed at
-- in.linkedin.com/company/mas-callnet-pvt-ltd and x.com/MCallnet while the feed
-- page pointed at linkedin.com/company/mas-callnet and twitter.com/MASCallnet.
--
-- This table makes the links editable from /social-feed/admin by super_admin /
-- hr_admin. It is deliberately NOT social_platform_config: that table holds API
-- credentials (page_id + encrypted token) for the three platforms the sync job
-- can actually pull posts from, and its platform column is an ENUM of exactly
-- those three. Public profile links exist for six destinations including the
-- website, LinkedIn and X, which have no sync path at all, so widening that
-- ENUM would put credential-less rows in front of syncAllPlatforms().
--
-- Purely additive: one CREATE TABLE IF NOT EXISTS plus INSERT IGNORE seeds, no
-- ALTER, DROP or DELETE of anything existing, no FOREIGN KEY. Every string
-- column carries an explicit COLLATE utf8mb4_unicode_ci (the errno 1267 trap
-- migration 1627 exists to repair). Readers fall back to the same values that
-- are compiled into the bundle, so an unapplied copy changes nothing on screen.

CREATE TABLE IF NOT EXISTS social_profile_link (
  platform      VARCHAR(32)  COLLATE utf8mb4_unicode_ci NOT NULL COMMENT 'website | linkedin | instagram | twitter | facebook | youtube',
  label         VARCHAR(64)  COLLATE utf8mb4_unicode_ci NOT NULL COMMENT 'Display name shown next to the icon',
  profile_url   VARCHAR(500) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT 'Public destination the icon/button opens',
  handle        VARCHAR(120) COLLATE utf8mb4_unicode_ci NULL     COMMENT 'Optional @handle shown on the feed cards',
  display_order INT          NOT NULL DEFAULT 0,
  enabled       TINYINT(1)   NOT NULL DEFAULT 1 COMMENT '0 hides the link everywhere it is rendered',
  updated_by    VARCHAR(64)  COLLATE utf8mb4_unicode_ci NULL,
  created_at    DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at    DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (platform)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Seed with the corrected live values. INSERT IGNORE so re-running never
-- overwrites a handle an admin has since edited through the UI.
INSERT IGNORE INTO social_profile_link (platform, label, profile_url, handle, display_order, enabled) VALUES
  ('website',   'Website',   'https://mascallnet.ai',                               'mascallnet.ai', 1, 1),
  ('linkedin',  'LinkedIn',  'https://www.linkedin.com/company/mas-callnet',        'mas-callnet',   2, 1),
  ('instagram', 'Instagram', 'https://instagram.com/mascallnet',                    '@mascallnet',   3, 1),
  ('twitter',   'X',         'https://twitter.com/MASCallnet',                      '@MASCallnet',   4, 1),
  ('facebook',  'Facebook',  'https://www.facebook.com/TeamMas9',                   'TeamMas9',      5, 1),
  ('youtube',   'YouTube',   'https://youtube.com/@MasCallnet',                     '@MasCallnet',   6, 1);
