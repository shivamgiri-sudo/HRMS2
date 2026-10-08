import { Router, Request, Response } from "express";
import { db } from "../../db/mysql.js";
import { env } from "../../config/env.js";

const router = Router();

// GET /api/mock-digilocker/authorize — public, renders consent page
router.get("/authorize", (_req: Request, res: Response) => {
  const { state, candidateId, docs } = _req.query as Record<string, string>;
  if (!state || !candidateId) {
    return res.status(400).send("Missing required parameters");
  }

  const docList = (docs || "").split(",").filter(Boolean);
  const frontendUrl = env.FRONTEND_URL || "http://localhost:8085";

  const docRows = docList
    .map((d) => `<li style="margin:6px 0;padding:6px 12px;background:#f0f4ff;border-radius:6px;font-size:14px;">✓ ${d.replace(/_/g, " ")}</li>`)
    .join("");

  const callbackUrl = `${frontendUrl}/onboard-full?token=__TOKEN__&step=digilocker&state=${encodeURIComponent(state)}&candidateId=${encodeURIComponent(candidateId)}`;

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8"/>
  <meta name="viewport" content="width=device-width,initial-scale=1"/>
  <title>DigiLocker — Document Consent</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; background: #f5f7fa; display: flex; align-items: center; justify-content: center; min-height: 100vh; }
    .card { background: #fff; border-radius: 16px; box-shadow: 0 4px 24px rgba(0,0,0,.10); padding: 40px 36px; max-width: 440px; width: 100%; }
    .logo { display: flex; align-items: center; gap: 10px; margin-bottom: 24px; }
    .logo-icon { width: 40px; height: 40px; background: linear-gradient(135deg,#1a56db,#7e3af2); border-radius: 10px; display: flex; align-items: center; justify-content: center; color: #fff; font-weight: 700; font-size: 18px; }
    h1 { font-size: 20px; font-weight: 700; color: #111; margin-bottom: 6px; }
    .sub { color: #6b7280; font-size: 14px; margin-bottom: 24px; }
    .section-label { font-size: 12px; font-weight: 600; text-transform: uppercase; color: #9ca3af; margin-bottom: 10px; letter-spacing: .05em; }
    ul { list-style: none; margin-bottom: 28px; }
    .notice { background: #fef9c3; border: 1px solid #fde68a; border-radius: 8px; padding: 12px 14px; font-size: 13px; color: #92400e; margin-bottom: 24px; }
    .btn { width: 100%; padding: 14px; border-radius: 10px; font-size: 15px; font-weight: 600; cursor: pointer; border: none; transition: opacity .15s; }
    .btn-allow { background: #1a56db; color: #fff; margin-bottom: 12px; }
    .btn-deny { background: #f3f4f6; color: #374151; }
    .btn:hover { opacity: .88; }
    #token-input { width: 100%; padding: 10px 12px; border: 1.5px solid #d1d5db; border-radius: 8px; font-size: 14px; margin-bottom: 16px; outline: none; }
    #token-input:focus { border-color: #1a56db; }
    .token-label { font-size: 13px; color: #374151; margin-bottom: 6px; font-weight: 500; }
    .mock-badge { display: inline-block; background: #fef3c7; color: #d97706; font-size: 11px; font-weight: 700; padding: 2px 8px; border-radius: 20px; margin-left: 8px; vertical-align: middle; }
  </style>
</head>
<body>
  <div class="card">
    <div class="logo">
      <div class="logo-icon">D</div>
      <span style="font-size:18px;font-weight:700;color:#1a56db;">DigiLocker</span>
      <span class="mock-badge">MOCK</span>
    </div>
    <h1>Document Access Request</h1>
    <p class="sub">MAS Callnet HRMS is requesting access to your documents for onboarding verification.</p>

    <div class="section-label">Documents requested</div>
    <ul>${docRows}</ul>

    <div class="notice">⚠️ This is a mock DigiLocker for testing. No real documents are accessed.</div>

    <div class="token-label">Enter your onboarding token to proceed</div>
    <input id="token-input" type="text" placeholder="Paste your onboarding token here..." />

    <button class="btn btn-allow" onclick="allow()">Allow Access</button>
    <button class="btn btn-deny" onclick="deny()">Deny</button>
  </div>

  <script>
    // Try to extract token from referrer or stored value
    function getTokenFromUrl() {
      // Check if opener has the token in its URL
      try {
        const ref = document.referrer;
        const m = ref.match(/[?&]token=([^&]+)/);
        if (m) return decodeURIComponent(m[1]);
      } catch(e) {}
      return '';
    }
    document.getElementById('token-input').value = getTokenFromUrl();

    function allow() {
      const token = document.getElementById('token-input').value.trim();
      if (!token) { alert('Please enter your onboarding token'); return; }
      const url = '${callbackUrl}'.replace('__TOKEN__', encodeURIComponent(token));
      window.location.href = url;
    }
    function deny() {
      const token = document.getElementById('token-input').value.trim();
      const base = '${frontendUrl}/onboard-full';
      window.location.href = token ? base + '?token=' + encodeURIComponent(token) : base;
    }
  </script>
</body>
</html>`;

  return res.setHeader("Content-Type", "text/html").send(html);
});

// GET /api/mock-digilocker/callback — marks BGV digilocker as completed
router.get("/callback", async (req: Request, res: Response) => {
  const { state, candidateId, token } = req.query as Record<string, string>;
  const frontendUrl = env.FRONTEND_URL || "http://localhost:8085";

  if (!candidateId || !token) {
    return res.redirect(`${frontendUrl}/onboard-full?error=missing_params`);
  }

  try {
    // Mark digilocker BGV as verified for this candidate
    await db.execute(
      `UPDATE ats_bgv_check
          SET status = 'verified', verification_result = 'mock_verified', verified_at = NOW()
        WHERE candidate_id = ? AND provider_key = 'mock_digilocker'`,
      [candidateId]
    );

    // IMPORTANT: Digilocker fetches Aadhaar + PAN from government = already verified at source
    // Auto-create verified BGV check records for both (no separate API calls needed)
    const now = new Date();

    // Create/update Aadhaar check as verified
    const [existingAadhaar] = await db.execute(
      `SELECT id FROM candidate_bgv_check WHERE candidate_id = ? AND check_type = 'aadhaar' LIMIT 1`,
      [candidateId]
    ) as any;

    if (existingAadhaar.length > 0) {
      await db.execute(
        `UPDATE candidate_bgv_check
         SET status = 'verified', provider_key = 'digilocker', result_summary = 'Verified via DigiLocker',
             verified_at = NOW(), updated_at = NOW()
         WHERE id = ?`,
        [existingAadhaar[0].id]
      );
    } else {
      await db.execute(
        `INSERT INTO candidate_bgv_check
         (id, candidate_id, check_type, provider_key, status, result_summary, verified_at, created_at, updated_at)
         VALUES (UUID(), ?, 'aadhaar', 'digilocker', 'verified', 'Verified via DigiLocker', NOW(), NOW(), NOW())`,
        [candidateId]
      );
    }

    // Create/update PAN check as verified
    const [existingPan] = await db.execute(
      `SELECT id FROM candidate_bgv_check WHERE candidate_id = ? AND check_type = 'pan' LIMIT 1`,
      [candidateId]
    ) as any;

    if (existingPan.length > 0) {
      await db.execute(
        `UPDATE candidate_bgv_check
         SET status = 'verified', provider_key = 'digilocker', result_summary = 'Verified via DigiLocker',
             verified_at = NOW(), updated_at = NOW()
         WHERE id = ?`,
        [existingPan[0].id]
      );
    } else {
      await db.execute(
        `INSERT INTO candidate_bgv_check
         (id, candidate_id, check_type, provider_key, status, result_summary, verified_at, created_at, updated_at)
         VALUES (UUID(), ?, 'pan', 'digilocker', 'verified', 'Verified via DigiLocker', NOW(), NOW(), NOW())`,
        [candidateId]
      );
    }
  } catch (_e) {
    // Non-fatal — redirect anyway
  }

  const redirectUrl = `${frontendUrl}/onboard-full?token=${encodeURIComponent(token)}&step=digilocker&state=${encodeURIComponent(state || "")}`;
  return res.redirect(redirectUrl);
});

export default router;
