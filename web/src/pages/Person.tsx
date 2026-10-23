import { useMemo, useState } from 'react';
import { useParams } from 'react-router-dom';
import type { Item } from '../lib/types';
import { Tile, useApi, useAsync } from '../lib/ui';

/**
 * An actor (or director, writer…): photo, short bio, and everything they're in on this server.
 * Guest spots in episodes are grouped under their show.
 */
export default function Person() {
  const { id = '' } = useParams();
  const api = useApi();
  const person = useAsync(() => api.item(id), [id]);
  const titles = useAsync(() => api.appearances(id), [id]);
  const [bioOpen, setBioOpen] = useState(false);

  const { movies, shows } = useMemo(() => {
    const items = titles.data ?? [];
    const movies = items.filter((i) => i.Type === 'Movie');
    // A show they're in, either as main cast or in some episodes.
    const shows = new Map<string, { show: Item; episodes: Item[] }>();
    for (const i of items) {
      if (i.Type === 'Series') shows.set(i.Id, { show: i, episodes: shows.get(i.Id)?.episodes ?? [] });
    }
    for (const e of items.filter((i) => i.Type === 'Episode' && i.SeriesId)) {
      const entry = shows.get(e.SeriesId!) ?? { show: { Id: e.SeriesId!, Name: e.SeriesName ?? e.Name, Type: 'Series' } as Item, episodes: [] };
      entry.episodes.push(e);
      shows.set(e.SeriesId!, entry);
    }
    return { movies, shows: [...shows.values()] };
  }, [titles.data]);

  if (person.error) return <div className="page"><div className="err-box">Couldn’t load this person: {person.error}</div></div>;
  const p = person.data;
  const photo = p ? api.image(p, 'Primary', 400) : undefined;
  const born = p?.PremiereDate ? new Date(p.PremiereDate) : null;
  const died = p?.EndDate ? new Date(p.EndDate) : null;
  const age = born ? Math.floor(((died ?? new Date()).getTime() - born.getTime()) / 31557600000) : null;
  const total = movies.length + shows.length;

  return (
    <div className="page person-page">
      <header className="person-head">
        <div className="person-photo">{photo ? <img src={photo} alt="" /> : <span className="person-initial">{p?.Name?.charAt(0) ?? ''}</span>}</div>
        <div className="person-info">
          <h1>{p?.Name ?? ' '}</h1>
          {(born || p?.ProductionLocations?.length) && (
            <p className="muted">
              {born && `Born ${born.toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' })}`}
              {born && !died && age != null && ` (age ${age})`}
              {p?.ProductionLocations?.[0] && ` in ${p.ProductionLocations[0]}`}
              {died && ` · died ${died.toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' })} (age ${age})`}
            </p>
          )}
          {p?.Overview && (
            <>
              <p className={`person-bio${bioOpen ? ' open' : ''}`}>{p.Overview}</p>
              {p.Overview.length > 420 && <button className="more-link as-button" onClick={() => setBioOpen((o) => !o)}>{bioOpen ? 'Less' : 'More'}</button>}
            </>
          )}
          {titles.data && <p className="hint">{total ? `${total} ${total === 1 ? 'title' : 'titles'} on this server` : 'Nothing on this server with them yet.'}</p>}
        </div>
      </header>

      {!titles.data && !titles.error && <p className="muted">Finding everything they’re in…</p>}
      {movies.length > 0 && (
        <section className="search-section">
          <h2>Movies</h2>
          <div className="tile-grid">{movies.map((i) => <Tile key={i.Id} item={i} />)}</div>
        </section>
      )}
      {shows.length > 0 && (
        <section className="search-section">
          <h2>TV shows</h2>
          <div className="tile-grid">
            {shows.map(({ show, episodes }) => (
              <div key={show.Id} className="person-show">
                <Tile item={show} />
                {episodes.length > 0 && (
                  <span className="hint">
                    {episodes.length === 1 ? `In ${episodeLabel(episodes[0])}` : `In ${episodes.length} episodes`}
                  </span>
                )}
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

function episodeLabel(e: Item): string {
  return e.ParentIndexNumber != null && e.IndexNumber != null ? `S${e.ParentIndexNumber}:E${e.IndexNumber} “${e.Name}”` : `“${e.Name}”`;
}
