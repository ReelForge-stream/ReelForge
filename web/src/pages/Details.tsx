import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { bytes, runtime } from '../lib/api';
import type { Item } from '../lib/types';
import { Art, Card, Icon, epCode, useApi, useAsync, useToast } from '../lib/ui';

export default function Details() {
  const { id = '' } = useParams();
  const api = useApi();
  const item = useAsync(() => api.item(id), [id]);

  if (item.error) return <div className="err-box">Couldn’t load this title: {item.error}</div>;
  if (!item.data) return <div className="loading">Loading…</div>;
  return item.data.Type === 'Series' ? <SeriesView item={item.data} /> : <MovieView item={item.data} onChange={item.reload} />;
}

function Header({ item, children }: { item: Item; children: React.ReactNode }) {
  return (
    <section className="hero detail-hero">
      <div className="backdrop">
        <Art item={item} kind="Backdrop" width={1920} />
      </div>
      <div className="copy">
        <h1 className="title">{item.Name}</h1>
        <div className="facts">
          {item.ProductionYear && <span>{item.ProductionYear}</span>}
          {item.OfficialRating && <span>{item.OfficialRating}</span>}
          {item.RunTimeTicks && <span>{runtime(item.RunTimeTicks)}</span>}
          {item.CommunityRating && <span>★ {item.CommunityRating.toFixed(1)}</span>}
          {item.Genres?.slice(0, 3).map((g) => <span key={g}>{g}</span>)}
        </div>
        {children}
      </div>
    </section>
  );
}

function MovieView({ item, onChange }: { item: Item; onChange: () => void }) {
  const api = useApi();
  const nav = useNavigate();
  const toast = useToast();
  const pct = item.UserData?.PlayedPercentage;
  const played = !!item.UserData?.Played;

  const toggle = async () => {
    await api.markPlayed(item.Id, !played);
    toast(played ? 'Marked as unwatched' : 'Marked as watched');
    onChange();
  };

  return (
    <>
      <Header item={item}>
        <div className="actions">
          <button className="btn primary lg" onClick={() => nav(`/play/${item.Id}`)}>
            <Icon.play />
            {pct ? 'Resume' : 'Play'}
          </button>
          {pct ? (
            <button className="btn lg" onClick={() => nav(`/play/${item.Id}?from=start`)}>
              Start over
            </button>
          ) : null}
          <button className="btn lg" onClick={toggle} aria-pressed={played}>
            <Icon.check />
            {played ? 'Watched' : 'Mark watched'}
          </button>
        </div>
      </Header>
      <div className="detail-body">
        <div>
          {item.Overview && <p className="measure" style={{ fontSize: '1.08rem' }}>{item.Overview}</p>}
          {item.MediaSources && item.MediaSources.length > 1 && (
            <p className="muted small" style={{ marginTop: 16 }}>
              {item.MediaSources.length} versions on disk ({item.MediaSources.map((s) => bytes(s.Size ?? 0)).join(', ')}). Duplicates can be cleaned up in Media Manager.
            </p>
          )}
        </div>
        <People item={item} />
      </div>
    </>
  );
}

function People({ item }: { item: Item }) {
  const people = (item.People ?? []).filter((p) => p.Type === 'Director' || p.Type === 'Actor').slice(0, 8);
  if (!people.length) return null;
  return (
    <aside className="people">
      {people.map((p) => (
        <div key={`${p.Name}-${p.Type}`}>
          <span>{p.Name}</span>
          <span className="muted">{p.Type === 'Director' ? 'Director' : p.Role}</span>
        </div>
      ))}
    </aside>
  );
}

function SeriesView({ item }: { item: Item }) {
  const api = useApi();
  const nav = useNavigate();
  const seasons = useAsync(() => api.seasons(item.Id), [item.Id]);
  const [season, setSeason] = useState<string | null>(null);

  useEffect(() => {
    if (!season && seasons.data?.length) {
      // Open on the first season with something unwatched, else the first one.
      const s = seasons.data.find((x) => (x.UserData?.UnplayedItemCount ?? 0) > 0) ?? seasons.data[0];
      setSeason(s.Id);
    }
  }, [season, seasons.data]);

  const episodes = useAsync(() => (season ? api.episodes(item.Id, season) : Promise.resolve([] as Item[])), [item.Id, season]);
  const next = episodes.data?.find((e) => !e.UserData?.Played);

  return (
    <>
      <Header item={item}>
        <div className="actions">
          {next && (
            <button className="btn primary lg" onClick={() => nav(`/play/${next.Id}`)}>
              <Icon.play />
              {next.UserData?.PlayedPercentage ? 'Resume' : 'Play'} {epCode(next)}
            </button>
          )}
        </div>
      </Header>
      <div className="detail-body">
        <div>
          {item.Overview && <p className="measure" style={{ fontSize: '1.08rem', marginBottom: 32 }}>{item.Overview}</p>}
          <div className="season-tabs chips" role="tablist">
            {seasons.data?.map((s) => (
              <button key={s.Id} role="tab" className="chip" aria-pressed={season === s.Id} aria-selected={season === s.Id} onClick={() => setSeason(s.Id)}>
                {s.Name}
              </button>
            ))}
          </div>
          <div className="episodes">
            {episodes.data?.map((e) => (
              <div key={e.Id} className="episode" role="link" tabIndex={0} onClick={() => nav(`/play/${e.Id}`)} onKeyDown={(k) => k.key === 'Enter' && nav(`/play/${e.Id}`)}>
                <Card item={e} shape="thumb" showLabel={false} />
                <div>
                  <h3>
                    {e.IndexNumber}. {e.Name}
                  </h3>
                  <span className="muted small">{runtime(e.RunTimeTicks)}{e.UserData?.Played ? ' · Watched' : ''}</span>
                  {e.Overview && <p>{e.Overview}</p>}
                </div>
              </div>
            ))}
          </div>
        </div>
        <People item={item} />
      </div>
    </>
  );
}
