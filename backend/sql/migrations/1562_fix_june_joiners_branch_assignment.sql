-- Fix June 2026 joiners who are inactive with NULL branch
-- These employees were paid in July but not properly activated in mas_hrms

-- NOIDA-2 employees (26)
UPDATE employees
SET active_status = 1,
    branch_id = (SELECT id FROM branch_master WHERE branch_name = 'NOIDA-2' LIMIT 1),
    updated_at = NOW()
WHERE employee_code IN (
  'MAS62926','MAS62940','MAS62942','MAS62943','MAS62944','MAS62945',
  'MAS62948','MAS62953','MAS62955','MAS62961','MAS62966','MAS62967',
  'MAS62979','MAS62990','MAS62991','MAS63011','MAS63013','MAS63016',
  'MAS63017','MAS63020','MAS63022','MAS63024','MAS63026','MAS63030',
  'MAS63031','MAS63032'
)
AND active_status = 0
AND branch_id IS NULL;

-- NOIDA employees (4)
UPDATE employees
SET active_status = 1,
    branch_id = (SELECT id FROM branch_master WHERE branch_name = 'NOIDA' LIMIT 1),
    updated_at = NOW()
WHERE employee_code IN ('MAS62923','MAS62929','MAS62982','MAS63035')
AND active_status = 0
AND branch_id IS NULL;

-- Verify the fix
SELECT
  b.branch_name,
  COUNT(*) AS Fixed_Employees
FROM employees e
JOIN branch_master b ON b.id = e.branch_id
WHERE e.employee_code IN (
  'MAS62926','MAS62940','MAS62942','MAS62943','MAS62944','MAS62945',
  'MAS62948','MAS62953','MAS62955','MAS62961','MAS62966','MAS62967',
  'MAS62979','MAS62990','MAS62991','MAS63011','MAS63013','MAS63016',
  'MAS63017','MAS63020','MAS63022','MAS63024','MAS63026','MAS63030',
  'MAS63031','MAS63032','MAS62923','MAS62929','MAS62982','MAS63035'
)
AND e.active_status = 1
GROUP BY b.branch_name;
