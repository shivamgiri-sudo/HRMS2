# Onboarding Full Form — Test Plan
**Version:** 1.0 · **Date:** 2026-06-27

---

## Test Environment
- URL: https://mcnhrms.teammas.in/onboard-full?token=<token>
- Token source: ats_onboarding_bridge WHERE onboarding_token_expires_at > NOW() AND profile_status != 'submitted'
- Mobile: 390x844 viewport (primary), 1024px (secondary)

---

## TC-01: Token Validation
| # | Action | Expected | Priority |
|---|---|---|---|
| 1 | Open with valid non-expired token | Welcome screen shows candidate name, mobile, code, branch, process | HIGH |
| 2 | Open with expired token | Error: "Onboarding token expired" | HIGH |
| 3 | Open with invalid/garbage token | Error: "Invalid onboarding token" | HIGH |
| 4 | Open with no token param | Error: "No onboarding token" | MEDIUM |

---

## TC-02: Step 1 — Welcome Display
| # | Action | Expected |
|---|---|---|
| 5 | Check branch shows | Branch name shows (not "—") for candidates with branch set |
| 6 | Check process shows | Process name shows (not "—") for candidates with process set |
| 7 | Scroll document checklist | Required docs listed: Aadhaar, PAN, 10th, Cancelled Cheque, Passport Photo |

---

## TC-03: Step 2 — Personal Information Save & Reload
| # | Action | Expected |
|---|---|---|
| 8 | Fill name, DOB, save, refresh, return to step 2 | All fields reload with saved values |
| 9 | Save with empty nominee DOB (not filling nominee DOB) | Save succeeds — no HTTP 500 |
| 10 | Fill nominee 1 share=60, nominee 2 share=50 | Warning: total is 110% — save blocked |
| 11 | Fill nominee 1 share=70, nominee 2 share=30 | Save allowed |
| 12 | DOB = 10 years old | Error: "Age must be between 16–60" |
| 13 | Save, refresh, check PRE-FILLED badge | Full Name, Mobile, Email, DOB, Gender show PRE-FILLED |
| 14 | Emergency contact fields save and reload | All three emergency contact fields persist |

---

## TC-04: Step 3 — Address & KYC
| # | Action | Expected |
|---|---|---|
| 15 | Fill permanent address, check "same as permanent", save | Present address copied from permanent; both save |
| 16 | Save, refresh | sameAddr checkbox reflects equality — checked if addresses match |
| 17 | Enter PIN "1234" (4 digits) | Error: "Must be 6 digits" |
| 18 | Enter PIN "110001" | No error |
| 19 | Enter PAN "INVALID" | Error: Invalid PAN format |
| 20 | Enter PAN "ABCDE1234F" | No error |
| 21 | Enter Aadhaar "12345" (not 12 digits) | Error: must be 12 digits |
| 22 | Save KYC, refresh | Passport, DL, UAN, EPF, ESIC all reload |
| 23 | PAN is blank on refresh (security) | PAN never pre-filled — expected |

---

## TC-05: Step 4 — Document Upload
| # | Action | Expected |
|---|---|---|
| 24 | Upload Aadhaar PDF | Appears in document table with status "pending" |
| 25 | Upload file > 5MB | Error: "File size must be under 5 MB" |
| 26 | Upload non-PDF/image | Not accepted (browser filter) |
| 27 | View uploaded doc | Link opens file in new tab |
| 28 | Delete uploaded doc | Removed from table (soft delete) |
| 29 | Document checklist shows pending required docs | Aadhaar/PAN/10th/Cheque/Photo rows show REQUIRED if not uploaded |
| 30 | Upload "Cancelled Cheque" doc | Bank detail record gets cancelled_cheque_document_id auto-set |
| 31 | BGV consent active — upload Aadhaar | Aadhaar auto-verification triggered in background |

---

## TC-06: Step 5 — BGV Consent
| # | Action | Expected |
|---|---|---|
| 32 | Click "Give Consent & Proceed" | Button turns green "✓ Consent Captured" |
| 33 | Refresh and return to step 5 | Consent still shows as captured (loaded from bgv_consent=1) |
| 34 | Check DB after consent | candidate_onboarding_profile.bgv_consent=1, dpdp_consent=1 |
| 35 | Without consent, verify buttons are disabled | All verify buttons disabled until consent given |
| 36 | BGV API fails | "Manual BGV path" notice shown — onboarding not blocked |

---

## TC-07: Step 6 — Bank Details
| # | Action | Expected |
|---|---|---|
| 37 | Enter IFSC "KKBK0000180", blur | Bank Name auto-fills "Kotak Mahindra Bank" |
| 38 | Enter account "12345", confirm "99999" | "Account numbers do not match" error, save disabled |
| 39 | Enter matching account numbers | Green "✓ Account numbers match" |
| 40 | Save bank, refresh | Bank name, IFSC, account type, holder name, nameOnCheque reload |
| 41 | Account number blank on refresh (security) | Expected — security design |
| 42 | "Bank saved — re-enter to update" hint shown | Appears when bankName is set but accountNo is blank |
| 43 | Name on cheque mismatch | Yellow info: "Routed to HR Payroll review, not a blocker" |

---

## TC-08: Step 7 — Education
| # | Action | Expected |
|---|---|---|
| 44 | Select qualification, add, verify in list | Qualification appears in added list |
| 45 | Refresh | All added qualifications show |
| 46 | Add with board/university filled | Board/University saved and shown in list |
| 47 | Add without year | Save button disabled (required) |
| 48 | View in HR onboarding requests | All qualifications shown in HR view |

---

## TC-09: Step 8 — Work Experience
| # | Action | Expected |
|---|---|---|
| 49 | Select "Fresher" | Experience fields hidden |
| 50 | Select "1–2 years" | Experience fields shown |
| 51 | Set from_date later than to_date | Error: "From date must be before To date" |
| 52 | Save experience, refresh | All experience fields reload |
| 53 | Experienced candidate — experience doc type shown | Dropdown shows all doc type options |

---

## TC-10: Step 9 — Family & Language
| # | Action | Expected |
|---|---|---|
| 54 | Add language "English", save, refresh | English reloads in language table |
| 55 | Try adding "English" again | Blocked — duplicate prevented |
| 56 | Add language without selecting any skill | Alert: select at least one skill (can_speak auto-set) |
| 57 | Save family income/dependents, refresh | Values reload |
| 58 | Change can_read for existing language | Change saved on next Save button click |

---

## TC-11: Step 10 — Statutory & Submit
| # | Action | Expected |
|---|---|---|
| 59 | Leave OTP unverified, try submit | Submit button disabled |
| 60 | Leave declaration unchecked, try submit | Submit button disabled |
| 61 | Send OTP | "OTP sent to XXXXX6265" (last 4 digits only) |
| 62 | Verify OTP with wrong code | Error: "Invalid OTP" (max 3 attempts) |
| 63 | Verify OTP with correct code | "Mobile verified ✓" |
| 64 | Check declaration, verify OTP, click Submit | Success screen: "Onboarding Submitted!" |
| 65 | Refresh after submit | Success screen shown again (profile_status='submitted') |
| 66 | Check HR onboarding requests after submit | Candidate appears with status "Profile Submitted" |
| 67 | Check DB after submit | profile_status='submitted', submitted_at set, submit_lat/lng set |

---

## TC-12: HR Downstream Verification
| # | Action | Expected |
|---|---|---|
| 68 | HR opens NativeHROnboardingRequests | Submitted candidate visible in list |
| 69 | HR clicks into candidate | All personal, bank, education, experience data shown |
| 70 | BGV center shows candidate | BGV checks, documents, score visible |
| 71 | Payroll HR validation shows candidate | Bank details, salary, joining date form available |
| 72 | NativePayrollHOQueues shows name mismatch | If cheque name ≠ account holder, appears in queue |

---

## TC-13: DPDP Compliance
| # | Action | Expected |
|---|---|---|
| 73 | Give BGV consent | dpdp_consent=1 and bgv_consent=1 both set in DB |
| 74 | Check submission blockers without consent | DPDP_CONSENT_MISSING hard blocker returned |
| 75 | Consent timestamp exists | bgv_consent_at and dpdp_consent_at populated |
| 76 | Audit log has consent entry | candidate_onboarding_submission_log has BGV_CONSENT_GRANTED |

---

## TC-14: Security
| # | Action | Expected |
|---|---|---|
| 77 | PAN field never pre-filled from API | Always blank — user must re-enter |
| 78 | Aadhaar never pre-filled from API | Always blank — user must re-enter |
| 79 | Account number never pre-filled from API | Always blank — user must re-enter |
| 80 | HR list never shows full PAN/Aadhaar/Account | Only masked versions shown |
| 81 | OTP max 3 sends per 10 minutes | 4th send returns 429 |
| 82 | OTP max 3 verify attempts | 4th attempt returns 429 |
