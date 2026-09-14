import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { hrmsApi } from "@/lib/hrmsApi";

// ============================================================================
// Types
// ============================================================================

export type CostCentreStatus =
  | "draft"
  | "pending_l1"
  | "pending_l2"
  | "approved"
  | "active"
  | "closed"
  | "rejected"
  | "revision_required";

export interface CostCentreContact {
  id?: string;
  contact_type: "client" | "scm" | "finance";
  contact_sequence: number;
  contact_name?: string;
  contact_email?: string;
  contact_phone?: string;
  contact_designation?: string;
  is_primary?: boolean;
}

export interface CostCentreRecord {
  id: string;
  cost_centre_code: string;
  cost_centre_name: string;
  client_id: string;
  lob_id: string;
  branch_id: string;
  process_id: string;
  department_id?: string;
  status: CostCentreStatus;
  /**
   * What the record actually is, for display: `status` with deactivation folded in.
   *
   * `status` is the approval stage (draft -> pending_l1 -> ... -> active) and keeps its value
   * after a cost centre is closed, so a closed one still reads "draft" there. Deactivation lives
   * in `active_status`/`close_date`. The server derives this so the badge and the tab agree.
   */
  effective_status?: CostCentreStatus;
  active_status: number;

  // Joined fields
  client_name?: string;
  /** The legal entity actually invoiced, from billing_invoice_snapshot. Distinct from
   *  client_name, which despite its name holds the PROCESS/campaign name. */
  billing_client_name?: string;
  client_code?: string;
  lob_name?: string;
  lob_code?: string;
  branch_name?: string;
  branch_code?: string;
  process_name?: string;
  process_code?: string;

  // Operational
  mandated_seats_value?: number;
  shrinkage_percentage?: number;
  attrition_percentage?: number;
  shift_hours?: string;
  working_days_per_week?: number;
  training_days?: number;
  incentive_allowed?: boolean;
  deduction_allowed?: boolean;

  // Billing
  revenue_flag?: boolean;
  billing_flag?: boolean;
  revenue_type?: string;
  fixed_amount?: number;
  variable_base?: string;
  payment_mode?: string;
  payment_terms?: string;

  // GST/Tax
  hsn_code?: string;
  /** Separate column from hsn_code. Holds the services code (99xxxx) and is the one actually
   *  populated on live rows — the form used to write both into hsn_code. */
  sac_code?: string;
  service_tax_no?: string;
  vendor_state_code?: string;

  // Addresses (legacy has 5 lines)
  bill_to_address1?: string;
  bill_to_address2?: string;
  bill_to_address3?: string;
  bill_to_address4?: string;
  bill_to_address5?: string;
  bill_to_city?: string;
  bill_to_pincode?: string;
  ship_to_address1?: string;
  ship_to_address2?: string;
  ship_to_address3?: string;
  ship_to_address4?: string;
  ship_to_address5?: string;
  ship_to_city?: string;
  ship_to_pincode?: string;

  // Legacy parity: grouping / categorization
  tally_head?: string;
  group_cost_center?: string;
  cost_center_type?: string;
  dialdee_type?: string;

  // Legacy parity: procurement
  jcc_no?: string;
  grn?: string;
  po_required?: boolean;

  // Dates
  association_date?: string;
  created_at?: string;
  updated_at?: string;

  // Approval tracking
  created_by?: string;
  created_by_name?: string;
  submitted_by?: string;
  submitted_by_name?: string;
  submitted_at?: string;
  l1_approved_by?: string;
  l1_approved_by_name?: string;
  l1_approved_at?: string;
  l2_approved_by?: string;
  l2_approved_by_name?: string;
  l2_approved_at?: string;
  rejection_reason?: string;
  revision_no?: number;

  // Related data
  contacts?: CostCentreContact[];
  approval_history?: ApprovalLogEntry[];
}

export interface ApprovalLogEntry {
  id: string;
  cost_centre_id: string;
  action: string;
  from_status?: string;
  to_status: string;
  actor_user_id: string;
  actor_role: string;
  actor_name?: string;
  remarks?: string;
  created_at: string;
}

export interface CostCentreInput {
  cost_centre_code: string;
  cost_centre_name: string;
  client_id: string;
  lob_id: string;
  branch_id: string;
  process_id: string;
  department_id?: string;

  // Operational
  mandated_seats_value?: number;
  shrinkage_percentage?: number;
  attrition_percentage?: number;
  shift_hours?: string;
  working_days_per_week?: number;
  training_days?: number;
  incentive_allowed?: boolean;
  deduction_allowed?: boolean;

  // Billing
  revenue_flag?: boolean;
  billing_flag?: boolean;
  revenue_type?: string;
  fixed_amount?: number;
  variable_base?: string;
  payment_mode?: string;
  payment_terms?: string;

  // GST/Tax
  hsn_code?: string;
  /** Separate column from hsn_code. Holds the services code (99xxxx) and is the one actually
   *  populated on live rows — the form used to write both into hsn_code. */
  sac_code?: string;
  service_tax_no?: string;
  vendor_state_code?: string;

  // Addresses (legacy has 5 lines)
  bill_to_address1?: string;
  bill_to_address2?: string;
  bill_to_address3?: string;
  bill_to_address4?: string;
  bill_to_address5?: string;
  bill_to_city?: string;
  bill_to_pincode?: string;
  ship_to_address1?: string;
  ship_to_address2?: string;
  ship_to_address3?: string;
  ship_to_address4?: string;
  ship_to_address5?: string;
  ship_to_city?: string;
  ship_to_pincode?: string;

  // Legacy parity: grouping / categorization
  tally_head?: string;
  group_cost_center?: string;
  cost_center_type?: string;
  dialdee_type?: string;

  // Legacy parity: procurement
  jcc_no?: string;
  grn?: string;
  po_required?: boolean;

  // Dates
  association_date?: string;

  // Contacts
  contacts?: CostCentreContact[];
}

export interface ListFilters {
  q?: string;
  status?: CostCentreStatus | "all";
  /** FK filter — matches nothing today, cost_centre_master.client_id is NULL on all 927 rows.
   *  Use client_name to filter by client; see the note in cost-centre-management.service.ts. */
  client_id?: string;
  /** Billing client text — 785 populated, 683 distinct. This is the filter that works. */
  client_name?: string;
  branch_id?: string;
  page?: number;
  limit?: number;
}

export interface StatusCounts {
  draft?: number;
  pending_l1?: number;
  pending_l2?: number;
  approved?: number;
  active?: number;
  closed?: number;
  rejected?: number;
  revision_required?: number;
}

// ============================================================================
// Query keys
// ============================================================================

const KEYS = {
  list: (filters: ListFilters) => ["cost-centres", filters] as const,
  detail: (id: string) => ["cost-centres", id] as const,
  history: (id: string) => ["cost-centres", id, "history"] as const,
  statusCounts: () => ["cost-centres", "status-counts"] as const,
  approvalQueue: () => ["cost-centres", "approval-queue"] as const,
};

// ============================================================================
// Queries
// ============================================================================

export function useCostCentreList(filters: ListFilters = {}) {
  return useQuery({
    queryKey: KEYS.list(filters),
    queryFn: async () => {
      const params = new URLSearchParams();
      if (filters.q) params.set("q", filters.q);
      if (filters.status) params.set("status", filters.status);
      if (filters.client_id) params.set("client_id", filters.client_id);
      if (filters.client_name) params.set("client_name", filters.client_name);
      if (filters.branch_id) params.set("branch_id", filters.branch_id);
      if (filters.page) params.set("page", String(filters.page));
      if (filters.limit) params.set("limit", String(filters.limit));

      const res = await hrmsApi.get<{
        data: CostCentreRecord[];
        total: number;
        page: number;
        limit: number;
      }>(`/api/finance/cost-centres?${params.toString()}`);
      return res;
    },
  });
}

export function useCostCentreDetail(id: string | null) {
  return useQuery({
    queryKey: KEYS.detail(id ?? ""),
    queryFn: async () => {
      if (!id) return null;
      const res = await hrmsApi.get<{ data: CostCentreRecord }>(`/api/finance/cost-centres/${id}`);
      return res.data;
    },
    enabled: !!id,
  });
}

export function useCostCentreHistory(id: string | null) {
  return useQuery({
    queryKey: KEYS.history(id ?? ""),
    queryFn: async () => {
      if (!id) return [];
      const res = await hrmsApi.get<{ data: ApprovalLogEntry[] }>(`/api/finance/cost-centres/${id}/history`);
      return res.data;
    },
    enabled: !!id,
  });
}

export function useCostCentreStatusCounts() {
  return useQuery({
    queryKey: KEYS.statusCounts(),
    queryFn: async () => {
      const res = await hrmsApi.get<{ data: StatusCounts }>("/api/finance/cost-centres/status-counts");
      return res.data;
    },
  });
}

export function useCostCentreApprovalQueue() {
  return useQuery({
    queryKey: KEYS.approvalQueue(),
    queryFn: async () => {
      const res = await hrmsApi.get<{ data: CostCentreRecord[] }>("/api/finance/cost-centres/approval-queue");
      return res.data;
    },
  });
}

// ============================================================================
// Mutations
// ============================================================================

export function useCreateCostCentre() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (data: CostCentreInput) => {
      const res = await hrmsApi.post<{ data: CostCentreRecord }>("/api/finance/cost-centres", data);
      return res.data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["cost-centres"] });
    },
  });
}

export function useUpdateCostCentre() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, data }: { id: string; data: Partial<CostCentreInput> }) => {
      const res = await hrmsApi.put<{ data: CostCentreRecord }>(`/api/finance/cost-centres/${id}`, data);
      return res.data;
    },
    onSuccess: (_, { id }) => {
      qc.invalidateQueries({ queryKey: ["cost-centres"] });
      qc.invalidateQueries({ queryKey: KEYS.detail(id) });
    },
  });
}

export function useSubmitCostCentre() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const res = await hrmsApi.post<{ data: CostCentreRecord }>(`/api/finance/cost-centres/${id}/submit`);
      return res.data;
    },
    onSuccess: (_, id) => {
      qc.invalidateQueries({ queryKey: ["cost-centres"] });
      qc.invalidateQueries({ queryKey: KEYS.detail(id) });
    },
  });
}

export function useApproveL1CostCentre() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, remarks }: { id: string; remarks?: string }) => {
      const res = await hrmsApi.post<{ data: CostCentreRecord }>(`/api/finance/cost-centres/${id}/approve-l1`, { remarks });
      return res.data;
    },
    onSuccess: (_, { id }) => {
      qc.invalidateQueries({ queryKey: ["cost-centres"] });
      qc.invalidateQueries({ queryKey: KEYS.detail(id) });
      qc.invalidateQueries({ queryKey: KEYS.approvalQueue() });
    },
  });
}

export function useApproveL2CostCentre() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, remarks }: { id: string; remarks?: string }) => {
      const res = await hrmsApi.post<{ data: CostCentreRecord }>(`/api/finance/cost-centres/${id}/approve-l2`, { remarks });
      return res.data;
    },
    onSuccess: (_, { id }) => {
      qc.invalidateQueries({ queryKey: ["cost-centres"] });
      qc.invalidateQueries({ queryKey: KEYS.detail(id) });
      qc.invalidateQueries({ queryKey: KEYS.approvalQueue() });
    },
  });
}

export function useRejectCostCentre() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, reason }: { id: string; reason: string }) => {
      const res = await hrmsApi.post<{ data: CostCentreRecord }>(`/api/finance/cost-centres/${id}/reject`, { reason });
      return res.data;
    },
    onSuccess: (_, { id }) => {
      qc.invalidateQueries({ queryKey: ["cost-centres"] });
      qc.invalidateQueries({ queryKey: KEYS.detail(id) });
      qc.invalidateQueries({ queryKey: KEYS.approvalQueue() });
    },
  });
}

export function useRequestRevisionCostCentre() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, reason }: { id: string; reason: string }) => {
      const res = await hrmsApi.post<{ data: CostCentreRecord }>(`/api/finance/cost-centres/${id}/request-revision`, { reason });
      return res.data;
    },
    onSuccess: (_, { id }) => {
      qc.invalidateQueries({ queryKey: ["cost-centres"] });
      qc.invalidateQueries({ queryKey: KEYS.detail(id) });
      qc.invalidateQueries({ queryKey: KEYS.approvalQueue() });
    },
  });
}

export function useActivateCostCentre() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const res = await hrmsApi.post<{ data: CostCentreRecord }>(`/api/finance/cost-centres/${id}/activate`);
      return res.data;
    },
    onSuccess: (_, id) => {
      qc.invalidateQueries({ queryKey: ["cost-centres"] });
      qc.invalidateQueries({ queryKey: KEYS.detail(id) });
    },
  });
}

export function useCloseCostCentre() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, reason }: { id: string; reason?: string }) => {
      const res = await hrmsApi.post<{ data: CostCentreRecord }>(`/api/finance/cost-centres/${id}/close`, { reason });
      return res.data;
    },
    onSuccess: (_, { id }) => {
      qc.invalidateQueries({ queryKey: ["cost-centres"] });
      qc.invalidateQueries({ queryKey: KEYS.detail(id) });
    },
  });
}
