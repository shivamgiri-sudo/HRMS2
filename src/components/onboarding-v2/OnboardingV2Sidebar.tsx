import React from 'react';
import { CheckCircle, Circle, Lock } from 'lucide-react';

export const SECTIONS = [
  { idx: 0, label: 'Welcome & Consent',    short: 'Welcome'    },
  { idx: 1, label: 'Personal Information', short: 'Personal'   },
  { idx: 2, label: 'Address Details',      short: 'Address'    },
  { idx: 3, label: 'KYC Documents',        short: 'KYC'        },
  { idx: 4, label: 'Statutory IDs',        short: 'Statutory'  },
  { idx: 5, label: 'Bank Details',         short: 'Bank'       },
  { idx: 6, label: 'Qualifications',       short: 'Education'  },
  { idx: 7, label: 'Work Experience',      short: 'Experience' },
  { idx: 8, label: 'Family & Nominees',    short: 'Family'     },
  { idx: 9, label: 'Court Verification',   short: 'Court'      },
  { idx: 10, label: 'Review & Submit',     short: 'Submit'     },
];

interface OnboardingV2SidebarProps {
  current: number;
  completed: Set<number>;
  hasConsent: boolean;
  onNavigate: (idx: number) => void;
}

export function OnboardingV2Sidebar({ current, completed, hasConsent, onNavigate }: OnboardingV2SidebarProps) {
  return (
    <nav className="w-64 shrink-0 bg-white border-r border-gray-200 flex flex-col py-6 px-3 min-h-screen">
      <div className="mb-6 px-3">
        <p className="text-xs font-bold text-gray-400 uppercase tracking-widest">Onboarding Steps</p>
      </div>
      <ol className="space-y-1 flex-1">
        {SECTIONS.map(s => {
          const isActive = s.idx === current;
          const isDone = completed.has(s.idx);
          const isLocked = s.idx > 0 && !hasConsent;

          return (
            <li key={s.idx}>
              <button
                type="button"
                disabled={isLocked}
                onClick={() => !isLocked && onNavigate(s.idx)}
                className={[
                  'w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm transition-colors text-left',
                  isActive  ? 'bg-purple-50 text-purple-700 font-semibold' : '',
                  isDone && !isActive ? 'text-green-700 hover:bg-green-50' : '',
                  !isDone && !isActive && !isLocked ? 'text-gray-600 hover:bg-gray-50' : '',
                  isLocked  ? 'text-gray-300 cursor-not-allowed' : 'cursor-pointer',
                ].filter(Boolean).join(' ')}
              >
                <span className="shrink-0">
                  {isLocked ? (
                    <Lock size={14} className="text-gray-300" />
                  ) : isDone ? (
                    <CheckCircle size={14} className="text-green-500" />
                  ) : (
                    <Circle size={14} className={isActive ? 'text-purple-500' : 'text-gray-300'} />
                  )}
                </span>
                <span className="flex-1 leading-tight">{s.label}</span>
                {isActive && <span className="w-1.5 h-1.5 rounded-full bg-purple-500 shrink-0" />}
              </button>
            </li>
          );
        })}
      </ol>
      <div className="px-3 pt-4 border-t border-gray-100">
        <p className="text-xs text-gray-400">Progress auto-saves as you go.</p>
      </div>
    </nav>
  );
}
