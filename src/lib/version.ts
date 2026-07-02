// Current application version - update this when releasing new versions
export const APP_VERSION = "1.0.5";

// Local-only deployment: no external version API
export const VERSION_API_URL = "";

export interface ChangelogEntry {
  version: string;
  date: string;
  type: "major" | "minor" | "patch";
  title: string;
  description: string;
  changes: Array<{
    type: "feature" | "fix" | "security" | "docs" | "breaking";
    text: string;
  }>;
}

export interface VersionResponse {
  currentVersion: string;
  releaseDate: string;
  changelog: ChangelogEntry[];
  hasUpdate: boolean;
  updateUrl: string;
  documentationUrl: string;
}

// Local changelog data as fallback
const LOCAL_CHANGELOG: ChangelogEntry[] = [
  {
    version: "1.0.0",
    date: "2025-01-19",
    type: "major",
    title: "Initial Release",
    description: "First stable release of Mas Callnet HRMS",
    changes: [
      { type: "feature", text: "Complete employee management with CRUD operations" },
      { type: "feature", text: "Leave management with approval workflows" },
      { type: "feature", text: "Attendance tracking with clock in/out" },
      { type: "feature", text: "Payroll management with salary structures" },
      { type: "feature", text: "Performance reviews and goal tracking" },
      { type: "feature", text: "Asset management and assignment" },
      { type: "feature", text: "Department management" },
      { type: "feature", text: "Role-based access control (Admin, HR, Manager, Employee)" },
      { type: "feature", text: "Email notifications via Resend" },
      { type: "feature", text: "Company calendar with events and holidays" },
      { type: "feature", text: "Comprehensive reporting system" },
      { type: "security", text: "Row Level Security (RLS) policies for data protection" },
      { type: "docs", text: "Complete documentation for self-hosting" },
    ],
  },
];

export const FALLBACK_VERSION_RESPONSE: VersionResponse = {
  currentVersion: APP_VERSION,
  releaseDate: "2025-01-19",
  changelog: LOCAL_CHANGELOG,
  hasUpdate: false,
  updateUrl: "",
  documentationUrl: "",
};

// Local-only deployment: no auto-updating external environment
export function isAutoUpdatingEnvironment(): boolean {
  return false;
}

export async function checkForUpdates(): Promise<VersionResponse | null> {
  return { ...FALLBACK_VERSION_RESPONSE, hasUpdate: false };
}
