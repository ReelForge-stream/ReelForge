import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import type { Api } from './api';
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
export function Art({ item, kind, width }: { item: Item; kind: 'Primary' | 'Thumb' | 'Backdrop'; width: number }) {
  const api = useApi();
  const url = api.image(item, kind === 'Thumb' && !item.ImageTags?.Thumb ? 'Backdrop' : kind, width) ?? (kind === 'Thumb' ? api.image(item, 'Primary', width) : undefined);
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
      {kind !== 'Backdrop' && (
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

export function Card({ item, shape = 'poster', showSub = true, showLabel = true }: { item: Item; shape?: 'poster' | 'thumb'; showSub?: boolean; showLabel?: boolean }) {
  const pct = item.UserData?.PlayedPercentage;
  const unplayed = item.UserData?.UnplayedItemCount;
  const sub =
    item.Type === 'Episode' ? `${item.SeriesName ?? ''} · ${epCode(item)}` : item.Type === 'Series' ? `${item.ChildCount ?? ''} ${item.ChildCount === 1 ? 'season' : 'seasons'}` : item.ProductionYear;
  return (
    <Link to={itemLink(item)} className={`card ${shape}`}>
      <div className="frame">
        <Art item={item} kind={shape === 'thumb' ? 'Thumb' : 'Primary'} width={shape === 'thumb' ? 560 : 360} />
        {pct ? (
          <div className="progress">
            <span style={{ width: `${pct}%` }} />
          </div>
        ) : null}
        {item.UserData?.Played ? (
          <span className="badge check" title="Watched">
            ✓
          </span>
        ) : unplayed ? (
          <span className="badge" title={`${unplayed} unwatched`}>
            {unplayed}
          </span>
        ) : null}
      </div>
      {showLabel && <div className="label">{item.Name}</div>}
      {showLabel && showSub && sub ? <div className="sub">{sub}</div> : null}
    </Link>
  );
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
  settings: () => (<svg viewBox="0 0 24 24" {...S}><circle cx="12" cy="12" r="3" /><path d="M12 3.5v2.2M12 18.3v2.2M3.5 12h2.2M18.3 12h2.2M6 6l1.6 1.6M16.4 16.4 18 18M6 18l1.6-1.6M16.4 7.6 18 6" /></svg>),
  logout: () => (<svg viewBox="0 0 24 24" {...S}><path d="M14 4.5h4a1.5 1.5 0 0 1 1.5 1.5v12a1.5 1.5 0 0 1-1.5 1.5h-4M10 16l-4-4 4-4M6 12h10" /></svg>),
};

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
