import { hrmsApi } from "@/lib/hrmsApi";

export const VISITOR_STATUSES = [
  "pending_approval",
  "approved",
  "rejected",
  "checked_in",
  "checked_out",
  "cancelled",
  "expired",
] as const;

export type VisitorStatus = (typeof VISITOR_STATUSES)[number];

export type VisitorBranch = {
  id: string;
  branch_code: string;
  branch_name: string;
  city?: string | null;
  state?: string | null;
};

export type VisitorHost = {
  id: string;
  employee_code: string;
  branch_id: string;
  full_name: string;
  dept_name?: string | null;
  designation_name?: string | null;
};

export type VisitorVisit = {
  id: string;
  visit_number: string;
  visit_type: string;
  purpose: string;
  status: VisitorStatus;
  scheduled_start: string;
  scheduled_end: string;
  checked_in_at?: string | null;
  checked_out_at?: string | null;
  checkout_requested_at?: string | null;
  branch_id: string;
  branch_name: string;
  host_employee_id?: string | null;
  host_display_name?: string | null;
  visitor_name: string;
  company_name?: string | null;
  masked_mobile?: string | null;
};

export type VisitorVisitDetail = VisitorVisit & {
  mobile?: string | null;
  email?: string | null;
  branch_code?: string | null;
  source_channel?: string;
  companions?: Array<{ id: string; full_name: string; mobile?: string | null; relationship_label?: string | null }>;
  belongings?: Array<{ id: string; item_type: string; description?: string | null; serial_number?: string | null; verified_out: boolean }>;
  vehicles?: Array<{ id: string; vehicle_number: string; vehicle_type?: string | null; parking_slot?: string | null }>;
  approvals?: Array<{ id: string; approval_level: string; status: string; decision_reason?: string | null; decided_at?: string | null }>;
  events?: Array<{ id: string; event_type: string; gate_code?: string | null; occurred_at: string }>;
};

export type VisitorOccupancy = {
  branch_id: string;
  branch_name: string;
  visitors_inside: number | string;
};

export type EmergencyVisitor = {
  id: string;
  visit_number: string;
  visitor_name: string;
  masked_mobile: string;
  branch_name: string;
  host_display_name?: string | null;
  checked_in_at: string;
};

export type VisitorInput = {
  visitor: {
    full_name: string;
    mobile: string;
    email?: string;
    company_name?: string;
  };
  branch_id: string;
  host_employee_id?: string;
  visit_type: string;
  purpose: string;
  scheduled_start: string;
  scheduled_end: string;
  vehicle?: { vehicle_number: string; vehicle_type?: string };
  belongings?: Array<{ item_type: string; description?: string; serial_number?: string }>;
};

type ApiResponse<T> = { success: boolean; data: T };

function queryString(values: Record<string, string | number | undefined>) {
  const params = new URLSearchParams();
  Object.entries(values).forEach(([key, value]) => {
    if (value !== undefined && value !== "") params.set(key, String(value));
  });
  return params.toString();
}

export const visitorApi = {
  async branches() {
    const response = await hrmsApi.get<ApiResponse<VisitorBranch[]>>("/api/visitor/public/branches");
    return response.data ?? [];
  },

  async visits(filters: { status?: VisitorStatus; branch_id?: string; search?: string; date_from?: string; date_to?: string; limit?: number } = {}) {
    const query = queryString({ ...filters, limit: filters.limit ?? 200 });
    const response = await hrmsApi.get<ApiResponse<VisitorVisit[]>>(`/api/visitor/visits?${query}`);
    return response.data ?? [];
  },

  async visit(id: string) {
    const response = await hrmsApi.get<ApiResponse<VisitorVisitDetail>>(`/api/visitor/visits/${id}`);
    return response.data;
  },

  async hosts(search: string, branchId?: string) {
    const query = queryString({ q: search, branch_id: branchId });
    const response = await hrmsApi.get<ApiResponse<VisitorHost[]>>(`/api/visitor/hosts?${query}`);
    return response.data ?? [];
  },

  async invite(input: VisitorInput) {
    const response = await hrmsApi.post<ApiResponse<{ id: string; visit_number: string; tracking_token: string; status: VisitorStatus }>>("/api/visitor/invitations", input);
    return response.data;
  },

  async deskRegister(input: VisitorInput & { host_employee_id: string }) {
    const response = await hrmsApi.post<ApiResponse<{ id: string; visit_number: string; tracking_token: string; status: VisitorStatus }>>("/api/visitor/desk/visits", input);
    return response.data;
  },

  async approve(id: string, reason?: string) {
    const response = await hrmsApi.post<ApiResponse<{ id: string; status: VisitorStatus }>>(`/api/visitor/visits/${id}/approve`, reason ? { reason } : {});
    return response.data;
  },

  async reject(id: string, reason: string) {
    const response = await hrmsApi.post<ApiResponse<{ id: string; status: VisitorStatus }>>(`/api/visitor/visits/${id}/reject`, { reason });
    return response.data;
  },

  async checkIn(id: string, input: { gate_code: string; badge_number?: string; notes?: string }) {
    const response = await hrmsApi.post<ApiResponse<{ id: string; status: VisitorStatus }>>(`/api/visitor/visits/${id}/check-in`, input);
    return response.data;
  },

  async checkOut(id: string, input: { gate_code: string; notes?: string }) {
    const response = await hrmsApi.post<ApiResponse<{ id: string; status: VisitorStatus }>>(`/api/visitor/visits/${id}/check-out`, input);
    return response.data;
  },

  async occupancy(branchId?: string) {
    const query = queryString({ branch_id: branchId });
    const response = await hrmsApi.get<ApiResponse<VisitorOccupancy[]>>(`/api/visitor/occupancy?${query}`);
    return response.data ?? [];
  },

  async emergencyRegister(branchId?: string) {
    const query = queryString({ branch_id: branchId });
    const response = await hrmsApi.get<ApiResponse<EmergencyVisitor[]>>(`/api/visitor/emergency-register?${query}`);
    return response.data ?? [];
  },
};

export function visitorDateTime(value?: string | null) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: true,
    timeZone: "Asia/Kolkata",
  }).format(date);
}

export function toLocalInputValue(date: Date) {
  const shifted = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return shifted.toISOString().slice(0, 16);
}

export function toIso(value: string) {
  return new Date(value).toISOString();
}
