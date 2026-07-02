-- Branch Alias Configuration
-- This allows showing user-friendly names to candidates while storing canonical names in DB
-- Example: Show "Trapezoid Mumbai" to candidates but store "Mumbai - Trapezoid" in database

USE mas_hrms;

-- Add example branch aliases (customize these based on your actual branch names)
-- Format: canonical_key = actual branch name in branch_master
--         display_name = what candidates see in the form
--         alias_text = alternative search text

-- Example 1: If you have "Mumbai - Trapezoid" in branch_master but want to show "Trapezoid Mumbai"
INSERT INTO ats_branch_alias_master (id, canonical_key, display_name, alias_text, active_status)
VALUES
  (UUID(), 'Mumbai - Trapezoid', 'Trapezoid Mumbai', 'Mumbai Trapezoid', 1)
ON DUPLICATE KEY UPDATE
  canonical_key = VALUES(canonical_key),
  alias_text = VALUES(alias_text),
  active_status = VALUES(active_status);

-- Example 2: If you have "Delhi - Okaya" but want to show "Okaya Delhi"
INSERT INTO ats_branch_alias_master (id, canonical_key, display_name, alias_text, active_status)
VALUES
  (UUID(), 'Delhi - Okaya', 'Okaya Delhi', 'Delhi Okaya', 1)
ON DUPLICATE KEY UPDATE
  canonical_key = VALUES(canonical_key),
  alias_text = VALUES(alias_text),
  active_status = VALUES(active_status);

-- Example 3: Simple alias without location
INSERT INTO ats_branch_alias_master (id, canonical_key, display_name, alias_text, active_status)
VALUES
  (UUID(), 'Bangalore - Corporate Office', 'Corporate Office', 'Bangalore HQ Head Office', 1)
ON DUPLICATE KEY UPDATE
  canonical_key = VALUES(canonical_key),
  alias_text = VALUES(alias_text),
  active_status = VALUES(active_status);

-- To add your own aliases, follow this pattern:
-- INSERT INTO ats_branch_alias_master (id, canonical_key, display_name, alias_text, active_status)
-- VALUES (UUID(), 'YourCanonicalBranchName', 'DisplayNameForCandidates', 'SearchKeywords', 1)
-- ON DUPLICATE KEY UPDATE canonical_key = VALUES(canonical_key), alias_text = VALUES(alias_text);

-- View all current aliases:
-- SELECT canonical_key AS 'Database Value', display_name AS 'Candidate Sees', alias_text AS 'Search Keywords'
-- FROM ats_branch_alias_master
-- WHERE active_status = 1
-- ORDER BY display_name;
