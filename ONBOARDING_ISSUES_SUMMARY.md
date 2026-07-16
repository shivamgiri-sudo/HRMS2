# Onboarding Flow Issues - Complete Analysis

## Issue 1: Befisc DNS Error (Screenshot)

**Error Message:**
```
getaddrinfo ENOTFOUND aadhaar-xml-download.befisc.com
```

**Root Cause:**
- Befisc API endpoint (`aadhaar-xml-download.befisc.com`) is not reachable
- Possible reasons:
  1. Domain doesn't exist / DNS not resolving
  2. Network/firewall blocking the domain
  3. Befisc service is down
  4. Wrong API URL configured in environment variables

**Location in Code:**
- File: `backend/src/modules/ats/bgv-provider.adapter.ts` lines 1187-1199
- The CompositeBgvProviderAdapter tries to call Befisc for Aadhaar offline verification
- URL comes from: `env.BEFISC_API_URL` or `cfg.befisc_api_url`

**Current Fallback:**
```typescript
// Lines 1168-1181 in bgv-provider.adapter.ts
if (!this.cfg.befisc_api_url || !this.cfg.befisc_api_key) {
  return {
    status: "manual_review",
    resultSummary: "Aadhaar verification queued for manual review — Befisc API not configured.",
    // ... falls back to manual review
  };
}
```

**Fix Options:**

### Option 1: Configure Correct Befisc URL
Check `backend/.env` for:
```env
BEFISC_API_URL=https://aadhaar-xml-download.befisc.com/
BEFISC_API_KEY=your_api_key_here
```

Verify the domain is correct with Befisc documentation.

### Option 2: Disable Befisc and Use Manual Review
Set in `.env`:
```env
BEFISC_API_URL=
BEFISC_API_KEY=
```

This will gracefully fall back to `manual_review` status without throwing errors.

### Option 3: Better Error Handling (Recommended)
Modify `bgv-provider.adapter.ts` lines 1200-1203:
```typescript
} catch (error: any) {
  const msg = error?.response?.data?.message ?? error?.message ?? "Befisc Aadhaar check failed";
  
  // If DNS error, fall back to manual review instead of throwing
  if (error.code === 'ENOTFOUND' || error.code === 'ECONNREFUSED') {
    return {
      status: "manual_review",
      providerKey: this.providerKey,
      providerRequestId: requestId,
      providerReferenceId: requestId,
      matchScore: null,
      matchedName: input.candidateName ?? null,
      resultSummary: "Aadhaar verification provider unavailable — queued for manual HR review",
      riskFlags: ['PROVIDER_UNAVAILABLE'],
      raw: { mode: "provider_error_fallback", error: msg },
    };
  }
  
  throw new Error(msg);
}
```

---

## Issue 2: Raw Account Number Required for Penny Drop

**Error Message in Code:**
```typescript
// Line 266 in bgv-verification.service.ts
throw Object.assign(new Error("Raw account number is required for digital verification"), { statusCode: 400 });
```

**Root Cause:**
- Backend stores only **hashed** account number (`account_no_hash`) for security
- Backend stores only **masked** account number (`account_no_masked` = last 4 digits)
- **Raw/full account number is never stored** after first save
- Luckpay Penny Drop API requires the **full raw account number** to verify
- Cannot recover raw account number from hash

**Why This Happens:**

1. **Step 6 - Save Bank Details:**
   ```typescript
   // onboarding-full.service.ts lines 1114-1120
   maskAccount(accountNo),        // Stores: "XXXXXXXX1234"
   hashValue(accountNo),          // Stores: SHA-256 hash (irreversible)
   ```

2. **Step 6 - Try Penny Drop Later:**
   ```typescript
   // bgv-verification.service.ts lines 258-266
   // Tries to fetch from database
   const [bankRows] = await db.execute(`SELECT * FROM candidate_onboarding_bank_detail...`);
   // But raw account number is not in the table!
   if (!accountNo) throw new Error("Raw account number is required for digital verification");
   ```

**The Problem:**
- Once candidate clicks "Save Bank Details", account number is hashed/masked
- If candidate leaves page and comes back, form shows empty account number field (security design)
- When candidate clicks "Verify Bank Account" button without re-entering account number, verification fails
- Backend cannot retrieve raw account number from database

**Current Behavior:**
- `PennyDropButton.tsx` passes `accountNo` prop from form state: `accountNo={bank.accountNo || ""}`
- If `bank.accountNo` is empty (after page reload or after save), penny drop fails

**Security vs. Usability Trade-off:**

### Current Design (Secure but UX issue):
- ✅ Raw account number never persisted in database
- ✅ Cannot be retrieved by attackers even with DB access
- ❌ User must re-enter account number for every verification attempt
- ❌ Confusing error message

### Alternative Designs:

#### Option A: In-Memory Verification (Immediate Verification Only)
```typescript
// After user enters account number, immediately show:
"Save & Verify" button instead of separate "Save" and "Verify" buttons

// On click:
1. Validate account number
2. Trigger penny drop verification (account still in memory)
3. Save to DB with hash/mask
4. Show result

// Pro: Secure, account number never persisted
// Con: Cannot verify later without re-entering
```

#### Option B: Session Storage (Current Session Only)
```typescript
// After save, store raw account in sessionStorage
sessionStorage.setItem(`temp_account_${token}`, accountNo);

// On penny drop click, retrieve from sessionStorage
const accountNo = sessionStorage.getItem(`temp_account_${token}`);

// Clear on page close or after 1 hour
setTimeout(() => sessionStorage.removeItem(`temp_account_${token}`), 3600000);

// Pro: Works across page navigations in same session
// Con: Stored in browser (less secure than in-memory)
```

#### Option C: Require Re-entry for Verification (Current - Document It)
```typescript
// Keep current design but improve UX:

// 1. In Step 6 after save, show message:
"✓ Bank details saved. Your account number is securely hashed and cannot be displayed again."

// 2. In penny drop UI, show clear instruction:
"To verify your account, please re-enter your account number below:"
<Input 
  placeholder="Re-enter account number for verification"
  value={tempAccountNo}
  onChange={(e) => setTempAccountNo(e.target.value)}
/>
<Button onClick={() => verifyWithTempAccount(tempAccountNo)}>
  Verify Bank Account
</Button>

// Pro: Most secure, user understands why
// Con: Extra step for user
```

#### Option D: Encrypted Storage (Balance Security + UX)
```typescript
// Store encrypted account number in database
import crypto from 'crypto';

const ENCRYPTION_KEY = env.BANK_ENCRYPTION_KEY; // 32-byte key from .env

function encryptAccount(accountNo: string): string {
  const cipher = crypto.createCipher('aes-256-cbc', ENCRYPTION_KEY);
  return cipher.update(accountNo, 'utf8', 'hex') + cipher.final('hex');
}

function decryptAccount(encrypted: string): string {
  const decipher = crypto.createDecipher('aes-256-cbc', ENCRYPTION_KEY);
  return decipher.update(encrypted, 'hex', 'utf8') + decipher.final('utf8');
}

// Save: store encrypted + hash + masked
await db.execute(`INSERT INTO candidate_onboarding_bank_detail 
  (account_no_encrypted, account_no_hash, account_no_masked) 
  VALUES (?, ?, ?)`, 
  [encryptAccount(accountNo), hashValue(accountNo), maskAccount(accountNo)]
);

// Verify: decrypt from database
const [rows] = await db.execute(`SELECT account_no_encrypted FROM ...`);
const rawAccount = decryptAccount(rows[0].account_no_encrypted);
await adapter.verifyBank({ accountNo: rawAccount, ... });

// Pro: User doesn't need to re-enter, secure with proper key management
// Con: If encryption key leaked, all accounts exposed
```

---

## Recommended Immediate Fixes

### Fix 1: Befisc DNS Error - Add Graceful Fallback

**File:** `backend/src/modules/ats/bgv-provider.adapter.ts`

**Change:**
```typescript
// Around line 1200
} catch (error: any) {
  const msg = error?.response?.data?.message ?? error?.message ?? "Befisc Aadhaar check failed";
  
  // Handle network/DNS errors gracefully
  if (error.code === 'ENOTFOUND' || error.code === 'ECONNREFUSED' || error.code === 'ETIMEDOUT') {
    console.error(`[BGV] Befisc provider unavailable: ${msg}`);
    return {
      status: "manual_review",
      providerKey: this.providerKey,
      providerRequestId: requestId,
      providerReferenceId: requestId,
      matchScore: null,
      matchedName: input.candidateName ?? null,
      resultSummary: "Aadhaar verification service temporarily unavailable. HR will verify manually after submission.",
      riskFlags: ['PROVIDER_UNAVAILABLE'],
      raw: { mode: "provider_error_fallback", error_code: error.code },
    };
  }
  
  throw new Error(msg);
}
```

### Fix 2: Penny Drop UX - Option C (Document Re-entry Requirement)

**File:** `src/components/onboarding-full/OnboardingSteps1to5.tsx`

**Add after Save button (around line 1153):**
```tsx
{bank.bankName && !bank.accountNo && (
  <div className="mt-4 rounded-xl border-2 border-blue-200 bg-blue-50 px-4 py-3">
    <p className="text-sm font-bold text-blue-900">✓ Bank Details Saved</p>
    <p className="text-xs text-blue-800 mt-1">
      Your account number is securely hashed and cannot be displayed. 
      To verify your account with penny drop, please re-enter your account number below.
    </p>
  </div>
)}
```

**File:** `src/components/onboarding-full/PennyDropButton.tsx`

**Add account re-entry field:**
```tsx
// After line 22, add:
const [tempAccountNo, setTempAccountNo] = useState("");
const [showReentryPrompt, setShowReentryPrompt] = useState(false);

// Replace handleVerify function:
async function handleVerify() {
  // If no account number provided, show re-entry prompt
  if (!accountNo) {
    setShowReentryPrompt(true);
    return;
  }
  
  // ... rest of existing verification logic
}

// In return JSX, add before Button:
{showReentryPrompt && !accountNo && (
  <div className="mb-3 space-y-2">
    <Label className="text-xs font-semibold text-slate-700">
      Re-enter Account Number for Verification
    </Label>
    <Input
      type="text"
      inputMode="numeric"
      placeholder="Enter your account number"
      value={tempAccountNo}
      onChange={(e) => setTempAccountNo(e.target.value)}
      className="min-h-[48px]"
    />
    <Button
      onClick={() => {
        setShowReentryPrompt(false);
        // Trigger verification with temp account
        handleVerify(); // Will use tempAccountNo as accountNo
      }}
      disabled={!tempAccountNo}
      size="sm"
      className="w-full"
    >
      Verify with Re-entered Account
    </Button>
  </div>
)}
```

### Fix 3: Better Error Messages in Frontend

**File:** `src/components/onboarding-full/useOnboardingFull.ts`

**Enhance verifyBank function (line 511-522):**
```typescript
const verifyBank = async () => {
  // Check if account number is available in form state
  if (!bank.accountNo || bank.accountNo.trim() === '') {
    setError(
      "Account number required for verification. " +
      "For security, we don't store your raw account number. " +
      "Please re-enter your account number in the Bank Details section above, then try verification again."
    );
    return;
  }
  
  const panSaved = Boolean((status as any)?.token?.saved_profile?.pan_number_masked);
  if (!panSaved) {
    setError("Please save your PAN number in Step 3 (KYC & Address) before verifying your bank account.");
    return;
  }
  
  setSaving(true);
  try { 
    await hrmsApi.post(`${BGV}/verify/bank`, { 
      token, 
      accountNo: bank.accountNo, 
      ifscCode: bank.ifscCode, 
      accountHolderName: bank.accountHolderName 
    }); 
    await load(); 
  }
  catch (e: any) { 
    const errorMsg = extractBgvError(e, "Bank verification failed");
    
    // Specific handling for account number missing error
    if (errorMsg.includes("Raw account number is required")) {
      setError(
        "Account number not available for verification. " +
        "Please re-enter your account number in the form above and try again. " +
        "(We don't store raw account numbers for security)"
      );
    } else {
      setError(errorMsg);
    }
  }
  finally { setSaving(false); }
};
```

---

## Testing Checklist

After implementing fixes:

### Test 1: Befisc Error Handling
1. Temporarily set wrong Befisc URL in backend `.env`
2. Go to Step 5, click "Verify Aadhaar"
3. **Expected:** Should show "Aadhaar verification service temporarily unavailable. HR will verify manually."
4. **Expected:** Should NOT block proceeding to next step
5. BGV status should show `manual_review` not `failed`

### Test 2: Bank Verification Without Re-entry
1. Go to Step 6, enter bank details, click "Save Bank Details"
2. Refresh the page (or navigate away and back)
3. Go to Penny Drop section, click "Verify Bank Account" WITHOUT re-entering account number
4. **Current:** Error "Raw account number is required"
5. **After Fix:** Clear message explaining need to re-enter + optional input field

### Test 3: Bank Verification With Re-entry
1. Complete Step 6 (save bank details)
2. In Penny Drop section, re-enter account number in the verification form
3. Click "Verify Bank Account"
4. **Expected:** Verification succeeds (or shows IP whitelist error with manual review fallback)

---

## Long-term Security Enhancement

### Recommended: Option D (Encrypted Storage) + PII Audit Log

**Database Schema:**
```sql
ALTER TABLE candidate_onboarding_bank_detail 
  ADD COLUMN account_no_encrypted TEXT NULL AFTER account_no_hash;

-- Audit log for decryption access
CREATE TABLE sensitive_data_access_log (
  id CHAR(36) PRIMARY KEY,
  candidate_id CHAR(36) NOT NULL,
  data_type ENUM('bank_account','aadhaar','pan') NOT NULL,
  accessed_by CHAR(36) NULL,
  accessed_for VARCHAR(100) NOT NULL, -- 'penny_drop_verification', 'payroll_setup', etc.
  ip_address VARCHAR(45) NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_candidate (candidate_id),
  INDEX idx_accessed_by (accessed_by)
);
```

**Benefits:**
- ✅ User never needs to re-enter account number
- ✅ Encrypted at rest (secure if key management proper)
- ✅ Audit trail of all decryption access
- ✅ Can verify account multiple times
- ✅ Compliance-friendly (DPDP Act 2023)

**Key Management:**
- Store encryption key in environment variable (not in code)
- Use AWS KMS / Azure Key Vault in production
- Rotate keys periodically
- Different keys for dev/staging/production

---

## Summary

| Issue | Impact | Immediate Fix | Long-term Fix |
|-------|--------|---------------|---------------|
| Befisc DNS Error | HIGH - Blocks Aadhaar verification | Add graceful fallback to manual_review | Fix Befisc URL or switch provider |
| Penny Drop Requires Re-entry | MEDIUM - UX friction | Add clear re-entry prompt with explanation | Implement encrypted storage |
| IP Whitelist Error | HIGH - Blocks bank verification | Manual review fallback (already in plan) | Get IP whitelisted with Luckpay |

**Priority:**
1. P0: Fix Befisc error handling (prevents onboarding completion)
2. P1: Improve penny drop UX messaging (current behavior is confusing)
3. P2: Consider encrypted storage for better UX (after security review)
