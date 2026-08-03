import { useState } from "react";
import { Star, Trophy } from "lucide-react";
import { PostEngagementBar } from "@/components/feed/PostEngagementBar";
import { CommentThread } from "@/components/feed/CommentThread";
import { useReactToPost, type CompanyPost } from "@/hooks/useCompanyFeed";
import { formatRelativeTime } from "@/lib/companyFeedUtils";

const MCN_NAVY = "#073f78";
const MCN_BLUE = "#1B6AB5";
const MCN_GREEN = "#3BAD49";

// Inline SVG fallbacks — no external image deps
function BirthdaySVG() {
  return (
    <svg width="72" height="72" viewBox="0 0 72 72" fill="none" xmlns="http://www.w3.org/2000/svg" aria-label="Birthday cake">
      {/* Plate */}
      <ellipse cx="36" cy="56" rx="26" ry="6" fill="#f9a8d4" />
      {/* Cake bottom tier */}
      <rect x="12" y="42" width="48" height="16" rx="4" fill="#fbcfe8" />
      {/* Cake top tier */}
      <rect x="20" y="28" width="32" height="16" rx="4" fill="#f9a8d4" />
      {/* Candles */}
      <rect x="24" y="18" width="5" height="10" rx="2" fill="#E8231A" />
      <rect x="33.5" y="16" width="5" height="12" rx="2" fill="#1B6AB5" />
      <rect x="43" y="18" width="5" height="10" rx="2" fill="#3BAD49" />
      {/* Flames */}
      <ellipse cx="26.5" cy="17" rx="2.5" ry="3.5" fill="#fbbf24" />
      <ellipse cx="36" cy="15" rx="2.5" ry="3.5" fill="#fbbf24" />
      <ellipse cx="45.5" cy="17" rx="2.5" ry="3.5" fill="#fbbf24" />
      {/* Icing dots */}
      <circle cx="22" cy="50" r="2" fill="white" />
      <circle cx="30" cy="50" r="2" fill="white" />
      <circle cx="38" cy="50" r="2" fill="white" />
      <circle cx="46" cy="50" r="2" fill="white" />
      <circle cx="54" cy="50" r="2" fill="white" />
      {/* Flowers */}
      <circle cx="10" cy="28" r="4" fill="#fce7f3" />
      <circle cx="10" cy="28" r="2" fill="#f9a8d4" />
      <circle cx="62" cy="30" r="4" fill="#fce7f3" />
      <circle cx="62" cy="30" r="2" fill="#f9a8d4" />
    </svg>
  );
}

function AnniversarySVG() {
  return (
    <svg width="72" height="72" viewBox="0 0 72 72" fill="none" xmlns="http://www.w3.org/2000/svg" aria-label="Work anniversary trophy">
      {/* Trophy cup */}
      <path d="M24 8h24v24c0 8-6 14-12 16-6-2-12-8-12-16V8Z" fill="#fbbf24" />
      <path d="M24 8h24v4H24Z" fill="#f59e0b" />
      {/* Handles */}
      <path d="M24 14 Q14 14 14 22 Q14 30 24 30" stroke="#f59e0b" strokeWidth="3" fill="none" strokeLinecap="round" />
      <path d="M48 14 Q58 14 58 22 Q58 30 48 30" stroke="#f59e0b" strokeWidth="3" fill="none" strokeLinecap="round" />
      {/* Base stem */}
      <rect x="32" y="48" width="8" height="8" fill="#f59e0b" />
      {/* Base */}
      <rect x="22" y="56" width="28" height="6" rx="2" fill="#fbbf24" />
      {/* Star on trophy */}
      <path d="M36 20 l1.5 4.5h4.7l-3.8 2.8 1.5 4.5L36 29l-3.9 2.8 1.5-4.5-3.8-2.8h4.7Z" fill="white" />
      {/* Rays */}
      <line x1="36" y1="4" x2="36" y2="6" stroke="#fbbf24" strokeWidth="2" strokeLinecap="round" />
      <line x1="44" y1="6" x2="43" y2="8" stroke="#fbbf24" strokeWidth="2" strokeLinecap="round" />
      <line x1="28" y1="6" x2="29" y2="8" stroke="#fbbf24" strokeWidth="2" strokeLinecap="round" />
    </svg>
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
    @media (prefers-reduced-motion: reduce) {
      .confetti-dot { animation: none !important; }
    }
  `;
  document.head.appendChild(style);
}

const CONFETTI_COLORS = ["#E8231A", "#1B6AB5", "#3BAD49", "#fbbf24", "#f9a8d4", "#a78bfa", "#fb923c", "#34d399"];
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

function StarRow() {
  return (
    <div className="flex items-center justify-center gap-1" aria-hidden>
      {[...Array(5)].map((_, i) => (
        <Star
          key={i}
          className="h-4 w-4 fill-amber-400 text-amber-400"
          style={{
            animation: `pulse ${1.2 + i * 0.15}s ease-in-out ${i * 0.1}s infinite alternate`,
          }}
        />
      ))}
    </div>
  );
}

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

  const isBirthday = post.post_type === "birthday";
  const timestamp = formatRelativeTime(post.approved_at ?? post.submitted_at ?? post.created_at);
  const bodyText = post.content_text?.trim() ?? "";

  // Extract name from content text for display (first word-sequence before "a very" / "on completing")
  const celebrantName = post.author_name ?? (bodyText.match(/Wishing (.+?) a very|Congratulations (.+?) on/)?.[1] ?? "A colleague");

  if (isBirthday) {
    return (
      <article className="group relative overflow-hidden rounded-2xl border border-pink-200 bg-gradient-to-br from-pink-50 to-rose-50 shadow-[var(--shadow-sm)] transition-shadow duration-200 hover:shadow-[var(--shadow-md)]">
        {/* MCN blue top accent */}
        <div className="absolute inset-x-0 top-0 h-1 rounded-t-2xl" style={{ background: MCN_BLUE }} />

        {/* Header */}
        <div
          className="relative flex items-center justify-between overflow-hidden px-5 py-4"
          style={{ background: `linear-gradient(135deg, ${MCN_NAVY} 0%, ${MCN_BLUE} 100%)` }}
        >
          <ConfettiDots />
          <div className="relative z-10 flex items-center gap-3">
            <span className="text-2xl" aria-hidden>🎂</span>
            <div>
              <p className="text-sm font-bold text-white leading-tight">Happy Birthday!</p>
              <p className="text-xs text-blue-200 leading-tight">MAS Callnet Family</p>
            </div>
          </div>
          {/* MCN logo placeholder — white M monogram */}
          <div
            className="relative z-10 flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-white text-sm font-extrabold"
            style={{ background: "rgba(255,255,255,0.18)", border: "1.5px solid rgba(255,255,255,0.35)" }}
            aria-label="MAS Callnet"
          >
            M
          </div>
        </div>

        {/* Body */}
        <div className="space-y-3 px-5 py-4">
          {/* Avatar + name */}
          <div className="flex flex-col items-center gap-2 text-center">
            <div
              className="flex h-[72px] w-[72px] shrink-0 items-center justify-center overflow-hidden rounded-full"
              style={{ border: `3px solid ${MCN_GREEN}`, boxShadow: `0 0 0 3px rgba(59,173,73,0.2)` }}
            >
              <BirthdaySVG />
            </div>
            <div>
              <p className="text-base font-bold text-slate-800">{celebrantName}</p>
              <p className="text-xs text-slate-400">{timestamp}</p>
            </div>
          </div>

          {/* Message */}
          {bodyText && (
            <p className="whitespace-pre-wrap text-[14px] leading-6 text-slate-700 text-center">
              {bodyText}
            </p>
          )}

          {/* Decoration row */}
          <div className="flex items-center justify-center gap-4 py-1 text-2xl" aria-hidden>
            <span>🎈</span>
            <span>🌸</span>
            <span>🎁</span>
            <span>🎊</span>
            <span>🌼</span>
          </div>

          {/* Engagement */}
          {showEngagement && (
            <>
              <div className="border-t border-pink-200 pt-2">
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
              <CommentThread
                postId={post.id}
                open={commentsOpen}
                currentUserId={currentUserId}
                isModerator={false}
              />
            </>
          )}
        </div>
      </article>
    );
  }

  // Anniversary card
  const yearsMatch = bodyText.match(/completing (\d+) wonderful/);
  const years = yearsMatch ? Number(yearsMatch[1]) : null;

  return (
    <article className="group relative overflow-hidden rounded-2xl border border-blue-200 bg-gradient-to-br from-slate-50 to-blue-50 shadow-[var(--shadow-sm)] transition-shadow duration-200 hover:shadow-[var(--shadow-md)]">
      {/* MCN navy top accent */}
      <div className="absolute inset-x-0 top-0 h-1 rounded-t-2xl" style={{ background: MCN_NAVY }} />

      {/* Header */}
      <div
        className="relative flex items-center justify-between overflow-hidden px-5 py-4"
        style={{ background: `linear-gradient(135deg, ${MCN_NAVY} 0%, #0d5aa7 100%)` }}
      >
        <div className="relative z-10 flex items-center gap-3">
          <span className="text-2xl" aria-hidden>⭐</span>
          <div>
            <p className="text-sm font-bold text-white leading-tight">Work Anniversary</p>
            <p className="text-xs text-blue-200 leading-tight">MAS Callnet Family</p>
          </div>
        </div>
        <div
          className="relative z-10 flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-white text-sm font-extrabold"
          style={{ background: "rgba(255,255,255,0.18)", border: "1.5px solid rgba(255,255,255,0.35)" }}
          aria-label="MAS Callnet"
        >
          M
        </div>
      </div>

      {/* Body */}
      <div className="space-y-3 px-5 py-4">
        {/* Avatar + name */}
        <div className="flex flex-col items-center gap-2 text-center">
          <div
            className="flex h-[72px] w-[72px] shrink-0 items-center justify-center overflow-hidden rounded-full"
            style={{ border: "3px solid #F59E0B", boxShadow: "0 0 0 3px rgba(245,158,11,0.2)" }}
          >
            <AnniversarySVG />
          </div>
          <div>
            <p className="text-base font-bold text-slate-800">{celebrantName}</p>
            <p className="text-xs text-slate-400">{timestamp}</p>
          </div>
        </div>

        {/* Year badge */}
        {years !== null && (
          <div className="flex justify-center">
            <span
              className="inline-flex items-center gap-2 rounded-full px-4 py-1.5 text-sm font-bold text-white"
              style={{ background: `linear-gradient(135deg, ${MCN_GREEN}, #2a8f38)` }}
            >
              <Trophy className="h-4 w-4" />
              {years} {years === 1 ? "Year" : "Years"} of Excellence
            </span>
          </div>
        )}

        {/* Star row */}
        <StarRow />

        {/* Message */}
        {bodyText && (
          <p className="whitespace-pre-wrap text-[14px] leading-6 text-slate-700 text-center">
            {bodyText}
          </p>
        )}

        {/* Engagement */}
        {showEngagement && (
          <>
            <div className="border-t border-blue-200 pt-2">
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
            <CommentThread
              postId={post.id}
              open={commentsOpen}
              currentUserId={currentUserId}
              isModerator={false}
            />
          </>
        )}
      </div>
    </article>
  );
}
