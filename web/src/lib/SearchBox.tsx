import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { searchTitles, titleIndex } from './search';
import type { Item } from './types';
import { Art, Icon, useApi } from './ui';

/** Bold the part of a title that matches what was typed (when it appears as typed). */
export function Highlight({ text, query }: { text: string; query: string }): ReactNode {
  const q = query.trim().toLowerCase();
  const i = q ? text.toLowerCase().indexOf(q) : -1;
  if (i < 0) return text;
  return (
    <>
      {text.slice(0, i)}
      <mark>{text.slice(i, i + q.length)}</mark>
      {text.slice(i + q.length)}
    </>
  );
}

const kindLabel = (i: Item) => (i.Type === 'Series' ? 'TV show' : i.Type === 'Movie' ? 'Movie' : i.Type);

/**
 * Top-bar search: opens in place, suggests matching movies, shows and people as you type
 * (typos and initials included), Enter goes to the full results.
 */
export default function SearchBox() {
  const api = useApi();
  const nav = useNavigate();
  const location = useLocation();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const [index, setIndex] = useState<Item[] | null>(null);
  const [people, setPeople] = useState<Item[]>([]);
  const [sel, setSel] = useState(-1);
  const wrap = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const onSearchPage = location.pathname === '/search';

  // Load the title list when the box opens (cached for a few minutes).
  useEffect(() => {
    if (open && !index) titleIndex(api).then(setIndex).catch(() => setIndex([]));
  }, [open, index, api]);

  // People (actors, directors) come from the server, a moment after typing stops.
  useEffect(() => {
    const term = q.trim();
    if (term.length < 3) {
      setPeople([]);
      return;
    }
    let live = true;
    const t = setTimeout(() => api.people(term, 3).then((p) => live && setPeople(p)).catch(() => undefined), 220);
    return () => {
      live = false;
      clearTimeout(t);
    };
  }, [q, api]);

  const titles = useMemo(() => (index && q.trim() ? searchTitles(q, index, 7).map((r) => r.item) : []), [index, q]);
  const rows: ({ kind: 'title'; item: Item } | { kind: 'person'; item: Item } | { kind: 'all' })[] = [
    ...titles.map((item) => ({ kind: 'title' as const, item })),
    ...people.map((item) => ({ kind: 'person' as const, item })),
    ...(q.trim() ? [{ kind: 'all' as const }] : []),
  ];
  useEffect(() => setSel(-1), [q]);

  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => {
      if (!wrap.current?.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', away);
    return () => document.removeEventListener('mousedown', away);
  }, [open]);

  const close = () => {
    setOpen(false);
    setQ('');
    input.current?.blur();
  };
  const choose = (r: (typeof rows)[number] | undefined) => {
    const term = q.trim();
    if (!r || r.kind === 'all') {
      if (term) nav(`/search?q=${encodeURIComponent(term)}`);
      close();
      return;
    }
    if (r.kind === 'person') nav(`/search?person=${r.item.Id}&name=${encodeURIComponent(r.item.Name)}`);
    else {
      const bg = (location.state as { background?: unknown } | null)?.background ?? location;
      nav(`/item/${r.item.Id}`, { state: { background: bg } });
    }
    close();
  };

  if (onSearchPage) return null; // the page has its own big search field

  return (
    <div className={`searchbox${open ? ' open' : ''}`} ref={wrap}>
      <button
        className="icon-btn searchbox-icon"
        aria-label="Search"
        onClick={() => {
          if (window.matchMedia('(max-width: 860px)').matches) return nav('/search');
          setOpen(true);
          setTimeout(() => input.current?.focus(), 0);
        }}
      >
        <Icon.search />
      </button>
      {open && (
        <>
          <input
            ref={input}
            className="searchbox-input"
            placeholder="Titles, people, genres"
            aria-label="Search"
            role="combobox"
            aria-expanded={rows.length > 0}
            aria-controls="search-suggest"
            aria-activedescendant={sel >= 0 ? `sug-${sel}` : undefined}
            autoComplete="off"
            spellCheck={false}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'ArrowDown') {
                e.preventDefault();
                setSel((s) => Math.min(rows.length - 1, s + 1));
              } else if (e.key === 'ArrowUp') {
                e.preventDefault();
                setSel((s) => Math.max(-1, s - 1));
              } else if (e.key === 'Enter') {
                e.preventDefault();
                choose(sel >= 0 ? rows[sel] : undefined);
              } else if (e.key === 'Escape') close();
            }}
          />
          {q && (
            <button className="searchbox-clear" aria-label="Clear search" onClick={() => { setQ(''); input.current?.focus(); }}>
              <Icon.close />
            </button>
          )}
          {q.trim() && (
            <div className="suggest" id="search-suggest" role="listbox" aria-label="Suggestions">
              {!index && <p className="suggest-note">Loading your library…</p>}
              {index && titles.length === 0 && people.length === 0 && <p className="suggest-note">No titles like “{q.trim()}”.</p>}
              {rows.map((r, n) =>
                r.kind === 'all' ? (
                  <button key="all" id={`sug-${n}`} role="option" aria-selected={sel === n} className={`suggest-all${sel === n ? ' sel' : ''}`} onMouseEnter={() => setSel(n)} onClick={() => choose(r)}>
                    <Icon.search />
                    See all results for “{q.trim()}”
                  </button>
                ) : (
                  <button key={r.item.Id} id={`sug-${n}`} role="option" aria-selected={sel === n} className={`suggest-row${sel === n ? ' sel' : ''}${r.kind === 'person' ? ' person' : ''}`} onMouseEnter={() => setSel(n)} onClick={() => choose(r)}>
                    <span className="suggest-pic">{r.kind === 'person' ? <PersonPic p={r.item} /> : <Art item={r.item} kind="Primary" width={96} bare />}</span>
                    <span className="suggest-text">
                      <span className="suggest-title"><Highlight text={r.item.Name} query={q} /></span>
                      <span className="suggest-sub">{r.kind === 'person' ? 'Cast & crew' : [r.item.ProductionYear, kindLabel(r.item)].filter(Boolean).join(' · ')}</span>
                    </span>
                  </button>
                ),
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}

export function PersonPic({ p }: { p: Item }) {
  const api = useApi();
  const url = api.image(p, 'Primary', 96);
  const [failed, setFailed] = useState(false);
  if (url && !failed) return <img src={url} alt="" loading="lazy" onError={() => setFailed(true)} />;
  return <span className="person-initial">{p.Name.trim().charAt(0)}</span>;
}
