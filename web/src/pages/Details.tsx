import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import type { Item } from '../lib/types';
import { publishItem, useItemMenu, useLiveItem, useMenuTrigger, useOnItemUpdated } from '../lib/itemMenu';
import { Art, Icon, isRecent, useApi, useAsync, useDetailsLink, useToast } from '../lib/ui';
import { useCanDownload } from '../lib/download';

/** Figma: "MovieDetails / Inside" (118:2845), an 850px overlay above the page it was opened from. */
export default function Details({ hasBackground }: { hasBackground: boolean }) {
  const { id = '' } = useParams();
  const api = useApi();
  const nav = useNavigate();
  const item = useAsync(() => api.item(id), [id]);
  const panel = useRef<HTMLDivElement>(null);
  useOnItemUpdated(id, item.reload); // artwork or watched state changed from a menu

  const close = () => (hasBackground ? nav(-1) : nav('/', { replace: true }));

  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    // Escape closes the panel, unless a menu or editor is open on top of it (that closes first).
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && !document.querySelector('.item-menu, .art-dialog') && close();
    window.addEventListener('keydown', esc);
    return () => {
      document.body.style.overflow = prev;
      window.removeEventListener('keydown', esc);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  // Braces matter: an effect must return nothing or a cleanup function, and some browser
  // extensions make scrollTo() return a value, which crashed the page when the panel closed.
  useEffect(() => {
    if (panel.current) panel.current.scrollTop = 0;
  }, [id]);

  return (
    <div className="details-back" ref={panel} onClick={close}>
      <article className="details" role="dialog" aria-modal="true" aria-label={item.data?.Name ?? 'Details'} onClick={(e) => e.stopPropagation()}>
        <button className="details-close" aria-label="Close" onClick={close}>
          <Icon.close />
        </button>
        {item.error && <p className="err-box">Couldn’t load this title: {item.error}</p>}
        {!item.data && !item.error && <div className="details-hero placeholder" />}
        {item.data && <DetailsBody item={item.data} />}
      </article>
    </div>
  );
}

function DetailsBody({ item }: { item: Item }) {
  const api = useApi();
  const nav = useNavigate();
  const toast = useToast();
  const isSeries = item.Type === 'Series';
  const logo = api.image(item, 'Logo', 700);
  const [logoOk, setLogoOk] = useState(true);
  const fav = !!item.UserData?.IsFavorite;
  const played = !!item.UserData?.Played;

  const seasons = useAsync(() => (isSeries ? api.seasons(item.Id) : Promise.resolve([] as Item[])), [item.Id]);
  const [season, setSeason] = useState<string | null>(null);
  useEffect(() => {
    if (!season && seasons.data?.length) setSeason((seasons.data.find((x) => (x.UserData?.UnplayedItemCount ?? 0) > 0) ?? seasons.data[0]).Id);
  }, [season, seasons.data]);
  const episodes = useAsync(() => (isSeries && season ? api.episodes(item.Id, season) : Promise.resolve([] as Item[])), [item.Id, season]);
  const nextEp = episodes.data?.find((e) => !e.UserData?.Played);
  const similar = useAsync(() => api.similar(item.Id).catch(() => [] as Item[]), [item.Id]);
  const [moreOpen, setMoreOpen] = useState(false);

  const playTarget = isSeries ? nextEp?.Id ?? episodes.data?.[0]?.Id : item.Id;
  const resumable = isSeries ? (nextEp?.UserData?.PlayedPercentage ?? 0) > 0 : (item.UserData?.PlayedPercentage ?? 0) > 0;

  const menu = useItemMenu();
  const canDownload = useCanDownload();
  const heroMenu = useMenuTrigger(item);
  const toggleFav = async () => {
    await api.setFavorite(item.Id, !fav);
    toast(fav ? 'Removed from My List' : 'Added to My List');
    publishItem(await api.item(item.Id));
  };
  const toggleWatched = async () => {
    await api.markPlayed(item.Id, !played);
    toast(played ? 'Marked as unwatched' : 'Marked as watched');
    publishItem(await api.item(item.Id));
  };

  const cast = (item.People ?? []).filter((p) => p.Type === 'Actor');
  const directors = (item.People ?? []).filter((p) => p.Type === 'Director');
  const writers = (item.People ?? []).filter((p) => p.Type === 'Writer');
  const videoHeight = item.MediaStreams?.find((s) => s.Type === 'Video')?.Height ?? item.MediaSources?.[0]?.MediaStreams?.find((s) => s.Type === 'Video')?.Height;
  const quality = videoHeight ? (videoHeight >= 1600 ? '4K' : videoHeight >= 700 ? 'HD' : null) : null;
  const seasonCount = seasons.data?.length;

  return (
    <>
      <section className="details-hero" {...heroMenu}>
        <Art item={item} kind="Backdrop" width={1280} />
        <div className="details-hero-shade" aria-hidden="true" />
        <div className="details-hero-copy">
          {logo && logoOk ? <img className="details-logo" src={logo} alt={item.Name} onError={() => setLogoOk(false)} /> : <h1 className="details-title">{item.Name}</h1>}
          <div className="details-actions">
            <button className="btn-play" disabled={!playTarget} onClick={() => playTarget && nav(`/play/${playTarget}`)}>
              <Icon.play />
              {resumable ? 'Resume' : 'Play'}
            </button>
            <button className={`circle-btn${fav ? ' on' : ''}`} aria-pressed={fav} aria-label={fav ? 'Remove from My List' : 'Add to My List'} title={fav ? 'Remove from My List' : 'Add to My List'} onClick={toggleFav}>
              {fav ? <Icon.check /> : <Icon.plus />}
            </button>
            {!isSeries && (
              <button className={`circle-btn${played ? ' on' : ''}`} aria-pressed={played} aria-label={played ? 'Mark as unwatched' : 'Mark as watched'} title={played ? 'Mark as unwatched' : 'Mark as watched'} onClick={toggleWatched}>
                <Icon.check />
              </button>
            )}
            {!isSeries && menu && canDownload && (
              <button className="circle-btn" aria-label="Download" title="Download to this device" onClick={() => menu.download(item)}>
                <Icon.download />
              </button>
            )}
            {menu && (
              <button
                className="circle-btn"
                aria-label="More options"
                title={api.isAdmin ? 'More: edit info, fix match, artwork' : 'More options'}
                onClick={(e) => {
                  const r = e.currentTarget.getBoundingClientRect();
                  menu.open(item, r.left, r.bottom + 6);
                }}
              >
                <Icon.more />
              </button>
            )}
          </div>
        </div>
      </section>

      <section className="details-info">
        <div className="details-main">
          <div className="meta-line">
            {isRecent(item) && <span className="meta-new">New</span>}
            {item.ProductionYear && <span>{item.ProductionYear}</span>}
            {isSeries && seasonCount ? <span>{seasonCount} {seasonCount === 1 ? 'Season' : 'Seasons'}</span> : null}
            {!isSeries && item.RunTimeTicks ? <span>{hm(item.RunTimeTicks)}</span> : null}
            {quality && <span className="quality">{quality}</span>}
          </div>
          <div className="meta-line">
            {item.OfficialRating && <span className="rating-box">{item.OfficialRating}</span>}
            <Scores item={item} />
          </div>
          {item.Taglines?.[0] && <p className="tagline">{item.Taglines[0]}</p>}
          {item.Overview && <p className="details-overview">{item.Overview}</p>}
        </div>
        <div className="details-side">
          {cast.length > 0 && (
            <p>
              <span className="meta-dim">Cast: </span>
              {cast.slice(0, 3).map((p, i) => (
                <span key={p.Id ?? p.Name}>
                  {i > 0 && ', '}
                  {p.Id ? <Link className="person-link" to={`/person/${p.Id}`}>{p.Name}</Link> : p.Name}
                </span>
              ))}
              {cast.length > 3 && <>, <a href="#cast" className="more-link">more</a></>}
            </p>
          )}
          {item.Genres?.length ? <p><span className="meta-dim">Genres: </span>{item.Genres.join(', ')}</p> : null}
          {item.Studios?.length ? <p><span className="meta-dim">{isSeries ? 'Network' : 'Studio'}: </span>{item.Studios.slice(0, 2).map((s) => s.Name).join(', ')}</p> : null}
        </div>
      </section>

      {isSeries && (
        <section className="details-section">
          <div className="section-head">
            <h2>Episodes</h2>
            {seasons.data && seasons.data.length > 1 ? (
              <select className="select season-select" aria-label="Season" value={season ?? ''} onChange={(e) => setSeason(e.target.value)}>
                {seasons.data.map((s) => (
                  <option key={s.Id} value={s.Id}>{s.Name}</option>
                ))}
              </select>
            ) : (
              <span className="section-aside">{seasons.data?.[0]?.Name ?? ''}</span>
            )}
          </div>
          <ol className="episode-list">
            {episodes.data?.map((e) => (
              <li key={e.Id}>
                <EpisodeRow e={e} current={e.Id === nextEp?.Id} onPlay={() => nav(`/play/${e.Id}`)} />
              </li>
            ))}
          </ol>
        </section>
      )}

      {cast.length > 0 && <CastRow cast={cast} />}

      {similar.data && similar.data.length > 0 && (
        <section className="details-section">
          <div className="section-head"><h2>More Like This</h2></div>
          <div className={`similar-grid${moreOpen ? ' open' : ''}`}>
            {similar.data.slice(0, moreOpen ? 12 : 6).map((s) => <SimilarCard key={s.Id} item={s} />)}
          </div>
          {similar.data.length > 6 && (
            <div className="similar-more">
              <button className={`circle-btn${moreOpen ? ' flip' : ''}`} aria-label={moreOpen ? 'Show fewer' : 'Show more'} onClick={() => setMoreOpen((o) => !o)}>
                <Icon.chevronDown />
              </button>
            </div>
          )}
        </section>
      )}

      <section className="details-section about" id="about">
        <h2>About <strong>{item.Name}</strong></h2>
        {directors.length > 0 && <p><span className="meta-dim">Director: </span>{directors.map((p) => p.Name).join(', ')}</p>}
        {cast.length > 0 && (
          <p>
            <span className="meta-dim">Cast: </span>
            {cast.slice(0, 15).map((p, i) => (
              <span key={p.Id ?? p.Name}>
                {i > 0 && ', '}
                {p.Id ? <Link className="person-link" to={`/person/${p.Id}`}>{p.Name}</Link> : p.Name}
              </span>
            ))}
          </p>
        )}
        {writers.length > 0 && <p><span className="meta-dim">Writer: </span>{writers.map((p) => p.Name).join(', ')}</p>}
        {item.Genres?.length ? <p><span className="meta-dim">Genres: </span>{item.Genres.join(', ')}</p> : null}
        {item.OfficialRating && <p><span className="meta-dim">Maturity rating: </span><span className="rating-box">{item.OfficialRating}</span></p>}
      </section>
    </>
  );
}

function EpisodeRow({ e: given, current, onPlay }: { e: Item; current: boolean; onPlay: () => void }) {
  const e = useLiveItem(given);
  const menu = useMenuTrigger(e);
  return (
    <button className={`episode-row${current ? ' current' : ''}`} onClick={onPlay} {...menu}>
      <span className="ep-num">{e.IndexNumber}</span>
      <span className="ep-thumb">
        <Art item={e} kind="Thumb" width={320} />
        <span className="ep-play" aria-hidden="true"><Icon.play /></span>
        {e.UserData?.PlayedPercentage ? <span className="ep-progress"><span style={{ width: `${e.UserData.PlayedPercentage}%` }} /></span> : null}
        {e.UserData?.Played && <span className="tile-watched" title="Watched"><Icon.check /></span>}
      </span>
      <span className="ep-text">
        <span className="ep-head">
          <span className="ep-title">{e.Name}</span>
          <span className="ep-time">{e.RunTimeTicks ? `${Math.round(e.RunTimeTicks / 6e8)}m` : ''}</span>
        </span>
        {e.Overview && <span className="ep-overview">{e.Overview}</span>}
      </span>
    </button>
  );
}

/** Figma: More Like This card: art with runtime, rating/year/+ row, overview. */
function SimilarCard({ item: given }: { item: Item }) {
  const api = useApi();
  const link = useDetailsLink();
  const item = useLiveItem(given);
  const menu = useMenuTrigger(item);
  const toast = useToast();
  const [fav, setFav] = useState(!!item.UserData?.IsFavorite);
  const toggle = async (e: React.MouseEvent) => {
    e.preventDefault();
    await api.setFavorite(item.Id, !fav);
    setFav(!fav);
    toast(fav ? 'Removed from My List' : 'Added to My List');
  };
  return (
    <Link className="similar-card" {...link(item)} {...menu} replace>
      <span className="similar-art">
        <Art item={item} kind="Thumb" width={400} />
        {item.RunTimeTicks ? <span className="similar-time">{hm(item.RunTimeTicks)}</span> : null}
        <span className="similar-name">{item.Name}</span>
      </span>
      <span className="similar-meta">
        <span className="similar-tags">
          {item.OfficialRating && <span className="rating-box">{item.OfficialRating}</span>}
          {item.ProductionYear && <span className="meta-dim">{item.ProductionYear}</span>}
        </span>
        <button className={`circle-btn sm${fav ? ' on' : ''}`} aria-label={fav ? 'Remove from My List' : 'Add to My List'} onClick={toggle}>
          {fav ? <Icon.check /> : <Icon.plus />}
        </button>
      </span>
      {item.Overview && <span className="similar-overview">{item.Overview}</span>}
    </Link>
  );
}

function hm(ticks: number): string {
  const m = Math.round(ticks / 6e8);
  return m >= 60 ? `${Math.floor(m / 60)}h ${m % 60}m` : `${m}m`;
}

/** IMDb and Rotten Tomatoes scores (from OMDb when the server has a key; otherwise what the library has). */
function Scores({ item }: { item: Item }) {
  const api = useApi();
  const r = useAsync(() => api.ratings(item.Id).catch(() => null), [item.Id]);
  const d = r.data;
  if (!d) return item.CommunityRating ? <span className="meta-dim">★ {item.CommunityRating.toFixed(1)}</span> : null;
  const imdbUrl = d.ImdbId ? `https://www.imdb.com/title/${d.ImdbId}/` : undefined;
  return (
    <span className="scores">
      {d.Imdb != null && (
        <a className="score imdb" href={imdbUrl} target="_blank" rel="noreferrer" title={d.ImdbVotes ? `IMDb · ${d.ImdbVotes.toLocaleString()} votes` : 'IMDb'}>
          <span className="score-label">IMDb</span>
          <strong>{d.Imdb.toFixed(1)}</strong>
          <span className="score-of">/10</span>
        </a>
      )}
      {d.RottenTomatoes != null && (
        <span className={`score rt ${d.RottenTomatoes >= 60 ? 'fresh' : 'rotten'}`} title={`Rotten Tomatoes Tomatometer: ${d.RottenTomatoes >= 60 ? 'fresh' : 'rotten'}`}>
          <TomatoIcon fresh={d.RottenTomatoes >= 60} />
          <strong>{d.RottenTomatoes}%</strong>
          <span className="score-label">Rotten Tomatoes</span>
        </span>
      )}
      {d.Imdb == null && d.Community != null && (
        <span className="meta-dim" title="Audience rating from your library’s metadata">★ {d.Community.toFixed(1)}</span>
      )}
    </span>
  );
}

/** A plain tomato (fresh) or splat (rotten): our own drawing, not Rotten Tomatoes' logo. */
function TomatoIcon({ fresh }: { fresh: boolean }) {
  return fresh ? (
    <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
      <circle cx="12" cy="13.5" r="8" fill="currentColor" />
      <path d="M12 5.5c-1.2-1.6-3-2.1-4.6-1.6 1.1.5 2 1.4 2.4 2.6M12 5.5c1-1.6 2.9-2.2 4.6-1.7-1.1.5-2.1 1.4-2.5 2.6M12 5.5V3" stroke="#3FA34D" strokeWidth="1.6" fill="none" strokeLinecap="round" />
    </svg>
  ) : (
    <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
      <path d="M12 4l1.6 4.2 4.4-1.6-1.8 4.3 4.3 1.7-4.4 1.6 1.7 4.4-4.3-1.9-1.5 4.3-1.6-4.3-4.3 1.9 1.8-4.4-4.4-1.6 4.3-1.7-1.8-4.3 4.4 1.6z" fill="currentColor" />
    </svg>
  );
}

/** The cast as a row of photos; each opens that person's page (everything they're in on this server). */
function CastRow({ cast }: { cast: NonNullable<Item['People']> }) {
  const api = useApi();
  const [all, setAll] = useState(false);
  const shown = all ? cast : cast.slice(0, 12);
  return (
    <section className="details-section" id="cast">
      <div className="section-head"><h2>Cast</h2></div>
      <ul className="cast-row">
        {shown.map((p) => {
          const img = p.Id && p.PrimaryImageTag ? api.imageUrl(p.Id, 'Primary', p.PrimaryImageTag, 240) : undefined;
          const body = (
            <>
              <span className="cast-photo">{img ? <img src={img} alt="" loading="lazy" /> : <span className="person-initial">{p.Name.trim().charAt(0)}</span>}</span>
              <span className="cast-name">{p.Name}</span>
              {p.Role && <span className="cast-role">{p.Role}</span>}
            </>
          );
          return <li key={`${p.Id ?? p.Name}-${p.Role ?? ''}`}>{p.Id ? <Link to={`/person/${p.Id}`} className="cast-card">{body}</Link> : <div className="cast-card">{body}</div>}</li>;
        })}
      </ul>
      {cast.length > 12 && (
        <button className="btn sm ghost cast-more" onClick={() => setAll((x) => !x)}>{all ? 'Show fewer' : `Show all ${cast.length}`}</button>
      )}
    </section>
  );
}
