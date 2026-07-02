-- Expense Categories Master Table
CREATE TABLE expense_categories (
  id INT AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(100) NOT NULL,
  description TEXT,
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_is_active (is_active)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Expense Claims Table
CREATE TABLE expense_claims (
  id INT AUTO_INCREMENT PRIMARY KEY,
  claim_number VARCHAR(50) UNIQUE NOT NULL,
  employee_id INT NOT NULL,
  process_id INT NOT NULL,
  branch_id INT NOT NULL,
  total_amount DECIMAL(10, 2) NOT NULL DEFAULT 0,
  currency VARCHAR(3) DEFAULT 'INR',
  status ENUM('DRAFT', 'SUBMITTED', 'MANAGER_APPROVED', 'FINANCE_APPROVED', 'PAID', 'REJECTED') DEFAULT 'DRAFT',
  submitted_date TIMESTAMP NULL,
  manager_approved_date TIMESTAMP NULL,
  finance_approved_date TIMESTAMP NULL,
  paid_date TIMESTAMP NULL,
  rejection_reason TEXT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (employee_id) REFERENCES employees(id),
  FOREIGN KEY (process_id) REFERENCES process_master(id),
  FOREIGN KEY (branch_id) REFERENCES branch_master(id),
  INDEX idx_employee (employee_id),
  INDEX idx_status (status),
  INDEX idx_process (process_id),
  INDEX idx_manager_queue (status, submitted_date)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Expense Items Table
CREATE TABLE expense_items (
  id INT AUTO_INCREMENT PRIMARY KEY,
  expense_claim_id INT NOT NULL,
  category_id INT NOT NULL,
  expense_date DATE NOT NULL,
  amount DECIMAL(10, 2) NOT NULL,
  description TEXT NOT NULL,
  vendor_name VARCHAR(100),
  receipt_file_path VARCHAR(500),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (expense_claim_id) REFERENCES expense_claims(id) ON DELETE CASCADE,
  FOREIGN KEY (category_id) REFERENCES expense_categories(id),
  INDEX idx_claim (expense_claim_id),
  INDEX idx_category (category_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Expense Approvals Audit Table
CREATE TABLE expense_approvals (
  id INT AUTO_INCREMENT PRIMARY KEY,
  expense_claim_id INT NOT NULL,
  approver_id INT NOT NULL,
  approval_type ENUM('MANAGER', 'FINANCE') NOT NULL,
  action ENUM('APPROVED', 'REJECTED') NOT NULL,
  comments TEXT,
  action_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (expense_claim_id) REFERENCES expense_claims(id),
  FOREIGN KEY (approver_id) REFERENCES employees(id),
  INDEX idx_claim (expense_claim_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Expense Payments Table
CREATE TABLE expense_payments (
  id INT AUTO_INCREMENT PRIMARY KEY,
  expense_claim_id INT NOT NULL,
  payment_reference VARCHAR(100) NOT NULL,
  payment_date DATE NOT NULL,
  payment_method VARCHAR(50) NOT NULL,
  processed_by INT NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (expense_claim_id) REFERENCES expense_claims(id),
  FOREIGN KEY (processed_by) REFERENCES employees(id),
  INDEX idx_claim (expense_claim_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Seed Expense Categories
INSERT INTO expense_categories (name, description) VALUES
('Travel', 'Flights, trains, buses, taxis, and other transportation'),
('Accommodation', 'Hotels, lodging, and overnight stays'),
('Meals & Entertainment', 'Client meals, team dinners, and business entertainment'),
('Fuel/Mileage', 'Personal vehicle usage for business purposes'),
('Office Supplies', 'Stationery, equipment, and office materials'),
('Communication', 'Mobile charges, internet, and communication expenses'),
('Other', 'Miscellaneous expenses not covered by other categories');
