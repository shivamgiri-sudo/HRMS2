// Meta parity fixtures: requisition criteria rows (as job_requisition stores them) x Meta form payloads.
// Shared by the screenLead pin (S8, written before the engine) and the engine parity test.
import type { MetaScreeningConfig } from "../../../job-requisition/job-requisition.types.js";
import type { MetaLeadDetail } from "../../../meta-campaign/meta-campaign.types.js";

export interface MetaReqFixture {
  name: string;
  ageMin: number | null; ageMax: number | null;
  education: string | null; expMin: number | null; expMax: number | null;
  config: MetaScreeningConfig | null;
}

const K7BK_NIGHT = "this_role_includes_night_shifts_are_you_willing_and_able_to_work_night_shifts";

export const META_REQS: MetaReqFixture[] = [
  { name: "no criteria", ageMin: null, ageMax: null, education: null, expMin: null, expMax: null, config: null },
  { name: "age 18-35", ageMin: 18, ageMax: 35, education: null, expMin: null, expMax: null, config: null },
  { name: "graduate", ageMin: null, ageMax: null, education: "Graduate", expMin: null, expMax: null, config: null },
  { name: "graduate preferred (soft)", ageMin: null, ageMax: null, education: "Graduate preferred", expMin: null, expMax: null, config: null },
  { name: "off-ladder education", ageMin: null, ageMax: null, education: "Any degree from a good college", expMin: null, expMax: null, config: null },
  { name: "experience 1-3", ageMin: null, ageMax: null, education: null, expMin: 1, expMax: 3, config: null },
  { name: "K7BK", ageMin: null, ageMax: null, education: null, expMin: null, expMax: null, config: { custom_field_rules: [
    { field: "are_you_a_graduate", op: "is_yes", value: "", label: "Graduate (must)" },
    { field: K7BK_NIGHT, op: "is_yes", value: "", label: "Willing to work night shifts" },
  ] } },
  { name: "DZCV", ageMin: null, ageMax: null, education: "12th pass", expMin: null, expMax: null, config: { custom_field_rules: [
    { field: "can_travel_noida", op: "neq", value: "no", label: "Can travel to Noida" },
    { field: "qualification", op: "neq", value: "below_12th", label: "12th pass or above" },
  ] } },
  { name: "DRA Ahmedabad", ageMin: null, ageMax: null, education: null, expMin: null, expMax: null, config: { certifications: ["DRA"], auto_notify: false, custom_field_rules: [
    { field: "can_you_work_from_our_ahmedabad_location", op: "is_yes", value: "", label: "Can work from Ahmedabad" },
  ] } },
  { name: "female hindi typing english", ageMin: 18, ageMax: 40, education: "12th", expMin: 0, expMax: null, config: {
    gender: "female", language_requirements: [{ language: "Hindi", skills: ["speak"] }], min_typing_speed_wpm: 25, written_english_level: "intermediate",
  } },
  { name: "male only", ageMin: null, ageMax: null, education: null, expMin: null, expMax: null, config: { gender: "male" } },
  { name: "unknown cert + gte rule", ageMin: null, ageMax: null, education: null, expMin: null, expMax: null, config: {
    certifications: ["XYZ", "IRDA"], custom_field_rules: [{ field: "months_of_experience", op: "gte", value: "6", label: "6+ months" }, { field: "city", op: "contains", value: "noida", label: "Noida" }],
  } },
];

const fd = (o: Record<string, string>): MetaLeadDetail => ({ id: "x", field_data: Object.entries(o).map(([name, v]) => ({ name, values: [v] })) });

export const META_LEADS: Array<{ name: string; payload: MetaLeadDetail }> = [
  { name: "empty form", payload: fd({ full_name: "A", phone_number: "+919876543210" }) },
  { name: "strong fit", payload: fd({ full_name: "B", phone_number: "9876543211", age: "24", gender: "Female", qualification: "graduate", experience: "2 years",
    are_you_a_graduate: "Yes", [K7BK_NIGHT]: "Yes", can_travel_noida: "yes", do_you_have_a_valid_dra_certificate: "Yes",
    can_you_work_from_our_ahmedabad_location: "yes", languages_you_can_speak: "Hindi, English", typing_speed_wpm: "32 wpm", written_english_level: "Intermediate",
    months_of_experience: "12", city: "Noida sector 62" }) },
  { name: "weak fit", payload: fd({ full_name: "C", phone_number: "9876543212", age: "41", gender: "Male", qualification: "below_12th", experience: "0",
    are_you_a_graduate: "No", [K7BK_NIGHT]: "No", can_travel_noida: "no", do_you_have_a_valid_dra_certificate: "No",
    can_you_work_from_our_ahmedabad_location: "no", languages_you_can_speak: "Gujarati", typing_speed_wpm: "18", written_english_level: "basic",
    months_of_experience: "2", city: "Surat" }) },
  { name: "ambiguous answers", payload: fd({ full_name: "D", phone_number: "9876543213", are_you_a_graduate: "maybe", [K7BK_NIGHT]: "not sure yes", do_you_have_a_valid_dra_certificate: "applied, not yet",
    typing_speed_wpm: "fast", written_english_level: "good", can_you_work_from_our_ahmedabad_location: "ok" }) },
  { name: "under age graduate", payload: fd({ full_name: "E", phone_number: "9876543214", age: "17", qualification: "B.Com", gender: "female", experience: "1" }) },
  { name: "female for male-only", payload: fd({ full_name: "F", phone_number: "9876543215", gender: "female" }) },
  { name: "off-ladder education text", payload: fd({ full_name: "G", phone_number: "9876543216", qualification: "xyz course", experience: "fresher" }) },
  { name: "12th, can relocate", payload: fd({ full_name: "H", phone_number: "9876543217", qualification: "12th", can_travel_noida: "can_relocate", age: "30", gender: "M",
    are_you_a_graduate: "Yas", [K7BK_NIGHT]: "Ya", languages_you_can_speak: "hindi", typing_speed_wpm: "25", written_english_level: "advanced" }) },
  { name: "post graduate, 5 years", payload: fd({ full_name: "I", phone_number: "9876543218", qualification: "post_graduate", experience: "5_7", age: "35", gender: "Female",
    written_english_level: "Fluent", typing_speed_wpm: "24 wpm", languages_you_can_speak: "English" }) },
  { name: "diploma, half year", payload: fd({ full_name: "J", phone_number: "9876543219", qualification: "diploma", experience: "6 months", age: "18", gender: "male" }) },
];
