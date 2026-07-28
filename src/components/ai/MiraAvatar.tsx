import { cn } from '@/lib/utils';

export type MiraMood = 'idle' | 'listening' | 'thinking' | 'speaking' | 'happy' | 'error';

interface MiraAvatarProps {
  mood?: MiraMood;
  size?: 'sm' | 'md' | 'lg';
  className?: string;
  showStatus?: boolean;
}

const SIZE_CLASS = {
  sm: 'h-10 w-10',
  md: 'h-14 w-14',
  lg: 'h-24 w-24',
};

const STATUS_TEXT: Record<MiraMood, string> = {
  idle: 'Ready',
  listening: 'Listening',
  thinking: 'Thinking',
  speaking: 'Speaking',
  happy: 'Done',
  error: 'Needs attention',
};

export function MiraAvatar({
  mood = 'idle',
  size = 'md',
  className,
  showStatus = false,
}: MiraAvatarProps) {
  return (
    <div className={cn('inline-flex flex-col items-center gap-1.5', className)} aria-label={`Mira is ${STATUS_TEXT[mood].toLowerCase()}`}>
      <div className={cn('relative shrink-0', SIZE_CLASS[size])}>
        {(mood === 'listening' || mood === 'speaking') && (
          <>
            <span className="absolute inset-[-5px] rounded-full border-2 border-cyan-300/70 animate-ping" />
            <span className="absolute inset-[-9px] rounded-full border border-violet-300/50 animate-pulse" />
          </>
        )}

        <div
          className={cn(
            'absolute inset-0 overflow-hidden rounded-full border border-white/70 bg-gradient-to-br from-violet-600 via-blue-600 to-cyan-500 shadow-[0_10px_30px_rgba(79,70,229,0.35)]',
            mood === 'thinking' && 'animate-pulse',
            mood === 'error' && 'from-rose-600 via-red-500 to-orange-500',
          )}
        >
          <div className="absolute inset-x-[18%] top-[25%] flex items-center justify-between">
            <span
              className={cn(
                'block h-[15%] min-h-[3px] w-[18%] rounded-full bg-white shadow-sm transition-all duration-200',
                mood === 'happy' && 'h-[8%] rotate-12',
                mood === 'thinking' && '-translate-y-[8%]',
              )}
            />
            <span
              className={cn(
                'block h-[15%] min-h-[3px] w-[18%] rounded-full bg-white shadow-sm transition-all duration-200',
                mood === 'happy' && 'h-[8%] -rotate-12',
                mood === 'thinking' && 'translate-y-[8%]',
              )}
            />
          </div>

          <div className="absolute inset-x-[31%] bottom-[24%] flex h-[17%] items-center justify-center">
            {mood === 'speaking' ? (
              <div className="flex h-full items-end gap-[8%]" aria-hidden>
                {[45, 90, 65, 100, 55].map((height, index) => (
                  <span
                    key={index}
                    className="w-[10%] min-w-[2px] rounded-full bg-white animate-pulse"
                    style={{ height: `${height}%`, animationDelay: `${index * 80}ms` }}
                  />
                ))}
              </div>
            ) : mood === 'happy' ? (
              <span className="block h-full w-full rounded-b-full border-b-[3px] border-white" />
            ) : mood === 'error' ? (
              <span className="block h-[55%] w-full rounded-t-full border-t-[3px] border-white" />
            ) : (
              <span
                className={cn(
                  'block h-[20%] w-full rounded-full bg-white transition-all duration-200',
                  mood === 'listening' && 'h-[55%] w-[55%]',
                  mood === 'thinking' && 'w-[65%]',
                )}
              />
            )}
          </div>

          <span className="absolute left-[12%] top-[12%] h-[22%] w-[35%] rounded-full bg-white/20 blur-sm" />
        </div>

        {mood === 'thinking' && (
          <div className="absolute inset-[-7px] animate-spin rounded-full border-2 border-transparent border-t-cyan-300 border-r-violet-300" />
        )}

        <span className="absolute -bottom-[3%] -right-[2%] h-[24%] w-[24%] rounded-full border-2 border-white bg-emerald-400 shadow-sm" />
      </div>

      {showStatus && (
        <span className="text-[11px] font-medium text-slate-500">{STATUS_TEXT[mood]}</span>
      )}
    </div>
  );
}
