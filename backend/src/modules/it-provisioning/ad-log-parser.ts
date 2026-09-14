import { readFile } from 'fs/promises';

export interface AdLogResult {
  logType: 'creation' | 'deletion';
  eventId: string;
  accountName: string | null;   // SAM account name of the target (new/deleted account)
  displayName: string | null;   // Display Name of the target (creation only)
  actionedByIt: string | null;  // Account Name of the subject (IT admin who did the action)
  eventTime: Date | null;       // TimeGenerated from the log
}

/**
 * Parses a Windows Security Event Log .txt file (PowerShell Get-EventLog export).
 * Handles EventID 4720 (account created) and 4726 (account deleted).
 * Returns null if the file is not a recognisable AD event log.
 */
export async function parseAdEventLog(filePath: string): Promise<AdLogResult | null> {
  let text: string;
  try {
    text = await readFile(filePath, 'utf8');
  } catch {
    return null;
  }

  // Detect event ID
  const eventIdMatch = text.match(/EventID\s*:\s*(\d+)/i);
  if (!eventIdMatch) return null;
  const eventId = eventIdMatch[1].trim();

  let logType: 'creation' | 'deletion';
  if (eventId === '4720') {
    logType = 'creation';
  } else if (eventId === '4726') {
    logType = 'deletion';
  } else {
    return null; // Not an AD account event we handle
  }

  // Extract Subject Account Name (IT admin who performed the action)
  // The Subject block appears before New Account / Target Account blocks
  const subjectMatch = text.match(/Subject:\s*[\s\S]*?Account Name:\s*([^\r\n]+)/i);
  const actionedByIt = subjectMatch ? subjectMatch[1].trim() : null;

  // Extract target account SAM name
  // For 4720: appears under "New Account:" section
  // For 4726: appears under "Target Account:" section
  let accountName: string | null = null;
  let displayName: string | null = null;

  if (logType === 'creation') {
    const newAccBlock = text.match(/New Account:\s*([\s\S]*?)(?:Attributes:|Additional Information:|$)/i);
    if (newAccBlock) {
      const samMatch = newAccBlock[1].match(/Account Name:\s*([^\r\n]+)/i);
      if (samMatch) accountName = samMatch[1].trim();
      const displayMatch = newAccBlock[1].match(/Display Name:\s*([^\r\n]+)/i);
      if (displayMatch) displayName = displayMatch[1].trim() || null;
    }
    // Fallback: SAM Account Name field in Attributes section
    if (!accountName) {
      const samAttr = text.match(/SAM Account Name:\s*([^\r\n]+)/i);
      if (samAttr) accountName = samAttr[1].trim();
    }
  } else {
    const targetBlock = text.match(/Target Account:\s*([\s\S]*?)(?:Additional Information:|$)/i);
    if (targetBlock) {
      const samMatch = targetBlock[1].match(/Account Name:\s*([^\r\n]+)/i);
      if (samMatch) accountName = samMatch[1].trim();
    }
  }

  // Clean up account names that are just dashes or empty
  if (accountName === '-' || accountName === '') accountName = null;
  if (actionedByIt === '-' || actionedByIt === '') {
    // Do nothing — keep null
  }

  // Extract TimeGenerated
  let eventTime: Date | null = null;
  const timeMatch = text.match(/TimeGenerated\s*:\s*([^\r\n]+)/i);
  if (timeMatch) {
    const parsed = new Date(timeMatch[1].trim());
    if (!isNaN(parsed.getTime())) eventTime = parsed;
  }

  return { logType, eventId, accountName, displayName, actionedByIt, eventTime };
}
