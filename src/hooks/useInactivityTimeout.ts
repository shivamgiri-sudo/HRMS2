import { useEffect, useCallback, useRef } from 'react';

/**
 * Hook to monitor user inactivity and trigger logout after specified timeout
 *
 * @param timeoutMinutes - Minutes of inactivity before triggering logout (0 = disabled)
 * @param onTimeout - Callback function to execute when timeout occurs
 *
 * Activity events monitored:
 * - Mouse movements (mousedown)
 * - Keyboard input (keydown)
 * - Scrolling (scroll)
 * - Touch events (touchstart)
 * - Tab visibility changes (visibilitychange)
 *
 * Usage:
 * ```tsx
 * useInactivityTimeout(30, () => {
 *   logout();
 *   toast.warning('You have been logged out due to inactivity');
 * });
 * ```
 */
export function useInactivityTimeout(
  timeoutMinutes: number,
  onTimeout: () => void
) {
  const timeoutRef = useRef<NodeJS.Timeout>();
  const onTimeoutRef = useRef(onTimeout);

  // Keep callback ref up to date
  useEffect(() => {
    onTimeoutRef.current = onTimeout;
  }, [onTimeout]);

  const resetTimer = useCallback(() => {
    // Clear existing timer
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
    }

    // Only set new timer if timeout is enabled (> 0)
    if (timeoutMinutes > 0) {
      timeoutRef.current = setTimeout(() => {
        console.log('[InactivityTimeout] Timeout triggered after', timeoutMinutes, 'minutes');
        onTimeoutRef.current();
      }, timeoutMinutes * 60 * 1000);
    }
  }, [timeoutMinutes]);

  useEffect(() => {
    // If timeout is disabled, clear any existing timer and don't attach listeners
    if (timeoutMinutes <= 0) {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
        timeoutRef.current = undefined;
      }
      return;
    }

    // Activity events that should reset the timer
    const events = ['mousedown', 'keydown', 'scroll', 'touchstart'] as const;

    // Attach activity event listeners
    events.forEach((event) => {
      document.addEventListener(event, resetTimer, { passive: true });
    });

    // Tab visibility change handler
    const handleVisibilityChange = () => {
      if (document.hidden) {
        // Tab hidden - don't reset timer, let it count down
        console.log('[InactivityTimeout] Tab hidden, timer continues');
      } else {
        // Tab visible again - reset timer
        console.log('[InactivityTimeout] Tab visible, timer reset');
        resetTimer();
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);

    // Start initial timer
    resetTimer();

    // Cleanup on unmount or when dependencies change
    return () => {
      events.forEach((event) => {
        document.removeEventListener(event, resetTimer);
      });
      document.removeEventListener('visibilitychange', handleVisibilityChange);

      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }
    };
  }, [timeoutMinutes, resetTimer]);
}
