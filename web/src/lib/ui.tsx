import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { Link, useLocation } from 'react-router-dom';
import type { Api } from './api';
import type { User } from './types';
import { useLiveItem, useMenuTrigger } from './itemMenu';
import type { Item } from './types';

// ---------- app context ----------

export const ApiContext = createContext<Api | null>(null);
export function useApi(): Api {
  const api = useContext(ApiContext);
  if (!api) throw new Error('No session');
  return api;
}

// ---------- data loading ----------

export function useAsync<T>(fn: () => Promise<T>, deps: unknown[]) {
  const [state, setState] = useState<{ data?: T; error?: string; loading: boolean }>({ loading: true });
  const [tick, setTick] = useState(0);
  useEffect(() => {
    let live = true;
    setState((s) => ({ ...s, loading: true, error: undefined }));
    fn().then(
      (data) => live && setState({ data, loading: false }),
      (e: Error) => live && setState({ error: e.message, loading: false }),
    );
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, tick]);
  const reload = useCallback(() => setTick((t) => t + 1), []);
  return { ...state, reload, setData: (data: T) => setState({ data, loading: false }) };
}

export function usePoll(fn: () => void, ms: number, enabled = true) {
  const ref = useRef(fn);
  ref.current = fn;
  useEffect(() => {
    if (!enabled) return;
    const id = setInterval(() => ref.current(), ms);
    return () => clearInterval(id);
  }, [ms, enabled]);
}

// ---------- toast ----------

const ToastContext = createContext<(msg: string) => void>(() => undefined);
export const useToast = () => useContext(ToastContext);

export function ToastHost({ children }: { children: ReactNode }) {
  const [msg, setMsg] = useState<string | null>(null);
  const timer = useRef<number>(0);
  const show = useCallback((m: string) => {
    setMsg(m);
    clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setMsg(null), 3600);
  }, []);
  return (
    <ToastContext.Provider value={show}>
      {children}
      <div aria-live="polite">{msg && <div className="toast">{msg}</div>}</div>
    </ToastContext.Provider>
  );
}

// ---------- dialog ----------

export function Confirm(props: {
  title: string;
  children: ReactNode;
  confirm: string;
  danger?: boolean;
  busy?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const btn = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    btn.current?.focus();
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && props.onCancel();
    window.addEventListener('keydown', esc);
    return () => window.removeEventListener('keydown', esc);
  }, [props]);
  return (
    <div className="dialog-back" onClick={props.onCancel}>
      <div className="dialog" role="dialog" aria-modal="true" aria-labelledby="dlg-title" onClick={(e) => e.stopPropagation()}>
        <h2 id="dlg-title">{props.title}</h2>
        <div className="muted">{props.children}</div>
        <div className="actions">
          <button className="btn ghost" onClick={props.onCancel}>Cancel</button>
          <button ref={btn} className={`btn ${props.danger ? 'danger' : 'primary'}`} disabled={props.busy} onClick={props.onConfirm}>
            {props.busy ? 'Working…' : props.confirm}
          </button>
        </div>
      </div>
    </div>
  );
}

// ---------- artwork ----------

function hueOf(item: Item): number {
  if (item._hue != null) return item._hue;
  let h = 0;
  for (const c of item.SeriesName ?? item.Name) h = (h * 31 + c.charCodeAt(0)) % 360;
  return h;
}

/** Real artwork when Jellyfin has it; otherwise a generated title card in the house style. */
export function Art({ item, kind, width, bare }: { item: Item; kind: 'Primary' | 'Thumb' | 'Backdrop'; width: number; bare?: boolean }) {
  const api = useApi();
  const url =
    kind === 'Thumb'
      ? api.image(item, 'Thumb', width) ??
        (item.Type === 'Episode' ? api.image(item, 'Primary', width) : undefined) ??
        api.image(item, 'Backdrop', width) ??
        api.image(item, 'Primary', width)
      : api.image(item, kind, width);
  const [failed, setFailed] = useState(false);
  if (url && !failed) return <img src={url} alt="" loading="lazy" decoding="async" onError={() => setFailed(true)} />;
  const h = hueOf(item);
  const title = item.Type === 'Episode' ? item.SeriesName ?? item.Name : item.Name;
  return (
    <div
      className="art-gen"
      aria-hidden="true"
      style={{
        background:
          kind === 'Backdrop'
            ? `radial-gradient(90% 90% at 85% 0%, hsl(${h} 30% 28%) 0%, transparent 65%), #17202A`
            : `radial-gradient(120% 80% at 80% 10%, hsl(${h} 55% 42%) 0%, transparent 60%),
          linear-gradient(160deg, hsl(${h} 45% 26%) 0%, hsl(${(h + 30) % 360} 40% 12%) 100%)`,
      }}
    >
      {kind !== 'Backdrop' && !bare && (
        <>
          {title}
          {item.Type === 'Episode' && <small>{epCode(item)} · {item.Name}</small>}
          {item.Type !== 'Episode' && item.ProductionYear && <small>{item.ProductionYear}</small>}
        </>
      )}
    </div>
  );
}

export function epCode(i: Item): string {
  if (i.ParentIndexNumber == null || i.IndexNumber == null) return '';
  return `S${String(i.ParentIndexNumber).padStart(2, '0')}E${String(i.IndexNumber).padStart(2, '0')}`;
}

export function itemLink(i: Item): string {
  if (i.Type === 'CollectionFolder') return `/library/${i.Id}`;
  if (i.Type === 'Episode') return `/play/${i.Id}`;
  if (i.Type === 'Season' && i.SeriesId) return `/item/${i.SeriesId}`;
  return `/item/${i.Id}`;
}

// ---------- icons (24px, stroke) ----------

const S = { fill: 'none', stroke: 'currentColor', strokeWidth: 1.8, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const };
export const Icon = {
  home: () => (<svg viewBox="0 0 24 24" {...S}><path d="M4 11.5 12 5l8 6.5V20H14v-5h-4v5H4z" /></svg>),
  film: () => (<svg viewBox="0 0 24 24" {...S}><rect x="3.5" y="4.5" width="17" height="15" rx="2" /><path d="M7.5 4.5v15M16.5 4.5v15M3.5 9h4M3.5 15h4M16.5 9h4M16.5 15h4" /></svg>),
  tv: () => (<svg viewBox="0 0 24 24" {...S}><rect x="3" y="6" width="18" height="12.5" rx="2" /><path d="M9 3l3 3 3-3" /></svg>),
  folder: () => (<svg viewBox="0 0 24 24" {...S}><path d="M3.5 7.5a2 2 0 0 1 2-2h4l2 2h7a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2z" /></svg>),
  search: () => (<svg viewBox="0 0 24 24" {...S}><circle cx="11" cy="11" r="6.5" /><path d="m20 20-4.2-4.2" /></svg>),
  manager: () => (<svg viewBox="0 0 24 24" {...S}><path d="M4 7h16M4 12h16M4 17h10" /><circle cx="18" cy="17" r="2.5" /></svg>),
  play: () => (<svg viewBox="0 0 24 24" fill="currentColor"><path d="M8 5.5v13a1 1 0 0 0 1.5.86l10.6-6.5a1 1 0 0 0 0-1.72L9.5 4.64A1 1 0 0 0 8 5.5z" /></svg>),
  back: () => (<svg viewBox="0 0 24 24" {...S}><path d="M15 5l-7 7 7 7" /></svg>),
  check: () => (<svg viewBox="0 0 24 24" {...S}><path d="m5 12.5 4.5 4.5L19 7.5" /></svg>),
  settings: () => (<svg viewBox="0 0 24 24" {...S}><path d="M10.3 3.5h3.4l.5 2.4 1.7 1 2.3-.8 1.7 2.9-1.8 1.6v2l1.8 1.6-1.7 2.9-2.3-.8-1.7 1-.5 2.4h-3.4l-.5-2.4-1.7-1-2.3.8-1.7-2.9 1.8-1.6v-2L3.9 9l1.7-2.9 2.3.8 1.7-1z" /><circle cx="12" cy="12" r="2.8" /></svg>),
  logout: () => (<svg viewBox="0 0 24 24" {...S}><path d="M14 4.5h4a1.5 1.5 0 0 1 1.5 1.5v12a1.5 1.5 0 0 1-1.5 1.5h-4M10 16l-4-4 4-4M6 12h10" /></svg>),
  info: () => (<svg viewBox="0 0 24 24" {...S}><circle cx="12" cy="12" r="9" /><path d="M12 11v5.5M12 7.6v.1" strokeWidth="2.2" /></svg>),
  plus: () => (<svg viewBox="0 0 24 24" {...S}><path d="M12 5v14M5 12h14" /></svg>),
  close: () => (<svg viewBox="0 0 24 24" {...S}><path d="M6 6l12 12M18 6 6 18" /></svg>),
  chevronDown: () => (<svg viewBox="0 0 24 24" {...S}><path d="m6 9 6 6 6-6" /></svg>),
  caret: () => (<svg viewBox="0 0 10 5" fill="currentColor"><path d="M0 0h10L5 5z" /></svg>),
  heart: () => (<svg viewBox="0 0 24 24" {...S}><path d="M12 19.5s-7.5-4.4-7.5-10A4.2 4.2 0 0 1 12 7a4.2 4.2 0 0 1 7.5 2.5c0 5.6-7.5 10-7.5 10z" /></svg>),
  heartFill: () => (<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 19.5s-7.5-4.4-7.5-10A4.2 4.2 0 0 1 12 7a4.2 4.2 0 0 1 7.5 2.5c0 5.6-7.5 10-7.5 10z" /></svg>),
  pencil: () => (<svg viewBox="0 0 24 24" {...S}><path d="M4.5 19.5l1-4L16 5a2 2 0 0 1 3 3L8.5 18.5z" /><path d="M14 7l3 3" /></svg>),
  user: () => (<svg viewBox="0 0 24 24" {...S}><circle cx="12" cy="8.5" r="3.8" /><path d="M4.5 20a7.5 7.5 0 0 1 15 0" /></svg>),
  pause: () => (<svg viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="4.5" width="4" height="15" rx="1" /><rect x="14" y="4.5" width="4" height="15" rx="1" /></svg>),
  back10: () => (<svg viewBox="0 0 24 24" {...S}><path d="M4.5 12a7.5 7.5 0 1 0 2.2-5.3" /><path d="M4.5 3.5v4h4" /><text x="12" y="15.5" fontSize="7" textAnchor="middle" fill="currentColor" stroke="none" fontFamily="Instrument Sans, sans-serif" fontWeight="600">10</text></svg>),
  fwd10: () => (<svg viewBox="0 0 24 24" {...S}><path d="M19.5 12a7.5 7.5 0 1 1-2.2-5.3" /><path d="M19.5 3.5v4h-4" /><text x="12" y="15.5" fontSize="7" textAnchor="middle" fill="currentColor" stroke="none" fontFamily="Instrument Sans, sans-serif" fontWeight="600">10</text></svg>),
  volume: () => (<svg viewBox="0 0 24 24" {...S}><path d="M4 9.5h3.5L12 5.5v13l-4.5-4H4z" /><path d="M15.5 9a4 4 0 0 1 0 6M18 6.5a7.5 7.5 0 0 1 0 11" /></svg>),
  mute: () => (<svg viewBox="0 0 24 24" {...S}><path d="M4 9.5h3.5L12 5.5v13l-4.5-4H4z" /><path d="M16 9.5l5 5M21 9.5l-5 5" /></svg>),
  fullscreen: () => (<svg viewBox="0 0 24 24" {...S}><path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5" /></svg>),
  exitFullscreen: () => (<svg viewBox="0 0 24 24" {...S}><path d="M9 4v5H4M15 4v5h5M9 20v-5H4M15 20v-5h5" /></svg>),
  subtitles: () => (<svg viewBox="0 0 24 24" {...S}><rect x="3" y="5" width="18" height="14" rx="2" /><path d="M7 13h4M13 13h4M7 16h7" /></svg>),
  next: () => (<svg viewBox="0 0 24 24" fill="currentColor"><path d="M5 5.5v13a1 1 0 0 0 1.5.86l9.4-6.5a1 1 0 0 0 0-1.72L6.5 4.64A1 1 0 0 0 5 5.5z" /><rect x="17" y="5" width="2.5" height="14" rx="1" /></svg>),
  image: () => (<svg viewBox="0 0 24 24" {...S}><rect x="3.5" y="4.5" width="17" height="15" rx="2" /><circle cx="9" cy="9.5" r="1.8" /><path d="m4 17.5 5-5 4 4 2.5-2.5 4.5 4.5" /></svg>),
  refresh: () => (<svg viewBox="0 0 24 24" {...S}><path d="M19.5 12a7.5 7.5 0 1 1-2.2-5.3" /><path d="M19.5 4v4h-4" /></svg>),
  more: () => (<svg viewBox="0 0 24 24" fill="currentColor"><circle cx="6" cy="12" r="1.8" /><circle cx="12" cy="12" r="1.8" /><circle cx="18" cy="12" r="1.8" /></svg>),
  upload: () => (<svg viewBox="0 0 24 24" {...S}><path d="M12 15.5V4.5M7.5 9 12 4.5 16.5 9M5 15v3.5a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V15" /></svg>),
  trash: () => (<svg viewBox="0 0 24 24" {...S}><path d="M5 7h14M10 7V5h4v2M7 7l1 12.5h8L17 7" /></svg>),
  episodes: () => (<svg viewBox="0 0 24 24" {...S}><rect x="3" y="7" width="14" height="12" rx="1.5" /><path d="M7 4h13a1 1 0 0 1 1 1v11" /></svg>),
};

// ---------- 16:9 tiles (Figma: MovieCard / Medium / HorizontalHomePage, 218×123) ----------

const RECENT_DAYS = 14;
export function isRecent(i: Item): boolean {
  if (!i.DateCreated) return false;
  return Date.now() - new Date(i.DateCreated).getTime() < RECENT_DAYS * 864e5;
}

/** Opens title details as an overlay over the current page (or as a page when opened directly). */
export function useDetailsLink() {
  const location = useLocation();
  const bg = (location.state as { background?: unknown } | null)?.background ?? location;
  return (i: Item) => ({ to: itemLink(i), state: i.Type === 'Episode' || i.Type === 'CollectionFolder' ? undefined : { background: bg } });
}

export function Tile({ item: given, progress = true }: { item: Item; progress?: boolean }) {
  const api = useApi();
  const link = useDetailsLink();
  const item = useLiveItem(given);
  const menu = useMenuTrigger(item);
  const pct = item.UserData?.PlayedPercentage;
  const hasThumb = !!item.ImageTags?.Thumb || (!!item.ParentThumbImageTag && item.Type !== 'Episode');
  const logo = hasThumb ? undefined : api.image(item, 'Logo', 300);
  const label = isRecent(item) && !item.UserData?.Played ? (item.Type === 'Series' ? 'New episodes' : 'Recently added') : null;
  const title = item.Type === 'Episode' ? `${item.SeriesName ?? ''}` : item.Name;
  return (
    <Link {...link(item)} {...menu} className="tile" aria-label={item.Type === 'Episode' ? `${item.SeriesName} ${epCode(item)} ${item.Name}` : item.Name}>
      <div className="tile-frame">
        <Art item={item} kind="Thumb" width={480} bare={!hasThumb} />
        {!hasThumb && (
          <div className="tile-title">
            {logo ? <img src={logo} alt="" loading="lazy" /> : <span>{title}</span>}
            {item.Type === 'Episode' && <small>{epCode(item)} · {item.Name}</small>}
          </div>
        )}
        {label && <span className="tile-label">{label}</span>}
        {item.UserData?.Played && <span className="tile-watched" title="Watched"><Icon.check /></span>}
      </div>
      {progress && pct ? (
        <div className="tile-progress" aria-label={`${Math.round(pct)}% watched`}>
          <span style={{ width: `${pct}%` }} />
        </div>
      ) : null}
    </Link>
  );
}

/** Ranked row tile: an outlined numeral beside a poster (Figma: Top 10 row). */
export function RankTile({ item: given, rank }: { item: Item; rank: number }) {
  const link = useDetailsLink();
  const item = useLiveItem(given);
  const menu = useMenuTrigger(item);
  return (
    <Link {...link(item)} {...menu} className="rank-tile" aria-label={`${rank}. ${item.Name}`}>
      <span className="rank-num" aria-hidden="true">{rank}</span>
      <div className="rank-poster">
        <Art item={item} kind="Primary" width={240} />
      </div>
    </Link>
  );
}

// ---------- profiles ----------

const AVATAR_TONES = ['#FF8A1F', '#5FD3A6', '#6F9BD1', '#C77DDB', '#E8C547', '#E46F6F', '#4FB6C2', '#93A4B5'];

/** A profile's picture, or a generated tile in the house style (initial on a toned plate). */
export function Avatar({ user, url, size }: { user: User; url?: string; size: number }) {
  const [failed, setFailed] = useState(false);
  if (url && !failed) return <img className="avatar" src={url} alt="" width={size} height={size} onError={() => setFailed(true)} />;
  let h = 0;
  for (const c of user.Name) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  const tone = AVATAR_TONES[h % AVATAR_TONES.length];
  return (
    <span className="avatar gen" style={{ width: size, height: size, background: `linear-gradient(150deg, ${tone} 0%, color-mix(in srgb, ${tone} 55%, #17202A) 100%)`, fontSize: size * 0.46 }} aria-hidden="true">
      {user.Name.trim().charAt(0).toUpperCase()}
    </span>
  );
}

export function Logo() {
  // The Press: steel plates squeezing a white-hot frame (see /brand).
  return (
    <svg viewBox="0 0 64 64" aria-hidden="true">
      <defs>
        <linearGradient id="rf-heat" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#FFD25A" />
          <stop offset=".5" stopColor="#FF8A1F" />
          <stop offset="1" stopColor="#F0442C" />
        </linearGradient>
        <mask id="rf-sprk">
          <rect width="64" height="64" fill="#fff" />
          <g fill="#000">
            {[24, 36.8].flatMap((x) => [18, 25.5, 33, 40.5].map((y) => <rect key={`${x}-${y}`} x={x} y={y} width="3.2" height="4" rx=".8" />))}
          </g>
        </mask>
      </defs>
      <path d="M6 8h13v7h-6v34h6v7H6z" fill="#DCE3EA" />
      <path d="M58 8H45v7h6v34h-6v7h13z" fill="#DCE3EA" />
      <rect x="22" y="14" width="20" height="36" rx="2.5" fill="url(#rf-heat)" mask="url(#rf-sprk)" />
    </svg>
  );
}
