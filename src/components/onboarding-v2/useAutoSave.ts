import { useEffect, useRef, useCallback } from 'react';

type SaveFn<T> = (data: T) => Promise<unknown>;

export function useAutoSave<T>(saveFn: SaveFn<T>, data: T, delay = 800) {
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inFlightRef = useRef(false);
  const pendingRef = useRef<T | null>(null);
  const saveFnRef = useRef(saveFn);
  saveFnRef.current = saveFn;

  const flush = useCallback(async () => {
    if (inFlightRef.current) return;
    const payload = pendingRef.current;
    if (payload === null) return;
    pendingRef.current = null;
    inFlightRef.current = true;
    try {
      await saveFnRef.current(payload);
    } catch {
      // silent — do not block navigation on auto-save error
    } finally {
      inFlightRef.current = false;
      // If more data arrived while saving, schedule another flush
      if (pendingRef.current !== null) {
        timerRef.current = setTimeout(flush, delay);
      }
    }
  }, [delay]);

  useEffect(() => {
    pendingRef.current = data;
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(flush, delay);
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [data, delay, flush]);

  return { flush };
}
