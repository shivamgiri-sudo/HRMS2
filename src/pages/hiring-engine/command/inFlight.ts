/**
 * Synchronous in-flight guard for write handlers. `disabled` on a button only takes effect after React re-renders, so two fast
 * clicks (or a click plus Enter) can both start a write; for Plan now both requests would compute the same "want" before either
 * credits. run() marks the guard busy before the handler's first await and ignores any call made while it is busy.
 * Hold one per component in a useRef. Pure: no React, no I/O.
 */
export interface InFlightGuard {
  readonly busy: boolean;
  /** Runs `fn` unless a previous run is still pending; a re-entrant call resolves to undefined without calling `fn`. */
  run<T>(fn: () => Promise<T>): Promise<T | undefined>;
}

export function createInFlightGuard(): InFlightGuard {
  let busy = false;
  return {
    get busy() { return busy; },
    async run<T>(fn: () => Promise<T>): Promise<T | undefined> {
      if (busy) return undefined;
      busy = true;
      try { return await fn(); } finally { busy = false; }
    },
  };
}
