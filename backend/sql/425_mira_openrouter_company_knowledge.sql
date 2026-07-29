-- 425_mira_openrouter_company_knowledge.sql
-- Approved public company knowledge and OpenRouter provider seed for Mira.

CREATE TABLE IF NOT EXISTS ai_company_knowledge (
  id CHAR(36) NOT NULL PRIMARY KEY,
  knowledge_key VARCHAR(120) NOT NULL,
  category VARCHAR(60) NOT NULL,
  title VARCHAR(255) NOT NULL,
  content_text MEDIUMTEXT NOT NULL,
  source_url VARCHAR(500) NOT NULL,
  source_title VARCHAR(255) NULL,
  is_public TINYINT(1) NOT NULL DEFAULT 1,
  active_status TINYINT(1) NOT NULL DEFAULT 1,
  refreshed_at DATETIME NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_ai_company_knowledge_key (knowledge_key),
  KEY idx_ai_company_knowledge_category (category, active_status),
  KEY idx_ai_company_knowledge_public (is_public, active_status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO ai_provider_config (
  provider_key, provider_name, active_status, is_default, model_name, base_url,
  config_json, timeout_ms, fallback_provider_key, created_by
) VALUES (
  'openrouter', 'OpenRouter', 'inactive', FALSE, 'openrouter/auto', 'https://openrouter.ai/api/v1',
  JSON_OBJECT('description', 'OpenAI-compatible model routing for public company questions and authorised business explanations'),
  30000, 'rule-based', 'system'
) ON DUPLICATE KEY UPDATE
  provider_name = VALUES(provider_name),
  base_url = VALUES(base_url),
  fallback_provider_key = VALUES(fallback_provider_key),
  updated_at = CURRENT_TIMESTAMP;

INSERT INTO ai_company_knowledge
  (id, knowledge_key, category, title, content_text, source_url, source_title, is_public, active_status, refreshed_at)
VALUES
  (UUID(), 'company-overview', 'overview', 'Company overview',
   'MAS Callnet was founded in 2003 and provides AI-enabled business process outsourcing, customer experience and process management services. The company reports 23+ years in operation, 250+ clients served, four delivery centres, 2,500+ team members, 24/7 service availability and 97% client retention.',
   'https://mascallnet.ai/about/', 'About MAS Callnet', 1, 1, NOW()),
  (UUID(), 'company-leadership', 'leadership', 'Company leadership',
   'Deepak Kashyap is CEO & Co-Founder. Ashwani Wadhwa is Chairman & Co-Founder. Bhavana Harjani is COO & Director.',
   'https://mascallnet.ai/about/', 'About MAS Callnet', 1, 1, NOW()),
  (UUID(), 'company-purpose', 'overview', 'Mission, vision and values',
   'MAS Callnet combines AI-led process automation with human expertise to create enhanced customer experiences. Its stated values include excellence, innovation, integrity, partnership and people development. The 2GTHR@MAS programme supports employee growth.',
   'https://mascallnet.ai/about/', 'About MAS Callnet', 1, 1, NOW()),
  (UUID(), 'company-contact', 'contact', 'Official contact',
   'Customer support email: care@teammas.co.in. Sales email: sales@teammas.in. Main contact number: +91 96671 95550.',
   'https://mascallnet.ai/contact-us/', 'Contact MAS Callnet', 1, 1, NOW()),
  (UUID(), 'company-locations', 'locations', 'Noida and Ahmedabad offices',
   'Noida offices are at Trapezoid IT Park, Sector 62 and Okaya Centre, Sector 62. Ahmedabad offices are at Jal Darshan Co-operative Society, Ashram Road and Neelkanth Avenue-01, Ashram Road. Full addresses are available on the official contact page.',
   'https://mascallnet.ai/contact-us/', 'Contact MAS Callnet', 1, 1, NOW()),
  (UUID(), 'company-careers', 'careers', 'Careers and openings',
   'MAS Callnet publishes career opportunities through its official careers and current-openings pages. Roles may be based in Noida, Ahmedabad or remote depending on the vacancy.',
   'https://mascallnet.ai/careers/', 'MAS Callnet careers', 1, 1, NOW())
ON DUPLICATE KEY UPDATE
  category = VALUES(category), title = VALUES(title), content_text = VALUES(content_text),
  source_url = VALUES(source_url), source_title = VALUES(source_title), active_status = 1,
  refreshed_at = VALUES(refreshed_at), updated_at = CURRENT_TIMESTAMP;
