import { z } from "zod";

export const ConsentRecordSchema = z.object({
  purpose_code: z.enum(["employment", "payroll", "communication", "lms", "portal", "recruitment", "health"]),
  decision: z.enum(["accepted", "declined"]),
  language: z.string().max(10).default("en"),
  // version/hash must NOT come from client — resolved server-side
});

export const WithdrawalRequestSchema = z.object({
  reason: z.string().min(10, "Reason must be at least 10 characters").max(2000),
  scope_json: z.array(z.string()).nullable().optional(),
  channel: z.enum(["self", "hr_on_behalf", "legal"]).default("self"),
});

export const RightsRequestSchema = z.object({
  request_type: z.enum(["access", "correction", "erasure", "nomination", "grievance"]),
  description: z.string().max(2000).optional(),
  field_name: z.string().max(128).optional(),
  current_value: z.string().max(500).optional(),
  requested_value: z.string().max(500).optional(),
});

export const CorrectionRequestSchema = z.object({
  field_name: z.string().min(1).max(128),
  current_value: z.string().max(500),
  requested_value: z.string().max(500),
  description: z.string().max(2000).optional(),
});

export type ConsentRecord = z.infer<typeof ConsentRecordSchema>;
export type WithdrawalRequest = z.infer<typeof WithdrawalRequestSchema>;
export type RightsRequest = z.infer<typeof RightsRequestSchema>;
