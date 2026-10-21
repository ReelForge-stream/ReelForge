// Autoplay the next episode, but stop and ask "Still watching?" after a few in a row
// that played with nobody touching anything (so a sleeping viewer doesn't binge a season).

export const UP_NEXT_SECONDS = 15; // the "Next episode" card appears this close to the end

export interface AutoplayPrefs {
  on: boolean;
  /** Ask after this many episodes in a row play by themselves. 0 = never ask. */
  askAfter: number;
}

export const DEFAULT_PREFS: AutoplayPrefs = { on: true, askAfter: 2 };
const PREFS_KEY = 'reelforge.autoplay';
const CHAIN_KEY = 'reelforge.autoplayChain';

export function loadPrefs(): AutoplayPrefs {
  try {
    const p = JSON.parse(localStorage.getItem(PREFS_KEY) ?? 'null') as Partial<AutoplayPrefs> | null;
    return { on: p?.on ?? DEFAULT_PREFS.on, askAfter: Number.isInteger(p?.askAfter) ? p!.askAfter! : DEFAULT_PREFS.askAfter };
  } catch {
    return DEFAULT_PREFS;
  }
}

export function savePrefs(p: AutoplayPrefs) {
  try {
    localStorage.setItem(PREFS_KEY, JSON.stringify(p));
  } catch {
    /* private mode */
  }
}

/** How many episodes in a row have started by themselves (kept per browser tab, survives the page change). */
export function chain(): number {
  try {
    return Number(sessionStorage.getItem(CHAIN_KEY) ?? 0) || 0;
  } catch {
    return 0;
  }
}

export function setChain(n: number) {
  try {
    sessionStorage.setItem(CHAIN_KEY, String(n));
  } catch {
    /* ignore */
  }
}

export type EndAction = 'next' | 'ask' | 'stop';

/** What to do when an episode finishes. */
export function atEnd(p: AutoplayPrefs, autoPlayedSoFar: number, hasNext: boolean, dismissed: boolean): EndAction {
  if (!hasNext || !p.on || dismissed) return 'stop';
  if (p.askAfter > 0 && autoPlayedSoFar >= p.askAfter) return 'ask';
  return 'next';
}

/** Show the "Next episode in 12" card now? */
export function showUpNext(p: AutoplayPrefs, autoPlayedSoFar: number, hasNext: boolean, dismissed: boolean, time: number, duration: number): boolean {
  if (duration < 120 || time <= 0) return false; // short clips: no card
  return atEnd(p, autoPlayedSoFar, hasNext, dismissed) === 'next' && duration - time <= UP_NEXT_SECONDS;
}

export function describePrefs(p: AutoplayPrefs): string {
  if (!p.on) return 'Off';
  return p.askAfter > 0 ? `On · asks after ${p.askAfter}` : 'On';
}
