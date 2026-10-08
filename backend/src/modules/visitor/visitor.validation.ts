import { z } from "zod";
import { VISIT_STATUSES } from "./visitor.types.js";

const uuid = z.string().uuid();
const mobile = z.string().trim().regex(/^\+?[0-9][0-9\s-]{7,18}$/, "Enter a valid mobile number");
const schedule = z.string().datetime({ offset: true });

export const visitorIdentitySchema = z.object({
  full_name: z.string().trim().min(2).max(200),
  mobile,
  email: z.string().trim().email().max(255).optional().or(z.literal("")),
  company_name: z.string().trim().max(255).optional(),
});

export const companionSchema = z.object({
  full_name: z.string().trim().min(2).max(200),
  mobile: mobile.optional(),
  relationship_label: z.string().trim().max(100).optional(),
});

export const belongingSchema = z.object({
  item_type: z.string().trim().min(2).max(80),
  description: z.string().trim().max(255).optional(),
  serial_number: z.string().trim().max(150).optional(),
});

export const vehicleSchema = z.object({
  vehicle_number: z.string().trim().min(4).max(30).transform((value) => value.toUpperCase()),
  vehicle_type: z.string().trim().max(40).optional(),
  parking_slot: z.string().trim().max(50).optional(),
});

export const publicRegistrationSchema = z.object({
  visitor: visitorIdentitySchema,
  branch_id: uuid,
  host_employee_code: z.string().trim().min(2).max(50).optional(),
  visit_type: z.string().trim().min(2).max(50),
  purpose: z.string().trim().min(5).max(500),
  scheduled_start: schedule,
  scheduled_end: schedule,
  consent: z.object({
    accepted: z.literal(true),
    consent_type: z.string().trim().min(2).max(80).default("visitor_privacy"),
    consent_version: z.string().trim().min(1).max(40),
  }),
  companions: z.array(companionSchema).max(10).optional(),
  vehicle: vehicleSchema.optional(),
  belongings: z.array(belongingSchema).max(20).optional(),
}).superRefine((value, ctx) => {
  if (new Date(value.scheduled_end).getTime() <= new Date(value.scheduled_start).getTime()) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["scheduled_end"], message: "Visit end must be after visit start" });
  }
});

export const invitationSchema = z.object({
  visitor: visitorIdentitySchema,
  branch_id: uuid,
  host_employee_id: uuid.optional(),
  visit_type: z.string().trim().min(2).max(50),
  purpose: z.string().trim().min(5).max(500),
  scheduled_start: schedule,
  scheduled_end: schedule,
  companions: z.array(companionSchema).max(25).optional(),
  vehicle: vehicleSchema.optional(),
  belongings: z.array(belongingSchema).max(20).optional(),
}).superRefine((value, ctx) => {
  if (new Date(value.scheduled_end).getTime() <= new Date(value.scheduled_start).getTime()) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["scheduled_end"], message: "Visit end must be after visit start" });
  }
});

export const deskRegistrationSchema = z.object({
  visitor: visitorIdentitySchema,
  branch_id: uuid,
  host_employee_id: uuid,
  visit_type: z.string().trim().min(2).max(50),
  purpose: z.string().trim().min(5).max(500),
  scheduled_start: schedule,
  scheduled_end: schedule,
  companions: z.array(companionSchema).max(25).optional(),
  vehicle: vehicleSchema.optional(),
  belongings: z.array(belongingSchema).max(20).optional(),
}).superRefine((value, ctx) => {
  if (new Date(value.scheduled_end).getTime() <= new Date(value.scheduled_start).getTime()) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["scheduled_end"], message: "Visit end must be after visit start" });
  }
});

export const consentSchema = z.object({
  tracking_token: z.string().regex(/^[a-f0-9]{64}$/i),
  consent_type: z.string().trim().min(2).max(80),
  consent_version: z.string().trim().min(1).max(40),
  accepted: z.boolean(),
});

export const trackingTokenSchema = z.string().regex(/^[a-f0-9]{64}$/i, "Invalid tracking token");

export const visitListQuerySchema = z.object({
  branch_id: uuid.optional(),
  host_employee_id: uuid.optional(),
  status: z.enum(VISIT_STATUSES).optional(),
  date_from: z.string().date().optional(),
  date_to: z.string().date().optional(),
  search: z.string().trim().max(100).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});

export const decisionSchema = z.object({
  reason: z.string().trim().min(3).max(500).optional(),
});

export const checkEventSchema = z.object({
  gate_code: z.string().trim().min(1).max(80),
  badge_number: z.string().trim().min(1).max(80).optional(),
  notes: z.string().trim().max(1000).optional(),
});

export const extensionSchema = z.object({
  scheduled_end: schedule,
  reason: z.string().trim().min(3).max(500),
});
