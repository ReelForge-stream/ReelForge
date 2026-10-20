import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import type { Item } from '../lib/types';
import { Tile, useApi, useAsync } from '../lib/ui';

const SORTS = [
  { id: 'DateCreated,SortName', label: 'Recently added', order: 'Descending' },
  { id: 'SortName', label: 'A–Z', order: 'Ascending' },
  { id: 'ProductionYear,SortName', label: 'Newest', order: 'Descending' },
  { id: 'CommunityRating,SortName', label: 'Top rated', order: 'Descending' },
  { id: 'Random', label: 'Surprise me', order: 'Ascending' },
];
const AZ = 'SortName';
const PAGE = 60;
const LETTERS = ['#', ...'ABCDEFGHIJKLMNOPQRSTUVWXYZ'];

/** "#" for titles starting with a number or symbol, otherwise the first letter. */
function letterOf(sortName?: string): string {
  const c = (sortName ?? '').trim().charAt(0).toUpperCase();
  return c >= 'A' && c <= 'Z' ? c : '#';
}

/**
 * Figma: Browse Page (148:8104). A grid of tiles that loads more as you scroll, with an A–Z bar
 * down the side to jump straight to a letter (like Plex).
 */
export default function Library() {
  const { id = '' } = useParams();
  const api = useApi();
  const [sort, setSort] = useState(SORTS[0].id);
  const [genre, setGenre] = useState('');
  const [items, setItems] = useState<Item[]>([]);
  const [start, setStart] = useState(0); // position of items[0] in the whole sorted list
  const [total, setTotal] = useState(0);
  const [busy, setBusy] = useState(false);
  const [pendingLetter, setPendingLetter] = useState<string | null>(null);
  const [current, setCurrent] = useState<string | null>(null);
  const [loadedFor, setLoadedFor] = useState(''); // which sort + genre the grid currently shows
  const jumpedAt = useRef(0);
  const grid = useRef<HTMLDivElement>(null);
  const bottom = useRef<HTMLDivElement>(null);
  const keepScroll = useRef<{ height: number; y: number } | null>(null);

  const view = useAsync(() => api.views().then((v) => v.find((x) => x.Id === id)), [id]);
  const genres = useAsync(() => api.genres(id).catch(() => []), [id]);
  const types = view.data?.CollectionType === 'tvshows' ? 'Series' : view.data?.CollectionType === 'movies' ? 'Movie' : 'Movie,Series,Video';
  const s = SORTS.find((x) => x.id === sort)!;
  const az = sort === AZ;

  // The A–Z index: every title's sort name, in order (small, even for big libraries).
  const index = useAsync(
    () => (view.data ? api.sortIndex({ parentId: id, types, genre: genre || undefined }) : Promise.resolve([])),
    [id, types, genre, !!view.data],
  );
  const firstOf = useMemo(() => {
    const m = new Map<string, number>();
    index.data?.forEach((x, i) => {
      const l = letterOf(x.SortName ?? x.Name);
      if (!m.has(l)) m.set(l, i);
    });
    return m;
  }, [index.data]);

  const fetchPage = useCallback(
    (startIndex: number, limit = PAGE) => api.items({ parentId: id, types, sortBy: s.id, sortOrder: s.order, genre: genre || undefined, start: startIndex, limit }),
    [api, id, types, s, genre],
  );

  // New library, sort or genre: start from the top.
  useEffect(() => {
    if (!view.data) return;
    let live = true;
    setBusy(true);
    fetchPage(0).then((r) => {
      if (!live) return;
      setItems(r.Items);
      setStart(0);
      setTotal(r.TotalRecordCount);
      setBusy(false);
      setLoadedFor(`${s.id}|${genre}`);
    });
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fetchPage, view.data]);

  const loadMore = useCallback(async () => {
    if (busy || start + items.length >= total) return;
    setBusy(true);
    const r = await fetchPage(start + items.length);
    setItems((x) => x.concat(r.Items));
    setBusy(false);
  }, [busy, start, items.length, total, fetchPage]);

  const loadEarlier = async () => {
    if (busy || start === 0) return;
    setBusy(true);
    const from = Math.max(0, start - PAGE);
    const r = await fetchPage(from, start - from);
    keepScroll.current = { height: document.documentElement.scrollHeight, y: window.scrollY };
    setItems((x) => r.Items.concat(x));
    setStart(from);
    setBusy(false);
  };
  // Adding titles above shouldn't move what you're looking at.
  useLayoutEffect(() => {
    const k = keepScroll.current;
    if (!k) return;
    keepScroll.current = null;
    window.scrollTo({ top: k.y + document.documentElement.scrollHeight - k.height });
  }, [items]);

  // Load more when the end of the grid comes into view.
  useEffect(() => {
    const el = bottom.current;
    if (!el) return;
    const io = new IntersectionObserver((e) => e[0].isIntersecting && loadMore(), { rootMargin: '900px 0px' });
    io.observe(el);
    return () => io.disconnect();
  }, [loadMore]);

  const scrollToTile = (pos: number) => {
    const tile = grid.current?.children[pos] as HTMLElement | undefined;
    if (!tile) return;
    const bar = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--bar')) || 68;
    window.scrollTo({ top: tile.getBoundingClientRect().top + window.scrollY - bar - 70, behavior: 'smooth' });
  };

  const jump = useCallback(
    async (letter: string) => {
      if (!az) {
        // Letters only make sense in A–Z order: switch, then jump once the list reloads.
        setPendingLetter(letter);
        setSort(AZ);
        return;
      }
      const at = firstOf.get(letter);
      if (at == null) return;
      setCurrent(letter);
      jumpedAt.current = Date.now(); // keep the chosen letter lit while the page scrolls there
      if (at >= start && at < start + items.length) return scrollToTile(at - start);
      // Not loaded yet: show the list from that letter on ("Show earlier titles" fills in above).
      setBusy(true);
      const r = await fetchPage(at);
      setItems(r.Items);
      setStart(at);
      setTotal(r.TotalRecordCount);
      setBusy(false);
      const bar = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--bar')) || 68;
      requestAnimationFrame(() => window.scrollTo({ top: (grid.current?.getBoundingClientRect().top ?? 0) + window.scrollY - bar - 70 }));
    },
    [az, firstOf, start, items.length, fetchPage],
  );
  useEffect(() => {
    if (pendingLetter && az && loadedFor === `${AZ}|${genre}` && index.data && !busy && items.length) {
      const l = pendingLetter;
      setPendingLetter(null);
      jump(l);
    }
  }, [pendingLetter, az, loadedFor, genre, index.data, busy, items.length, jump]);

  // Light up the letter of the first title on screen while scrolling.
  useEffect(() => {
    if (!az) return setCurrent(null);
    let raf = 0;
    const on = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        if (Date.now() - jumpedAt.current < 1200) return;
        const kids = grid.current?.children;
        if (!kids?.length || !index.data) return;
        const bar = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--bar')) || 68;
        let lo = 0;
        let hi = kids.length - 1;
        while (lo < hi) {
          const mid = (lo + hi) >> 1;
          if ((kids[mid] as HTMLElement).getBoundingClientRect().bottom < bar + 20) lo = mid + 1;
          else hi = mid;
        }
        const entry = index.data[start + lo];
        if (entry) setCurrent(letterOf(entry.SortName ?? entry.Name));
      });
    };
    on();
    window.addEventListener('scroll', on, { passive: true });
    return () => {
      window.removeEventListener('scroll', on);
      cancelAnimationFrame(raf);
    };
  }, [az, index.data, start, items]);

  // Drag a finger (or the mouse) along the bar to scrub through letters.
  const scrubbing = useRef(false);
  const letterAt = (x: number, y: number) => (document.elementFromPoint(x, y) as HTMLElement | null)?.closest<HTMLElement>('[data-letter]')?.dataset.letter;

  return (
    <div className={`browse${az ? ' with-az' : ''}`}>
      <div className="browse-head">
        <h1>{view.data?.Name ?? ' '}</h1>
        <div className="browse-filters">
          <label className="filter">
            <span>Genre</span>
            <select className="select" value={genre} onChange={(e) => setGenre(e.target.value)}>
              <option value="">All genres</option>
              {genres.data?.map((g) => <option key={g.Id} value={g.Name}>{g.Name}</option>)}
            </select>
          </label>
          <label className="filter">
            <span>Sort by</span>
            <select className="select" value={sort} onChange={(e) => setSort(e.target.value)}>
              {SORTS.map((x) => <option key={x.id} value={x.id}>{x.label}</option>)}
            </select>
          </label>
        </div>
      </div>
      {total > 0 && <p className="browse-count">{total.toLocaleString()} {types === 'Series' ? 'shows' : 'titles'}{genre ? ` in ${genre}` : ''}</p>}

      {start > 0 && (
        <div className="browse-more top">
          <button className="btn" disabled={busy} onClick={loadEarlier}>
            Show earlier titles ({start.toLocaleString()})
          </button>
        </div>
      )}

      <div className="tile-grid" ref={grid}>{items.map((i) => <Tile key={i.Id} item={i} />)}</div>
      <div ref={bottom} className="browse-sentinel" aria-hidden="true" />

      {busy && items.length === 0 && <p className="muted">Loading…</p>}
      {!busy && view.data && items.length === 0 && <p className="muted">Nothing here{genre ? ` in ${genre}` : ''} yet.</p>}
      {busy && items.length > 0 && <p className="muted browse-loading">Loading more…</p>}

      {(index.data?.length ?? 0) > 0 && (
        <nav
          className="az-bar"
          aria-label="Jump to letter"
          onPointerDown={(e) => {
            scrubbing.current = true;
            e.currentTarget.setPointerCapture(e.pointerId);
            const l = letterAt(e.clientX, e.clientY);
            if (l && firstOf.has(l)) jump(l);
          }}
          onPointerMove={(e) => {
            if (!scrubbing.current) return;
            const l = letterAt(e.clientX, e.clientY);
            if (l && l !== current && firstOf.has(l)) jump(l);
          }}
          onPointerUp={() => (scrubbing.current = false)}
          onPointerCancel={() => (scrubbing.current = false)}
        >
          {LETTERS.map((l) => (
            <button
              key={l}
              data-letter={l}
              className={`${current === l ? 'on' : ''}${firstOf.has(l) ? '' : ' empty'}`}
              disabled={!firstOf.has(l)}
              aria-label={l === '#' ? 'Numbers and symbols' : l}
              onClick={(e) => e.detail === 0 && jump(l)}
            >
              {l}
            </button>
          ))}
        </nav>
      )}
    </div>
  );
}
