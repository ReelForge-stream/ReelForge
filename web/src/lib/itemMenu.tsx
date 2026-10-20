import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState, type MouseEvent as RMouseEvent, type ReactNode, type TouchEvent as RTouchEvent } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { EditInfoDialog, FixMatchDialog } from './metaDialogs';
import type { ImageKind, RemoteImage } from './api';
import type { Item } from './types';
import { Art, Icon, useApi, useToast } from './ui';

// ---------- keeping tiles in step after an edit ----------

const EVENT = 'reelforge:item-updated';

/** Tell every tile, row and panel showing this title that it changed (new artwork, watched, My List). */
export function publishItem(item: Item) {
  window.dispatchEvent(new CustomEvent<Item>(EVENT, { detail: item }));
}

/** The item as last published, so a tile updates in place after an edit without reloading the page. */
export function useLiveItem(item: Item): Item {
  const [live, setLive] = useState(item);
  useEffect(() => setLive(item), [item]);
  useEffect(() => {
    const on = (e: Event) => {
      const next = (e as CustomEvent<Item>).detail;
      if (next.Id === item.Id) setLive((cur) => ({ ...cur, ...next }));
    };
    window.addEventListener(EVENT, on);
    return () => window.removeEventListener(EVENT, on);
  }, [item.Id]);
  return live;
}

/** Re-run something when this title changes elsewhere (e.g. the details panel reloading itself). */
export function useOnItemUpdated(id: string | undefined, fn: () => void) {
  const ref = useRef(fn);
  ref.current = fn;
  useEffect(() => {
    if (!id) return;
    const on = (e: Event) => {
      if ((e as CustomEvent<Item>).detail.Id === id) ref.current();
    };
    window.addEventListener(EVENT, on);
    return () => window.removeEventListener(EVENT, on);
  }, [id]);
}

// ---------- the right-click menu ----------

interface MenuApi {
  open: (item: Item, x: number, y: number) => void;
  editArtwork: (item: Item, kind?: ImageKind) => void;
}
const MenuContext = createContext<MenuApi | null>(null);

export function useItemMenu(): MenuApi | null {
  return useContext(MenuContext);
}

/**
 * Props that give an element the item menu: right-click on a computer, press-and-hold on a phone
 * or tablet. Spread them onto a tile: <Link {...menuProps(item)}>.
 */
export function useMenuTrigger(item: Item) {
  const menu = useItemMenu();
  const timer = useRef(0);
  const fired = useRef(false);
  const start = useRef<{ x: number; y: number } | null>(null);
  if (!menu) return {};
  return {
    onContextMenu: (e: RMouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
      clearTimeout(timer.current);
      menu.open(item, e.clientX, e.clientY);
    },
    onTouchStart: (e: RTouchEvent) => {
      const t = e.touches[0];
      fired.current = false;
      start.current = { x: t.clientX, y: t.clientY };
      timer.current = window.setTimeout(() => {
        fired.current = true;
        if (start.current) menu.open(item, start.current.x, start.current.y);
      }, 550);
    },
    onTouchMove: (e: RTouchEvent) => {
      const t = e.touches[0];
      if (start.current && Math.hypot(t.clientX - start.current.x, t.clientY - start.current.y) > 10) clearTimeout(timer.current);
    },
    onTouchEnd: () => clearTimeout(timer.current),
    onClickCapture: (e: RMouseEvent) => {
      // A press-and-hold opened the menu: don't also follow the link.
      if (fired.current) {
        e.preventDefault();
        e.stopPropagation();
        fired.current = false;
      }
    },
  };
}

type Open = { item: Item; x: number; y: number } | null;

type Dialog = { kind: 'art'; item: Item; image?: ImageKind } | { kind: 'info' | 'match'; item: Item } | null;

export function ItemMenuHost({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState<Open>(null);
  const [dialog, setDialog] = useState<Dialog>(null);
  const value = useMemo<MenuApi>(
    () => ({
      open: (item, x, y) => setOpen({ item, x, y }),
      editArtwork: (item, image) => {
        setOpen(null);
        setDialog({ kind: 'art', item, image });
      },
    }),
    [],
  );
  const close = useCallback(() => setDialog(null), []);
  return (
    <MenuContext.Provider value={value}>
      {children}
      {open && <ItemMenu {...open} onClose={() => setOpen(null)} onDialog={(d) => { setOpen(null); setDialog(d); }} />}
      {dialog?.kind === 'art' && <ArtworkDialog item={dialog.item} initial={dialog.image} onClose={close} />}
      {dialog?.kind === 'info' && <EditInfoDialog item={dialog.item} onClose={close} />}
      {dialog?.kind === 'match' && <FixMatchDialog item={dialog.item} onClose={close} />}
    </MenuContext.Provider>
  );
}

function ItemMenu({ item: shown, x, y, onClose, onDialog }: { item: Item; x: number; y: number; onClose: () => void; onDialog: (d: Dialog) => void }) {
  const api = useApi();
  const nav = useNavigate();
  const location = useLocation();
  const toast = useToast();
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ left: x, top: y });
  const item = useLiveItem(shown);
  const fav = !!item.UserData?.IsFavorite;
  const played = !!item.UserData?.Played;
  const playable = item.Type === 'Movie' || item.Type === 'Episode' || item.Type === 'Video';
  const resumable = (item.UserData?.PlayedPercentage ?? 0) > 0;
  const title = item.Type === 'Episode' ? `${item.SeriesName ?? ''} · ${item.Name}` : item.Name;

  // Keep the menu on screen.
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    setPos({ left: Math.max(8, Math.min(x, window.innerWidth - r.width - 8)), top: Math.max(8, Math.min(y, window.innerHeight - r.height - 8)) });
    el.querySelector<HTMLButtonElement>('button')?.focus();
  }, [x, y]);

  useEffect(() => {
    const away = (e: Event) => {
      if (!ref.current?.contains(e.target as Node)) onClose();
    };
    const key = (e: KeyboardEvent) => {
      const items = [...(ref.current?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)') ?? [])];
      const i = items.indexOf(document.activeElement as HTMLButtonElement);
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
      }
      else if (e.key === 'ArrowDown') {
        e.preventDefault();
        items[(i + 1) % items.length]?.focus();
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        items[(i - 1 + items.length) % items.length]?.focus();
      }
    };
    // Close when the page scrolls, but ignore the settling scroll right after opening.
    const openedAt = Date.now();
    const scrolled = () => Date.now() - openedAt > 250 && onClose();
    document.addEventListener('mousedown', away);
    document.addEventListener('touchstart', away);
    document.addEventListener('keydown', key);
    window.addEventListener('scroll', scrolled, true);
    window.addEventListener('resize', onClose);
    return () => {
      document.removeEventListener('mousedown', away);
      document.removeEventListener('touchstart', away);
      document.removeEventListener('keydown', key);
      window.removeEventListener('scroll', scrolled, true);
      window.removeEventListener('resize', onClose);
    };
  }, [onClose]);

  const act = async (fn: () => Promise<unknown>, msg: string) => {
    onClose();
    try {
      await fn();
      toast(msg);
      publishItem(await api.item(item.Id));
    } catch (e) {
      toast((e as Error).message);
    }
  };

  const go = (to: string) => {
    onClose();
    nav(to);
  };
  // Open More Info over the page you're on (Movies, TV, Search...), not over Home.
  const details = (id: string) => {
    onClose();
    const bg = (location.state as { background?: unknown } | null)?.background ?? location;
    nav(`/item/${id}`, { state: { background: bg } });
  };

  return (
    <div className="item-menu" ref={ref} role="menu" aria-label={`${title}: options`} style={pos} onContextMenu={(e) => e.preventDefault()}>
      <div className="im-title">{title}</div>
      {playable && (
        <button role="menuitem" onClick={() => go(`/play/${item.Id}`)}>
          <Icon.play />
          {resumable ? 'Resume' : 'Play'}
        </button>
      )}
      {playable && resumable && (
        <button role="menuitem" onClick={() => go(`/play/${item.Id}?from=start`)}>
          <Icon.back10 />
          Play from the beginning
        </button>
      )}
      {item.Type === 'Episode' && item.SeriesId ? (
        <button role="menuitem" onClick={() => details(item.SeriesId!)}>
          <Icon.tv />
          Go to show
        </button>
      ) : (
        <button role="menuitem" onClick={() => details(item.Id)}>
          <Icon.info />
          More info
        </button>
      )}
      <button role="menuitem" onClick={() => act(() => api.setFavorite(item.Id, !fav), fav ? 'Removed from My List' : 'Added to My List')}>
        {fav ? <Icon.check /> : <Icon.plus />}
        {fav ? 'Remove from My List' : 'Add to My List'}
      </button>
      <button role="menuitem" onClick={() => act(() => api.markPlayed(item.Id, !played), played ? 'Marked as unwatched' : 'Marked as watched')}>
        <Icon.check />
        {played ? 'Mark as unwatched' : 'Mark as watched'}
      </button>
      {api.isAdmin && (
        <>
          <div className="im-sep" role="separator" />
          <button role="menuitem" onClick={() => onDialog({ kind: 'info', item })}>
            <Icon.pencil />
            Edit info…
          </button>
          {(item.Type === 'Movie' || item.Type === 'Series') && (
            <button role="menuitem" onClick={() => onDialog({ kind: 'match', item })}>
              <Icon.search />
              Fix match…
            </button>
          )}
          <button role="menuitem" onClick={() => onDialog({ kind: 'art', item, image: item.Type === 'Episode' ? 'Primary' : 'Thumb' })}>
            <Icon.image />
            Edit artwork…
          </button>
          <button role="menuitem" onClick={() => act(() => api.art.refresh(item.Id, false), 'Refreshing info and artwork from the internet…')}>
            <Icon.refresh />
            Refresh info and artwork
          </button>
        </>
      )}
    </div>
  );
}

// ---------- artwork editor ----------

const KINDS: Record<string, { kind: ImageKind; label: string; hint: string }[]> = {
  Episode: [{ kind: 'Primary', label: 'Thumbnail', hint: 'The still shown for this episode.' }],
  Season: [{ kind: 'Primary', label: 'Poster', hint: 'The season’s cover.' }],
  default: [
    { kind: 'Thumb', label: 'Thumbnail', hint: 'The wide picture on rows and tiles. Without one, tiles use the background with the title on top.' },
    { kind: 'Primary', label: 'Poster', hint: 'The tall cover, used in the Top 10 row and on TVs and phones.' },
    { kind: 'Backdrop', label: 'Background', hint: 'The big picture behind the title at the top of Home and in More Info.' },
    { kind: 'Logo', label: 'Logo', hint: 'The title treatment shown over backgrounds instead of plain text.' },
  ],
};

function ArtworkDialog({ item, initial, onClose }: { item: Item; initial?: ImageKind; onClose: () => void }) {
  const api = useApi();
  const toast = useToast();
  const kinds = KINDS[item.Type] ?? KINDS.default;
  const [kind, setKind] = useState<ImageKind>(kinds.some((k) => k.kind === initial) ? initial! : kinds[0].kind);
  const [current, setCurrent] = useState<{ ImageType: string; ImageIndex?: number; ImageTag: string; Width?: number; Height?: number }[] | null>(null);
  const [remote, setRemote] = useState<RemoteImage[] | null>(null);
  const [remoteErr, setRemoteErr] = useState<string | null>(null);
  const [allLangs, setAllLangs] = useState(false);
  const [busy, setBusy] = useState<string | null>(null); // url being applied, or 'upload' / 'remove'
  const file = useRef<HTMLInputElement>(null);
  const info = kinds.find((k) => k.kind === kind)!;
  const wide = kind === 'Thumb' || kind === 'Backdrop' || (kind === 'Primary' && item.Type === 'Episode');

  const loadCurrent = useCallback(() => api.art.current(item.Id).then(setCurrent).catch(() => setCurrent([])), [api, item.Id]);
  useEffect(() => {
    loadCurrent();
  }, [loadCurrent]);
  useEffect(() => {
    let live = true;
    setRemote(null);
    setRemoteErr(null);
    api.art
      .remote(item.Id, kind, allLangs)
      .then((r) => live && setRemote(r.Images))
      .catch((e) => live && setRemoteErr((e as Error).message));
    return () => {
      live = false;
    };
  }, [api, item.Id, kind, allLangs]);

  useEffect(() => {
    const key = (e: KeyboardEvent) => e.key === 'Escape' && !busy && onClose();
    window.addEventListener('keydown', key);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', key);
      document.body.style.overflow = prev;
    };
  }, [busy, onClose]);

  const after = async (msg: string) => {
    await loadCurrent();
    publishItem(await api.item(item.Id));
    toast(msg);
  };
  const run = async (tag: string, fn: () => Promise<unknown>, msg: string) => {
    setBusy(tag);
    try {
      await fn();
      await after(msg);
    } catch (e) {
      toast(`Couldn’t change the ${info.label.toLowerCase()}: ${(e as Error).message}`);
    } finally {
      setBusy(null);
    }
  };

  const mine = (current ?? []).filter((c) => c.ImageType === kind);
  const now = mine[0];
  const nowUrl = now ? api.imageUrl(item.Id, kind, now.ImageTag, wide ? 640 : 360, now.ImageIndex ?? 0) : undefined;
  const title = item.Type === 'Episode' ? `${item.SeriesName ?? ''} · ${item.Name}` : item.Name;

  return (
    <div className="dialog-back art-back" onMouseDown={(e) => e.target === e.currentTarget && !busy && onClose()}>
      <div className="art-dialog" role="dialog" aria-modal="true" aria-label={`Artwork for ${title}`}>
        <header className="art-head">
          <div>
            <h2>Artwork</h2>
            <p className="muted">{title}</p>
          </div>
          <button className="details-close static" aria-label="Close" onClick={onClose} disabled={!!busy}>
            <Icon.close />
          </button>
        </header>

        {kinds.length > 1 && (
          <nav className="art-tabs" role="tablist" aria-label="Kind of artwork">
            {kinds.map((k) => (
              <button key={k.kind} role="tab" aria-selected={kind === k.kind} className={kind === k.kind ? 'on' : ''} onClick={() => setKind(k.kind)} disabled={!!busy}>
                {k.label}
              </button>
            ))}
          </nav>
        )}

        <div className="art-body">
          <section className="art-current">
            <h3>Current {info.label.toLowerCase()}</h3>
            <div className={`art-frame ${wide ? 'wide' : kind === 'Logo' ? 'logo' : 'tall'}`}>
              {nowUrl ? (
                <img src={nowUrl} alt="" />
              ) : current && !now ? (
                <span className="art-none">None yet</span>
              ) : kind !== 'Logo' ? (
                <Art item={item} kind={kind === 'Backdrop' ? 'Backdrop' : kind === 'Thumb' ? 'Thumb' : 'Primary'} width={480} />
              ) : null}
              {(busy === 'upload' || busy === 'remove') && <span className="art-busy"><span className="spinner" /></span>}
            </div>
            {now?.Width && now.Height ? <p className="hint">{now.Width} × {now.Height}</p> : null}
            <p className="hint">{info.hint}</p>
            <div className="row-actions">
              <input
                ref={file}
                type="file"
                accept="image/jpeg,image/png,image/webp"
                hidden
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  e.target.value = '';
                  if (f) run('upload', () => api.art.upload(item.Id, kind, f), `${info.label} updated`);
                }}
              />
              <button className="btn sm" onClick={() => file.current?.click()} disabled={!!busy}>
                <Icon.upload />
                Upload your own
              </button>
              {now && (
                <button className="btn ghost sm" onClick={() => run('remove', () => api.art.remove(item.Id, kind, now.ImageIndex ?? 0), `${info.label} removed`)} disabled={!!busy}>
                  <Icon.trash />
                  Remove
                </button>
              )}
            </div>
          </section>

          <section className="art-online">
            <div className="art-online-head">
              <h3>Find online</h3>
              <label className="check-row small">
                <input type="checkbox" className="check" checked={allLangs} onChange={(e) => setAllLangs(e.target.checked)} />
                Include other languages
              </label>
            </div>
            {remoteErr && <p className="error small">Couldn’t search: {remoteErr}</p>}
            {!remote && !remoteErr && <p className="muted">Searching…</p>}
            {remote && remote.length === 0 && (
              <p className="muted small">
                Nothing found for this {info.label.toLowerCase()}. {allLangs ? '' : 'Try including other languages, or '}upload your own. If the title was matched wrong, its info may need fixing first.
              </p>
            )}
            <div className={`art-grid ${wide ? 'wide' : kind === 'Logo' ? 'logo' : 'tall'}`}>
              {remote?.map((r) => (
                <button
                  key={r.Url}
                  className="art-option"
                  onClick={() => run(r.Url, () => api.art.useRemote(item.Id, kind, r.Url), `${info.label} updated`)}
                  disabled={!!busy}
                  title={`Use this ${info.label.toLowerCase()}`}
                >
                  <span className="art-option-img">
                    <img src={r.ThumbnailUrl || r.Url} alt="" loading="lazy" referrerPolicy="no-referrer" />
                    {busy === r.Url && <span className="art-busy"><span className="spinner" /></span>}
                  </span>
                  <span className="art-option-meta">
                    <span>{r.Width && r.Height ? `${r.Width}×${r.Height}` : ''}</span>
                    <span>{[r.Language?.toUpperCase(), r.CommunityRating ? `★ ${r.CommunityRating.toFixed(1)}` : null].filter(Boolean).join(' · ')}</span>
                  </span>
                  <span className="art-option-src">{r.ProviderName}</span>
                </button>
              ))}
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
