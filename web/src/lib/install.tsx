import { useEffect, useState } from 'react';
import { detectPlatform, isMobile, type Platform } from './device';
import { Icon } from './ui';

// "Install app" for phones and tablets. Android Chrome can install straight from a button (when the
// server is on HTTPS); iPhone/iPad and other browsers need a couple of taps, which we show.

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

// The browser offers this once, early; keep it until someone presses Install.
let deferred: BeforeInstallPromptEvent | null = null;
const listeners = new Set<() => void>();
if (typeof window !== 'undefined') {
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferred = e as BeforeInstallPromptEvent;
    listeners.forEach((l) => l());
  });
  window.addEventListener('appinstalled', () => {
    deferred = null;
    listeners.forEach((l) => l());
  });
}

/** Registers the service worker (needs HTTPS or localhost; on plain http it quietly does nothing). */
export function registerServiceWorker() {
  if (!('serviceWorker' in navigator) || !window.isSecureContext) return;
  navigator.serviceWorker.register('/reelforge/sw.js', { scope: '/reelforge/' }).catch(() => undefined);
}

export type InstallMode = 'none' | 'prompt' | 'ios' | 'menu';

/** How this device can install: a real prompt, iPhone/iPad steps, the browser-menu steps, or not at all. */
export function installMode(platform: Platform, standalone: boolean, hasPrompt: boolean): InstallMode {
  if (standalone || !isMobile(platform)) return 'none';
  if (hasPrompt) return 'prompt';
  if (platform === 'iphone' || platform === 'ipad') return 'ios';
  return 'menu';
}

function isStandalone(): boolean {
  try {
    return window.matchMedia('(display-mode: standalone)').matches || (navigator as { standalone?: boolean }).standalone === true;
  } catch {
    return false;
  }
}

const DISMISS_KEY = 'rf-install-dismissed';
const DISMISS_DAYS = 30;

function dismissedRecently(): boolean {
  try {
    const t = Number(localStorage.getItem(DISMISS_KEY) ?? 0);
    return Date.now() - t < DISMISS_DAYS * 864e5;
  } catch {
    return false;
  }
}

export function useInstall() {
  const platform = detectPlatform(navigator.userAgent, navigator.maxTouchPoints);
  const [, bump] = useState(0);
  useEffect(() => {
    const l = () => bump((n) => n + 1);
    listeners.add(l);
    return () => {
      listeners.delete(l);
    };
  }, []);
  const mode = installMode(platform, isStandalone(), !!deferred);
  const [steps, setSteps] = useState(false);
  const start = async () => {
    if (deferred) {
      const e = deferred;
      await e.prompt();
      const { outcome } = await e.userChoice;
      if (outcome === 'accepted') deferred = null;
      listeners.forEach((l) => l());
    } else setSteps(true);
  };
  return { mode, platform, start, steps, closeSteps: () => setSteps(false) };
}

/** Bottom banner on phones and tablets, until installed or dismissed (comes back after 30 days). */
export function InstallBanner() {
  const { mode, platform, start, steps, closeSteps } = useInstall();
  const [shown, setShown] = useState(false);
  const [hidden, setHidden] = useState(dismissedRecently);
  // Let the page settle first; a banner the moment it opens is pushy.
  useEffect(() => {
    const t = setTimeout(() => setShown(true), 4000);
    return () => clearTimeout(t);
  }, []);

  const dismiss = () => {
    setHidden(true);
    try {
      localStorage.setItem(DISMISS_KEY, String(Date.now()));
    } catch {
      /* private mode */
    }
  };

  return (
    <>
      {mode !== 'none' && shown && !hidden && (
        <div className="install-banner" role="region" aria-label="Install the app">
          <img src="/reelforge/icon-192.png" alt="" width={44} height={44} />
          <div className="install-text">
            <strong>Get the ReelForge app</strong>
            <span>Full screen, on your home screen, no browser bars.</span>
          </div>
          <button className="btn primary sm" onClick={start}>Install</button>
          <button className="install-close" aria-label="Not now" onClick={dismiss}><Icon.close /></button>
        </div>
      )}
      {steps && <InstallSteps mode={mode} platform={platform} onClose={closeSteps} />}
    </>
  );
}

/** "Install app" in the profile menu (always available on phones, even after dismissing the banner). */
export function InstallMenuItem({ onDone }: { onDone: () => void }) {
  const { mode, platform, start, steps, closeSteps } = useInstall();
  if (mode === 'none') return null;
  return (
    <>
      <button role="menuitem" className="pm-row" onClick={start}>
        <span className="pm-icon"><Icon.download /></span>
        <span>Install app</span>
      </button>
      {steps && <InstallSteps mode={mode} platform={platform} onClose={() => { closeSteps(); onDone(); }} />}
    </>
  );
}

const ShareIcon = () => (
  <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M12 3.5v11M8 7.5l4-4 4 4M6 11H5a1 1 0 0 0-1 1v7.5a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1V12a1 1 0 0 0-1-1h-1" />
  </svg>
);
const MenuDots = () => (
  <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor" aria-hidden="true">
    <circle cx="12" cy="5.5" r="1.8" /><circle cx="12" cy="12" r="1.8" /><circle cx="12" cy="18.5" r="1.8" />
  </svg>
);

function InstallSteps({ mode, platform, onClose }: { mode: InstallMode; platform: Platform; onClose: () => void }) {
  useEffect(() => {
    const k = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [onClose]);
  const ios = mode === 'ios';
  return (
    <div className="dialog-back install-back" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="install-sheet" role="dialog" aria-modal="true" aria-labelledby="install-title">
        <h2 id="install-title">Install ReelForge</h2>
        <ol className="install-steps">
          {ios ? (
            <>
              <li>Tap the <b>Share</b> button <span className="install-glyph"><ShareIcon /></span> {platform === 'ipad' ? 'at the top of Safari' : 'at the bottom of Safari'}.</li>
              <li>Scroll down and tap <b>Add to Home Screen</b>.</li>
              <li>Tap <b>Add</b>. ReelForge appears on your home screen like any other app.</li>
            </>
          ) : (
            <>
              <li>Tap the browser menu <span className="install-glyph"><MenuDots /></span> (top right in Chrome).</li>
              <li>Tap <b>Install app</b> or <b>Add to Home screen</b>.</li>
              <li>Confirm. ReelForge appears on your home screen like any other app.</li>
            </>
          )}
        </ol>
        {ios && <p className="hint">The app keeps its own sign-in, so you’ll pick your profile once the first time you open it.</p>}
        <div className="actions">
          <button className="btn primary" onClick={onClose}>Got it</button>
        </div>
      </div>
    </div>
  );
}
