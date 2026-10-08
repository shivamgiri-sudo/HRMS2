import { describe, expect, it } from "vitest";
import { anchorLastActive, isPlaceholder, normaliseFacts, parseLakhs, parseNoticeDays, type RawPerson } from "../facts-normalise.js";

const NOW = new Date("2026-10-09T06:00:00Z");
const sys = { eligibility: { ok: true, blocks: [], priority: 1 }, inOtherJourney: null, bookedFor: null, exEmployee: null, rejectedOtherProcess: false };
const person = (o: Partial<RawPerson>): RawPerson => ({ sourceKind: "he", subSource: "candidate", mobile: "9876543210", ats: null, lead: null, profile: null, meta: null, dra: null, system: sys, contact: { lastFirstContactAt: null }, ...o });
const metaDetail = (fields: Record<string, string>) => ({ id: "m1", field_data: Object.entries(fields).map(([name, v]) => ({ name, values: [v] })) });

describe("placeholders", () => {
  it.each(["ccc", "CCC", "na", "N/A", "-", ".", "xxx", "test", "nil", "aaaa", "123456", "  "])("%s is a placeholder", (t) => expect(isPlaceholder(t)).toBe(true));
  it.each(["Noida", "Sector 62 Noida", "ccc colony Surat", "A-12 Lajpat Nagar"])("%s is not", (t) => expect(isPlaceholder(t)).toBe(false));
  it("null is not a placeholder (it is missing)", () => expect(isPlaceholder(null)).toBe(false));
});

describe("Naukri parsers", () => {
  it.each([["INR 3.5 L", 29167], ["Rs 12 Lakhs", 100000], ["Rs 3.25 Lakhs", 27083], ["Rs 3 Lakhs", 25000], ["INR 9.9 L", 82500], ["garbage", null], [null, null]])("salary %s -> %s a month", (t, v) => expect(parseLakhs(t as string | null)).toBe(v));
  it.each([
    ["15 Days or less", 15, "ok"], ["1 Months", 30, "ok"], ["2 Months", 60, "ok"], ["3 Months", 90, "ok"], ["More than 3 Months", 120, "ok"], ["Serving Notice Period", 30, "ok"],
    ["sometime", null, "ambiguous"], [null, null, "missing"],
  ])("notice %s -> %s (%s)", (t, d, q) => expect(parseNoticeDays(t as string | null)).toEqual({ days: d, quality: q }));
  it.each([
    ["Active in last 15 days", "2026-09-22"], ["Active yesterday", "2026-10-06"], ["Active 2 days ago", "2026-10-05"], ["Active today", "2026-10-07"], ["Active in last 7 days", "2026-09-30"],
    ["Active in last 1 month", "2026-09-07"], ["whenever", null], [null, null],
  ])("last active %s anchored at import 2026-10-07 -> %s", (t, d) => expect(anchorLastActive(t as string | null, "2026-10-07 14:00:00")).toBe(d));
});

describe("normaliseFacts", () => {
  it("Naukri: education ladder, salary, notice, employer, last active anchored at import, valid email", () => {
    const f = normaliseFacts(person({ subSource: "naukri_import", ats: { record_type: "naukri_import", education: "B.a - Bachelor Of Arts", annual_salary: "INR 3.5 L", notice_period: "1 Months",
      current_employer: "Teleperformance", last_active_naukri: "Active in last 15 days", created_at: "2026-10-07 10:00:00", email: "a.b@example.com", date_of_birth: "2000-01-15", experience: "2 Year(s) 3 Month(s)" } }), NOW);
    expect(f.educationRank).toMatchObject({ value: 5, quality: "ok" });
    expect(f.salaryMonthly).toMatchObject({ value: 29167, quality: "ok" });
    expect(f.salaryIsExpectation).toBe(false);
    expect(f.noticeDays).toMatchObject({ value: 30, quality: "ok" });
    expect(f.employers.value).toEqual(["Teleperformance"]);
    expect(f.lastActiveAt.value).toBe("2026-09-22");
    expect(f.email).toMatchObject({ value: "a.b@example.com", quality: "ok" });
    expect(f.age).toMatchObject({ value: 26, quality: "ok" });
    expect(f.experienceYears.quality).toBe("ok");
  });
  it("B.b.a. / B.m.s. ranks as graduate", () => {
    expect(normaliseFacts(person({ ats: { record_type: "naukri_import", education: "B.b.a. / B.m.s." } }), NOW).educationRank.value).toBe(5);
  });
  it("WorkIndia row: Graduate is the import default (unknown), ccc is a placeholder, no email", () => {
    const f = normaliseFacts(person({ subSource: "workindia_import", ats: { record_type: "workindia_import", education: "Graduate", address: "ccc", email: null } }), NOW);
    expect(f.educationRank).toMatchObject({ value: null, quality: "source_default" });
    expect(f.locationText).toMatchObject({ value: null, quality: "placeholder" });
    expect(f.email.quality).toBe("missing");
    expect(f.match.educationRank ?? null).toBeNull();
  });
  it("out-of-range values are ambiguous, never used", () => {
    const f = normaliseFacts(person({ lead: { age: 9, experience_years: 60 }, profile: { salary_expectation: 900000 } }), NOW);
    expect(f.age.quality).toBe("ambiguous");
    expect(f.experienceYears.quality).toBe("ambiguous");
    expect(f.salaryMonthly.quality).toBe("ambiguous");
    expect(f.match.age ?? null).toBeNull();
  });
  it("mobile written +91 98765 43210 -> personKey 9876543210, valid", () => {
    const f = normaliseFacts(person({ mobile: "+91 98765 43210" }), NOW);
    expect(f.personKey).toBe("9876543210");
    expect(f.mobileValid).toBe(true);
    expect(normaliseFacts(person({ mobile: "12345" }), NOW).mobileValid).toBe(false);
  });
  it("an invalid email is ambiguous", () => {
    expect(normaliseFacts(person({ ats: { email: "not-an-email" } }), NOW).email.quality).toBe("ambiguous");
  });
  it("DRA certificate row verified -> level verified; a Meta DRA yes -> declared", () => {
    expect(normaliseFacts(person({ dra: { status: "verified" } }), NOW).certificates.value).toEqual([{ code: "DRA", level: "verified" }]);
    expect(normaliseFacts(person({ dra: { status: "pending" } }), NOW).certificates.value).toEqual([{ code: "DRA", level: "declared" }]);
    expect(normaliseFacts(person({ dra: { status: "invalid" } }), NOW).certificates.value ?? []).toEqual([]);
    const m = normaliseFacts(person({ sourceKind: "meta_live", subSource: "meta_live", meta: { rawPayload: metaDetail({ do_you_have_a_valid_dra_certificate: "Yes" }), parsedEducation: null, parsedLocation: null, parsedExperienceYr: null, createdAt: "2026-10-08 10:00:00" } }), NOW);
    expect(m.certificates.value).toEqual([{ code: "DRA", level: "declared" }]);
  });
  it("Meta: metaInput is exactly what ingest screens (parseLead of the stored payload, string or object)", () => {
    const payload = metaDetail({ full_name: "A", phone_number: "9876543210", qualification: "graduate", experience: "2 years", gender: "Female", city: "Noida" });
    for (const raw of [payload, JSON.stringify(payload)]) {
      const f = normaliseFacts(person({ sourceKind: "meta_old", subSource: "meta_old", meta: { rawPayload: raw, parsedEducation: "graduate", parsedLocation: "Noida", parsedExperienceYr: 2, createdAt: "2026-09-01 10:00:00" } }), NOW);
      expect(f.metaInput).toMatchObject({ parsedEducation: "graduate", parsedExperienceYr: 2, parsedGender: "Female", rawFields: expect.objectContaining({ city: "Noida" }) });
      expect(f.educationRank.value).toBe(5);
      expect(f.gender.value).toBe("female");
      expect(f.locationText.value).toContain("noida");
      expect(f.recordUpdatedAt.value).toBe("2026-09-01 10:00:00");
    }
  });
  it("non-Meta people have no metaInput", () => expect(normaliseFacts(person({}), NOW).metaInput).toBeNull());
  it("pool lead + profile: structured facts and the matcher lead", () => {
    const f = normaliseFacts(person({ subSource: "pool_other", lead: { age: 25, education_rank: 3, experience_years: 1.5, night_shift_ok: 1, locality: "Indirapuram", lat: 28.6, lng: 77.3, updated_at: "2026-10-01 00:00:00" },
      profile: { gender: "male", languages: "[\"hindi\",\"english\"]", certifications: "[\"DRA\"]", typing_wpm: 30, english_level: "intermediate", education_status: "completed", stream: "commerce", last_employer: "Concentrix", skills_text: "excel" } }), NOW);
    expect(f.match).toMatchObject({ age: 25, educationRank: 3, experienceYears: 1.5, nightShiftOk: true, lat: 28.6, gender: "male", languages: ["hindi", "english"], certifications: ["DRA"], typingWpm: 30, englishLevel: "intermediate", educationStatus: "completed", stream: "commerce" });
    expect(f.englishLevel.value).toBe(2);
    expect(f.certificates.value).toEqual([{ code: "DRA", level: "declared" }]);
    expect(f.employers.value).toEqual(["Concentrix"]);
    expect(f.recordUpdatedAt.value).toBe("2026-10-01 00:00:00");
  });
});

describe("imported columns mapped into the facts (WS3 D2: the 55k Naukri / WorkIndia bridge)", () => {
  it("current designation joins the skills text and is its own fact", () => {
    const f = normaliseFacts(person({ subSource: "naukri_import", ats: { record_type: "naukri_import", current_designation: "Senior Telecaller", role_applied: "Customer support" } }), NOW);
    expect(f.designation).toMatchObject({ value: "Senior Telecaller", quality: "ok", from: "naukri.current_designation" });
    expect(f.skillsText.value).toContain("Senior Telecaller");
  });
  it("a placeholder designation is unknown and stays out of the skills", () => {
    const f = normaliseFacts(person({ subSource: "workindia_import", ats: { record_type: "workindia_import", current_designation: "ccc" } }), NOW);
    expect(f.designation?.quality).toBe("placeholder");
    expect(f.skillsText.value ?? "").not.toContain("ccc");
  });
  it("the Naukri application date is the recency when last-active is missing or unreadable", () => {
    const missingActive = normaliseFacts(person({ ats: { record_type: "naukri_import", naukri_application_date: "2026-09-30" } }), NOW);
    expect(missingActive.lastActiveAt).toMatchObject({ value: "2026-09-30", quality: "ok", from: "naukri.naukri_application_date" });
    const both = normaliseFacts(person({ ats: { record_type: "naukri_import", naukri_application_date: "2026-09-01", last_active_naukri: "Active yesterday", created_at: "2026-10-07 10:00:00" } }), NOW);
    expect(both.lastActiveAt.from).toBe("naukri.last_active_naukri");
    const dateObj = normaliseFacts(person({ ats: { record_type: "naukri_import", naukri_application_date: new Date("2026-09-29T18:30:00Z") as never } }), NOW);
    expect(dateObj.lastActiveAt.value).toBe("2026-09-30");
  });
});
