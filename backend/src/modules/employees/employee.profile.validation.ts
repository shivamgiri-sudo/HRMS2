import { z } from "zod";
import { isOfficialEmail, OFFICIAL_EMAIL_MESSAGE } from "../../shared/officialEmail.js";

const DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/;
const TIME_REGEX = /^([01]\d|2[0-3]):[0-5]\d$/;
const PHONE_REGEX = /^[0-9+()\-\s]{7,20}$/;

const optionalText = (max: number) =>
  z.string().trim().max(max).nullable().optional();

const optionalPhone = z
  .union([
    z.string().trim().regex(PHONE_REGEX, "Enter a valid phone number"),
    z.literal(""),
    z.null(),
  ])
  .optional()
  .transform((value) => value === "" ? null : value);

export const selfProfileUpdateSchema = z.object({
  email: z.string().trim().email().refine(isOfficialEmail, OFFICIAL_EMAIL_MESSAGE).optional(),
  phone: optionalPhone,
  personal_email: z.union([z.string().trim().email("Enter a valid email"), z.literal(""), z.null()])
    .optional()
    .transform((v) => v === "" ? null : v),
  personal_phone: optionalPhone,
  alternate_mobile: optionalPhone,
  address: optionalText(500),
  address2: optionalText(500),
  city: optionalText(100),
  state: optionalText(100),
  country: optionalText(100),
  pincode: optionalText(20),
  date_of_birth: z.union([z.string().regex(DATE_REGEX), z.literal(""), z.null()])
    .optional()
    .transform((value) => value === "" ? null : value),
  gender: z.union([z.enum(["male", "female", "other", "prefer_not_to_say"]), z.literal(""), z.null()])
    .optional()
    .transform((value) => value === "" ? null : value),
  marital_status: z.union([
    z.enum(["single", "married", "divorced", "widowed"]),
    z.literal(""),
    z.null(),
  ]).optional().transform((value) => value === "" ? null : value),
  blood_group: optionalText(10),
  working_hours_start: z.string().regex(TIME_REGEX).optional(),
  working_hours_end: z.string().regex(TIME_REGEX).optional(),
  working_days: z.array(z.number().int().min(0).max(6)).max(7).optional(),
}).strict();

export const emergencyContactSchema = z.object({
  name: z.string().trim().min(2).max(255),
  relationship: z.string().trim().min(2).max(100),
  mobile: z.string().trim().regex(PHONE_REGEX, "Enter a valid emergency contact number"),
  address: optionalText(1000),
}).strict();

export const nomineeSchema = z.object({
  nominee_name: z.string().trim().min(2).max(255),
  relationship: z.string().trim().min(2).max(100),
  date_of_birth: z.string().regex(DATE_REGEX).nullable().optional(),
  mobile: optionalPhone,
  address: optionalText(1000),
}).strict();

export const bankDetailsSchema = z.object({
  bank_name: z.string().trim().min(2).max(255),
  account_holder_name: z.string().trim().min(2).max(255),
  bank_branch: optionalText(255),
  ifsc_code: z.string().trim().toUpperCase().regex(
    /^[A-Z]{4}0[A-Z0-9]{6}$/,
    "Enter a valid 11-character IFSC code",
  ),
  account_type: z.enum(["Savings", "Current", "Salary"]),
  account_number: z.string().trim().regex(
    /^\d{6,20}$/,
    "Account number must contain 6 to 20 digits",
  ).optional(),
}).strict();

export const statutoryDetailsSchema = z.object({
  pan_number: z.string().trim().toUpperCase().regex(
    /^[A-Z]{5}[0-9]{4}[A-Z]$/,
    "Enter a valid PAN",
  ).optional(),
  aadhaar_last4: z.string().trim().regex(
    /^\d{4}$/,
    "Enter only the last four Aadhaar digits",
  ).optional(),
  uan: z.string().trim().regex(/^\d{12}$/, "UAN must contain 12 digits").optional(),
  pf_number: z.string().trim().min(5).max(32).regex(
    /^[A-Za-z0-9/._-]+$/,
    "Enter a valid PF member number",
  ).optional(),
}).strict().refine(
  (value) => Object.values(value).some((item) => item !== undefined && item !== ""),
  "Provide at least one statutory detail",
);

export type SelfProfileUpdateInput = z.infer<typeof selfProfileUpdateSchema>;
export type EmergencyContactInput = z.infer<typeof emergencyContactSchema>;
export type NomineeInput = z.infer<typeof nomineeSchema>;
export type BankDetailsInput = z.infer<typeof bankDetailsSchema>;
export type StatutoryDetailsInput = z.infer<typeof statutoryDetailsSchema>;
