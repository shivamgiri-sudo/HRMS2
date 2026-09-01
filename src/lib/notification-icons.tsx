import {
  Bell,
  CalendarClock,
  CalendarDays,
  Camera,
  Clock,
  DoorOpen,
  FileSignature,
  Laptop,
  LifeBuoy,
  MessageSquareWarning,
  ShieldAlert,
  ThumbsDown,
  ThumbsUp,
  UserPlus,
  Wallet,
  type LucideIcon,
} from "lucide-react";

/**
 * Real work_inbox_item `type` values, mapped to an icon + semantic tone.
 *
 * Before this, NotificationBell.tsx's only per-type logic (`warning`/`error`/`success` ->
 * border colour) never matched anything real — every notification this platform actually
 * produces uses a domain type like `grn_approval_pending` or `helpdesk_ticket_assigned`, so
 * every item fell to the same generic blue-border default, and Notifications.tsx rendered the
 * exact same static Bell icon for all of them regardless of type. Confirmed by grep across every
 * `inboxService.createItem` call site (backend/src/modules, backend/src/workers) before writing
 * this map — these are the real, currently-produced values, not an invented registry.
 *
 * Grouped by domain rather than listed as 63 individual literals, using prefix/substring
 * matching (matchers run in order, first match wins) — new types in an existing domain
 * (another `reimbursement_*`, another `attendance_*`) pick up the right icon automatically
 * instead of silently falling through to the generic default the way the old switch did.
 */
export type NotificationTone = "info" | "success" | "warning" | "danger";

interface IconRule {
  test: (type: string) => boolean;
  icon: LucideIcon;
  tone: NotificationTone;
}

const RULES: IconRule[] = [
  // Finance: GRN, Branch Budget, reimbursement, vendor payment, payroll review.
  { test: (t) => t.includes("rejected") && (t.includes("grn") || t.includes("budget") || t.includes("reimbursement") || t.includes("payroll") || t.includes("benefit_claim") || t.includes("offer")), icon: ThumbsDown, tone: "danger" },
  { test: (t) => (t.includes("approved") || t.includes("paid")) && (t.includes("grn") || t.includes("budget") || t.includes("reimbursement") || t.includes("payroll") || t.includes("benefit_claim") || t.includes("offer")), icon: ThumbsUp, tone: "success" },
  { test: (t) => t.includes("grn") || t.includes("vendor_payment") || t.includes("budget") || t.includes("reimbursement") || t.includes("benefit_claim") || t.includes("payroll"), icon: Wallet, tone: "info" },

  // Attendance & leave.
  { test: (t) => t.startsWith("leave") || t.includes("leave_on_behalf") || t === "attendance_regularization", icon: CalendarDays, tone: "info" },
  { test: (t) => t.startsWith("attendance") || t === "week_off_preference", icon: Clock, tone: "info" },

  // Recruitment / onboarding (ATS).
  { test: (t) => t.includes("rejected") && (t.includes("offer") || t.includes("candidate") || t.includes("requisition")), icon: ThumbsDown, tone: "danger" },
  { test: (t) => t.includes("approved") || t.includes("selected"), icon: ThumbsUp, tone: "success" },
  { test: (t) => t.includes("overdue") || t.includes("sla") || t.includes("no_show"), icon: MessageSquareWarning, tone: "warning" },
  { test: (t) => t.includes("candidate") || t.includes("offer") || t.includes("requisition") || t.includes("walkin") || t.includes("interview") || t.includes("joining_date"), icon: UserPlus, tone: "info" },

  // IT / helpdesk / grievance.
  { test: (t) => t.includes("sla_breach") || t.includes("breached"), icon: ShieldAlert, tone: "danger" },
  { test: (t) => t.includes("helpdesk") || t.includes("grievance"), icon: LifeBuoy, tone: "info" },
  { test: (t) => t.includes("it_provisioning") || t.includes("it_asset"), icon: Laptop, tone: "info" },

  // Onboarding paperwork / identity.
  { test: (t) => t.includes("esign"), icon: FileSignature, tone: "info" },
  { test: (t) => t.includes("profile_photo"), icon: Camera, tone: "warning" },

  // Front office.
  { test: (t) => t.includes("visitor"), icon: DoorOpen, tone: "info" },

  // Generic escalation / deadline language, for anything not caught above.
  { test: (t) => t.includes("overdue") || t.includes("due") || t.includes("breach"), icon: CalendarClock, tone: "warning" },
];

/** Resolves a work_inbox_item `type` to the icon + tone it should render with. Case/format
 *  agnostic — real types mix UPPER_SNAKE and lower_snake with no consistent convention. */
export function resolveNotificationIcon(type: string | null | undefined): { icon: LucideIcon; tone: NotificationTone } {
  const normalized = String(type ?? "").toLowerCase();
  for (const rule of RULES) {
    if (rule.test(normalized)) return { icon: rule.icon, tone: rule.tone };
  }
  return { icon: Bell, tone: "info" };
}
