-- 1076_mira_company_services_seed.sql
-- Fixes a real bug: ai-company-knowledge.service.ts's FALLBACK_FACTS array has
-- 7 entries (overview, leadership, purpose, contact, locations, careers,
-- services), but 425_mira_openrouter_company_knowledge.sql only ever seeded 6
-- rows into ai_company_knowledge — no 'company-services' row. facts()
-- (ai-company-knowledge.service.ts) does `merged = dbFacts.length ? dbFacts :
-- FALLBACK_FACTS` — an all-or-nothing choice, not a merge. Once any DB rows
-- exist (which they do, from migration 425), a 'services'-category question
-- gets ZERO facts, not even the fallback text, because dbFacts is used
-- entirely and 'services' was never among those 6 rows. This inserts the
-- missing row, content copied verbatim from FALLBACK_FACTS (lines 50-53).

INSERT INTO ai_company_knowledge
  (id, knowledge_key, category, title, content_text, source_url, source_title, is_public, active_status, refreshed_at)
VALUES
  (UUID(), 'company-services', 'services', 'Services and capabilities',
   'MAS Callnet provides customer support, back-office and process management services supported by technology, automation, quality controls and industry-specific delivery capabilities.',
   'https://mascallnet.ai', 'MAS Callnet', 1, 1, NOW())
ON DUPLICATE KEY UPDATE
  category = VALUES(category), title = VALUES(title), content_text = VALUES(content_text),
  source_url = VALUES(source_url), source_title = VALUES(source_title), active_status = 1,
  refreshed_at = VALUES(refreshed_at), updated_at = CURRENT_TIMESTAMP;
