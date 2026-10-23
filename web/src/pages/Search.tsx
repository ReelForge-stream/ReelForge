import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { PersonPic } from '../lib/SearchBox';
import { onlyClose, searchTitles, titleIndex } from '../lib/search';
import type { Item } from '../lib/types';
import { Tile, useApi } from '../lib/ui';

/** Full search: instant, typo-tolerant title matches as you type, plus people and episodes from the server. */
export default function Search() {
  const api = useApi();
  const nav = useNavigate();
  const [params, setParams] = useSearchParams();
  const [term, setTerm] = useState(params.get('q') ?? '');
  const [index, setIndex] = useState<Item[] | null>(null);
  const [people, setPeople] = useState<Item[]>([]);
  const [episodes, setEpisodes] = useState<Item[]>([]);
  const personId = params.get('person');
  const personName = params.get('name') ?? '';
  const [personItems, setPersonItems] = useState<Item[] | null>(null);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    titleIndex(api).then(setIndex).catch(() => setIndex([]));
  }, [api]);

  // Keep the address in step with the box, so Back and shared links work.
  useEffect(() => {
    const t = setTimeout(() => {
      const q = term.trim();
      if ((params.get('q') ?? '') !== q || personId) setParams(q ? { q } : {}, { replace: true });
    }, 300);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [term]);

  useEffect(() => {
    if (!personId) {
      setPersonItems(null);
      return;
    }
    api.byPerson(personId).then(setPersonItems).catch(() => setPersonItems([]));
  }, [api, personId]);

  useEffect(() => {
    const q = term.trim();
    if (q.length < 2) {
      setPeople([]);
      setEpisodes([]);
      return;
    }
    let live = true;
    const t = setTimeout(() => {
      api.people(q, 8).then((p) => live && setPeople(p)).catch(() => undefined);
      api.items({ search: q, types: 'Episode', limit: 24 }).then((r) => live && setEpisodes(r.Items)).catch(() => undefined);
    }, 250);
    return () => {
      live = false;
      clearTimeout(t);
    };
  }, [api, term]);

  const results = useMemo(() => (index && term.trim() ? searchTitles(term, index, 80).map((r) => r.item) : []), [index, term]);
  const movies = results.filter((i) => i.Type === 'Movie');
  const shows = results.filter((i) => i.Type === 'Series');
  const close = onlyClose(term, results[0]);
  const q = term.trim();

  return (
    <div className="browse search-page">
      <div className="search-field">
        <input
          ref={input}
          className="input"
          placeholder="Search titles, people and episodes"
          aria-label="Search"
          autoFocus
          autoComplete="off"
          spellCheck={false}
          value={term}
          onChange={(e) => setTerm(e.target.value)}
        />
        {term && (
          <button className="searchbox-clear big" aria-label="Clear search" onClick={() => { setTerm(''); input.current?.focus(); }}>
            ×
          </button>
        )}
      </div>

      {personId && personItems && !q && (
        <section className="search-section">
          <h2>With {personName}</h2>
          {personItems.length ? <div className="tile-grid">{personItems.map((i) => <Tile key={i.Id} item={i} />)}</div> : <p className="muted">Nothing in your library with {personName}.</p>}
        </section>
      )}

      {!q && !personId && <p className="muted search-hint">Start typing: titles appear as you go, even with typos or initials like “lotr”.</p>}

      {q && index && results.length === 0 && people.length === 0 && episodes.length === 0 && <p className="muted search-hint">Nothing in your library is close to “{q}”.</p>}
      {q && close && results.length > 0 && <p className="muted search-hint">No exact matches. Showing the closest titles.</p>}

      {q && people.length > 0 && (
        <section className="search-section">
          <h2>Cast &amp; crew</h2>
          <div className="person-chips">
            {people.map((p) => (
              <button key={p.Id} className="person-chip" onClick={() => nav(`/person/${p.Id}`)}>
                <span className="suggest-pic round"><PersonPic p={p} /></span>
                {p.Name}
              </button>
            ))}
          </div>
        </section>
      )}
      {q && movies.length > 0 && (
        <section className="search-section">
          <h2>Movies</h2>
          <div className="tile-grid">{movies.map((i) => <Tile key={i.Id} item={i} />)}</div>
        </section>
      )}
      {q && shows.length > 0 && (
        <section className="search-section">
          <h2>TV shows</h2>
          <div className="tile-grid">{shows.map((i) => <Tile key={i.Id} item={i} />)}</div>
        </section>
      )}
      {q && episodes.length > 0 && (
        <section className="search-section">
          <h2>Episodes</h2>
          <div className="tile-grid">{episodes.map((i) => <Tile key={i.Id} item={i} />)}</div>
        </section>
      )}
    </div>
  );
}
