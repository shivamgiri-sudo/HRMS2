/**
 * Position Hierarchy for Password Reset Access Control
 *
 * Higher level = More authority
 * Only users at higher levels can reset passwords for lower levels
 */

export const POSITION_HIERARCHY: Record<string, number> = {
  // Top Management - Level 10 (Cannot be reset by anyone)
  "CEO": 10,
  "Managing Director": 10,
  "Director": 10,

  // Senior Management - Level 9
  "VP": 9,
  "Vice President": 9,
  "CTO": 9,
  "CFO": 9,
  "COO": 9,

  // Department Heads - Level 8 (Protected from WFM Admin)
  "Admin": 8,
  "HR Manager": 8,
  "HR Head": 8,
  "Payroll Manager": 8,
  "Finance Manager": 8,

  // Middle Management - Level 7
  "Senior Manager": 7,
  "Manager": 6,
  "Assistant Manager": 5,

  // Supervisory - Level 4
  "Team Lead": 4,
  "Supervisor": 4,

  // Senior Staff - Level 3
  "Senior Executive": 3,
  "Senior Associate": 3,

  // Staff - Level 2
  "Executive": 2,
  "Associate": 2,
  "Officer": 2,

  // Entry Level - Level 1
  "Trainee": 1,
  "Intern": 1,
  "Junior Associate": 1,

  // Default - Level 0
  "Employee": 0,
};

// WFM Admin can reset passwords for positions at level 6 and below
export const WFM_ADMIN_MAX_LEVEL = 6;

// Super Admin can reset passwords for positions at level 8 and below
export const SUPER_ADMIN_MAX_LEVEL = 8;

/**
 * Get position level from designation string
 * Uses fuzzy matching to handle variations
 */
export function getPositionLevel(designation: string | null): number {
  if (!designation) return 0;

  const normalized = designation.toLowerCase().trim();

  // Exact match first
  for (const [position, level] of Object.entries(POSITION_HIERARCHY)) {
    if (position.toLowerCase() === normalized) {
      return level;
    }
  }

  // Fuzzy match - contains key words
  for (const [position, level] of Object.entries(POSITION_HIERARCHY)) {
    const posKey = position.toLowerCase();
    if (normalized.includes(posKey) || posKey.includes(normalized)) {
      return level;
    }
  }

  // Default level for unknown positions
  return 0;
}

/**
 * Check if requester can reset password for target employee
 */
export function canResetPassword(
  requesterRole: string,
  requesterDesignation: string | null,
  targetDesignation: string | null,
  targetUserId?: string,
  requesterUserId?: string
): { allowed: boolean; reason?: string } {
  // Cannot reset own password through this mechanism
  if (targetUserId && requesterUserId && targetUserId === requesterUserId) {
    return { allowed: false, reason: "Cannot reset your own password through admin panel" };
  }

  const targetLevel = getPositionLevel(targetDesignation);
  const requesterLevel = getPositionLevel(requesterDesignation);

  // Super Admin check
  if (requesterRole === "super_admin" || requesterRole === "admin") {
    if (targetLevel > SUPER_ADMIN_MAX_LEVEL) {
      return {
        allowed: false,
        reason: `Cannot reset password for ${targetDesignation || "this position"} (Level ${targetLevel}). Maximum allowed level: ${SUPER_ADMIN_MAX_LEVEL}`
      };
    }
    return { allowed: true };
  }

  // WFM Admin check
  if (requesterRole === "wfm_admin" || requesterRole === "wfm") {
    if (targetLevel > WFM_ADMIN_MAX_LEVEL) {
      return {
        allowed: false,
        reason: `Cannot reset password for ${targetDesignation || "this position"} (Level ${targetLevel}). WFM Admin can only reset passwords for positions at level ${WFM_ADMIN_MAX_LEVEL} and below`
      };
    }
    return { allowed: true };
  }

  // Regular admin/manager - can only reset for lower positions
  if (requesterRole === "manager" || requesterRole === "hr") {
    if (targetLevel >= requesterLevel) {
      return {
        allowed: false,
        reason: "Can only reset passwords for employees in lower positions"
      };
    }
    return { allowed: true };
  }

  return { allowed: false, reason: "Insufficient permissions to reset passwords" };
}

/**
 * Generate secure temporary password
 */
export function generateTemporaryPassword(): string {
  const uppercase = "ABCDEFGHJKLMNPQRSTUVWXYZ";
  const lowercase = "abcdefghjkmnpqrstuvwxyz";
  const digits = "23456789";
  const special = "!@#$%";
  const all = `${uppercase}${lowercase}${digits}${special}`;
  const pick = (characters: string) => characters[randomInt(characters.length)];
  const password = [
    pick(uppercase),
    pick(lowercase),
    pick(digits),
    pick(special),
    ...Array.from({ length: 8 }, () => pick(all)),
  ];

  for (let index = password.length - 1; index > 0; index -= 1) {
    const swapIndex = randomInt(index + 1);
    [password[index], password[swapIndex]] = [password[swapIndex], password[index]];
  }

  return password.join("");
}
import { randomInt } from "crypto";
