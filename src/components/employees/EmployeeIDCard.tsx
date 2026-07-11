import { useState, useEffect } from "react";
import { buildEmployeeIdQrData, buildQrCodeUrl } from "@/integrations/apis/qrCode.api";
import { normalizeMediaUrl } from "@/lib/mediaUrl";

interface EmployeeIDCardProps {
  employeeId: string;
  employeeCode: string;
  fullName: string;
  designation: string;
  department?: string;
  branchAddress?: string;
  branchName?: string;
  branchCity?: string;
  branchState?: string;
  hrContact?: string;
  photoUrl?: string;
  emergencyContact: string;
  bloodGroup: string;
  printMode?: boolean;
}

interface DesignationTier {
  gradient: string;
  accent: string;
  accentRgb: string;
  premium: boolean;
}

function getDesignationTier(designation: string): DesignationTier {
  const d = designation.toLowerCase();
  if (/manager|head|director|\bvp\b|coo|ceo|hr admin/.test(d))
    return {
      gradient: "linear-gradient(160deg, #061e40 0%, #0a2d5a 40%, #051428 100%)",
      accent: "#d4a017",
      accentRgb: "212,160,23",
      premium: true,
    };
  if (/team lead|\btl\b|floor|supervisor|senior/.test(d))
    return {
      gradient: "linear-gradient(160deg, #3730a3 0%, #312e81 55%, #1e1b6b 100%)",
      accent: "#818cf8",
      accentRgb: "129,140,248",
      premium: false,
    };
  if (/quality|auditor|\bqa\b|analyst|trainer/.test(d))
    return {
      gradient: "linear-gradient(160deg, #92400e 0%, #78350f 55%, #5a2707 100%)",
      accent: "#f59e0b",
      accentRgb: "245,158,11",
      premium: false,
    };
  if (/executive|agent|associate|caller|csr|officer/.test(d))
    return {
      gradient: "linear-gradient(160deg, #0d6e6e 0%, #0a5555 55%, #073d3d 100%)",
      accent: "#2dd4bf",
      accentRgb: "45,212,191",
      premium: false,
    };
  return {
    gradient: "linear-gradient(160deg, #1e293b 0%, #0f172a 55%, #080e1a 100%)",
    accent: "#94a3b8",
    accentRgb: "148,163,184",
    premium: false,
  };
}

const INSTRUCTIONS = [
  "Employees must wear this ID card at all times while on company premises.",
  "This card does not confer any rights other than identification.",
  "Loss must be reported immediately to the HR Department.",
  "This card is the property of MAS Callnet India Pvt. Ltd. If found, please return it to the nearest MAS Callnet office. Unauthorized use is prohibited.",
];

// Card geometry
const W  = 340;
const H  = 590;
const WH = 200;  // white header height
const PD = 130;  // photo outer ring diameter (accent ring)
const PI = 116;  // photo inner diameter — thinner border so image is larger
const PT = WH - PD / 2; // photo absolute top position

export function EmployeeIDCard({
  employeeId,
  employeeCode,
  fullName,
  designation,
  department,
  branchAddress,
  branchName,
  branchCity,
  branchState,
  hrContact = "hr@teammas.in",
  photoUrl,
  emergencyContact,
  bloodGroup,
  printMode = false,
}: EmployeeIDCardProps) {
  const [qrUrl, setQrUrl] = useState("");
  const [flipped, setFlipped] = useState(false);

  useEffect(() => {
    const qrData = buildEmployeeIdQrData(employeeCode, employeeId);
    buildQrCodeUrl(qrData, 96).then(setQrUrl).catch(() => setQrUrl(""));
  }, [employeeCode, employeeId]);

  const tier = getDesignationTier(designation);
  const { accent, accentRgb, premium, gradient } = tier;

  const designationLine = designation
    ? department ? `${designation} — ${department}` : designation
    : department ?? "";

  const addressLines: string[] = [];
  if (branchName) addressLines.push(branchName);
  if (branchAddress) addressLines.push(branchAddress);
  const cityState = [branchCity, branchState].filter(Boolean).join(", ");
  if (cityState) addressLines.push(cityState);

  const uid = accent.replace("#", "");

  // ── Shared photo element ─────────────────────────────────────────────────
  const photoElement = (
    <div style={{ width: PI, height: PI, borderRadius: "50%", overflow: "hidden", background: "#e5e7eb" }}>
      {photoUrl
        ? <img src={normalizeMediaUrl(photoUrl)} alt={fullName} style={{ width: "100%", height: "100%", objectFit: "cover", objectPosition: "center 20%" }} />
        : <div style={{ width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 10, fontWeight: 700, color: "#9ca3af" }}>No Photo</div>
      }
    </div>
  );

  // ── Front face inner content ─────────────────────────────────────────────
  const frontFaceContent = (
    <>
      {/* ── White header ── */}
      <div style={{
        position: "absolute", top: 0, left: 0, right: 0, height: WH,
        background: "#ffffff", display: "flex", flexDirection: "column",
        alignItems: "center", paddingTop: 22, zIndex: 2, overflow: "hidden",
      }}>
        {/* Geometric SVG decoration */}
        <svg style={{ position: "absolute", inset: 0, width: "100%", height: "100%", pointerEvents: "none" }} xmlns="http://www.w3.org/2000/svg">
          <defs>
            {premium ? (
              <pattern id={`xh-${uid}`} x="0" y="0" width="14" height="14" patternUnits="userSpaceOnUse">
                <line x1="0" y1="0" x2="14" y2="14" stroke={`rgba(${accentRgb},0.07)`} strokeWidth="0.8" />
                <line x1="14" y1="0" x2="0" y2="14" stroke={`rgba(${accentRgb},0.07)`} strokeWidth="0.8" />
              </pattern>
            ) : (
              <pattern id={`hatch-${uid}`} x="0" y="0" width="20" height="20" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
                <line x1="0" y1="0" x2="0" y2="20" stroke={`rgba(${accentRgb},0.07)`} strokeWidth="1.5" />
              </pattern>
            )}
          </defs>
          <rect width="100%" height="100%" fill={`url(#${premium ? `xh-${uid}` : `hatch-${uid}`})`} />
          {premium ? (
            <>
              <circle cx={W} cy="0" r="90" fill="none" stroke={`rgba(${accentRgb},0.18)`} strokeWidth="14" />
              <circle cx={W} cy="0" r="68" fill="none" stroke={`rgba(${accentRgb},0.10)`} strokeWidth="6" />
              <circle cx="0" cy={WH} r="70" fill="none" stroke={`rgba(${accentRgb},0.10)`} strokeWidth="10" />
              <circle cx="18" cy="16" r="4" fill={`rgba(${accentRgb},0.25)`} />
              <circle cx="32" cy="26" r="2.5" fill={`rgba(${accentRgb},0.15)`} />
              <circle cx="14" cy="32" r="2" fill={`rgba(${accentRgb},0.10)`} />
            </>
          ) : (
            <>
              <circle cx={W - 18} cy={WH - 10} r="80" fill="none" stroke={`rgba(${accentRgb},0.12)`} strokeWidth="16" />
              <circle cx="18" cy="18" r="32" fill="none" stroke={`rgba(${accentRgb},0.08)`} strokeWidth="10" />
              <circle cx={W - 26} cy="20" r="4" fill={`rgba(${accentRgb},0.15)`} />
              <circle cx={W - 14} cy="32" r="3" fill={`rgba(${accentRgb},0.10)`} />
            </>
          )}
        </svg>

        {/* Logo */}
        <img src="/mcn-logo.png" alt="MAS Callnet" style={{ height: 52, objectFit: "contain", position: "relative", zIndex: 3 }} />

        {/* Company name */}
        <p style={{
          position: "relative", zIndex: 3, marginTop: 10,
          fontSize: 14, fontWeight: 900,
          color: premium ? "#051e3e" : "#073f78",
          textAlign: "center", letterSpacing: "-0.01em", lineHeight: 1.2,
        }}>
          Mas Callnet India Pvt. Ltd.
        </p>

        {/* Subtitle */}
        <p style={{
          position: "relative", zIndex: 3, marginTop: 5,
          fontSize: 10, fontWeight: 700,
          color: premium ? `rgba(${accentRgb},0.7)` : "#94a3b8",
          textTransform: "uppercase", letterSpacing: "0.2em",
        }}>
          Employee Identity Card
        </p>

        {/* Wave divider */}
        <svg style={{ position: "absolute", bottom: -1, left: 0, width: "100%", zIndex: 4, display: "block" }}
          viewBox={`0 0 ${W} 30`} preserveAspectRatio="none">
          <path d={`M0,30 Q${W/2},5 ${W},30 L${W},30 L0,30 Z`} fill={accent} opacity="0.2" />
          <path d={`M0,30 Q${W/2},7 ${W},30`} stroke={accent} strokeWidth="2.5" fill="none" opacity="0.7" />
          <path d={`M0,30 Q${W/2},5 ${W},30 L${W},30 L0,30 Z`} fill="white" />
        </svg>
      </div>

      {/* ── Dark body ── */}
      <div style={{ position: "absolute", top: WH, left: 0, right: 0, bottom: 0, background: gradient, overflow: "hidden" }}>
        {/* Body geometric */}
        <svg style={{ position: "absolute", inset: 0, width: "100%", height: "100%", pointerEvents: "none" }} xmlns="http://www.w3.org/2000/svg">
          {premium ? (
            <>
              <circle cx={W + 30} cy="-20" r="160" fill={`rgba(${accentRgb},0.04)`} />
              <circle cx="-30" cy={H - WH} r="180" fill={`rgba(${accentRgb},0.03)`} />
              <line x1={W - 60} y1="0" x2={W} y2="80" stroke={`rgba(${accentRgb},0.08)`} strokeWidth="1.2" />
              <line x1={W - 40} y1="0" x2={W} y2="60" stroke={`rgba(${accentRgb},0.05)`} strokeWidth="1" />
              <polygon
                points={`${W-30},${H-WH-100} ${W-14},${H-WH-82} ${W-30},${H-WH-64} ${W-46},${H-WH-82}`}
                fill="none" stroke={`rgba(${accentRgb},0.12)`} strokeWidth="1.2"
              />
            </>
          ) : (
            <>
              <circle cx={W + 10} cy="40" r="110" fill={`rgba(${accentRgb},0.04)`} />
              <circle cx="-10" cy={H - WH - 50} r="90" fill={`rgba(${accentRgb},0.04)`} />
            </>
          )}
        </svg>

        {/* Body content */}
        <div style={{
          position: "relative", zIndex: 2,
          display: "flex", flexDirection: "column", alignItems: "center",
          paddingTop: PD/2 + (premium ? 28 : 18),
          paddingLeft: 26, paddingRight: 26, paddingBottom: 18, height: "100%",
        }}>
          {/* Full name */}
          <h3 style={{
            fontSize: 24, fontWeight: 900, color: "#ffffff",
            textAlign: "center", lineHeight: 1.15, letterSpacing: "-0.01em",
            marginBottom: 7,
            ...(premium ? { textShadow: `0 1px 12px rgba(${accentRgb},0.45)` } : {}),
          }}>
            {fullName}
          </h3>

          {/* Accent rule */}
          <div style={{
            width: premium ? 60 : 48, height: 3, marginBottom: 7, borderRadius: 2,
            background: premium ? `linear-gradient(90deg,#d4a017,#f0c040,#d4a017)` : accent,
          }} />

          {/* Designation */}
          {designationLine && (
            <p style={{
              fontSize: 12, fontWeight: 700,
              color: `rgba(${accentRgb},${premium ? "1" : "0.9"})`,
              textAlign: "center", letterSpacing: "0.03em",
              marginBottom: premium ? 10 : 18,
            }}>
              {designationLine}
            </p>
          )}

          {/* Premium: subtle gold divider line instead of badge */}
          {premium && (
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 14, width: "100%" }}>
              <div style={{ height: 1, flex: 1, background: `linear-gradient(90deg,transparent,rgba(${accentRgb},0.5))` }} />
              <div style={{ width: 6, height: 6, borderRadius: "50%", background: accent }} />
              <div style={{ height: 1, flex: 1, background: `linear-gradient(90deg,rgba(${accentRgb},0.5),transparent)` }} />
            </div>
          )}

          {/* Info rows */}
          <div style={{
            width: "100%",
            borderTop: `1px solid rgba(${accentRgb},${premium ? "0.35" : "0.2"})`,
            paddingTop: 14, display: "flex", flexDirection: "column", gap: 9,
          }}>
            {[
              ["ID No", employeeCode],
              ["Emergency", emergencyContact],
              ["Blood Group", bloodGroup],
            ].map(([lbl, val]) => (
              <div key={lbl} style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <span style={{ fontSize: 11, fontWeight: 800, color: accent, minWidth: 90, letterSpacing: "0.03em" }}>
                  {lbl}
                </span>
                <span style={{ fontSize: 11, color: "rgba(255,255,255,0.25)", marginRight: 2 }}>:</span>
                <span style={{ fontSize: 12, fontWeight: 600, color: `rgba(255,255,255,${premium ? "1" : "0.9"})` }}>
                  {val}
                </span>
              </div>
            ))}
          </div>

          {/* QR */}
          <div style={{ marginTop: "auto", display: "flex", flexDirection: "column", alignItems: "center" }}>
            {qrUrl ? (
              <>
                <div style={{
                  padding: 6, background: "white", borderRadius: 11,
                  boxShadow: `0 0 0 2.5px rgba(${accentRgb},0.6)${premium ? ",0 0 16px rgba(212,160,23,0.25)" : ""}`,
                }}>
                  <img src={qrUrl} alt="QR" style={{ width: 62, height: 62, borderRadius: 6, display: "block" }} />
                </div>
                <p style={{ marginTop: 5, fontSize: 8.5, color: "rgba(255,255,255,0.3)", textTransform: "uppercase", letterSpacing: "0.2em" }}>
                  Scan to verify
                </p>
              </>
            ) : (
              <div style={{ width: 62, height: 62, borderRadius: 11, background: "rgba(255,255,255,0.08)" }} />
            )}
          </div>
        </div>
      </div>

      {/* ── Photo circle ── */}
      {premium ? (
        <div style={{
          position: "absolute", top: PT - 4, left: "50%", transform: "translateX(-50%)",
          zIndex: 10, width: PD + 8, height: PD + 8, borderRadius: "50%",
          background: "conic-gradient(from 0deg, rgba(212,160,23,0.9), rgba(255,220,80,1), rgba(212,160,23,0.5), rgba(255,220,80,1), rgba(212,160,23,0.9))",
          display: "flex", alignItems: "center", justifyContent: "center",
          boxShadow: "0 0 0 3px rgba(255,255,255,0.9), 0 8px 28px rgba(0,0,0,0.45)",
        }}>
          <div style={{ width: PD + 2, height: PD + 2, borderRadius: "50%", background: "white", display: "flex", alignItems: "center", justifyContent: "center" }}>
            {photoElement}
          </div>
        </div>
      ) : (
        <div style={{
          position: "absolute", top: PT, left: "50%", transform: "translateX(-50%)",
          zIndex: 10, width: PD, height: PD, borderRadius: "50%", background: accent,
          display: "flex", alignItems: "center", justifyContent: "center",
          boxShadow: "0 0 0 4px rgba(255,255,255,0.95), 0 8px 28px rgba(0,0,0,0.4)",
        }}>
          <div style={{ width: PD - 6, height: PD - 6, borderRadius: "50%", background: "white", display: "flex", alignItems: "center", justifyContent: "center" }}>
            {photoElement}
          </div>
        </div>
      )}
    </>
  );

  // ── Back face inner content ──────────────────────────────────────────────
  const backFaceContent = (
    <>
      {/* Dark header band */}
      <div style={{ background: gradient, padding: "20px 20px 16px", position: "relative" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
          <img src="/mcn-logo.png" alt="MAS Callnet" style={{ height: 32, objectFit: "contain" }} />
          <span style={{
            fontSize: 9, fontWeight: 800, textTransform: "uppercase", letterSpacing: "0.18em",
            color: accent, background: `rgba(${accentRgb},0.15)`,
            border: `1px solid rgba(${accentRgb},0.35)`, padding: "3px 10px", borderRadius: 20,
          }}>
            Identity Card
          </span>
        </div>
        <p style={{ fontSize: 14, fontWeight: 900, color: "#ffffff", lineHeight: 1.2 }}>{fullName}</p>
        <p style={{ fontSize: 10, fontFamily: "monospace", color: "rgba(255,255,255,0.5)", marginTop: 3 }}>{employeeCode}</p>

        {/* Wave into white body */}
        <svg style={{ position: "absolute", bottom: 0, left: 0, width: "100%", display: "block" }}
          viewBox={`0 0 ${W} 20`} preserveAspectRatio="none">
          <path d={`M0,0 Q${W/2},20 ${W},0 L${W},20 L0,20 Z`} fill="#ffffff" />
        </svg>
      </div>

      {/* Accent line */}
      <div style={{ height: 3, background: accent }} />

      {/* White body */}
      <div style={{ padding: "14px 20px 24px", display: "flex", flexDirection: "column", gap: 14 }}>

        {/* Instructions */}
        <div>
          <p style={{ fontSize: 9, fontWeight: 800, textTransform: "uppercase", letterSpacing: "0.18em", color: accent, display: "flex", alignItems: "center", gap: 6, marginBottom: 7 }}>
            <span style={{ display: "inline-block", width: 16, height: 2, borderRadius: 1, background: accent }} />
            Terms & Conditions
          </p>
          <ul style={{ listStyle: "none", display: "flex", flexDirection: "column", gap: 5 }}>
            {INSTRUCTIONS.map((inst, i) => (
              <li key={i} style={{ display: "flex", alignItems: "flex-start", gap: 6, fontSize: 9.5, color: "#374151", lineHeight: 1.4 }}>
                <span style={{
                  marginTop: 2, flexShrink: 0, width: 13, height: 13, borderRadius: 3,
                  background: accent, display: "flex", alignItems: "center", justifyContent: "center",
                }}>
                  <svg width="7" height="6" viewBox="0 0 7 6" fill="none">
                    <path d="M1 3l2 2 3-4" stroke="white" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                </span>
                {inst}
              </li>
            ))}
          </ul>
        </div>

        {/* Branch Address */}
        <div>
          <p style={{ fontSize: 9, fontWeight: 800, textTransform: "uppercase", letterSpacing: "0.18em", color: accent, display: "flex", alignItems: "center", gap: 6, marginBottom: 5 }}>
            <span style={{ display: "inline-block", width: 16, height: 2, borderRadius: 1, background: accent }} />
            Branch Address
          </p>
          {addressLines.length > 0 ? (
            <div style={{ display: "flex", flexDirection: "column", gap: 1 }}>
              {addressLines.map((line, i) => (
                <p key={i} style={{ fontSize: 10, lineHeight: 1.4, color: i === 0 ? "#111827" : "#6b7280", fontWeight: i === 0 ? 700 : 400 }}>
                  {line}
                </p>
              ))}
            </div>
          ) : (
            <p style={{ fontSize: 10, color: "#9ca3af", fontStyle: "italic" }}>Contact HR for branch address details.</p>
          )}
        </div>

        {/* HR Helpdesk */}
        <div>
          <p style={{ fontSize: 9, fontWeight: 800, textTransform: "uppercase", letterSpacing: "0.18em", color: accent, display: "flex", alignItems: "center", gap: 6, marginBottom: 5 }}>
            <span style={{ display: "inline-block", width: 16, height: 2, borderRadius: 1, background: accent }} />
            HR Helpdesk
          </p>
          <p style={{ fontSize: 10.5, fontWeight: 700, color: "#111827" }}>{hrContact}</p>
          <p style={{ fontSize: 10, color: "#6b7280", marginTop: 1 }}>Mas Callnet India Pvt. Ltd.</p>
        </div>
      </div>

      {/* Bottom accent strip */}
      <div style={{ position: "absolute", bottom: 0, left: 0, right: 0, height: 6, background: gradient }} />
    </>
  );

  // ── Print mode: flat layout, no 3D transforms ────────────────────────────
  if (printMode) {
    return (
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 24 }}>
        {/* Front */}
        <div style={{
          position: "relative", width: W, height: H,
          borderRadius: 20, overflow: "hidden",
          boxShadow: premium
            ? "0 28px 80px rgba(0,0,0,0.65), 0 0 0 1px rgba(212,160,23,0.2)"
            : "0 24px 64px rgba(0,0,0,0.5)",
          pageBreakInside: "avoid", breakInside: "avoid",
          pageBreakAfter: "always", breakAfter: "page",
        } as React.CSSProperties}>
          {frontFaceContent}
        </div>
        {/* Back */}
        <div style={{
          position: "relative", width: W, height: H,
          borderRadius: 20, overflow: "hidden",
          border: "1px solid #d1d5db",
          background: "#ffffff",
          pageBreakInside: "avoid", breakInside: "avoid",
        } as React.CSSProperties}>
          {backFaceContent}
        </div>
      </div>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 12 }}>
      {/* Flip container */}
      <div
        style={{ width: W, height: H, perspective: 1200, cursor: "pointer", position: "relative" }}
        onClick={() => setFlipped((f) => !f)}
        title={flipped ? "Click to see front" : "Click to see back"}
      >
        <div
          style={{
            width: "100%", height: "100%", position: "relative",
            transformStyle: "preserve-3d",
            transition: "transform 0.55s cubic-bezier(0.4, 0, 0.2, 1)",
            transform: flipped ? "rotateY(180deg)" : "rotateY(0deg)",
          }}
        >

          {/* ════════════════════════════════
              FRONT FACE
          ════════════════════════════════ */}
          <div id="id-card-front-face" style={{
            position: "absolute", inset: 0, borderRadius: 20, overflow: "hidden",
            boxShadow: premium
              ? "0 28px 80px rgba(0,0,0,0.65), 0 0 0 1px rgba(212,160,23,0.2)"
              : "0 24px 64px rgba(0,0,0,0.5)",
            backfaceVisibility: "hidden",
          }}>
            {frontFaceContent}
          </div>

          {/* ════════════════════════════════
              BACK FACE
          ════════════════════════════════ */}
          <div id="id-card-back-face" style={{
            position: "absolute", inset: 0, borderRadius: 20, overflow: "hidden",
            boxShadow: premium
              ? "0 28px 80px rgba(0,0,0,0.65), 0 0 0 1px rgba(212,160,23,0.2)"
              : "0 24px 64px rgba(0,0,0,0.5)",
            backfaceVisibility: "hidden",
            transform: "rotateY(180deg)",
            background: "#ffffff",
          }}>
            {backFaceContent}
          </div>

        </div>
      </div>

      {/* Flip button */}
      <button
        className="id-card-flip-btn"
        onClick={() => setFlipped((f) => !f)}
        style={{
          display: "inline-flex", alignItems: "center", gap: 6, borderRadius: 20,
          border: `1.5px solid rgba(${accentRgb},0.4)`,
          background: `rgba(${accentRgb},0.1)`,
          color: accent, padding: "7px 16px", fontSize: 11, fontWeight: 700, cursor: "pointer",
        }}
      >
        <svg width="14" height="14" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5}
            d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
        </svg>
        {flipped ? "Show Front" : "Show Back"}
      </button>
    </div>
  );
}
