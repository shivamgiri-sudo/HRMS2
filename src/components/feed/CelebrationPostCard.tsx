import { useEffect, useRef, useState } from "react";
import { Sparkles, Star, Trophy } from "lucide-react";
import { PostEngagementBar } from "@/components/feed/PostEngagementBar";
import { CommentThread } from "@/components/feed/CommentThread";
import { useReactToPost, type CompanyPost } from "@/hooks/useCompanyFeed";
import { formatRelativeTime } from "@/lib/companyFeedUtils";
import { apiBaseUrl } from "@/lib/apiBase";

const MCN_GREEN = "#3BAD49";
const API_BASE = apiBaseUrl();

/**
 * Fetches an employee photo with the same auth-header + blob-URL approach as
 * AuthedImage, but returns state instead of rendering — AuthedImage's own error state
 * is a plain "Image unavailable" text box, which reads as broken inside a small round
 * avatar. Only 22 of 1,120 active employees (2%, verified live 2026-08-28) have an
 * uploaded photo, so the no-photo path is the common case and needs a considered
 * fallback (initials), not an error box.
 */
function useEmployeePhoto(src: string | null): { url: string | null; failed: boolean } {
  const [url, setUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const objectUrlRef = useRef<string | null>(null);

  useEffect(() => {
    setUrl(null);
    setFailed(false);
    if (!src) return;

    let cancelled = false;
    const resolved = src.startsWith("http") ? src : `${API_BASE}${src}`;
    const token = localStorage.getItem("hrms_access_token");

    fetch(resolved, { headers: token ? { Authorization: `Bearer ${token}` } : {} })
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.blob();
      })
      .then((blob) => {
        if (cancelled) return;
        const objectUrl = URL.createObjectURL(blob);
        objectUrlRef.current = objectUrl;
        setUrl(objectUrl);
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });

    return () => {
      cancelled = true;
    };
  }, [src]);

  useEffect(() => {
    return () => {
      if (objectUrlRef.current) URL.revokeObjectURL(objectUrlRef.current);
    };
  }, []);

  return { url, failed };
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  return (parts[0][0] + (parts[1]?.[0] ?? "")).toUpperCase();
}

/**
 * The celebrated employee's real photo when one exists, an initials avatar in the
 * card's own accent colours otherwise. Either way this is the primary visual — the
 * illustrative cake/trophy/diya icon is a small corner badge, not the main image,
 * because a birthday post is about a specific person, not a stock illustration of cake.
 */
function CelebrantAvatar({
  name,
  photoUrl,
  ringColor,
  glowColor,
  initialsBg,
  badgeIcon,
  badgeBg,
}: {
  name: string;
  photoUrl: string | null;
  ringColor: string;
  glowColor: string;
  initialsBg: string;
  badgeIcon: React.ReactNode;
  badgeBg: string;
}) {
  const { url, failed } = useEmployeePhoto(photoUrl);
  const showPhoto = photoUrl && url && !failed;

  return (
    <div className="relative h-[84px] w-[84px] shrink-0">
      <div
        className="absolute inset-0 rounded-full blur-md opacity-60"
        style={{ background: glowColor }}
        aria-hidden
      />
      <div
        className="relative flex h-full w-full items-center justify-center overflow-hidden rounded-full bg-white"
        style={{ border: `3px solid ${ringColor}` }}
      >
        {showPhoto ? (
          <img src={url} alt={name} className="h-full w-full object-cover" />
        ) : (
          <div
            className="flex h-full w-full items-center justify-center text-xl font-extrabold text-white"
            style={{ background: initialsBg }}
          >
            {initials(name)}
          </div>
        )}
      </div>
      <div
        className="absolute -bottom-1 -right-1 flex h-8 w-8 items-center justify-center rounded-full text-base shadow-[0_2px_6px_rgba(0,0,0,0.18)]"
        style={{ background: badgeBg, border: "2px solid white" }}
        aria-hidden
      >
        {badgeIcon}
      </div>
    </div>
  );
}

// Confetti dots — 8 scattered circles, CSS animation via inline keyframes injected once
let confettiStyleInjected = false;
function ensureConfettiStyle() {
  if (confettiStyleInjected || typeof document === "undefined") return;
  confettiStyleInjected = true;
  const style = document.createElement("style");
  style.textContent = `
    @keyframes confettiFall {
      0% { transform: translateY(-6px) rotate(0deg); opacity: 1; }
      100% { transform: translateY(14px) rotate(180deg); opacity: 0; }
    }
    @keyframes sparkleTwinkle {
      0%, 100% { opacity: 0.35; transform: scale(0.85); }
      50% { opacity: 1; transform: scale(1.1); }
    }
    @media (prefers-reduced-motion: reduce) {
      .confetti-dot, .sparkle-dot { animation: none !important; }
    }
  `;
  document.head.appendChild(style);
}

const CONFETTI_COLORS = ["#fb7185", "#a855f7", "#38bdf8", "#fbbf24", "#f472b6", "#c084fc", "#fb923c", "#34d399"];
const CONFETTI_POSITIONS = [
  { top: 8, left: 12 }, { top: 4, left: 28 }, { top: 10, left: 44 }, { top: 6, left: 60 },
  { top: 14, left: 18 }, { top: 8, left: 50 }, { top: 16, left: 34 }, { top: 5, left: 70 },
];

function ConfettiDots() {
  ensureConfettiStyle();
  return (
    <div className="pointer-events-none absolute inset-x-0 top-0 h-16 overflow-hidden" aria-hidden>
      {CONFETTI_POSITIONS.map((pos, i) => (
        <div
          key={i}
          className="confetti-dot absolute h-2.5 w-2.5 rounded-full"
          style={{
            background: CONFETTI_COLORS[i],
            top: `${pos.top}px`,
            left: `${pos.left}%`,
            animation: `confettiFall ${1.4 + i * 0.15}s ease-in-out ${i * 0.12}s infinite alternate`,
          }}
        />
      ))}
    </div>
  );
}

const SPARKLE_POSITIONS = [
  { top: 6, left: 10 }, { top: 12, left: 30 }, { top: 4, left: 50 },
  { top: 10, left: 68 }, { top: 6, left: 86 },
];

function SparkleDots() {
  ensureConfettiStyle();
  return (
    <div className="pointer-events-none absolute inset-x-0 top-0 h-16 overflow-hidden" aria-hidden>
      {SPARKLE_POSITIONS.map((pos, i) => (
        <Sparkles
          key={i}
          className="sparkle-dot absolute h-3.5 w-3.5 text-white/80"
          style={{
            top: `${pos.top}px`,
            left: `${pos.left}%`,
            animation: `sparkleTwinkle ${1.6 + i * 0.2}s ease-in-out ${i * 0.15}s infinite`,
          }}
        />
      ))}
    </div>
  );
}

function StarRow() {
  return (
    <div className="flex items-center justify-center gap-1" aria-hidden>
      {[...Array(5)].map((_, i) => (
        <Star
          key={i}
          className="h-4 w-4 fill-amber-400 text-amber-400"
          style={{ animation: `pulse ${1.2 + i * 0.15}s ease-in-out ${i * 0.1}s infinite alternate` }}
        />
      ))}
    </div>
  );
}

/** MCN monogram badge shown in every celebration header, top-right. */
function BrandBadge() {
  return (
    <div
      className="relative z-10 flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-white text-sm font-extrabold"
      style={{ background: "rgba(255,255,255,0.18)", border: "1.5px solid rgba(255,255,255,0.35)" }}
      aria-label="MAS Callnet"
    >
      M
    </div>
  );
}

/**
 * Festivals get a family, not one fixed illustration for all 30 configured in
 * festival_calendar (verified live 2026-08-28). The family drives the header gradient
 * and ambient motif; the emoji itself is the one festival_calendar already curated per
 * festival — that IS the per-festival image, just never surfaced prominently before.
 */
type FestivalFamily = "lights" | "colour" | "lunar" | "patriotic" | "devotional";

function festivalFamily(name: string): FestivalFamily {
  const n = name.toLowerCase();
  if (/diwali|lohri|chhath|christmas|deepavali/.test(n)) return "lights";
  if (/holi/.test(n)) return "colour";
  if (/eid|muharram/.test(n)) return "lunar";
  if (/independence|republic/.test(n)) return "patriotic";
  return "devotional";
}

const FESTIVAL_THEME: Record<FestivalFamily, {
  headerGradient: string;
  cardBg: string;
  border: string;
  ring: string;
  glow: string;
  initialsBg: string;
  decor: string[];
}> = {
  lights: {
    headerGradient: "linear-gradient(135deg, #7c2d12 0%, #c2410c 55%, #f59e0b 100%)",
    cardBg: "linear-gradient(160deg, #fff7ed 0%, #fef3c7 100%)",
    border: "#fdba74", ring: "#f59e0b", glow: "rgba(245,158,11,0.35)", initialsBg: "linear-gradient(135deg,#c2410c,#f59e0b)",
    decor: ["🪔", "✨", "🎇", "🌟"],
  },
  colour: {
    headerGradient: "linear-gradient(135deg, #a21caf 0%, #db2777 35%, #f59e0b 70%, #22c55e 100%)",
    cardBg: "linear-gradient(160deg, #fdf4ff 0%, #ecfeff 100%)",
    border: "#f0abfc", ring: "#d946ef", glow: "rgba(217,70,239,0.32)", initialsBg: "linear-gradient(135deg,#db2777,#f59e0b)",
    decor: ["🎨", "💦", "🌈", "🎊"],
  },
  lunar: {
    headerGradient: "linear-gradient(135deg, #0c1e3d 0%, #1e3a5f 50%, #3b6ba5 100%)",
    cardBg: "linear-gradient(160deg, #f0f5fb 0%, #e6edf7 100%)",
    border: "#93c5fd", ring: "#3b82f6", glow: "rgba(59,130,246,0.3)", initialsBg: "linear-gradient(135deg,#1e3a5f,#3b82f6)",
    decor: ["🌙", "⭐", "🕌", "✨"],
  },
  patriotic: {
    headerGradient: "linear-gradient(135deg, #b45309 0%, #f1f5f9 45%, #15803d 100%)",
    cardBg: "linear-gradient(160deg, #fff7ed 0%, #f0fdf4 100%)",
    border: "#bbf7d0", ring: "#15803d", glow: "rgba(21,128,61,0.25)", initialsBg: "linear-gradient(135deg,#b45309,#15803d)",
    decor: ["🇮🇳", "🎉", "🕊️", "⭐"],
  },
  devotional: {
    headerGradient: "linear-gradient(135deg, #9a3412 0%, #ea580c 55%, #f97316 100%)",
    cardBg: "linear-gradient(160deg, #fff7ed 0%, #fff1e6 100%)",
    border: "#fdba74", ring: "#f97316", glow: "rgba(249,115,22,0.32)", initialsBg: "linear-gradient(135deg,#9a3412,#f97316)",
    decor: ["🪷", "✨", "🎇", "🌼"],
  },
};

interface CelebrationPostCardProps {
  post: CompanyPost;
  currentUserId?: string;
  showEngagement?: boolean;
}

export function CelebrationPostCard({
  post,
  currentUserId,
  showEngagement = true,
}: CelebrationPostCardProps) {
  const [commentsOpen, setCommentsOpen] = useState(false);
  const reactMutation = useReactToPost();

  const timestamp = formatRelativeTime(post.approved_at ?? post.submitted_at ?? post.created_at);
  const bodyText = post.content_text?.trim() ?? "";
  const photoUrl = post.celebrated_employee_avatar;

  const engagement = showEngagement && (
    <>
      <div className="border-t pt-2" style={{ borderColor: "var(--celebration-border, #e2e8f0)" }}>
        <PostEngagementBar
          postId={post.id}
          likeCount={post.like_count ?? 0}
          dislikeCount={post.dislike_count ?? 0}
          commentCount={post.comment_count ?? 0}
          myReaction={post.my_reaction ?? null}
          onReact={(reaction) => reactMutation.mutate({ postId: post.id, reaction })}
          onCommentClick={() => setCommentsOpen((v) => !v)}
          commentsOpen={commentsOpen}
        />
      </div>
      <CommentThread postId={post.id} open={commentsOpen} currentUserId={currentUserId} isModerator={false} />
    </>
  );

  // ── Festival ──────────────────────────────────────────────────────────────
  if (post.post_type === "festival") {
    // festival-greeting.cron.ts writes "{emoji} {subject}\n\n{body}" — split the
    // headline out so it reads as a title, and reuse festival_calendar's own curated
    // emoji as the primary image instead of one fixed illustration for every festival.
    const [firstLine, ...rest] = bodyText.split("\n\n");
    const headlineMatch = firstLine?.match(/^(\S+)\s+(.+)$/);
    const festivalEmoji = headlineMatch?.[1] ?? "🎉";
    const festivalTitle = headlineMatch?.[2] ?? firstLine ?? "Season's Greetings!";
    const restText = rest.join("\n\n").trim();
    const theme = FESTIVAL_THEME[festivalFamily(festivalTitle)];

    return (
      <article
        className="group relative overflow-hidden rounded-2xl border shadow-[var(--shadow-sm)] transition-shadow duration-200 hover:shadow-[var(--shadow-md)]"
        style={{ borderColor: theme.border, background: theme.cardBg, ["--celebration-border" as string]: theme.border }}
      >
        <div className="relative flex items-center justify-between overflow-hidden px-5 py-4" style={{ background: theme.headerGradient }}>
          <SparkleDots />
          <div className="relative z-10 flex items-center gap-3 min-w-0">
            <span className="text-2xl shrink-0" aria-hidden>{festivalEmoji}</span>
            <div className="min-w-0">
              <p className="text-sm font-bold text-white leading-tight truncate">{festivalTitle}</p>
              <p className="text-xs text-white/75 leading-tight">MAS Callnet Family</p>
            </div>
          </div>
          <BrandBadge />
        </div>

        <div className="space-y-3 px-5 py-4">
          <div className="flex flex-col items-center gap-2 text-center">
            <div
              className="flex h-[72px] w-[72px] shrink-0 items-center justify-center rounded-full text-4xl"
              style={{ background: "white", border: `3px solid ${theme.ring}`, boxShadow: `0 0 0 3px ${theme.glow}` }}
              aria-hidden
            >
              {festivalEmoji}
            </div>
            <p className="text-xs text-slate-400">{timestamp}</p>
          </div>

          {restText && (
            <p className="whitespace-pre-wrap text-[14px] leading-6 text-slate-700 text-center">{restText}</p>
          )}

          <div className="flex items-center justify-center gap-4 py-1 text-2xl" aria-hidden>
            {theme.decor.map((d, i) => <span key={i}>{d}</span>)}
          </div>

          {engagement}
        </div>
      </article>
    );
  }

  // ── Birthday ──────────────────────────────────────────────────────────────
  if (post.post_type === "birthday") {
    const celebrantName = post.celebrated_employee_name ?? post.author_name
      ?? (bodyText.match(/Wishing (.+?) a very/)?.[1] ?? "A colleague");

    return (
      <article
        className="group relative overflow-hidden rounded-2xl border shadow-[var(--shadow-sm)] transition-shadow duration-200 hover:shadow-[var(--shadow-md)]"
        style={{ borderColor: "#f5d0fe", background: "linear-gradient(160deg, #fdf4ff 0%, #fff1f7 100%)", ["--celebration-border" as string]: "#fbcfe8" }}
      >
        <div className="relative flex items-center justify-between overflow-hidden px-5 py-4" style={{ background: "linear-gradient(135deg, #a21caf 0%, #db2777 50%, #f97316 100%)" }}>
          <ConfettiDots />
          <div className="relative z-10 flex items-center gap-3">
            <span className="text-2xl" aria-hidden>🎂</span>
            <div>
              <p className="text-sm font-bold text-white leading-tight">Happy Birthday!</p>
              <p className="text-xs text-pink-100 leading-tight">MAS Callnet Family</p>
            </div>
          </div>
          <BrandBadge />
        </div>

        <div className="space-y-3 px-5 py-4">
          <div className="flex flex-col items-center gap-2.5 text-center">
            <CelebrantAvatar
              name={celebrantName}
              photoUrl={photoUrl}
              ringColor={MCN_GREEN}
              glowColor="rgba(219,39,119,0.35)"
              initialsBg="linear-gradient(135deg,#a21caf,#f97316)"
              badgeIcon="🎂"
              badgeBg="#fdf2f8"
            />
            <div>
              <p className="text-base font-bold text-slate-800">{celebrantName}</p>
              {post.celebrated_employee_code && (
                <p className="text-[11px] font-medium text-fuchsia-400">{post.celebrated_employee_code}</p>
              )}
              <p className="text-xs text-slate-400 mt-0.5">{timestamp}</p>
            </div>
          </div>

          {bodyText && (
            <p className="whitespace-pre-wrap text-[14px] leading-6 text-slate-700 text-center">{bodyText}</p>
          )}

          <div className="flex items-center justify-center gap-4 py-1 text-2xl" aria-hidden>
            <span>🎈</span><span>🌸</span><span>🎁</span><span>🎊</span><span>🌼</span>
          </div>

          {engagement}
        </div>
      </article>
    );
  }

  // ── Anniversary ───────────────────────────────────────────────────────────
  const celebrantName = post.celebrated_employee_name ?? post.author_name
    ?? (bodyText.match(/Congratulations (.+?) on/)?.[1] ?? "A colleague");
  const yearsMatch = bodyText.match(/completing (\d+) wonderful|(\d+)(?:st|nd|rd|th) Work Anniversary/);
  const years = yearsMatch ? Number(yearsMatch[1] ?? yearsMatch[2]) : null;

  // Milestone tiers give a 10-year anniversary a visibly different treatment from a
  // 1-year one — the years earned are the thing worth encoding in the design, not just
  // stating in the copy.
  const tier: "standard" | "milestone" | "legacy" =
    years !== null && years >= 10 ? "legacy" : years !== null && years >= 5 ? "milestone" : "standard";
  const tierHeaderGradient =
    tier === "legacy" ? "linear-gradient(135deg, #4c1d95 0%, #7c3aed 55%, #a855f7 100%)"
      : tier === "milestone" ? "linear-gradient(135deg, #92400e 0%, #d97706 50%, #f59e0b 100%)"
        : "linear-gradient(135deg, #073f78 0%, #1B6AB5 100%)";
  const tierBadgeGradient =
    tier === "legacy" ? "linear-gradient(135deg, #7c3aed, #a855f7)"
      : tier === "milestone" ? "linear-gradient(135deg, #d97706, #f59e0b)"
        : `linear-gradient(135deg, ${MCN_GREEN}, #2a8f38)`;
  const tierRing = tier === "legacy" ? "#a855f7" : "#F59E0B";
  const tierGlow = tier === "legacy" ? "rgba(168,85,247,0.35)" : "rgba(245,158,11,0.32)";
  const tierInitialsBg = tier === "legacy" ? "linear-gradient(135deg,#6d28d9,#a855f7)" : "linear-gradient(135deg,#073f78,#1B6AB5)";
  const tierLabel = tier === "legacy" ? "Legacy Milestone" : tier === "milestone" ? "Milestone" : null;

  return (
    <article
      className="group relative overflow-hidden rounded-2xl border shadow-[var(--shadow-sm)] transition-shadow duration-200 hover:shadow-[var(--shadow-md)]"
      style={{
        borderColor: tier === "legacy" ? "#e9d5ff" : tier === "milestone" ? "#fde68a" : "#bfdbfe",
        background: tier === "legacy" ? "linear-gradient(160deg, #faf5ff 0%, #f3e8ff 100%)"
          : tier === "milestone" ? "linear-gradient(160deg, #fffbeb 0%, #fef3c7 100%)"
            : "linear-gradient(160deg, #f8fafc 0%, #eff6ff 100%)",
        ["--celebration-border" as string]: tier === "legacy" ? "#e9d5ff" : tier === "milestone" ? "#fde68a" : "#bfdbfe",
      }}
    >
      <div className="relative flex items-center justify-between overflow-hidden px-5 py-4" style={{ background: tierHeaderGradient }}>
        {tier === "legacy" && <SparkleDots />}
        <div className="relative z-10 flex items-center gap-3">
          <span className="text-2xl" aria-hidden>⭐</span>
          <div>
            <p className="text-sm font-bold text-white leading-tight">Work Anniversary</p>
            <p className="text-xs text-white/80 leading-tight">MAS Callnet Family</p>
          </div>
        </div>
        <BrandBadge />
      </div>

      <div className="space-y-3 px-5 py-4">
        <div className="flex flex-col items-center gap-2.5 text-center">
          <CelebrantAvatar
            name={celebrantName}
            photoUrl={photoUrl}
            ringColor={tierRing}
            glowColor={tierGlow}
            initialsBg={tierInitialsBg}
            badgeIcon="🏆"
            badgeBg={tier === "legacy" ? "#f5f3ff" : "#fffbeb"}
          />
          <div>
            <p className="text-base font-bold text-slate-800">{celebrantName}</p>
            {post.celebrated_employee_code && (
              <p className="text-[11px] font-medium" style={{ color: tier === "legacy" ? "#a855f7" : "#d97706" }}>
                {post.celebrated_employee_code}
              </p>
            )}
            <p className="text-xs text-slate-400 mt-0.5">{timestamp}</p>
          </div>
        </div>

        {years !== null && (
          <div className="flex flex-col items-center gap-1.5">
            <span
              className="inline-flex items-center gap-2 rounded-full px-4 py-1.5 text-sm font-bold text-white"
              style={{ background: tierBadgeGradient }}
            >
              <Trophy className="h-4 w-4" />
              {years} {years === 1 ? "Year" : "Years"} of Excellence
            </span>
            {tierLabel && (
              <span className="text-[10px] font-semibold uppercase tracking-[0.16em]" style={{ color: tier === "legacy" ? "#7c3aed" : "#d97706" }}>
                {tierLabel}
              </span>
            )}
          </div>
        )}

        <StarRow />

        {bodyText && (
          <p className="whitespace-pre-wrap text-[14px] leading-6 text-slate-700 text-center">{bodyText}</p>
        )}

        {engagement}
      </div>
    </article>
  );
}
