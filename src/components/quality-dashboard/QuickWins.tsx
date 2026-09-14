import React from 'react';
import { ChevronRight } from 'lucide-react';

interface QuickWin {
  id: string;
  label: string;
  icon: React.ReactNode;
  action: () => void;
  badge?: string;
  badgeColor?: 'red' | 'yellow' | 'green' | 'blue';
}

interface QuickWinsProps {
  items?: QuickWin[];
  onViewReviews?: () => void;
  onViewWeakness?: () => void;
  onViewCoaching?: () => void;
  callsAwaitingReview?: number;
  coachingFlags?: number;
  topWeakness?: string;
  isLoading?: boolean;
}

export const QuickWins: React.FC<QuickWinsProps> = ({
  items,
  onViewReviews,
  onViewWeakness,
  onViewCoaching,
  callsAwaitingReview = 0,
  coachingFlags = 0,
  topWeakness = 'Soft Skills',
  isLoading = false,
}) => {
  const getBadgeStyle = (color?: string) => {
    switch (color) {
      case 'red':
        return 'bg-red-100 text-red-800';
      case 'yellow':
        return 'bg-yellow-100 text-yellow-800';
      case 'green':
        return 'bg-green-100 text-green-800';
      case 'blue':
        return 'bg-blue-100 text-blue-800';
      default:
        return 'bg-gray-100 text-gray-800';
    }
  };

  const defaultItems: QuickWin[] = items || [
    {
      id: 'reviews',
      label: `Review Calls (${callsAwaitingReview})`,
      icon: (
        <svg
          className="w-6 h-6"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 20h14a2 2 0 002-2V6a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z"
          />
        </svg>
      ),
      action: onViewReviews || (() => {}),
      badge: callsAwaitingReview > 0 ? String(callsAwaitingReview) : undefined,
      badgeColor: callsAwaitingReview > 0 ? 'red' : undefined,
    },
    {
      id: 'weakness',
      label: `Address ${topWeakness}`,
      icon: (
        <svg
          className="w-6 h-6"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M13 10V3L4 14h7v7l9-11h-7z"
          />
        </svg>
      ),
      action: onViewWeakness || (() => {}),
      badgeColor: 'yellow',
    },
    {
      id: 'coaching',
      label: `Coaching Notes (${coachingFlags})`,
      icon: (
        <svg
          className="w-6 h-6"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"
          />
        </svg>
      ),
      action: onViewCoaching || (() => {}),
      badge: coachingFlags > 0 ? String(coachingFlags) : undefined,
      badgeColor: coachingFlags > 0 ? 'blue' : undefined,
    },
    {
      id: 'improvement',
      label: 'Improvement Plan',
      icon: (
        <svg
          className="w-6 h-6"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M13 10V3L4 14h7v7l9-11h-7z"
          />
        </svg>
      ),
      action: () => {},
      badgeColor: 'green',
    },
    {
      id: 'metrics',
      label: 'View Full Metrics',
      icon: (
        <svg
          className="w-6 h-6"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z"
          />
        </svg>
      ),
      action: () => {},
    },
    {
      id: 'feedback',
      label: 'Request Feedback',
      icon: (
        <svg
          className="w-6 h-6"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z"
          />
        </svg>
      ),
      action: () => {},
    },
  ];

  if (isLoading) {
    return (
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3 animate-pulse">
        {[...Array(6)].map((_, i) => (
          <div
            key={i}
            className="h-24 bg-gray-200 rounded-lg"
          ></div>
        ))}
      </div>
    );
  }

  return (
    <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
      {defaultItems.map((item) => (
        <button
          key={item.id}
          onClick={item.action}
          className="relative p-4 bg-white rounded-lg shadow hover:shadow-md transition-shadow border border-gray-200 hover:border-gray-300 flex flex-col items-center justify-center text-center group"
        >
          {/* Badge */}
          {item.badge && (
            <div
              className={`absolute top-2 right-2 px-2 py-1 rounded-full text-xs font-semibold ${getBadgeStyle(
                item.badgeColor
              )}`}
            >
              {item.badge}
            </div>
          )}

          {/* Icon */}
          <div className="text-gray-600 group-hover:text-blue-600 transition-colors mb-2">
            {item.icon}
          </div>

          {/* Label */}
          <p className="text-sm font-medium text-gray-700 group-hover:text-gray-900 line-clamp-2">
            {item.label}
          </p>

          {/* Arrow */}
          <ChevronRight className="w-4 h-4 text-gray-400 group-hover:text-blue-600 transition-colors mt-2 opacity-0 group-hover:opacity-100" />
        </button>
      ))}
    </div>
  );
};

export default QuickWins;
